import { collections, util } from '@kit.ArkTS';
import { ProtoContainers } from '../ProtoContainers';
import { isValidWireType, ProtoWireType } from './ProtoWireType';

const MAX_FIELD_NUMBER: number = 0x1fffffff;
const MAX_LENGTH: bigint = 0x7fffffffn;
const MAX_VARINT_BYTES: number = 10;
const MAX_TAG_VARINT_BYTES: number = 5;

/**
 * 把 Sendable bytes 拷贝为原生 Uint8Array；两者底层不同，无视图转换，必然拷贝一次。
 */
function toNativeBytes(bytes: collections.Uint8Array): Uint8Array {
  const result: Uint8Array = new Uint8Array(bytes.length);
  for (let index: number = 0; index < bytes.length; index++) {
    result[index] = bytes[index];
  }
  return result;
}

/**
 * 严格校验边界、截断输入和 group 配对的纯 ArkTS Protobuf reader。
 */
export class ProtoReader {
  private readonly bytes: Uint8Array;
  private position: number = 0;

  /**
   * 接受原生视图或 Sendable bytes；原生输入零拷贝直接使用，Sendable 输入拷贝一次转为原生。
   */
  constructor(bytes: Uint8Array | collections.Uint8Array) {
    this.bytes = bytes instanceof Uint8Array ? bytes : toNativeBytes(bytes);
  }

  /**
   * 从原生 ArrayBuffer 构造 reader，不复制数据；网络栈（如 RCP）的响应体可直接传入。
   */
  static fromBuffer(buffer: ArrayBuffer): ProtoReader {
    return new ProtoReader(new Uint8Array(buffer));
  }

  isAtEnd(): boolean {
    return this.position >= this.bytes.length;
  }

  readTag(): number {
    if (this.isAtEnd()) {
      return 0;
    }
    const rawTag: number = this.readTagVarint();
    const fieldNumber: number = Math.floor(rawTag / 8);
    const wireType: number = rawTag & 0x07;
    if (fieldNumber < 1 || fieldNumber > MAX_FIELD_NUMBER) {
      throw new Error(`Invalid protobuf field number: ${fieldNumber}`);
    }
    if (!isValidWireType(wireType)) {
      throw new Error(`Invalid protobuf wire type: ${wireType}`);
    }
    return rawTag;
  }

  readInt32(): number {
    return Number(BigInt.asIntN(32, this.readVarint()));
  }

  /**
   * 32 位字段在 wire 上按 64 位 varint 编码，超出 32 位的部分按规范截断而非报错。
   */
  readUInt32(): number {
    return Number(BigInt.asUintN(32, this.readVarint()));
  }

  /**
   * 先把 wire 值截断到 32 位，再做 zigzag 解码；顺序反了会得到错误的负数。
   */
  readSInt32(): number {
    const value: bigint = BigInt.asUintN(32, this.readVarint());
    return Number((value >> 1n) ^ (-(value & 1n)));
  }

  readInt64(): bigint {
    return BigInt.asIntN(64, this.readVarint());
  }

  readUInt64(): bigint {
    return this.readVarint();
  }

  readSInt64(): bigint {
    const value: bigint = this.readVarint();
    return (value >> 1n) ^ (-(value & 1n));
  }

  readFixed32(): number {
    this.requireAvailable(4);
    const value: number = this.bytes[this.position] +
      this.bytes[this.position + 1] * 0x100 +
      this.bytes[this.position + 2] * 0x10000 +
      this.bytes[this.position + 3] * 0x1000000;
    this.position += 4;
    return value;
  }

  readSFixed32(): number {
    const value: number = this.readFixed32();
    return value > 0x7fffffff ? value - 0x100000000 : value;
  }

  readFixed64(): bigint {
    return this.readLittleEndian(8);
  }

  readSFixed64(): bigint {
    return BigInt.asIntN(64, this.readLittleEndian(8));
  }

  readFloat(): number {
    const arrayBuffer: ArrayBuffer = this.readArrayBuffer(4);
    return new DataView(arrayBuffer).getFloat32(0, true);
  }

  readDouble(): number {
    const arrayBuffer: ArrayBuffer = this.readArrayBuffer(8);
    return new DataView(arrayBuffer).getFloat64(0, true);
  }

  readBool(): boolean {
    return this.readVarint() !== 0n;
  }

  readString(): string {
    const length: number = this.readLength();
    const value: Uint8Array = new Uint8Array(length);
    this.copyToNative(value);
    return new util.TextDecoder('utf-8', { fatal: true }).decodeToString(value);
  }

