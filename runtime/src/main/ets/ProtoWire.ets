import { collections, util } from '@kit.ArkTS';

const MAX_FIELD_NUMBER: number = 0x1fffffff;
const MAX_LENGTH: bigint = 0x7fffffffn;
const MAX_LENGTH_NUMBER: number = 0x7fffffff;
const MAX_VARINT_BYTES: number = 10;
const INT32_MIN: number = -0x80000000;
const INT32_MAX: number = 0x7fffffff;
const UINT32_MAX: number = 0xffffffff;
const UINT32_MAX_AS_BIGINT: bigint = 0xffffffffn;
const INT64_MIN: bigint = -0x8000000000000000n;
const INT64_MAX: bigint = 0x7fffffffffffffffn;
const UINT64_MAX: bigint = 0xffffffffffffffffn;

/**
 * Protobuf 标准 wire type。
 */
export const enum ProtoWireType {
  VARINT = 0,
  FIXED64 = 1,
  LENGTH_DELIMITED = 2,
  START_GROUP = 3,
  END_GROUP = 4,
  FIXED32 = 5
}

/**
 * 共享容器操作的显式异常边界；异常原样向 codec 调用方传播。
 */
export function appendProtoValue<T>(values: collections.Array<T>, value: T): void {
  try {
    values.push(value);
  } catch (error) {
    throw error as Error;
  }
}

/**
 * 共享容器操作的显式异常边界；异常原样向 codec 调用方传播。
 */
export function setProtoMapValue<K, V>(values: collections.Map<K, V>, key: K, value: V): void {
  try {
    values.set(key, value);
  } catch (error) {
    throw error as Error;
  }
}

/**
 * 获取共享 Map 的确定性遍历快照，并原样传播容器异常。
 */
export function getProtoMapKeys<K, V>(values: collections.Map<K, V>): collections.Array<K> {
  const result: collections.Array<K> = new collections.Array<K>();
  try {
    for (const key of values.keys()) {
      result.push(key);
    }
  } catch (error) {
    throw error as Error;
  }
  return result;
}

/**
 * 读取共享 Map，并原样传播容器异常。
 */
export function getProtoMapValue<K, V>(values: collections.Map<K, V>, key: K): V | undefined {
  try {
    return values.get(key);
  } catch (error) {
    throw error as Error;
  }
}

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
 * 纯 ArkTS Protobuf writer；只应作为 encode 过程中的局部对象使用。
 */
export class ProtoWriter {
  private buffer: Uint8Array = new Uint8Array(64);
  private position: number = 0;

  writeTag(fieldNumber: number, wireType: number): void {
    this.validateIntegerRange('field number', fieldNumber, 1, MAX_FIELD_NUMBER);
    if (!this.isValidWireType(wireType)) {
      throw new Error(`Invalid protobuf wire type: ${wireType}`);
    }
    // fieldNumber * 8 + wireType 最大 0xfffffffd，仍在 varint32 快路径范围内。
    this.writeVarint32(fieldNumber * 8 + wireType);
  }

  writeInt32(value: number): void {
    this.validateIntegerRange('int32', value, INT32_MIN, INT32_MAX);
    // 负 int32 必须按 protobuf 规则符号扩展成 64 位（整 10 字节），超出 number 精度。
    if (value < 0) {
      this.writeVarint(BigInt.asUintN(64, BigInt(value)));
      return;
    }
    this.writeVarint32(value);
  }

  writeUInt32(value: number): void {
    this.validateIntegerRange('uint32', value, 0, UINT32_MAX);
    this.writeVarint32(value);
  }

  writeSInt32(value: number): void {
    this.validateIntegerRange('sint32', value, INT32_MIN, INT32_MAX);
    // zigzag 后落在 [0, 2^32)；`>>> 0` 把 32 位有符号结果转回无符号。
    this.writeVarint32(((value << 1) ^ (value >> 31)) >>> 0);
  }

  writeInt64(value: bigint): void {
    this.validateBigIntRange('int64', value, INT64_MIN, INT64_MAX);
    this.writeVarint(BigInt.asUintN(64, value));
  }

