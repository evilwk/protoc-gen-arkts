import { collections } from '@kit.ArkTS';
import { JsonReader, parseExactInteger } from './JsonReader';
import { JsonToken } from './JsonToken';
import { JsonWriter } from './JsonWriter';
import { JsonEncodingVisitor } from './JsonEncodingVisitor';
import { ProtoContainers } from '../ProtoContainers';
import { FieldInfo } from '../visitor/FieldInfo';
import { ProtoValueKind } from '../visitor/ProtoValueKind';
import { ProtoJsonMessage, ProtoVisitor } from '../visitor/ProtoVisitor';
import { decodeBase64, encodeBase64, formatJsonNumber, quoteJson } from './JsonSupport';
import {
  ProtoJsonTimeValue, ProtoJsonWkt
} from './wkt/ProtoJsonWkt';
import {
  ProtoJsonAnyDecoder,
  ProtoJsonAnyParser,
  ProtoJsonAnyRegistry,
  ProtoJsonAnyValue
} from './wkt/ProtoJsonAnyRegistry';

const INT32_MIN: bigint = -0x80000000n;
const INT32_MAX: bigint = 0x7fffffffn;
const UINT32_MAX: bigint = 0xffffffffn;
const INT64_MIN: bigint = -0x8000000000000000n;
const INT64_MAX: bigint = 0x7fffffffffffffffn;
const UINT64_MAX: bigint = 0xffffffffffffffffn;

/**
 * 生成式 JSON 解析辅助能力的紧凑 facade。
 */
export class ProtoJson {
  static write(message: ProtoJsonMessage): string {
    const writer: JsonWriter = new JsonWriter();
    message.traverse(new JsonEncodingVisitor(writer));
    return writer.finish();
  }

  static isNull(reader: JsonReader): boolean {
    return reader.peek() === JsonToken.NULL;
  }

  static isString(reader: JsonReader): boolean {
    return reader.peek() === JsonToken.STRING;
  }

  static requireUnseenField(seen: Set<number>, fieldNumber: number): void {
    if (seen.has(fieldNumber)) {
      throw new Error(`Duplicate JSON field: ${fieldNumber}`);
    }
    seen.add(fieldNumber);
  }

  static skipNull(reader: JsonReader): boolean {
    if (!ProtoJson.isNull(reader)) {
      return false;
    }
    reader.readNull();
    return true;
  }

  static skipNullField(reader: JsonReader, seen: Set<number>, fieldNumber: number): boolean {
    ProtoJson.requireUnseenField(seen, fieldNumber);
    return ProtoJson.skipNull(reader);
  }

  static requireOneof(
    oneofCases: number[],
    index: number,
    fieldNumber: number,
    oneofName: string
  ): void {
    if (oneofCases[index] !== 0) {
      throw new Error(`Multiple JSON fields set in oneof "${oneofName}"`);
    }
    oneofCases[index] = fieldNumber;
  }

  static readRepeated<T>(
    reader: JsonReader,
    append: (value: T) => void,
    readElement: () => T
  ): void {
    reader.beginArray();
    while (reader.hasMoreElements()) {
      append(readElement());
    }
    reader.endArray();
  }

  static readRepeatedEnum(
    reader: JsonReader,
    append: (value: number) => void,
    readElement: () => number | undefined
  ): void {
    reader.beginArray();
    while (reader.hasMoreElements()) {
      const value: number | undefined = readElement();
      if (value !== undefined) {
        append(value);
      }
    }
    reader.endArray();
  }

  static readMap<K, V>(
    reader: JsonReader,
    setEntry: (key: K, value: V) => void,
    readKey: (text: string) => K,
    readValue: () => V | undefined
  ): void {
    reader.beginObject();
    while (reader.hasMoreMembers()) {
      const key: K = readKey(reader.readKey());
      const value: V | undefined = readValue();
      if (value !== undefined) {
        setEntry(key, value);
      }
    }
    reader.endObject();
  }

  static traverseRepeated<T>(
    visitor: ProtoVisitor,
    values: collections.Array<T>,
    fieldNumber: number,
    protoName: string,
    jsonName: string | undefined,
    visit: (value: T, field: FieldInfo) => void
  ): void {
    if (values.length === 0) {
      return;
    }
    const field: FieldInfo = new FieldInfo(fieldNumber, protoName, jsonName);
    visitor.beginRepeated(field);
    for (let index: number = 0; index < values.length; index++) {
      visit(values[index], field);
    }
    visitor.endRepeated(field);
  }

