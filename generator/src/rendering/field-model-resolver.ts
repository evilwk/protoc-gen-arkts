import type { IFieldDescriptorProto } from 'protobufjs/ext/descriptor/index.js';
import { DescriptorModel } from '../model/descriptor-model.js';
import {
  isGroupType,
  isMapKeyType,
  isNamedType,
  isPackable,
  isRepeatedLabel
} from '../model/descriptor-types.js';
import {
  toValueFieldModel,
  type FieldModel,
  type FieldModelBase,
  type MapFieldModel,
  type ScalarShape,
  type ValueFieldModel
} from '../model/field-model.js';
import type {
  FieldTypeSymbol,
  FileModel,
  MapTypeSymbol,
  MessageTypeSymbol,
  TypeSymbol
} from '../model/symbols.js';
import { requireProtoIdentifier, toArkMemberName } from '../naming.js';
import { requireScalarShape, shape } from './scalar-shapes.js';

interface DescriptorFieldWithPresence extends IFieldDescriptorProto {
  readonly proto3Optional?: boolean;
}

/**
 * 字段声明的类型信息：protobuf 类型编号、全名，以及 message/enum 字段解析出的符号。
 *
 * 标量字段没有对应符号，`symbol` 为 undefined。
 */
interface FieldTypeInfo {
  readonly type: number;
  readonly typeName: string;
  readonly symbol: TypeSymbol | undefined;
}

/**
 * 解析标量 / enum / message 字段所需的入参；由 resolve() 完成通用校验后一次性传入。
 */
interface ResolveValueParams {
  readonly rawField: IFieldDescriptorProto;
  readonly context: string;
  readonly protoName: string;
  readonly name: string;
  readonly number: number;
  readonly type: number;
  readonly typeName: string;
  readonly resolvedSymbol: FieldTypeSymbol | undefined;
  readonly repeated: boolean;
  readonly oneofIndex: number | undefined;
}

/**
 * 解析 map 字段所需的入参；由 resolve() 完成通用校验后一次性传入。
 */
interface ResolveMapParams {
  readonly rawField: IFieldDescriptorProto;
  readonly owner: MessageTypeSymbol;
  readonly entrySymbol: MapTypeSymbol;
  readonly protoName: string;
  readonly name: string;
  readonly number: number;
  readonly type: number;
  readonly typeName: string;
}

/**
 * 将 descriptor 字段转换为只读判别联合，并关闭字段级非法状态。
 */
export class FieldModelResolver {
  public constructor(
    private readonly file: FileModel,
    private readonly model: DescriptorModel,
    private readonly imports: ReadonlyMap<string, string>
  ) {
  }

  public resolve(rawField: IFieldDescriptorProto, owner: MessageTypeSymbol): FieldModel {
    const field: DescriptorFieldWithPresence = rawField;

    // --- 校验字段标识与编号 ---
    const protoName: string = requireProtoIdentifier(
      rawField.name,
      `${this.file.fileName}: ${owner.fullName} field name`
    );

    const context: string = `${this.file.fileName}: ${owner.fullName}.${protoName}`;
    const name: string = toArkMemberName((rawField.jsonName as string | undefined) ?? protoName);
    const number: number = rawField.number ?? 0;

    if (!Number.isInteger(number) || number < 1 || number > 0x1fffffff) {
      throw new Error(`${context}: invalid field number ${number}`);
    }

    if (field.proto3Optional === true) {
      throw new Error(`${context}: proto3 optional is not supported`);
    }

    // --- 校验 oneof 归属 ---
    const oneofIndex: number | undefined = rawField.oneofIndex;
    if (oneofIndex !== undefined && (!Number.isInteger(oneofIndex) ||
      oneofIndex < 0 || oneofIndex >= (owner.message.oneofDecl?.length ?? 0))
    ) {
      throw new Error(`${context}: invalid oneof index ${oneofIndex}`);
    }

    // --- 解析字段类型符号 ---
    const typeInfo: FieldTypeInfo = this.resolveFieldType(rawField, context);
    const { type, typeName } = typeInfo;
    const resolvedSymbol: TypeSymbol | undefined = typeInfo.symbol;
    const repeated: boolean = isRepeatedLabel(rawField.label);

    // --- 按字段种类分派 ---
    // protoc 将 map 编译成 repeated 的合成 entry message，这里还原为 ArkTS Map 字段。
    if (repeated && resolvedSymbol?.kind === 'map') {
      if (oneofIndex !== undefined) {
        throw new Error(`${context}: map fields cannot belong to a oneof`);
      }
      return this.resolveMap({
        rawField,
        owner,
        entrySymbol: resolvedSymbol,
        protoName,
        name,
        number,
        type,
        typeName
      });
    }
    if (resolvedSymbol?.kind === 'map') {
      throw new Error(
        `${context}: map entry ${resolvedSymbol.fullName} cannot be used as a normal field type`
      );
    }

    return this.resolveValue({
      rawField,
      context,
      protoName,
      name,
      number,
      type,
      typeName,
      resolvedSymbol,
      repeated,
      oneofIndex
    });
  }

