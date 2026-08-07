import type { IOneofDescriptorProto } from 'protobufjs/ext/descriptor/index.js';
import { isBytesType, scalarTypeName } from '../model/descriptor-types.js';
import type { EnumFieldModel, FieldModel, MapFieldModel, ScalarShape, ValueFieldModel } from '../model/field-model.js';
import { requireArkMemberName, toUpperCamel } from '../naming.js';
import { renderSource } from '../source-template.js';
import { requireScalarShape } from './scalar-shapes.js';
import { isSpecialWktMessage } from './wkt-json-kind.js';

/**
 * 从解析后的字段模型渲染全部 JSON 方法。
 */
export class JsonCodecRenderer {
  public constructor(
    private readonly messageName: string,
    private readonly oneofs: IOneofDescriptorProto[],
  ) {}

  public renderTraversal(fields: FieldModel[]): string {
    return fields.map((field): string => this.renderTraversalField(field)).join('\n');
  }

  public renderReadJson(fields: FieldModel[]): string {
    const cases: string = fields.map((field): string => this.renderReadCase(field)).join('\n');
    const initialOneofCases: string = this.oneofs.map((): string => '0').join(', ');
    return renderSource`
      static readJson(reader: JsonReader, ignoreUnknownFields: boolean): ${this.messageName} {
        const message: ${this.messageName} = new ${this.messageName}();
        const seenFields: Set<number> = new Set<number>();
        const oneofCases: number[] = [${initialOneofCases}];
        reader.beginObject();
        while (reader.hasMoreMembers()) {
          const key: string = reader.readKey();
          switch (key) {
            ${cases}
            default:
              if (!ignoreUnknownFields) {
                throw new Error('Unknown JSON field: ' + key);
              }
              reader.skipValue();
          }
        }
        reader.endObject();
        return message;
      }`;
  }

  public renderToJson(): string {
    return renderSource`
      toJson(): string {
        return ProtoJson.write(this);
      }`;
  }

  public renderFromJson(): string {
    return renderSource`
      static fromJson(text: string, ignoreUnknownFields: boolean = false): ${this.messageName} {
        const reader: JsonReader = new JsonReader(text);
        const message: ${this.messageName} = ${this.messageName}.readJson(reader, ignoreUnknownFields);
        reader.requireEndOfInput();
        return message;
      }`;
  }

  private renderTraversalField(field: FieldModel): string {
    const fieldInfo: string = 'fieldInfo';
    const jsonName: string = field.jsonName === field.protoName ? '' : `, ${quote(field.jsonName)}`;
    const declaration: string = `const fieldInfo: FieldInfo = new FieldInfo(${field.number}, ${quote(field.protoName)}${jsonName});`;
    const runtimeJsonName: string = field.jsonName === field.protoName ? 'undefined' : quote(field.jsonName);
    if (field.kind === 'map') {
      return renderSource`
        ProtoJson.traverseMap<${field.mapKey.arkType}, ${field.mapValue.arkType}>(
          visitor, this.${field.name}, ${field.number}, ${quote(field.protoName)}, ${runtimeJsonName},
          (key: ${field.mapKey.arkType}, value: ${field.mapValue.arkType}, fieldInfo: FieldInfo) => {
            visitor.mapKey(${this.mapKeyToString('key', field.mapKey)});
            ${this.renderVisitValue(field.mapValue, 'value', fieldInfo)}
          });`;
    }
    if (field.repeated) {
      const elementType: string = repeatedElementType(field);
      const visit: string = this.renderVisitValue(field, 'value', fieldInfo);
      const callback: string = visit.includes('\n')
        ? renderSource`
            (value: ${elementType}, fieldInfo: FieldInfo) => {
              ${visit}
            }`
        : `(value: ${elementType}, fieldInfo: FieldInfo) => ${withoutTrailingSemicolon(visit)}`;
      return renderSource`
        ProtoJson.traverseRepeated<${elementType}>(
          visitor, this.${field.name}, ${field.number}, ${quote(field.protoName)}, ${runtimeJsonName},
          ${callback});`;
    }
    const condition: string = this.traversalCondition(field);
    if (field.kind !== 'enum') {
      return this.renderSingularTraversal(field, condition);
    }
    return renderSource`
      if (${condition}) {
        ${declaration}
        ${this.renderVisitValue(field, `this.${field.name}`, fieldInfo)}
      }`;
  }

