import type { IOneofDescriptorProto } from 'protobufjs/ext/descriptor/index.js';
import { isBytesType } from '../model/descriptor-types.js';
import type {
  EnumFieldModel,
  FieldModel,
  MapFieldModel,
  MessageFieldModel,
  ValueFieldModel,
} from '../model/field-model.js';
import { requireArkMemberName, toUpperCamel } from '../naming.js';
import { renderSource } from '../source-template.js';
import { wireTypeNumber } from './scalar-shapes.js';

/**
 * 根据已解析字段模型生成 encode/decode 片段，不再访问原始 descriptor。
 */
export class FieldCodecRenderer {
  public constructor(
    private readonly ownerName: string,
    private readonly oneofs: IOneofDescriptorProto[],
  ) {}

  public renderEncoder(field: FieldModel): string {
    if (field.kind === 'map') {
      return this.renderMapEncoder(field);
    }

    if (field.repeated) {
      // prettier-ignore
      return field.packed
        ? this.renderPackedRepeatedEncoder(field)
        : this.renderUnpackedRepeatedEncoder(field);
    }

    return this.renderSingularEncoder(field);
  }

  public renderDecoder(field: FieldModel): string {
    if (field.kind === 'map') {
      return this.renderMapDecoder(field);
    }

    // 解码看 packable 而非 packed：声明为非 packed 的字段也必须接受 packed 输入。
    if (field.repeated && field.packable) {
      return this.renderPackedRepeatedDecoder(field);
    }

    return this.renderTaggedDecoder(field);
  }

  public renderMapReader(field: MapFieldModel): string {
    const mapKey: ValueFieldModel = field.mapKey;
    const mapValue: ValueFieldModel = field.mapValue;
    const keyRead: string = this.renderReadValue('reader', mapKey);
    const valueRead: string = this.renderReadValue('reader', mapValue);

    // prettier-ignore
    const valueDefault: string = mapValue.kind === 'message'
      ? `new ${mapValue.arkType}()`
      : mapValue.defaultValue;

    // 生成读取单个 map entry 的静态方法：逐字段解析 entry 后写回 map。
    return renderSource`
      private static read${toUpperCamel(field.name)}Entry(bytes: Uint8Array, message: ${this.ownerName}): void {
        const reader: ProtoReader = new ProtoReader(bytes);
        let key: ${mapKey.arkType} = ${mapKey.defaultValue};
        let value: ${mapValue.arkType} = ${valueDefault};
        while (!reader.isAtEnd()) {
          const tag: number = reader.readTag();
          switch (tag) {
            case ${8 + wireTypeNumber(mapKey.wireType)}:
              key = ${keyRead};
              break;
            case ${16 + wireTypeNumber(mapValue.wireType)}:
              value = ${valueRead};
              break;
            default:
              reader.skipField(Math.floor(tag / 8), tag & 0x07);
          }
        }
        ProtoContainers.setMapValue(message.${field.name}, key, value);
      }`;
  }

  /**
   * 非 repeated 字段：仅在值与默认值不同（或 oneof 命中）时写出 tag + 值。
   */
  private renderSingularEncoder(field: ValueFieldModel): string {
    // prettier-ignore
    const oneofName: string | undefined = field.oneofIndex === undefined
        ? undefined
        : requireArkMemberName(this.oneofs[field.oneofIndex]?.name, 'oneof name');

    const access: string = `this.${field.name}`;
    let condition: string;
    if (oneofName !== undefined) {
      condition = `this.${oneofName}Case === ${field.number}`;
    } else if (field.kind === 'message') {
      condition = `${access} !== undefined`;
    } else if (isBytesType(field.type)) {
      condition = `${access}.length !== 0`;
    } else {
      condition = `${access} !== ${field.defaultValue}`;
    }

    const valueWrite: string = this.renderWriteValue('writer', field, access);
    // prettier-ignore
    const messageGuard: string = field.kind === 'message' && oneofName !== undefined
      ? ` && ${access} !== undefined`
      : '';

    return renderSource`
      if (${condition}${messageGuard}) {
        writer.writeTag(${field.number}, ProtoWireType.${field.wireType});
        ${valueWrite}
      }`;
  }