  /**
   * 解析标量、enum 或 message 字段（含 repeated 形态）。
   */
  private resolveValue(params: ResolveValueParams): ValueFieldModel {
    const {
      rawField, context, protoName, name, number, type, typeName,
      resolvedSymbol, repeated, oneofIndex
    } = params;

    // --- 构造标量形态 ---
    const scalarShape: ScalarShape = this.requireShape(resolvedSymbol, type, context);

    // --- 计算 ArkTS 类型与默认值 ---
    // 非 repeated 的 message 字段用 `| undefined` 表达“未设置”，repeated 字段统一包成 collections.Array。
    const arkType: string = resolvedSymbol?.kind === 'message' && !repeated
      ? `${scalarShape.arkType} | undefined`
      : repeated ? `collections.Array<${scalarShape.arkType}>` : scalarShape.arkType;

    const packed: boolean = repeated && isPackable(type) && rawField.options?.packed !== false;

    const fieldBase: FieldModelBase = {
      protoName,
      name,
      number,
      type,
      typeName,
      repeated,
      packed,
      arkType,
      defaultValue: repeated ? `new collections.Array<${scalarShape.arkType}>()` : scalarShape.defaultValue,
      writerMethod: scalarShape.writerMethod,
      readerMethod: scalarShape.readerMethod,
      wireType: scalarShape.wireType,
      ...(oneofIndex === undefined ? {} : { oneofIndex })
    };

    return toValueFieldModel(fieldBase, resolvedSymbol);
  }

  private resolveMap(params: ResolveMapParams): MapFieldModel {
    const { owner, entrySymbol, protoName, name, number, type, typeName } = params;
    const context: string = `${this.file.fileName}: ${owner.fullName}.${protoName}`;

    // --- 校验合成 entry message 的结构 ---
    const entryFields: IFieldDescriptorProto[] = entrySymbol.message.field ?? [];
    const keyFields: IFieldDescriptorProto[] = entryFields.filter((item): boolean => item.number === 1);
    const valueFields: IFieldDescriptorProto[] = entryFields.filter((item): boolean => item.number === 2);

    if (entryFields.length !== 2 || keyFields.length !== 1 || valueFields.length !== 1) {
      throw new Error(`${context}: invalid map entry ${typeName}`);
    }

    const keyRaw: IFieldDescriptorProto | undefined = keyFields[0];
    const valueRaw: IFieldDescriptorProto | undefined = valueFields[0];
    if (keyRaw === undefined || valueRaw === undefined) {
      throw new Error(`${context}: invalid map entry ${typeName}`);
    }

    if (!isMapKeyType(keyRaw.type ?? 0)) {
      throw new Error(`${context}: invalid map key type ${keyRaw.type ?? 0}`);
    }

    // --- 解析 key / value 分量 ---
    const mapKey: ValueFieldModel = this.resolveMapComponent(keyRaw, owner, `${protoName}.key`);
    if (mapKey.kind !== 'scalar') {
      throw new Error(`${context}: map key must be a supported scalar type`);
    }

    const mapValue: ValueFieldModel = this.resolveMapComponent(valueRaw, owner, `${protoName}.value`);
    return {
      kind: 'map',
      protoName,
      name,
      number,
      type,
      typeName,
      repeated: false,
      packed: false,
      arkType: `collections.Map<${mapKey.arkType}, ${mapValue.arkType}>`,
      defaultValue: `new collections.Map<${mapKey.arkType}, ${mapValue.arkType}>()`,
      writerMethod: '',
      readerMethod: '',
      wireType: 'LENGTH_DELIMITED',
      symbol: entrySymbol,
      mapKey,
      mapValue
    };
  }

  private resolveMapComponent(
    rawField: IFieldDescriptorProto,
    owner: MessageTypeSymbol,
    path: string
  ): ValueFieldModel {
    const context: string = `${this.file.fileName}: ${owner.fullName}.${path}`;
    if (isRepeatedLabel(rawField.label)) {
      throw new Error(`${context}: map entry components cannot be repeated`);
    }

    const { type, typeName, symbol } = this.resolveFieldType(rawField, context);
    if (symbol?.kind === 'map') {
      throw new Error(`${context}: nested map entry ${symbol.fullName} is not supported`);
    }

    const scalarShape: ScalarShape = this.requireShape(symbol, type, context);

    // map 分量不参与 repeated / packed 形态，直接沿用标量形态字段。
    const fieldBase: FieldModelBase = {
      protoName: path,
      name: path,
      number: rawField.number ?? 0,
      type,
      typeName,
      repeated: false,
      packed: false,
      ...scalarShape
    };

    return toValueFieldModel(fieldBase, symbol);
  }

  /**
   * 校验字段类型并解析 message/enum 引用的符号，供普通字段与 map 分量共用。
   */
  private resolveFieldType(rawField: IFieldDescriptorProto, context: string): FieldTypeInfo {
    const type: number = rawField.type ?? 0;
    if (isGroupType(type)) {
      throw new Error(`${context}: group fields are not supported`);
    }

    const typeName: string = rawField.typeName ?? '';
    const symbol: TypeSymbol | undefined = isNamedType(type)
      ? this.model.requireSymbol(typeName, context)
      : undefined;

    return { type, typeName, symbol };
  }

  /**
   * 取字段的标量形态：标量类型查表，message/enum 由符号推导。
   */
  private requireShape(
    symbol: FieldTypeSymbol | undefined,
    type: number,
    context: string
  ): ScalarShape {
    return symbol === undefined
      ? requireScalarShape(type, context)
      : this.shapeForSymbol(symbol);
  }

  private shapeForSymbol(symbol: FieldTypeSymbol): ScalarShape {
    const arkType: string = symbol.fileName === this.file.fileName
      ? symbol.arkName
      : this.imports.get(symbol.fullName) ?? symbol.arkName;

    if (symbol.kind === 'enum') {
      return shape('number', '0', 'writeInt32', 'readInt32', 'VARINT');
    }
    return shape(arkType, 'undefined', 'writeBytes', 'readBytes', 'LENGTH_DELIMITED');
  }
}