  private renderSingularTraversal(field: ValueFieldModel, condition: string): string {
    const jsonName: string = field.jsonName === field.protoName ? '' : `, ${quote(field.jsonName)}`;
    const metadata: string = `${field.number}, ${quote(field.protoName)}${jsonName}`;
    const value: string = `this.${field.name}`;
    if (field.kind === 'message') {
      const method: string = isSpecialWktMessage(field.symbol.fullName)
        ? 'visitMessageField'
        : 'traverseMessageField';
      return `ProtoJson.${method}(visitor, ${condition}, ${value}, ${metadata});`;
    }
    if (isBytesType(field.type)) {
      return `ProtoJson.traverseBytesField(visitor, ${condition}, ${value}, ${metadata});`;
    }
    const typeName: string = scalarTypeName(field.type) ?? '';
    // prettier-ignore
    if (typeName === 'int64' || typeName === 'uint64' || typeName === 'sint64' ||
      typeName === 'fixed64' || typeName === 'sfixed64'
    ) {
      return `ProtoJson.traverseBigIntField(visitor, ${condition}, ${value}, ProtoValueKind.${kindFor(typeName)}, ${metadata});`;
    }
    if (typeName === 'bool') {
      return `ProtoJson.traverseBoolField(visitor, ${condition}, ${value}, ${metadata});`;
    }
    if (typeName === 'string') {
      return `ProtoJson.traverseStringField(visitor, ${condition}, ${value}, ${metadata});`;
    }
    return `ProtoJson.traverseNumberField(visitor, ${condition}, ${value}, ProtoValueKind.${kindFor(typeName)}, ${metadata});`;
  }

  private renderVisitValue(field: ValueFieldModel, value: string, fieldInfo: string): string {
    if (field.kind === 'message') {
      if (isSpecialWktMessage(field.symbol.fullName)) {
        return `visitor.visitMessage(${value}, ${fieldInfo});`;
      }
      return `ProtoJson.traverseMessage(visitor, ${fieldInfo}, ${value});`;
    }
    if (field.kind === 'enum') {
      return this.renderEnumVisit(field, value, fieldInfo);
    }
    const typeName: string = scalarTypeName(field.type) ?? '';
    if (typeName === 'bytes') {
      return `visitor.visitBytes(${value}, ${fieldInfo});`;
    }
    // prettier-ignore
    if (typeName === 'int64' || typeName === 'uint64' || typeName === 'sint64' ||
      typeName === 'fixed64' || typeName === 'sfixed64'
    ) {
      return `visitor.visitBigInt(${value}, ProtoValueKind.${kindFor(typeName)}, ${fieldInfo});`;
    }
    if (typeName === 'bool') {
      return `visitor.visitBool(${value}, ${fieldInfo});`;
    }
    if (typeName === 'string') {
      return `visitor.visitString(${value}, ${fieldInfo});`;
    }
    return `visitor.visitNumber(${value}, ProtoValueKind.${kindFor(typeName)}, ${fieldInfo});`;
  }

  private traversalCondition(field: ValueFieldModel): string {
    if (field.oneofIndex !== undefined) {
      const oneof: string = requireArkMemberName(this.oneofs[field.oneofIndex]?.name, 'oneof name');
      const messageGuard: string = field.kind === 'message' ? ` && this.${field.name} !== undefined` : '';
      return `this.${oneof}Case === ${field.number}${messageGuard}`;
    }
    if (field.kind === 'message') {
      return `this.${field.name} !== undefined`;
    }
    if (isBytesType(field.type)) {
      return `this.${field.name}.length !== 0`;
    }
    return `this.${field.name} !== ${field.defaultValue}`;
  }

  private renderReadCase(field: FieldModel): string {
    const statements: string = [
      this.renderReadGuard(field),
      this.renderCaseOneofGuard(field),
      this.renderReadBody(field),
      'break;',
    ]
      .filter((statement): boolean => statement.length !== 0)
      .join('\n');
    return renderSource`
      ${this.renderCaseLabels(field)}
        ${statements}`;
  }

  /**
   * JSON 名与 proto 名都要接受，两者一致时只发一个 case。
   */
  private renderCaseLabels(field: FieldModel): string {
    // prettier-ignore
    const aliases: string[] = field.protoName === field.jsonName
      ? [field.jsonName]
      : [field.jsonName, field.protoName];
    return aliases.map((name): string => `case ${quote(name)}:`).join('\n');
  }

