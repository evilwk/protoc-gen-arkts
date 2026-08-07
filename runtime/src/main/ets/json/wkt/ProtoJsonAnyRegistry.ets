import { collections } from '@kit.ArkTS';
import { JsonReader } from '../JsonReader';
import { quoteJson } from '../JsonSupport';
import { ProtoJsonWkt } from './ProtoJsonWkt';
import { ProtoContainers } from '../../ProtoContainers';
import { ProtoMessage } from '../../visitor/ProtoVisitor';

/**
 * Any 注册类型的二进制解码函数。
 */
export type ProtoJsonAnyDecoder = (bytes: Uint8Array | collections.Uint8Array) => ProtoMessage;

/**
 * Any 注册类型的 JSON 解析函数。
 */
export type ProtoJsonAnyParser = (text: string, ignoreUnknownFields?: boolean) => ProtoMessage;

/**
 * Any JSON 解析写入目标。
 */
export class ProtoJsonAnyValue {
  readonly typeUrl: string;
  readonly value: collections.Uint8Array;

  constructor(typeUrl: string, value: collections.Uint8Array) {
    this.typeUrl = typeUrl;
    this.value = value;
  }
}

interface RegisteredAnyType {
  readonly decode: ProtoJsonAnyDecoder;
  readonly fromJson: ProtoJsonAnyParser;
  readonly customJson: boolean;
}

/**
 * Any 的 JSON 类型注册表。
 *
 * 注册只影响 JSON 解包；Any 的二进制形态始终是 type_url 与 bytes。
 */
export class ProtoJsonAnyRegistry {
  private static readonly types: Map<string, RegisteredAnyType> = new Map<string, RegisteredAnyType>();

  static register(
    typeName: string,
    decode: ProtoJsonAnyDecoder,
    fromJson: ProtoJsonAnyParser,
    customJson: boolean
  ): void {
    if (typeName.length === 0 || typeName.indexOf('/') >= 0) {
      throw new Error('Any registry requires a protobuf full name without URL prefix');
    }
    ProtoJsonAnyRegistry.types.set(typeName, { decode, fromJson, customJson });
  }

  static write(typeUrl: string, value: collections.Uint8Array): string {
    if (typeUrl.length === 0) {
      if (value.length !== 0) {
        throw new Error('Any value has bytes but no type URL');
      }
      return '{}';
    }
    const registered: RegisteredAnyType = ProtoJsonAnyRegistry.requireType(typeUrl);
    const message: ProtoMessage = registered.decode(value);
    const messageJson: string = message.toJson();
    const typeEntry: string = `"@type":${quoteJson(typeUrl)}`;
    if (registered.customJson) {
      return `{${typeEntry},"value":${messageJson}}`;
    }
    if (messageJson === '{}') {
      return `{${typeEntry}}`;
    }
    if (messageJson.length < 2 || messageJson.charAt(0) !== '{' ||
      messageJson.charAt(messageJson.length - 1) !== '}') {
      throw new Error('Registered Any message must produce a JSON object');
    }
    return `{${typeEntry},${messageJson.substring(1)}`;
  }

  static read(reader: JsonReader, ignoreUnknownFields: boolean): ProtoJsonAnyValue {
    const raw: string = reader.readRawValue();
    const objectReader: JsonReader = new JsonReader(raw);
    const keys: collections.Array<string> = new collections.Array<string>();
    const values: collections.Array<string> = new collections.Array<string>();
    let typeUrl: string = '';
    objectReader.beginObject();
    while (objectReader.hasMoreMembers()) {
      const key: string = objectReader.readKey();
      if (key === '@type') {
        typeUrl = objectReader.readString();
      } else {
        ProtoContainers.append(keys, key);
        ProtoContainers.append(values, objectReader.readRawValue());
      }
    }
    objectReader.endObject();
    objectReader.requireEndOfInput();
    if (typeUrl.length === 0) {
      if (keys.length === 0) {
        return new ProtoJsonAnyValue('', new collections.Uint8Array(0));
      }
      throw new Error('Any JSON object is missing @type');
    }

    const registered: RegisteredAnyType = ProtoJsonAnyRegistry.requireType(typeUrl);
    let messageJson: string;
    if (registered.customJson) {
      const valueIndex: number = findKey(keys, 'value');
      if (valueIndex < 0) {
        throw new Error('Any JSON object is missing value');
      }
      if (!ignoreUnknownFields && keys.length !== 1) {
        throw new Error('Any custom JSON object contains unknown fields');
      }
      messageJson = values[valueIndex];
    } else {
      messageJson = ProtoJsonWkt.writeRawObject(keys, values);
    }
    const message: ProtoMessage = registered.fromJson(messageJson, ignoreUnknownFields);
    return new ProtoJsonAnyValue(typeUrl, message.encode());
  }

  private static requireType(typeUrl: string): RegisteredAnyType {
    const slash: number = typeUrl.lastIndexOf('/');
    const typeName: string = slash < 0 ? typeUrl : typeUrl.substring(slash + 1);
    const registered: RegisteredAnyType | undefined = ProtoJsonAnyRegistry.types.get(typeName);
    if (registered === undefined) {
      throw new Error(`Any JSON type is not registered: ${typeName}`);
    }
    return registered;
  }
}

function findKey(keys: collections.Array<string>, expected: string): number {
  for (let index: number = 0; index < keys.length; index++) {
    if (keys[index] === expected) {
      return index;
    }
  }
  return -1;
}