  /**
   * 非 packed repeated 字段：每个元素各写一次 tag + 值。
   */
  private renderUnpackedRepeatedEncoder(field: ValueFieldModel): string {
    const value: string = `this.${field.name}[index]`;
    return renderSource`
      for (let index: number = 0; index < this.${field.name}.length; index++) {
        writer.writeTag(${field.number}, ProtoWireType.${field.wireType});
        ${this.renderWriteValue('writer', field, value)}
      }`;
  }

  /**
   * packed repeated 字段：所有元素先写入子 writer，再作为单个长度前缀块写出。
   */
  private renderPackedRepeatedEncoder(field: ValueFieldModel): string {
    return renderSource`
      if (this.${field.name}.length !== 0) {
        const packedWriter: ProtoWriter = new ProtoWriter();
        for (let index: number = 0; index < this.${field.name}.length; index++) {
          ${this.renderWriteValue('packedWriter', field, `this.${field.name}[index]`)}
        }
        writer.writeTag(${field.number}, ProtoWireType.LENGTH_DELIMITED);
        writer.writeBytes(packedWriter.finish());
      }`;
  }

  /**
   * map 字段：遍历 key 列表，把每个 entry 编码成独立的长度前缀块。
   */
  private renderMapEncoder(field: MapFieldModel): string {
    const mapKey: ValueFieldModel = field.mapKey;
    const mapValue: ValueFieldModel = field.mapValue;
    return renderSource`
      const ${field.name}Keys: collections.Array<${mapKey.arkType}> = ProtoContainers.mapKeys(this.${field.name});
      for (let index: number = 0; index < ${field.name}Keys.length; index++) {
        const key: ${mapKey.arkType} = ${field.name}Keys[index];
        const value: ${mapValue.arkType} | undefined = ProtoContainers.mapValue(this.${field.name}, key);
        if (value !== undefined) {
          const entryWriter: ProtoWriter = new ProtoWriter();
          entryWriter.writeTag(1, ProtoWireType.${mapKey.wireType});
          ${this.renderWriteValue('entryWriter', mapKey, 'key')}
          entryWriter.writeTag(2, ProtoWireType.${mapValue.wireType});
          ${this.renderWriteValue('entryWriter', mapValue, 'value')}
          writer.writeTag(${field.number}, ProtoWireType.LENGTH_DELIMITED);
          writer.writeBytes(entryWriter.finish());
        }
      }`;
  }

  private renderWriteValue(writer: string, field: ValueFieldModel, value: string): string {
    if (field.kind === 'message') {
      return `${writer}.writeBytes(${value}.encode());`;
    }
    return `${writer}.${field.writerMethod}(${value});`;
  }

  /**
   * map 字段：把 entry 字节交给对应的静态读取方法。
   */
  private renderMapDecoder(field: MapFieldModel): string {
    return renderSource`
      case ${field.number * 8 + 2}:
        ${this.ownerName}.read${toUpperCamel(field.name)}Entry(reader.readSlice(), message);
        break;`;
  }

  /**
   * 单 tag 分支：按 repeated / oneof / message / enum 分派赋值语句。
   */
  private renderTaggedDecoder(field: ValueFieldModel): string {
    const tag: number = field.number * 8 + wireTypeNumber(field.wireType);
    const readExpression: string = this.renderReadValue('reader', field);

    let assignment: string;
    if (field.repeated) {
      assignment = this.renderRepeatedAssignment(field, readExpression);
    } else if (field.oneofIndex !== undefined) {
      // prettier-ignore
      const oneofName: string = requireArkMemberName(
        this.oneofs[field.oneofIndex]?.name,
        'oneof name'
      );
      assignment = this.renderOneofDecode(field, oneofName, readExpression);
    } else if (field.kind === 'message') {
      const typeName: string = concreteType(field);
      assignment = `message.${field.name} = ${typeName}.mergeFrom(reader.readSlice(), message.${field.name} ?? new ${typeName}());`;
    } else if (field.kind === 'enum') {
      assignment = this.renderEnumAssignment(field, readExpression, `message.${field.name} = value;`);
    } else {
      assignment = `message.${field.name} = ${readExpression};`;
    }

    return renderSource`
      case ${tag}:
        ${assignment}
        break;`;
  }