  /**
   * JSON null 表示"保持默认值"，因此读掉即可；
   * NullValue 与 Value 例外，null 是它们的有效取值。
   */
  private renderReadGuard(field: FieldModel): string {
    if (acceptsJsonNullAsValue(field)) {
      return `ProtoJson.requireUnseenField(seenFields, ${field.number});`;
    }
    return `if (ProtoJson.skipNullField(reader, seenFields, ${field.number})) { break; }`;
  }

  private renderCaseOneofGuard(field: FieldModel): string {
    if (field.kind === 'map' || field.oneofIndex === undefined) {
      return '';
    }
    return this.renderOneofGuard(field);
  }

  private renderReadBody(field: FieldModel): string {
    if (field.kind === 'map') {
      return this.renderReadMap(field);
    }
    return field.repeated ? this.renderReadRepeated(field) : this.renderReadSingular(field);
  }

  private renderEnumVisit(field: EnumFieldModel, value: string, fieldInfo: string): string {
    if (isNullValue(field)) {
      return renderSource`
        if (${value} === 0) {
          visitor.visitNull(${fieldInfo});
        } else {
          visitor.visitEnum(${value}, undefined, ${fieldInfo});
        }`;
    }

    const seen: Set<number> = new Set();
    const cases: string[] = [];
    for (const enumValue of field.symbol.enum.value ?? []) {
      const number: number = enumValue.number ?? 0;
      if (seen.has(number)) {
        continue;
      }
      seen.add(number);
      cases.push(`case ${number}: name = ${quote(enumValue.name ?? '')}; break;`);
    }

    return renderSource`
      let name: string | undefined = undefined;
      switch (${value}) {
        ${cases.join('\n')}
      }
      visitor.visitEnum(${value}, name, ${fieldInfo});`;
  }

  private renderOneofGuard(field: ValueFieldModel): string {
    const index: number = field.oneofIndex ?? 0;
    return `ProtoJson.requireOneof(oneofCases, ${index}, ${field.number}, ${quote(this.oneofs[index]?.name ?? '')});`;
  }

  private renderReadSingular(field: ValueFieldModel): string {
    if (field.kind === 'enum') {
      return this.renderEnumAssignment(field, this.renderStore(field, 'value'));
    }
    return this.renderStore(field, this.renderReadValue(field));
  }

  private renderReadRepeated(field: ValueFieldModel): string {
    if (field.kind === 'enum') {
      return renderSource`
        ProtoJson.readRepeatedEnum(reader,
          (value: number) => ProtoContainers.append(message.${field.name}, value),
          (): number | undefined => {
            ${this.renderEnumRead(field)}
            return knownEnumValue ? value : undefined;
          });`;
    }
    const elementType: string = repeatedElementType(field);
    return renderSource`
      ProtoJson.readRepeated<${elementType}>(reader,
        (value: ${elementType}) => ProtoContainers.append(message.${field.name}, value),
        () => ${this.renderReadValue(field)});`;
  }

  /**
   * 单个 message 或标量值的读取表达式；enum 不走这里，它另有 knownEnumValue 流程。
   */
  private renderReadValue(field: ValueFieldModel): string {
    if (field.kind === 'message') {
      return `${field.symbol.arkName}.readJson(reader, ignoreUnknownFields)`;
    }
    return this.renderReadScalar(field, 'reader');
  }

  /**
   * 把读到的值写回 message。
   *
   * oneof 成员必须走 setter 以同步 case 状态，其余字段直接赋值。
   */
  private renderStore(field: ValueFieldModel, value: string): string {
    if (field.oneofIndex === undefined) {
      return `message.${field.name} = ${value};`;
    }
    return `message.set${toUpperCamel(field.name)}(${value});`;
  }

  private renderReadMap(field: MapFieldModel): string {
    const key: string = this.renderMapKey(field.mapKey).replace('{keyText}', 'text');
    const readValue: string = field.mapValue.kind === 'enum'
      ? renderSource`
          (): number | undefined => {
            ${this.renderEnumRead(field.mapValue)}
            return knownEnumValue ? value : undefined;
          }`
      : `() => ${this.renderReadValue(field.mapValue)}`;
    return renderSource`
      ProtoJson.readMap<${field.mapKey.arkType}, ${field.mapValue.arkType}>(reader,
        (key: ${field.mapKey.arkType}, value: ${field.mapValue.arkType}) =>
          ProtoContainers.setMapValue(message.${field.name}, key, value),
        (text: string) => ${key},
        ${readValue});`;
  }

