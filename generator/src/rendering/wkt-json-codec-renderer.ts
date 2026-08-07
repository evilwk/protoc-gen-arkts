import type { IOneofDescriptorProto } from 'protobufjs/ext/descriptor/index.js';
import { scalarTypeName } from '../model/descriptor-types.js';
import type { FieldModel, MapFieldModel, MessageFieldModel, ValueFieldModel } from '../model/field-model.js';
import { toUpperCamel } from '../naming.js';
import { renderSource } from '../source-template.js';
import { JsonCodecRenderer } from './json-codec-renderer.js';
import {
  LIST_VALUE,
  STRUCT,
  VALUE,
  WktJsonKind,
  WRAPPERS,
  wktJsonKind
} from './wkt-json-kind.js';

export { isSpecialWktMessage } from './wkt-json-kind.js';

/**
 * 为 JSON 表示不是普通对象的 well-known types 渲染专用方法。
 */
export class WktJsonCodecRenderer extends JsonCodecRenderer {
  private readonly kind: WktJsonKind;

  public constructor(
    private readonly wktName: string,
    private readonly arkName: string,
    oneofs: IOneofDescriptorProto[],
    private readonly fields: FieldModel[]
  ) {
    super(arkName, oneofs);
    this.kind = wktJsonKind(wktName);
  }

  override renderToJson(): string {
    switch (this.kind) {
      case WktJsonKind.EMPTY:
        return renderSource`
          toJson(): string {
            return '{}';
          }`;
      case WktJsonKind.WRAPPER:
        return this.renderWrapperToJson();
      case WktJsonKind.TIMESTAMP:
        return this.renderTimeToJson('Timestamp');
      case WktJsonKind.DURATION:
        return this.renderTimeToJson('Duration');
      case WktJsonKind.FIELD_MASK:
        return renderSource`
          toJson(): string {
            return ProtoJson.writeFieldMask(this.paths);
          }`;
      case WktJsonKind.STRUCT:
        return this.renderStructToJson();
      case WktJsonKind.VALUE:
        return renderValueToJson(this.fields);
      case WktJsonKind.LIST_VALUE:
        return this.renderListValueToJson();
      case WktJsonKind.ANY:
        return renderSource`
          toJson(): string {
            return ProtoJson.writeAny(this.typeUrl, this.value);
          }`;
      case WktJsonKind.ORDINARY:
      default:
        return super.renderToJson();
    }
  }

  override renderReadJson(fields: FieldModel[]): string {
    switch (this.kind) {
      case WktJsonKind.EMPTY:
        return super.renderReadJson(fields);
      case WktJsonKind.WRAPPER:
        return this.renderWrapperReadJson(fields);
      case WktJsonKind.TIMESTAMP:
        return this.renderTimeReadJson(fields, 'Timestamp');
      case WktJsonKind.DURATION:
        return this.renderTimeReadJson(fields, 'Duration');
      case WktJsonKind.FIELD_MASK:
        requireRepeatedField(this.wktName, fields, 'paths', 'string');
        return renderSource`
          static readJson(reader: JsonReader, _ignoreUnknownFields: boolean): ${this.arkName} {
            const message: ${this.arkName} = new ${this.arkName}();
            message.paths = ProtoJson.readFieldMask(reader);
            return message;
          }`;
      case WktJsonKind.STRUCT:
        return this.renderStructReadJson(fields);
      case WktJsonKind.VALUE:
        return renderValueReadJson(this.arkName, fields);
      case WktJsonKind.LIST_VALUE:
        return this.renderListValueReadJson(fields);
      case WktJsonKind.ANY:
        return renderSource`
          static readJson(reader: JsonReader, ignoreUnknownFields: boolean): ${this.arkName} {
            const message: ${this.arkName} = new ${this.arkName}();
            const value = ProtoJson.readAny(reader, ignoreUnknownFields);
            message.typeUrl = value.typeUrl;
            message.value = value.value;
            return message;
          }`;
      case WktJsonKind.ORDINARY:
      default:
        return super.renderReadJson(fields);
    }
  }

  private renderWrapperToJson(): string {
    const method: string = requireWrapperMethod(this.wktName);
    return renderSource`
      toJson(): string {
        return ProtoJson.write${method}(this.value);
      }`;
  }

  private renderWrapperReadJson(fields: FieldModel[]): string {
    const method: string = requireWrapperMethod(this.wktName);
    requireWrapperValueField(this.wktName, fields);
    return renderSource`
      static readJson(reader: JsonReader, _ignoreUnknownFields: boolean): ${this.arkName} {
        const message: ${this.arkName} = new ${this.arkName}();
        if (ProtoJson.isNull(reader)) {
          reader.readNull();
          return message;
        }
        message.value = ProtoJson.read${method}(reader);
        return message;
      }`;
  }

  private renderTimeToJson(shortName: string): string {
    return renderSource`
      toJson(): string {
        return ProtoJson.write${shortName}(this.seconds, this.nanos);
      }`;
  }

