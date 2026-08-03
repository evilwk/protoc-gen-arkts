import type { IFieldDescriptorProto } from 'protobufjs/ext/descriptor/index.js';
import { DescriptorModel } from '../model/descriptor-model.js';
import {
  LABEL_REPEATED,
  type EnumFieldModel,
  type FieldModel,
  type FileModel,
  type MapFieldModel,
  type MapTypeSymbol,
  type MessageFieldModel,
  type MessageTypeSymbol,
  type ScalarFieldModel,
  type ScalarShape,
  type TypeSymbol,
  type ValueFieldModel,
  TYPE_ENUM,
  TYPE_GROUP,
  TYPE_MESSAGE
} from '../model/types.js';
import { requireProtoIdentifier, toArkMemberName } from '../naming.js';
import {
  isPackable,
  requireScalarShape,
  shape,
  TYPE_BOOL,
  TYPE_FIXED32,
  TYPE_FIXED64,
  TYPE_INT32,
  TYPE_INT64,
  TYPE_SFIXED32,
  TYPE_SFIXED64,
  TYPE_SINT32,
  TYPE_SINT64,
  TYPE_STRING,
  TYPE_UINT32,
  TYPE_UINT64
} from './scalar-shapes.js';

interface DescriptorFieldWithPresence extends IFieldDescriptorProto {
  readonly proto3Optional?: boolean;
}