  static traverseMap<K, V>(
    visitor: ProtoVisitor,
    values: collections.Map<K, V>,
    fieldNumber: number,
    protoName: string,
    jsonName: string | undefined,
    visit: (key: K, value: V, field: FieldInfo) => void
  ): void {
    if (values.size === 0) {
      return;
    }
    const field: FieldInfo = new FieldInfo(fieldNumber, protoName, jsonName);
    visitor.beginMap(field);
    const keys: collections.Array<K> = ProtoContainers.mapKeys(values);
    for (let index: number = 0; index < keys.length; index++) {
      const key: K = keys[index];
      const value: V | undefined = ProtoContainers.mapValue(values, key);
      if (value !== undefined) {
        visit(key, value, field);
      }
    }
    visitor.endMap(field);
  }

  static traverseMessage(visitor: ProtoVisitor, field: FieldInfo, message: ProtoJsonMessage): void {
    visitor.beginMessage(field);
    message.traverse(visitor);
    visitor.endMessage(field);
  }

  static traverseNumberField(
    visitor: ProtoVisitor,
    present: boolean,
    value: number,
    kind: ProtoValueKind,
    fieldNumber: number,
    protoName: string,
    jsonName?: string
  ): void {
    if (present) visitor.visitNumber(value, kind, new FieldInfo(fieldNumber, protoName, jsonName));
  }

  static traverseBigIntField(
    visitor: ProtoVisitor,
    present: boolean,
    value: bigint,
    kind: ProtoValueKind,
    fieldNumber: number,
    protoName: string,
    jsonName?: string
  ): void {
    if (present) visitor.visitBigInt(value, kind, new FieldInfo(fieldNumber, protoName, jsonName));
  }

  static traverseBoolField(
    visitor: ProtoVisitor,
    present: boolean,
    value: boolean,
    fieldNumber: number,
    protoName: string,
    jsonName?: string
  ): void {
    if (present) visitor.visitBool(value, new FieldInfo(fieldNumber, protoName, jsonName));
  }

  static traverseStringField(
    visitor: ProtoVisitor,
    present: boolean,
    value: string,
    fieldNumber: number,
    protoName: string,
    jsonName?: string
  ): void {
    if (present) visitor.visitString(value, new FieldInfo(fieldNumber, protoName, jsonName));
  }

  static traverseBytesField(
    visitor: ProtoVisitor,
    present: boolean,
    value: collections.Uint8Array,
    fieldNumber: number,
    protoName: string,
    jsonName?: string
  ): void {
    if (present) visitor.visitBytes(value, new FieldInfo(fieldNumber, protoName, jsonName));
  }

  static traverseMessageField(
    visitor: ProtoVisitor,
    present: boolean,
    message: ProtoJsonMessage | undefined,
    fieldNumber: number,
    protoName: string,
    jsonName?: string
  ): void {
    if (present && message !== undefined) {
      ProtoJson.traverseMessage(visitor, new FieldInfo(fieldNumber, protoName, jsonName), message);
    }
  }

  static visitMessageField(
    visitor: ProtoVisitor,
    present: boolean,
    message: ProtoJsonMessage | undefined,
    fieldNumber: number,
    protoName: string,
    jsonName?: string
  ): void {
    if (present && message !== undefined) {
      visitor.visitMessage(message, new FieldInfo(fieldNumber, protoName, jsonName));
    }
  }

  static readInt32(reader: JsonReader): number {
    return Number(readIntegerInRange(reader, INT32_MIN, INT32_MAX, 'int32', 10));
  }

  static readUInt32(reader: JsonReader): number {
    return Number(readIntegerInRange(reader, 0n, UINT32_MAX, 'uint32', 10));
  }

  static readSInt32(reader: JsonReader): number {
    return ProtoJson.readInt32(reader);
  }

  static readFixed32(reader: JsonReader): number {
    return ProtoJson.readUInt32(reader);
  }

  static readSFixed32(reader: JsonReader): number {
    return ProtoJson.readInt32(reader);
  }