  private renderTimeReadJson(fields: FieldModel[], shortName: string): string {
    requireSecondsAndNanos(this.wktName, fields);
    return renderSource`
      static readJson(reader: JsonReader, _ignoreUnknownFields: boolean): ${this.arkName} {
        const message: ${this.arkName} = new ${this.arkName}();
        const value = ProtoJson.read${shortName}(reader);
        message.seconds = value.seconds;
        message.nanos = value.nanos;
        return message;
      }`;
  }

  private renderStructToJson(): string {
    const field: MapFieldModel = requireStructFields(this.fields);
    return renderSource`
      toJson(): string {
        const keys: collections.Array<string> = ProtoContainers.mapKeys(this.${field.name});
        const jsonValues: collections.Array<string> = new collections.Array<string>();
        for (let index: number = 0; index < keys.length; index++) {
          const value: ${field.mapValue.arkType} | undefined = ProtoContainers.mapValue(this.${field.name}, keys[index]);
          if (value === undefined) {
            throw new Error('Struct field has no value');
          }
          ProtoContainers.append(jsonValues, value.toJson());
        }
        return ProtoJson.writeRawObject(keys, jsonValues);
      }`;
  }

  private renderStructReadJson(fields: FieldModel[]): string {
    const field: MapFieldModel = requireStructFields(fields);
    const valueType: string = field.mapValue.kind === 'message' ? field.mapValue.symbol.arkName : '';
    return renderSource`
      static readJson(reader: JsonReader, ignoreUnknownFields: boolean): ${this.arkName} {
        const message: ${this.arkName} = new ${this.arkName}();
        const seenKeys: Set<string> = new Set<string>();
        reader.beginObject();
        while (reader.hasMoreMembers()) {
          const key: string = reader.readKey();
          if (seenKeys.has(key)) {
            throw new Error('Duplicate Struct field: ' + key);
          }
          seenKeys.add(key);
          ProtoContainers.setMapValue(message.${field.name}, key, ${valueType}.readJson(reader, ignoreUnknownFields));
        }
        reader.endObject();
        return message;
      }`;
  }

  private renderListValueToJson(): string {
    const field: MessageFieldModel = requireListValueFields(this.fields);
    return renderSource`
      toJson(): string {
        const jsonValues: collections.Array<string> = new collections.Array<string>();
        for (let index: number = 0; index < this.${field.name}.length; index++) {
          ProtoContainers.append(jsonValues, this.${field.name}[index].toJson());
        }
        return ProtoJson.writeRawArray(jsonValues);
      }`;
  }

  private renderListValueReadJson(fields: FieldModel[]): string {
    const field: MessageFieldModel = requireListValueFields(fields);
    return renderSource`
      static readJson(reader: JsonReader, ignoreUnknownFields: boolean): ${this.arkName} {
        const message: ${this.arkName} = new ${this.arkName}();
        reader.beginArray();
        while (reader.hasMoreElements()) {
          ProtoContainers.append(message.${field.name}, ${field.symbol.arkName}.readJson(reader, ignoreUnknownFields));
        }
        reader.endArray();
        return message;
      }`;
  }
}

function requireWrapperMethod(wktName: string): string {
  const method: string | undefined = WRAPPERS.get(wktName);
  if (method === undefined) {
    throw new Error(`${wktName}: wrapper JSON method is not configured`);
  }
  return method;
}

function requireSecondsAndNanos(wktName: string, fields: FieldModel[]): void {
  const seconds: FieldModel | undefined = fields.find((field): boolean => field.protoName === 'seconds');
  const nanos: FieldModel | undefined = fields.find((field): boolean => field.protoName === 'nanos');
  if (seconds === undefined || seconds.kind !== 'scalar' || seconds.repeated ||
    scalarTypeName(seconds.type) !== 'int64' || nanos === undefined || nanos.kind !== 'scalar' ||
    nanos.repeated || scalarTypeName(nanos.type) !== 'int32') {
    throw new Error(`${wktName}: expected singular int64 seconds and int32 nanos fields`);
  }
}

function requireRepeatedField(
  wktName: string,
  fields: FieldModel[],
  protoName: string,
  scalarName: string
): ValueFieldModel {
  const field: FieldModel | undefined = fields.find((candidate): boolean => candidate.protoName === protoName);
  if (field === undefined || field.kind === 'map' || !field.repeated ||
    scalarTypeName(field.type) !== scalarName) {
    throw new Error(`${wktName}: expected repeated ${scalarName} ${protoName} field`);
  }
  return field;
}

function requireStructFields(fields: FieldModel[]): MapFieldModel {
  const field: FieldModel | undefined = fields.find((candidate): boolean => candidate.protoName === 'fields');
  if (field === undefined || field.kind !== 'map' || scalarTypeName(field.mapKey.type) !== 'string' ||
    field.mapValue.kind !== 'message' || field.mapValue.symbol.fullName !== VALUE) {
    throw new Error(`${STRUCT}: expected map<string, Value> fields field`);
  }
  return field;
}