  /**
   * 读取 length-delimited 字节段并返回 Sendable 副本，供 bytes 字段存储；必然拷贝一次。
   */
  readBytes(): collections.Uint8Array {
    const length: number = this.readLength();
    const start: number = this.position;
    this.position += length;
    return new collections.Uint8Array(this.bytes.subarray(start, start + length));
  }

  /**
   * 读取 length-delimited 字节段并返回共享底层内存的原生视图，供递归解码使用，不得长期持有。
   */
  readSlice(): Uint8Array {
    const length: number = this.readLength();
    const start: number = this.position;
    this.position += length;
    return this.bytes.subarray(start, start + length);
  }

  readPackedInt32(values: collections.Array<number>): void {
    const packed: ProtoReader = new ProtoReader(this.readSlice());
    while (!packed.isAtEnd()) ProtoContainers.append(values, packed.readInt32());
  }

  readPackedUInt32(values: collections.Array<number>): void {
    const packed: ProtoReader = new ProtoReader(this.readSlice());
    while (!packed.isAtEnd()) ProtoContainers.append(values, packed.readUInt32());
  }

  readPackedSInt32(values: collections.Array<number>): void {
    const packed: ProtoReader = new ProtoReader(this.readSlice());
    while (!packed.isAtEnd()) ProtoContainers.append(values, packed.readSInt32());
  }

  readPackedFixed32(values: collections.Array<number>): void {
    const packed: ProtoReader = new ProtoReader(this.readSlice());
    while (!packed.isAtEnd()) ProtoContainers.append(values, packed.readFixed32());
  }

  readPackedSFixed32(values: collections.Array<number>): void {
    const packed: ProtoReader = new ProtoReader(this.readSlice());
    while (!packed.isAtEnd()) ProtoContainers.append(values, packed.readSFixed32());
  }

  readPackedFloat(values: collections.Array<number>): void {
    const packed: ProtoReader = new ProtoReader(this.readSlice());
    while (!packed.isAtEnd()) ProtoContainers.append(values, packed.readFloat());
  }

  readPackedDouble(values: collections.Array<number>): void {
    const packed: ProtoReader = new ProtoReader(this.readSlice());
    while (!packed.isAtEnd()) ProtoContainers.append(values, packed.readDouble());
  }

  readPackedBool(values: collections.Array<boolean>): void {
    const packed: ProtoReader = new ProtoReader(this.readSlice());
    while (!packed.isAtEnd()) ProtoContainers.append(values, packed.readBool());
  }

  readPackedInt64(values: collections.Array<bigint>): void {
    const packed: ProtoReader = new ProtoReader(this.readSlice());
    while (!packed.isAtEnd()) ProtoContainers.append(values, packed.readInt64());
  }

  readPackedUInt64(values: collections.Array<bigint>): void {
    const packed: ProtoReader = new ProtoReader(this.readSlice());
    while (!packed.isAtEnd()) ProtoContainers.append(values, packed.readUInt64());
  }

  readPackedSInt64(values: collections.Array<bigint>): void {
    const packed: ProtoReader = new ProtoReader(this.readSlice());
    while (!packed.isAtEnd()) ProtoContainers.append(values, packed.readSInt64());
  }

  readPackedFixed64(values: collections.Array<bigint>): void {
    const packed: ProtoReader = new ProtoReader(this.readSlice());
    while (!packed.isAtEnd()) ProtoContainers.append(values, packed.readFixed64());
  }

  readPackedSFixed64(values: collections.Array<bigint>): void {
    const packed: ProtoReader = new ProtoReader(this.readSlice());
    while (!packed.isAtEnd()) ProtoContainers.append(values, packed.readSFixed64());
  }

  readMapEntry<K, V>(
    values: collections.Map<K, V>,
    defaultKey: K,
    defaultValue: V,
    keyTag: number,
    valueTag: number,
    readKey: (reader: ProtoReader) => K,
    readValue: (reader: ProtoReader) => V
  ): void {
    const entry: ProtoReader = new ProtoReader(this.readSlice());
    let key: K = defaultKey;
    let value: V = defaultValue;
    while (!entry.isAtEnd()) {
      const tag: number = entry.readTag();
      if (tag === keyTag) {
        key = readKey(entry);
      } else if (tag === valueTag) {
        value = readValue(entry);
      } else {
        entry.skipField(Math.floor(tag / 8), tag & 0x07);
      }
    }
    ProtoContainers.setMapValue(values, key, value);
  }