  writeUInt64(value: bigint): void {
    this.validateBigIntRange('uint64', value, 0n, UINT64_MAX);
    this.writeVarint(value);
  }

  writeSInt64(value: bigint): void {
    this.validateBigIntRange('sint64', value, INT64_MIN, INT64_MAX);
    this.writeVarint((value << 1n) ^ (value >> 63n));
  }

  writeFixed32(value: number): void {
    this.validateIntegerRange('fixed32', value, 0, UINT32_MAX);
    this.writeLittleEndian32(value);
  }

  writeSFixed32(value: number): void {
    this.validateIntegerRange('sfixed32', value, INT32_MIN, INT32_MAX);
    // `>>> 0` 取 32 位二进制补码，等价于 BigInt.asUintN(32, …) 但不分配。
    this.writeLittleEndian32(value >>> 0);
  }

  writeFixed64(value: bigint): void {
    this.validateBigIntRange('fixed64', value, 0n, UINT64_MAX);
    this.writeLittleEndian64(value);
  }

  writeSFixed64(value: bigint): void {
    this.validateBigIntRange('sfixed64', value, INT64_MIN, INT64_MAX);
    this.writeLittleEndian64(BigInt.asUintN(64, value));
  }

  writeFloat(value: number): void {
    const arrayBuffer: ArrayBuffer = new ArrayBuffer(4);
    const view: DataView = new DataView(arrayBuffer);
    view.setFloat32(0, value, true);
    this.writeNativeBytes(new Uint8Array(arrayBuffer));
  }

  writeDouble(value: number): void {
    const arrayBuffer: ArrayBuffer = new ArrayBuffer(8);
    const view: DataView = new DataView(arrayBuffer);
    view.setFloat64(0, value, true);
    this.writeNativeBytes(new Uint8Array(arrayBuffer));
  }

  writeBool(value: boolean): void {
    this.writeVarint32(value ? 1 : 0);
  }

  writeString(value: string): void {
    if (value.length === 0) {
      this.writeVarint32(0);
      return;
    }
    const bytes: Uint8Array = new util.TextEncoder().encodeInto(value);
    this.writeLength(bytes.length);
    this.writeNativeBytes(bytes);
  }

  writeBytes(value: collections.Uint8Array): void {
    this.writeLength(value.length);
    this.ensureCapacity(value.length);
    for (let index: number = 0; index < value.length; index++) {
      this.buffer[this.position++] = value[index];
    }
  }

  /**
   * 返回 Sendable bytes，供写入 bytes 字段或跨线程传递。
   */
  finish(): collections.Uint8Array {
    return collections.Uint8Array.from(this.buffer.subarray(0, this.position));
  }

  /**
   * 返回原生 ArrayBuffer，可直接作为 RCP 等网络接口的请求体；按实际写入长度截取一次。
   */
  finishBuffer(): ArrayBuffer {
    return this.buffer.buffer.slice(0, this.position);
  }

  private writeVarint(value: bigint): void {
    let remaining: bigint = value;
    while (remaining >= 0x80n) {
      this.writeByte(Number((remaining & 0x7fn) | 0x80n));
      remaining >>= 7n;
    }
    this.writeByte(Number(remaining));
  }

  /**
   * 32 位以内取值的 varint 快路径，字节输出与 writeVarint 完全一致但不分配 BigInt。
   *
   * 调用方必须保证 value 是 [0, 2^32) 内的整数：该范围内 `& 0x7f` 与 `>>>` 都是精确的
   * 32 位运算，超出后 `>>>` 会先把操作数截断到 32 位，结果不再正确。
   */
  private writeVarint32(value: number): void {
    let remaining: number = value;
    while (remaining >= 0x80) {
      this.writeByte((remaining & 0x7f) | 0x80);
      remaining >>>= 7;
    }
    this.writeByte(remaining);
  }