function requireListValueFields(fields: FieldModel[]): MessageFieldModel {
  const field: FieldModel | undefined = fields.find((candidate): boolean => candidate.protoName === 'values');
  if (field === undefined || field.kind !== 'message' || !field.repeated || field.symbol.fullName !== VALUE) {
    throw new Error(`${LIST_VALUE}: expected repeated Value values field`);
  }
  return field;
}

interface ValueFields {
  readonly nullValue: ValueFieldModel;
  readonly numberValue: ValueFieldModel;
  readonly stringValue: ValueFieldModel;
  readonly boolValue: ValueFieldModel;
  readonly structValue: MessageFieldModel;
  readonly listValue: MessageFieldModel;
}

function requireValueFields(fields: FieldModel[]): ValueFields {
  const find = (name: string): ValueFieldModel => {
    const field: FieldModel | undefined = fields.find((candidate): boolean => candidate.protoName === name);
    if (field === undefined || field.kind === 'map' || field.repeated || field.oneofIndex === undefined) {
      throw new Error(`${VALUE}: invalid ${name} field`);
    }
    return field;
  };
  const nullValue: ValueFieldModel = find('null_value');
  const numberValue: ValueFieldModel = find('number_value');
  const stringValue: ValueFieldModel = find('string_value');
  const boolValue: ValueFieldModel = find('bool_value');
  const structValue: ValueFieldModel = find('struct_value');
  const listValue: ValueFieldModel = find('list_value');
  if (nullValue.kind !== 'enum' || nullValue.symbol.fullName !== '.google.protobuf.NullValue' ||
    numberValue.kind !== 'scalar' || scalarTypeName(numberValue.type) !== 'double' ||
    stringValue.kind !== 'scalar' || scalarTypeName(stringValue.type) !== 'string' ||
    boolValue.kind !== 'scalar' || scalarTypeName(boolValue.type) !== 'bool' ||
    structValue.kind !== 'message' || structValue.symbol.fullName !== STRUCT ||
    listValue.kind !== 'message' || listValue.symbol.fullName !== LIST_VALUE) {
    throw new Error(`${VALUE}: unexpected kind oneof fields`);
  }
  return { nullValue, numberValue, stringValue, boolValue, structValue, listValue };
}

function renderValueToJson(fields: FieldModel[]): string {
  const value: ValueFields = requireValueFields(fields);
  return renderSource`
    toJson(): string {
      if (this.has${toUpperCamel(value.nullValue.name)}()) {
        return 'null';
      }
      if (this.has${toUpperCamel(value.numberValue.name)}()) {
        return ProtoJson.writeValueNumber(this.${value.numberValue.name});
      }
      if (this.has${toUpperCamel(value.stringValue.name)}()) {
        return ProtoJson.writeString(this.${value.stringValue.name});
      }
      if (this.has${toUpperCamel(value.boolValue.name)}()) {
        return ProtoJson.writeBool(this.${value.boolValue.name});
      }
      if (this.has${toUpperCamel(value.structValue.name)}() && this.${value.structValue.name} !== undefined) {
        return this.${value.structValue.name}.toJson();
      }
      if (this.has${toUpperCamel(value.listValue.name)}() && this.${value.listValue.name} !== undefined) {
        return this.${value.listValue.name}.toJson();
      }
      return 'null';
    }`;
}

function renderValueReadJson(arkName: string, fields: FieldModel[]): string {
  const value: ValueFields = requireValueFields(fields);
  const setter = (field: ValueFieldModel): string => `message.set${toUpperCamel(field.name)}`;
  return renderSource`
    static readJson(reader: JsonReader, ignoreUnknownFields: boolean): ${arkName} {
      const message: ${arkName} = new ${arkName}();
      if (ProtoJson.isNull(reader)) {
        reader.readNull();
        ${setter(value.nullValue)}(0);
      } else if (ProtoJson.isString(reader)) {
        ${setter(value.stringValue)}(ProtoJson.readString(reader));
      } else if (ProtoJson.isBool(reader)) {
        ${setter(value.boolValue)}(ProtoJson.readBool(reader));
      } else if (ProtoJson.isObject(reader)) {
        ${setter(value.structValue)}(${value.structValue.symbol.arkName}.readJson(reader, ignoreUnknownFields));
      } else if (ProtoJson.isArray(reader)) {
        ${setter(value.listValue)}(${value.listValue.symbol.arkName}.readJson(reader, ignoreUnknownFields));
      } else {
        ${setter(value.numberValue)}(ProtoJson.readDouble(reader));
      }
      return message;
    }`;
}

function requireWrapperValueField(wktName: string, fields: FieldModel[]): ValueFieldModel {
  const field: FieldModel | undefined = fields.find((candidate): boolean => candidate.protoName === 'value');
  if (field === undefined || field.kind === 'map' || field.repeated) {
    throw new Error(`${wktName}: wrapper must contain one singular value field`);
  }
  const expectedMethod: string | undefined = WRAPPERS.get(wktName);
  const actualType: string = scalarTypeName(field.type) ?? '';
  if (expectedMethod === undefined || actualType.toLowerCase() !== expectedMethod.toLowerCase()) {
    throw new Error(`${wktName}: invalid wrapper value type ${actualType}`);
  }
  return field;
}