  skipField(fieldNumber: number, wireType: number): void {
    switch (wireType) {
      case ProtoWireType.VARINT:
        this.readVarint();
        return;
      case ProtoWireType.FIXED64:
        this.skipBytes(8);
        return;
      case ProtoWireType.LENGTH_DELIMITED:
        this.skipBytes(this.readLength());
        return;
      case ProtoWireType.START_GROUP:
        this.skipGroup(fieldNumber);
        return;
      case ProtoWireType.END_GROUP:
        throw new Error('Unexpected protobuf end-group tag');
      case ProtoWireType.FIXED32:
        this.skipBytes(4);
        return;
      default:
        throw new Error(`Invalid protobuf wire type: ${wireType}`);
    }
  }

  /**
   * 读取 varint。
   *
   * maxBytes 限制允许的编码长度：值 varint 是 64 位，上限 10 字节；tag 是 32 位，
   * 上限 5 字节，更长的编码即使数值合法也必须拒绝（overlong tag 属于畸形输入）。
   */
  private readVarint(maxBytes: number = MAX_VARINT_BYTES): bigint {
    let result: bigint = 0n;
    for (let index: number = 0; index < maxBytes; index++) {
      const current: number = this.readByte();
      if (index === MAX_VARINT_BYTES - 1 && current > 1) {
        throw new Error('Protobuf varint exceeds 64 bits');
      }
      result |= BigInt(current & 0x7f) << BigInt(index * 7);
      if ((current & 0x80) === 0) {
        return result;
      }
    }
    throw new Error('Malformed protobuf varint');
  }

  /** Tag 最大 32 位，使用 number 避免每个字段都创建 BigInt 临时值。 */
  private readTagVarint(): number {
    let result: number = 0;
    let multiplier: number = 1;
    for (let index: number = 0; index < MAX_TAG_VARINT_BYTES; index++) {
      const current: number = this.readByte();
      result += (current & 0x7f) * multiplier;
      if ((current & 0x80) === 0) {
        return result;
      }
      multiplier *= 0x80;
    }
    throw new Error('Malformed protobuf varint');
  }

  private readLength(): number {
    const length: bigint = this.readVarint();
    if (length > MAX_LENGTH) {
      throw new Error('Protobuf length exceeds supported range');
    }
    const numericLength: number = Number(length);
    this.requireAvailable(numericLength);
    return numericLength;
  }

  private readLittleEndian(byteLength: number): bigint {
    this.requireAvailable(byteLength);
    let value: bigint = 0n;
    for (let index: number = 0; index < byteLength; index++) {
      value |= BigInt(this.bytes[this.position++]) << BigInt(index * 8);
    }
    return value;
  }

  private readArrayBuffer(byteLength: number): ArrayBuffer {
    this.requireAvailable(byteLength);
    const arrayBuffer: ArrayBuffer = new ArrayBuffer(byteLength);
    const value: Uint8Array = new Uint8Array(arrayBuffer);
    this.copyToNative(value);
    return arrayBuffer;
  }

  private copyToNative(value: Uint8Array): void {
    this.requireAvailable(value.length);
    for (let index: number = 0; index < value.length; index++) {
      value[index] = this.bytes[this.position++];
    }
  }

  private skipGroup(fieldNumber: number): void {
    const fieldNumbers: number[] = [fieldNumber];
    while (!this.isAtEnd()) {
      const tag: number = this.readTag();
      const nestedFieldNumber: number = Math.floor(tag / 8);
      const wireType: number = tag & 0x07;
      if (wireType === ProtoWireType.END_GROUP) {
        const expectedFieldNumber: number = fieldNumbers[fieldNumbers.length - 1];
        if (nestedFieldNumber !== expectedFieldNumber) {
          throw new Error('Mismatched protobuf end-group tag');
        }
        fieldNumbers.pop();
        if (fieldNumbers.length === 0) {
          return;
        }
      } else if (wireType === ProtoWireType.START_GROUP) {
        fieldNumbers.push(nestedFieldNumber);
      } else {
        this.skipField(nestedFieldNumber, wireType);
      }
    }
    throw new Error('Truncated protobuf group');
  }

  private skipBytes(length: number): void {
    this.requireAvailable(length);
    this.position += length;
  }

  private readByte(): number {
    this.requireAvailable(1);
    return this.bytes[this.position++];
  }

  private requireAvailable(length: number): void {
    if (length < 0 || this.position + length > this.bytes.length) {
      throw new Error('Truncated protobuf input');
    }
  }

}
