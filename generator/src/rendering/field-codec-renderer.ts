import type { IOneofDescriptorProto } from 'protobufjs/ext/descriptor/index.js';
import {
  type FieldModel,
  type MapFieldModel,
  type MessageFieldModel,
  type ValueFieldModel,
  TYPE_BYTES
} from '../model/types.js';
import { requireArkMemberName, toUpperCamel } from '../naming.js';
import { renderSource } from '../source-template.js';
import { wireTypeNumber } from './scalar-shapes.js';

/**
 * 根据已解析字段模型生成 encode/decode 片段，不再访问原始 descriptor。
 */
export class FieldCodecRenderer {
  public constructor(
    private readonly ownerName: string,
    private readonly oneofs: IOneofDescriptorProto[]
  ) {
  }

  public renderEncoder(field: FieldModel): string {
    if (field.kind === 'map') {
      return this.renderMapEncoder(field);
    }
    if (field.repeated) {
      return field.packed ? this.renderPackedEncoder(field) : this.renderRepeatedEncoder(field);
    }

    const oneofName: string | undefined = field.oneofIndex === undefined
      ? undefined
      : requireArkMemberName(this.oneofs[field.oneofIndex]?.name, 'oneof name');
    const access: string = `this.${field.name}`;
    let condition: string;
    if (oneofName !== undefined) {
      condition = `this.${oneofName}Case === ${field.number}`;
    } else if (field.kind === 'message') {
      condition = `${access} !== undefined`;
    } else if (field.type === TYPE_BYTES) {
      condition = `${access}.length !== 0`;
    } else {
      condition = `${access} !== ${field.defaultValue}`;
    }

    const valueWrite: string = this.renderWriteValue('writer', field, access);
    const messageGuard: string = field.kind === 'message' && oneofName !== undefined
      ? ` && ${access} !== undefined`
      : '';
    return renderSource`
      if (${condition}${messageGuard}) {
        writer.writeTag(${field.number}, ProtoWireType.${field.wireType});
        ${valueWrite}
      }`;
  }

  public renderDecoder(field: FieldModel): string {
    if (field.kind === 'map') {
      return renderSource`
        case ${field.number * 8 + 2}:
          ${this.ownerName}.read${toUpperCamel(field.name)}Entry(reader.readBytes(), message);
          break;`;
    }
    if (field.repeated && field.packed) {
      return this.renderPackedDecoder(field);
    }

    const tag: number = field.number * 8 + wireTypeNumber(field.wireType);
    const read: string = this.renderReadValue('reader', field);
    let assignment: string;
    if (field.repeated) {
      assignment = this.renderRepeatedAssignment(field, read);
    } else if (field.oneofIndex !== undefined) {
      const oneofName: string = requireArkMemberName(
        this.oneofs[field.oneofIndex]?.name,
        'oneof name'
      );
      assignment = this.renderOneofDecode(field, oneofName, read);
    } else if (field.kind === 'message') {
      const typeName: string = concreteType(field);
      assignment = `message.${field.name} = ${typeName}.mergeFrom(reader.readBytes(), message.${field.name} ?? new ${typeName}());`;
    } else if (field.kind === 'enum') {
      assignment = this.renderEnumAssignment(field, read, `message.${field.name} = value;`);
    } else {
      assignment = `message.${field.name} = ${read};`;
    }
    return renderSource`
      case ${tag}:
        ${assignment}
        break;`;
  }

  public renderMapReader(field: MapFieldModel): string {
    const key = field.mapKey;
    const value = field.mapValue;
    const keyRead: string = this.renderReadValue('reader', key);
    const valueRead: string = this.renderReadValue('reader', value);
    const valueDefault: string = value.kind === 'message'
      ? `new ${value.arkType}()`
      : value.defaultValue;

    return renderSource`
      private static read${toUpperCamel(field.name)}Entry(bytes: collections.Uint8Array, message: ${this.ownerName}): void {
        const reader: ProtoReader = new ProtoReader(bytes);
        let key: ${key.arkType} = ${key.defaultValue};
        let value: ${value.arkType} = ${valueDefault};
        while (!reader.isAtEnd()) {
          const tag: number = reader.readTag();
          switch (tag) {
            case ${8 + wireTypeNumber(key.wireType)}:
              key = ${keyRead};
              break;
            case ${16 + wireTypeNumber(value.wireType)}:
              value = ${valueRead};
              break;
            default:
              reader.skipField(Math.floor(tag / 8), tag & 0x07);
          }
        }
        setProtoMapValue(message.${field.name}, key, value);
      }`;
  }

  private renderRepeatedEncoder(field: ValueFieldModel): string {
    const value: string = `this.${field.name}[index]`;
    return renderSource`
      for (let index: number = 0; index < this.${field.name}.length; index++) {
        writer.writeTag(${field.number}, ProtoWireType.${field.wireType});
        ${this.renderWriteValue('writer', field, value)}
      }`;
  }

  private renderPackedEncoder(field: ValueFieldModel): string {
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

  private renderMapEncoder(field: MapFieldModel): string {
    const key = field.mapKey;
    const value = field.mapValue;
    return renderSource`
      const ${field.name}Keys: collections.Array<${key.arkType}> = getProtoMapKeys(this.${field.name});
      for (let index: number = 0; index < ${field.name}Keys.length; index++) {
        const key: ${key.arkType} = ${field.name}Keys[index];
        const value: ${value.arkType} | undefined = getProtoMapValue(this.${field.name}, key);
        if (value !== undefined) {
          const entryWriter: ProtoWriter = new ProtoWriter();
          entryWriter.writeTag(1, ProtoWireType.${key.wireType});
          ${this.renderWriteValue('entryWriter', key, 'key')}
          entryWriter.writeTag(2, ProtoWireType.${value.wireType});
          ${this.renderWriteValue('entryWriter', value, 'value')}
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

  private renderPackedDecoder(field: ValueFieldModel): string {
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
        const packedReader: ProtoReader = new ProtoReader(reader.readBytes());
        while (!packedReader.isAtEnd()) {
          ${packedAssignment}
        }
        break;
      }`;
  }

  private renderRepeatedAssignment(field: ValueFieldModel, read: string): string {
    if (field.kind === 'enum') {
      return this.renderEnumAssignment(field, read, `appendProtoValue(message.${field.name}, value);`);
    }
    return `appendProtoValue(message.${field.name}, ${read});`;
  }

  private renderEnumAssignment(
    field: Extract<ValueFieldModel, { readonly kind: 'enum' }>,
    read: string,
    assignment: string
  ): string {
    const cases: string = field.symbol.enumValues.map((value): string => `case ${value}:`).join('\n');
    return renderSource`
      {
        const value: number = ${read};
        switch (value) {
          ${cases}
            ${assignment}
        }
      }`;
  }

  private renderOneofDecode(field: ValueFieldModel, oneofName: string, read: string): string {
    const setter: string = `message.set${toUpperCamel(field.name)}`;
    if (field.kind === 'message') {
      const typeName: string = concreteType(field);
      // 同一 oneof message 成员连续出现时按 protobuf 规则 merge，而不是整体覆盖。
      return renderSource`
        {
          const valueBytes: collections.Uint8Array = reader.readBytes();
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
      return this.renderEnumAssignment(field, read, `${setter}(value);`);
    }
    return `${setter}(${read});`;
  }

  private renderReadValue(reader: string, field: ValueFieldModel): string {
    if (field.kind === 'message') {
      return `${referencedType(field)}.decode(${reader}.readBytes())`;
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