  /**
   * packed repeated 字段：同时接受非 packed 的单值 tag 与 packed 的长度前缀块。
   */
  private renderPackedRepeatedDecoder(field: ValueFieldModel): string {
    const unpackedTag: number = field.number * 8 + wireTypeNumber(field.wireType);
    const packedTag: number = field.number * 8 + 2;
    const unpackedRead: string = this.renderReadValue('reader', field);
    const packedRead: string = this.renderReadValue('packedReader', field);
    const unpackedAssignment: string = this.renderRepeatedAssignment(field, unpackedRead);
    const packedAssignment: string = this.renderRepeatedAssignment(field, packedRead);
    return renderSource`
      case ${unpackedTag}:
        ${unpackedAssignment}
        break;
      case ${packedTag}: {
        const packedReader: ProtoReader = new ProtoReader(reader.readSlice());
        while (!packedReader.isAtEnd()) {
          ${packedAssignment}
        }
        break;
      }`;
  }

  private renderRepeatedAssignment(field: ValueFieldModel, readExpression: string): string {
    if (field.kind === 'enum') {
      // prettier-ignore
      return this.renderEnumAssignment(
        field,
        readExpression,
        `ProtoContainers.append(message.${field.name}, value);`
      );
    }
    return `ProtoContainers.append(message.${field.name}, ${readExpression});`;
  }

  /**
   * enum 字段：只接受 descriptor 声明过的取值，未知值按 proto3 规则丢弃。
   */
  private renderEnumAssignment(field: EnumFieldModel, readExpression: string, assignment: string): string {
    const cases: string = field.symbol.enumValues.map((value): string => `case ${value}:`).join('\n');
    return renderSource`
      {
        const value: number = ${readExpression};
        switch (value) {
          ${cases}
            ${assignment}
        }
      }`;
  }

  private renderOneofDecode(field: ValueFieldModel, oneofName: string, readExpression: string): string {
    const setter: string = `message.set${toUpperCamel(field.name)}`;
    if (field.kind === 'message') {
      const typeName: string = concreteType(field);
      // 同一 oneof message 成员连续出现时按 protobuf 规则 merge，而不是整体覆盖。
      return renderSource`
        {
          const valueBytes: Uint8Array = reader.readSlice();
          if (message.${oneofName}Case === ${field.number}) {
            const current: ${typeName} | undefined = message.get${toUpperCamel(field.name)}();
            if (current !== undefined) {
              ${typeName}.mergeFrom(valueBytes, current);
              break;
            }
          }
          ${setter}(${typeName}.decode(valueBytes));
        }`;
    }
    if (field.kind === 'enum') {
      return this.renderEnumAssignment(field, readExpression, `${setter}(value);`);
    }
    return `${setter}(${readExpression});`;
  }

  private renderReadValue(reader: string, field: ValueFieldModel): string {
    if (field.kind === 'message') {
      return `${referencedType(field)}.decode(${reader}.readSlice())`;
    }
    return `${reader}.${field.readerMethod}()`;
  }
}

function concreteType(field: MessageFieldModel): string {
  return field.arkType.endsWith(' | undefined') ? field.arkType.slice(0, -12) : field.arkType;
}

function referencedType(field: MessageFieldModel): string {
  const arrayPrefix: string = 'collections.Array<';
  if (field.arkType.startsWith(arrayPrefix) && field.arkType.endsWith('>')) {
    return field.arkType.slice(arrayPrefix.length, -1);
  }
  return concreteType(field);
}