const MAP_KEY_TYPES: ReadonlySet<number> = new Set([
  TYPE_INT32,
  TYPE_INT64,
  TYPE_UINT32,
  TYPE_UINT64,
  TYPE_SINT32,
  TYPE_SINT64,
  TYPE_FIXED32,
  TYPE_FIXED64,
  TYPE_SFIXED32,
  TYPE_SFIXED64,
  TYPE_BOOL,
  TYPE_STRING
]);

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

    const oneofIndex: number | undefined = rawField.oneofIndex;
    if (oneofIndex !== undefined && (
      !Number.isInteger(oneofIndex)
      || oneofIndex < 0
      || oneofIndex >= (owner.message.oneofDecl?.length ?? 0)
    )) {
      throw new Error(`${context}: invalid oneof index ${oneofIndex}`);
    }

    const type: number = rawField.type ?? 0;
    if (type === TYPE_GROUP) {
      throw new Error(`${context}: group fields are not supported`);
    }

    const repeated: boolean = rawField.label === LABEL_REPEATED;
    const typeName: string = rawField.typeName ?? '';
    const target: TypeSymbol | undefined = type === TYPE_MESSAGE || type === TYPE_ENUM
      ? this.model.requireSymbol(typeName, context)
      : undefined;

    // protoc 将 map 编译成 repeated 的合成 entry message，这里还原为 ArkTS Map 字段。
    if (repeated && target?.kind === 'map') {
      if (oneofIndex !== undefined) {
        throw new Error(`${context}: map fields cannot belong to a oneof`);
      }
      return this.resolveMap(rawField, owner, target, protoName, name, number, type, typeName);
    }
    if (target?.kind === 'map') {
      throw new Error(`${context}: map entry ${target.fullName} cannot be used as a normal field type`);
    }

    const base: ScalarShape = target === undefined
      ? requireScalarShape(type, context)
      : this.shapeForSymbol(target);

    const packed: boolean = repeated && isPackable(type) && rawField.options?.packed !== false;

    const arkType: string = target?.kind === 'message' && !repeated
      ? `${base.arkType} | undefined`
      : repeated ? `collections.Array<${base.arkType}>` : base.arkType;

    const common = {
      protoName,
      name,
      number,
      type,
      typeName,
      repeated,
      packed,
      arkType,
      defaultValue: repeated ? `new collections.Array<${base.arkType}>()` : base.defaultValue,
      writerMethod: base.writerMethod,
      readerMethod: base.readerMethod,
      wireType: base.wireType,
      ...(oneofIndex === undefined ? {} : { oneofIndex })
    };

    if (target === undefined) {
      return { kind: 'scalar', ...common } satisfies ScalarFieldModel;
    }

    if (target.kind === 'enum') {
      return { kind: 'enum', symbol: target, ...common } satisfies EnumFieldModel;
    }

    return { kind: 'message', symbol: target, ...common } satisfies MessageFieldModel;
  }

  private resolveMap(
    rawField: IFieldDescriptorProto,
    owner: MessageTypeSymbol,
    target: MapTypeSymbol,
    protoName: string,
    name: string,
    number: number,
    type: number,
    typeName: string
  ): MapFieldModel {
    const context: string = `${this.file.fileName}: ${owner.fullName}.${protoName}`;
    const entryFields: IFieldDescriptorProto[] = target.message.field ?? [];
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
    if (!MAP_KEY_TYPES.has(keyRaw.type ?? 0)) {
      throw new Error(`${context}: invalid map key type ${keyRaw.type ?? 0}`);
    }
    const keyModel: ValueFieldModel = this.resolveMapComponent(keyRaw, owner, `${protoName}.key`);
    if (keyModel.kind !== 'scalar') {
      throw new Error(`${context}: map key must be a supported scalar type`);
    }
    const value: ValueFieldModel = this.resolveMapComponent(valueRaw, owner, `${protoName}.value`);
    return {
      kind: 'map',
      protoName,
      name,
      number,
      type,
      typeName,
      repeated: false,
      packed: false,
      arkType: `collections.Map<${keyModel.arkType}, ${value.arkType}>`,
      defaultValue: `new collections.Map<${keyModel.arkType}, ${value.arkType}>()`,
      writerMethod: '',
      readerMethod: '',
      wireType: 'LENGTH_DELIMITED',
      symbol: target,
      mapKey: keyModel,
      mapValue: value
    };
  }

  private resolveMapComponent(
    rawField: IFieldDescriptorProto,
    owner: MessageTypeSymbol,
    path: string
  ): ValueFieldModel {
    const context: string = `${this.file.fileName}: ${owner.fullName}.${path}`;
    if (rawField.label === LABEL_REPEATED) {
      throw new Error(`${context}: map entry components cannot be repeated`);
    }

    const type: number = rawField.type ?? 0;
    if (type === TYPE_GROUP) {
      throw new Error(`${context}: group fields are not supported`);
    }

    const target: TypeSymbol | undefined = type === TYPE_MESSAGE || type === TYPE_ENUM
      ? this.model.requireSymbol(rawField.typeName ?? '', context)
      : undefined;
    if (target?.kind === 'map') {
      throw new Error(`${context}: nested map entry ${target.fullName} is not supported`);
    }

    const base: ScalarShape = target === undefined
      ? requireScalarShape(type, context)
      : this.shapeForSymbol(target);

    const common = {
      protoName: path,
      name: path,
      number: rawField.number ?? 0,
      type,
      typeName: rawField.typeName ?? '',
      repeated: false,
      packed: false,
      ...base
    };

    if (target === undefined) {
      return { kind: 'scalar', ...common } satisfies ScalarFieldModel;
    }

    if (target.kind === 'enum') {
      return { kind: 'enum', symbol: target, ...common } satisfies EnumFieldModel;
    }

    return { kind: 'message', symbol: target, ...common } satisfies MessageFieldModel;
  }

  private shapeForSymbol(symbol: Exclude<TypeSymbol, MapTypeSymbol>): ScalarShape {
    const arkType: string = symbol.fileName === this.file.fileName
      ? symbol.arkName
      : this.imports.get(symbol.fullName) ?? symbol.arkName;

    if (symbol.kind === 'enum') {
      return shape('number', '0', 'writeInt32', 'readInt32', 'VARINT');
    }
    return shape(arkType, 'undefined', 'writeBytes', 'readBytes', 'LENGTH_DELIMITED');
  }
}