  static readInt64(reader: JsonReader): bigint {
    return readIntegerInRange(reader, INT64_MIN, INT64_MAX, 'int64', 20);
  }

  static readUInt64(reader: JsonReader): bigint {
    return readIntegerInRange(reader, 0n, UINT64_MAX, 'uint64', 20);
  }

  static readSInt64(reader: JsonReader): bigint {
    return ProtoJson.readInt64(reader);
  }

  static readFixed64(reader: JsonReader): bigint {
    return ProtoJson.readUInt64(reader);
  }

  static readSFixed64(reader: JsonReader): bigint {
    return ProtoJson.readInt64(reader);
  }

  static readFloat(reader: JsonReader): number {
    return readFloatJson(reader);
  }

  static readDouble(reader: JsonReader): number {
    return readDoubleJson(reader);
  }

  static readBool(reader: JsonReader): boolean {
    return reader.readBool();
  }

  static readString(reader: JsonReader): string {
    return reader.readString();
  }

  static readBytes(reader: JsonReader): collections.Uint8Array {
    return decodeBase64(reader.readString());
  }

  static parseInt32MapKey(text: string): number {
    return parseInt32JsonMapKey(text);
  }

  static parseUInt32MapKey(text: string): number {
    return parseUInt32JsonMapKey(text);
  }

  static parseInt64MapKey(text: string): bigint {
    return parseInt64JsonMapKey(text);
  }

  static parseUInt64MapKey(text: string): bigint {
    return parseUInt64JsonMapKey(text);
  }

  static parseBoolMapKey(text: string): boolean {
    return parseBoolJsonMapKey(text);
  }

  static encodeBase64(bytes: collections.Uint8Array): string {
    return encodeBase64(bytes);
  }

  static decodeBase64(text: string): collections.Uint8Array {
    return decodeBase64(text);
  }

  static writeDouble(value: number): string {
    return formatJsonNumber(value);
  }

  static writeValueNumber(value: number): string {
    // Value.number_value 没有 NaN/Infinity 的 JSON 表示，只能在此拒绝。
    if (!Number.isFinite(value)) {
      throw new Error('Value number_value must be finite');
    }
    return formatJsonNumber(value);
  }

  static writeFloat(value: number): string {
    return formatJsonNumber(value);
  }

  static writeInt64(value: bigint): string {
    return quoteJson(value.toString());
  }

  static writeUInt64(value: bigint): string {
    return quoteJson(value.toString());
  }

  static writeInt32(value: number): string {
    return `${value}`;
  }

  static writeUInt32(value: number): string {
    return `${value}`;
  }

  static writeBool(value: boolean): string {
    return value ? 'true' : 'false';
  }

  static writeString(value: string): string {
    return quoteJson(value);
  }

  static writeBytes(value: collections.Uint8Array): string {
    return quoteJson(encodeBase64(value));
  }

  static writeTimestamp(seconds: bigint, nanos: number): string {
    return ProtoJsonWkt.writeTimestamp(seconds, nanos);
  }

  static readTimestamp(reader: JsonReader): ProtoJsonTimeValue {
    return ProtoJsonWkt.readTimestamp(reader);
  }

  static writeDuration(seconds: bigint, nanos: number): string {
    return ProtoJsonWkt.writeDuration(seconds, nanos);
  }

  static readDuration(reader: JsonReader): ProtoJsonTimeValue {
    return ProtoJsonWkt.readDuration(reader);
  }

  static writeFieldMask(paths: collections.Array<string>): string {
    return ProtoJsonWkt.writeFieldMask(paths);
  }

  static readFieldMask(reader: JsonReader): collections.Array<string> {
    return ProtoJsonWkt.readFieldMask(reader);
  }

  static writeRawObject(keys: collections.Array<string>, values: collections.Array<string>): string {
    return ProtoJsonWkt.writeRawObject(keys, values);
  }

  static writeRawArray(values: collections.Array<string>): string {
    return ProtoJsonWkt.writeRawArray(values);
  }

  static isBool(reader: JsonReader): boolean {
    return reader.peek() === JsonToken.BOOL;
  }

  static isObject(reader: JsonReader): boolean {
    return reader.peek() === JsonToken.BEGIN_OBJECT;
  }

  static isArray(reader: JsonReader): boolean {
    return reader.peek() === JsonToken.BEGIN_ARRAY;
  }

