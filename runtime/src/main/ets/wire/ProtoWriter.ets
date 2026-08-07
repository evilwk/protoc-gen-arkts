import { collections, util } from '@kit.ArkTS';
import { ProtoContainers } from '../ProtoContainers';
import { isValidWireType, ProtoWireType } from './ProtoWireType';

const MAX_FIELD_NUMBER: number = 0x1fffffff;
const MAX_LENGTH_NUMBER: number = 0x7fffffff;
const INT32_MIN: number = -0x80000000;
const INT32_MAX: number = 0x7fffffff;
const UINT32_MAX: number = 0xffffffff;
const INT64_MIN: bigint = -0x8000000000000000n;
const INT64_MAX: bigint = 0x7fffffffffffffffn;
const UINT64_MAX: bigint = 0xffffffffffffffffn;

/**
 * 纯 ArkTS Protobuf writer；只应作为 encode 过程中的局部对象使用。
 */
export class ProtoWriter {
  private buffer: Uint8Array = new Uint8Array(64);
  private position: number = 0;

  writeTag(fieldNumber: number, wireType: number): void {
    this.validateIntegerRange('field number', fieldNumber, 1, MAX_FIELD_NUMBER);
    if (!isValidWireType(wireType)) {
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

  writePackedInt32(fieldNumber: number, values: collections.Array<number>): void {
    if (values.length === 0) return;
    const packed: ProtoWriter = new ProtoWriter();
    for (let index: number = 0; index < values.length; index++) packed.writeInt32(values[index]);
    this.writeDelimited(fieldNumber, packed);
  }

  writePackedUInt32(fieldNumber: number, values: collections.Array<number>): void {
    if (values.length === 0) return;
    const packed: ProtoWriter = new ProtoWriter();
    for (let index: number = 0; index < values.length; index++) packed.writeUInt32(values[index]);
    this.writeDelimited(fieldNumber, packed);
  }

  writePackedSInt32(fieldNumber: number, values: collections.Array<number>): void {
    if (values.length === 0) return;
    const packed: ProtoWriter = new ProtoWriter();
    for (let index: number = 0; index < values.length; index++) packed.writeSInt32(values[index]);
    this.writeDelimited(fieldNumber, packed);
  }

  writePackedFixed32(fieldNumber: number, values: collections.Array<number>): void {
    if (values.length === 0) return;
    const packed: ProtoWriter = new ProtoWriter();
    for (let index: number = 0; index < values.length; index++) packed.writeFixed32(values[index]);
    this.writeDelimited(fieldNumber, packed);
  }

  writePackedSFixed32(fieldNumber: number, values: collections.Array<number>): void {
    if (values.length === 0) return;
    const packed: ProtoWriter = new ProtoWriter();
    for (let index: number = 0; index < values.length; index++) packed.writeSFixed32(values[index]);
    this.writeDelimited(fieldNumber, packed);
  }

  writePackedFloat(fieldNumber: number, values: collections.Array<number>): void {
    if (values.length === 0) return;
    const packed: ProtoWriter = new ProtoWriter();
    for (let index: number = 0; index < values.length; index++) packed.writeFloat(values[index]);
    this.writeDelimited(fieldNumber, packed);
  }

  writePackedDouble(fieldNumber: number, values: collections.Array<number>): void {
    if (values.length === 0) return;
    const packed: ProtoWriter = new ProtoWriter();
    for (let index: number = 0; index < values.length; index++) packed.writeDouble(values[index]);
    this.writeDelimited(fieldNumber, packed);
  }

  writePackedBool(fieldNumber: number, values: collections.Array<boolean>): void {
    if (values.length === 0) return;
    const packed: ProtoWriter = new ProtoWriter();
    for (let index: number = 0; index < values.length; index++) packed.writeBool(values[index]);
    this.writeDelimited(fieldNumber, packed);
  }

  writePackedInt64(fieldNumber: number, values: collections.Array<bigint>): void {
    if (values.length === 0) return;
    const packed: ProtoWriter = new ProtoWriter();
    for (let index: number = 0; index < values.length; index++) packed.writeInt64(values[index]);
    this.writeDelimited(fieldNumber, packed);
  }

  writePackedUInt64(fieldNumber: number, values: collections.Array<bigint>): void {
    if (values.length === 0) return;
    const packed: ProtoWriter = new ProtoWriter();
    for (let index: number = 0; index < values.length; index++) packed.writeUInt64(values[index]);
    this.writeDelimited(fieldNumber, packed);
  }

  writePackedSInt64(fieldNumber: number, values: collections.Array<bigint>): void {
    if (values.length === 0) return;
    const packed: ProtoWriter = new ProtoWriter();
    for (let index: number = 0; index < values.length; index++) packed.writeSInt64(values[index]);
    this.writeDelimited(fieldNumber, packed);
  }

  writePackedFixed64(fieldNumber: number, values: collections.Array<bigint>): void {
    if (values.length === 0) return;
    const packed: ProtoWriter = new ProtoWriter();
    for (let index: number = 0; index < values.length; index++) packed.writeFixed64(values[index]);
    this.writeDelimited(fieldNumber, packed);
  }

  writePackedSFixed64(fieldNumber: number, values: collections.Array<bigint>): void {
    if (values.length === 0) return;
    const packed: ProtoWriter = new ProtoWriter();
    for (let index: number = 0; index < values.length; index++) packed.writeSFixed64(values[index]);
    this.writeDelimited(fieldNumber, packed);
  }

  writeMap<K, V>(
    fieldNumber: number,
    values: collections.Map<K, V>,
    keyWireType: number,
    valueWireType: number,
    writeKey: (writer: ProtoWriter, key: K) => void,
    writeValue: (writer: ProtoWriter, value: V) => void
  ): void {
    const keys: collections.Array<K> = ProtoContainers.mapKeys(values);
    for (let index: number = 0; index < keys.length; index++) {
      const key: K = keys[index];
      const value: V | undefined = ProtoContainers.mapValue(values, key);
      if (value !== undefined) {
        const entry: ProtoWriter = new ProtoWriter();
        entry.writeTag(1, keyWireType);
        writeKey(entry, key);
        entry.writeTag(2, valueWireType);
        writeValue(entry, value);
        this.writeDelimited(fieldNumber, entry);
      }
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

  private writeDelimited(fieldNumber: number, writer: ProtoWriter): void {
    this.writeTag(fieldNumber, ProtoWireType.LENGTH_DELIMITED);
    this.writeBytes(writer.finish());
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
    if (!Number.isSafeInteger(requiredLength) || requiredLength > MAX_LENGTH_NUMBER) {
      throw new Error('Protobuf output exceeds supported length');
    }
    if (requiredLength <= this.buffer.length) {
      return;
    }
    let nextLength: number = this.buffer.length;
    while (nextLength < requiredLength) {
      nextLength = Math.min(nextLength * 2, MAX_LENGTH_NUMBER);
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

}