  private writeLength(value: number): void {
    this.validateIntegerRange('length', value, 0, MAX_LENGTH_NUMBER);
    this.writeVarint32(value);
  }

  private writeLittleEndian32(value: number): void {
    this.ensureCapacity(4);
    for (let index: number = 0; index < 4; index++) {
      this.buffer[this.position++] = (value >>> (index * 8)) & 0xff;
    }
  }

  private writeLittleEndian64(value: bigint): void {
    this.ensureCapacity(8);
    for (let index: number = 0; index < 8; index++) {
      this.buffer[this.position++] = Number((value >> BigInt(index * 8)) & 0xffn);
    }
  }

  private writeNativeBytes(value: Uint8Array): void {
    this.ensureCapacity(value.length);
    this.buffer.set(value, this.position);
    this.position += value.length;
  }

  private writeByte(value: number): void {
    this.ensureCapacity(1);
    this.buffer[this.position++] = value;
  }

  private ensureCapacity(additionalLength: number): void {
    const requiredLength: number = this.position + additionalLength;
    if (requiredLength <= this.buffer.length) {
      return;
    }
    let nextLength: number = this.buffer.length;
    while (nextLength < requiredLength) {
      nextLength *= 2;
    }
    const nextBuffer: Uint8Array = new Uint8Array(nextLength);
    nextBuffer.set(this.buffer);
    this.buffer = nextBuffer;
  }

  private validateIntegerRange(name: string, value: number, minimum: number, maximum: number): void {
    if (!Number.isInteger(value) || value < minimum || value > maximum) {
      throw new Error(`Protobuf ${name} is out of range: ${value}`);
    }
  }

  private validateBigIntRange(name: string, value: bigint, minimum: bigint, maximum: bigint): void {
    if (value < minimum || value > maximum) {
      throw new Error(`Protobuf ${name} is out of range: ${value}`);
    }
  }

  private isValidWireType(wireType: number): boolean {
    return Number.isInteger(wireType) && wireType >= ProtoWireType.VARINT && wireType <= ProtoWireType.FIXED32;
  }
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
    const rawTag: bigint = this.readVarint();
    const fieldNumber: bigint = rawTag >> 3n;
    const wireType: number = Number(rawTag & 0x07n);
    if (fieldNumber < 1n || fieldNumber > BigInt(MAX_FIELD_NUMBER)) {
      throw new Error(`Invalid protobuf field number: ${fieldNumber}`);
    }
    if (!this.isValidWireType(wireType)) {
      throw new Error(`Invalid protobuf wire type: ${wireType}`);
    }
    return Number(rawTag);
  }

  readInt32(): number {
    return Number(BigInt.asIntN(32, this.readVarint()));
  }

  readUInt32(): number {
    const value: bigint = this.readVarint();
    if (value > UINT32_MAX_AS_BIGINT) {
      throw new Error('Protobuf uint32 is out of range');
    }
    return Number(value);
  }

  readSInt32(): number {
    const value: bigint = this.readVarint();
    if (value > UINT32_MAX_AS_BIGINT) {
      throw new Error('Protobuf sint32 is out of range');
    }
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
    return Number(this.readLittleEndian(4));
  }

  readSFixed32(): number {
    return Number(BigInt.asIntN(32, this.readLittleEndian(4)));
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

  private readVarint(): bigint {
    let result: bigint = 0n;
    for (let index: number = 0; index < MAX_VARINT_BYTES; index++) {
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
    while (!this.isAtEnd()) {
      const tag: number = this.readTag();
      const nestedFieldNumber: number = Math.floor(tag / 8);
      const wireType: number = tag & 0x07;
      if (wireType === ProtoWireType.END_GROUP) {
        if (nestedFieldNumber !== fieldNumber) {
          throw new Error('Mismatched protobuf end-group tag');
        }
        return;
      }
      this.skipField(nestedFieldNumber, wireType);
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

  private isValidWireType(wireType: number): boolean {
    return Number.isInteger(wireType) && wireType >= ProtoWireType.VARINT && wireType <= ProtoWireType.FIXED32;
  }
}