  static registerAnyType(
    typeName: string,
    decode: ProtoJsonAnyDecoder,
    fromJson: ProtoJsonAnyParser
  ): void {
    ProtoJsonAnyRegistry.register(typeName, decode, fromJson, false);
  }

  static registerAnyCustomType(
    typeName: string,
    decode: ProtoJsonAnyDecoder,
    fromJson: ProtoJsonAnyParser
  ): void {
    ProtoJsonAnyRegistry.register(typeName, decode, fromJson, true);
  }

  static writeAny(typeUrl: string, value: collections.Uint8Array): string {
    return ProtoJsonAnyRegistry.write(typeUrl, value);
  }

  static readAny(reader: JsonReader, ignoreUnknownFields: boolean): ProtoJsonAnyValue {
    return ProtoJsonAnyRegistry.read(reader, ignoreUnknownFields);
  }
}

function readFloatJson(reader: JsonReader): number {
  const value: number = readFloatingJson(reader);
  const result: number = Math.fround(value);
  if (Number.isFinite(value) && !Number.isFinite(result)) {
    throw new Error('Protobuf JSON float is out of range');
  }
  return result;
}

function readDoubleJson(reader: JsonReader): number {
  return readFloatingJson(reader);
}

function parseInt32JsonMapKey(text: string): number {
  return Number(requireIntegerRange(
    parseSignedInteger(text, 'map key', 10), INT32_MIN, INT32_MAX, 'int32 map key'
  ));
}

function parseUInt32JsonMapKey(text: string): number {
  return Number(requireIntegerRange(
    parseSignedInteger(text, 'map key', 10), 0n, UINT32_MAX, 'uint32 map key'
  ));
}

function parseInt64JsonMapKey(text: string): bigint {
  return requireIntegerRange(parseSignedInteger(text, 'map key', 20), INT64_MIN, INT64_MAX, 'int64 map key');
}

function parseUInt64JsonMapKey(text: string): bigint {
  return requireIntegerRange(parseSignedInteger(text, 'map key', 20), 0n, UINT64_MAX, 'uint64 map key');
}

function parseBoolJsonMapKey(text: string): boolean {
  if (text === 'true') {
    return true;
  }
  if (text === 'false') {
    return false;
  }
  throw new Error(`Invalid bool map key: ${text}`);
}

function readIntegerInRange(
  reader: JsonReader,
  minimum: bigint,
  maximum: bigint,
  name: string,
  maximumDigits: number
): bigint {
  const value: bigint = reader.peek() === JsonToken.STRING
    ? parseExactInteger(reader.readString(), name, maximumDigits)
    : reader.readNumberAsBigInt(maximumDigits);
  return requireIntegerRange(value, minimum, maximum, name);
}

function readFloatingJson(reader: JsonReader): number {
  if (reader.peek() === JsonToken.NUMBER) {
    const numberValue: number = reader.readNumberAsNumber();
    if (!Number.isFinite(numberValue)) {
      throw new Error('Protobuf JSON floating-point value is out of range');
    }
    return numberValue;
  }
  const value: string = reader.readString();
  if (value === 'NaN') {
    return Number.NaN;
  }
  if (value === 'Infinity') {
    return Number.POSITIVE_INFINITY;
  }
  if (value === '-Infinity') {
    return Number.NEGATIVE_INFINITY;
  }
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value)) {
    throw new Error(`Invalid protobuf floating-point value: ${value}`);
  }
  const parsed: number = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid protobuf floating-point value: ${value}`);
  }
  return parsed;
}

function requireIntegerRange(value: bigint, minimum: bigint, maximum: bigint, name: string): bigint {
  if (value < minimum || value > maximum) {
    throw new Error(`Protobuf JSON ${name} is out of range: ${value}`);
  }
  return value;
}

function parseSignedInteger(text: string, name: string, maximumDigits: number): bigint {
  if (text.length === 0) {
    throw new Error(`Invalid ${name}: ${text}`);
  }
  for (let index: number = 0; index < text.length; index++) {
    const code: number = text.charCodeAt(index);
    if (code === 0x2e || code === 0x65 || code === 0x45 || code === 0x2b) {
      throw new Error(`Invalid ${name}: ${text}`);
    }
  }
  return parseExactInteger(text, name, maximumDigits);
}