  /**
   * enum 读取加写回：未知值不写入，由调用方给出命中时的写回语句。
   */
  private renderEnumAssignment(field: EnumFieldModel, store: string): string {
    return renderSource`
      {
        ${this.renderEnumRead(field)}
        if (knownEnumValue) {
          ${store}
        }
      }`;
  }

  private renderEnumRead(field: EnumFieldModel): string {
    return renderSource`
      let value: number = 0;
      let knownEnumValue: boolean = true;
      ${this.renderEnumReadBody(field)}`;
  }

  /**
   * enum 取值支持名字与数字两种 JSON 形态。
   *
   * NullValue 额外接受 null，此时整段读取包在 `else { … }` 里。
   */
  private renderEnumReadBody(field: EnumFieldModel): string {
    const read: string = this.renderEnumNameOrNumberRead(field);
    if (!isNullValue(field)) {
      return read;
    }
    return renderSource`
      if (ProtoJson.isNull(reader)) {
        reader.readNull();
        value = 0;
      } else {
        ${read}
      }`;
  }

  private renderEnumNameOrNumberRead(field: EnumFieldModel): string {
    const values: string = (field.symbol.enum.value ?? [])
      .map((value): string => `case ${quote(value.name ?? '')}: value = ${value.number ?? 0}; break;`)
      .join('\n');
    return renderSource`
      if (ProtoJson.isString(reader)) {
        const name: string = reader.readString();
        switch (name) {
          ${values}
          default:
            if (ignoreUnknownFields) {
              knownEnumValue = false;
            } else {
              throw new Error('Unknown enum value: ' + name);
            }
        }
      } else {
        value = ProtoJson.readInt32(reader);
      }`;
  }

  /**
   * JSON 的标量读取方法名与线格式一致，直接复用标量形态表，避免再维护一份类型阶梯。
   */
  private renderReadScalar(field: ValueFieldModel, reader: string): string {
    const shape: ScalarShape = requireScalarShape(field.type, 'JSON scalar');
    return `ProtoJson.${shape.readerMethod}(${reader})`;
  }

  private renderMapKey(field: ValueFieldModel): string {
    const typeName: string = scalarTypeName(field.type) ?? '';
    switch (typeName) {
      case 'string':
        return '{keyText}';
      case 'bool':
        return 'ProtoJson.parseBoolMapKey({keyText})';
      case 'int32':
      case 'sint32':
      case 'sfixed32':
        return 'ProtoJson.parseInt32MapKey({keyText})';
      case 'uint32':
      case 'fixed32':
        return 'ProtoJson.parseUInt32MapKey({keyText})';
      case 'int64':
      case 'sint64':
      case 'sfixed64':
        return 'ProtoJson.parseInt64MapKey({keyText})';
      case 'uint64':
      case 'fixed64':
        return 'ProtoJson.parseUInt64MapKey({keyText})';
      default:
        throw new Error(`Unsupported JSON map key type ${typeName}`);
    }
  }

  private mapKeyToString(value: string, field: ValueFieldModel): string {
    const typeName: string = scalarTypeName(field.type) ?? '';
    return typeName === 'string' ? value : `\`\${${value}}\``;
  }
}

function isNullValue(field: FieldModel): boolean {
  return field.kind === 'enum' && field.symbol.fullName === '.google.protobuf.NullValue';
}

function acceptsJsonNullAsValue(field: FieldModel): boolean {
  // prettier-ignore
  return isNullValue(field) ||
    (field.kind === 'message' && field.symbol.fullName === '.google.protobuf.Value');
}

function kindFor(typeName: string): string {
  return typeName.toUpperCase();
}

function quote(value: string): string {
  return JSON.stringify(value);
}

function repeatedElementType(field: ValueFieldModel): string {
  const prefix: string = 'collections.Array<';
  if (!field.arkType.startsWith(prefix) || !field.arkType.endsWith('>')) {
    throw new Error(`Expected repeated field type, got ${field.arkType}`);
  }
  return field.arkType.slice(prefix.length, -1);
}

function withoutTrailingSemicolon(source: string): string {
  return source.endsWith(';') ? source.slice(0, -1) : source;
}
