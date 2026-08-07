import { collections } from '@kit.ArkTS';
import { describe, expect, it } from '@ohos/hypium';
import { ProtoReader } from '../main/ets/wire/ProtoReader';
import { ProtoWireType } from '../main/ets/wire/ProtoWireType';
import { ProtoWriter } from '../main/ets/wire/ProtoWriter';

function didThrow(action: () => void): boolean {
  try {
    action();
    return false;
  } catch (_error) {
    return true;
  }
}

function assertBytes(actual: collections.Uint8Array, expected: number[]): void {
  expect(actual.length).assertEqual(expected.length);
  for (let index: number = 0; index < expected.length; index++) {
    expect(actual[index]).assertEqual(expected[index]);
  }
}

export default function protoWireTest(): void {
  describe('ProtoWireTest', () => {
    it('encodesIntegerWireVectors', 0, () => {
      const writer: ProtoWriter = new ProtoWriter();
      writer.writeInt32(-1);
      writer.writeUInt32(0xffffffff);
      writer.writeUInt64(0xffffffffffffffffn);

      assertBytes(writer.finish(), [
        0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01,
        0xff, 0xff, 0xff, 0xff, 0x0f,
        0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01
      ]);
    });

    it('roundTripsIntegerBoundaries', 0, () => {
      const writer: ProtoWriter = new ProtoWriter();
      writer.writeInt32(-0x80000000);
      writer.writeInt32(0x7fffffff);
      writer.writeUInt32(0xffffffff);
      writer.writeInt64(-0x8000000000000000n);
      writer.writeInt64(0x7fffffffffffffffn);
      writer.writeUInt64(0xffffffffffffffffn);

      const reader: ProtoReader = new ProtoReader(writer.finish());
      expect(reader.readInt32()).assertEqual(-0x80000000);
      expect(reader.readInt32()).assertEqual(0x7fffffff);
      expect(reader.readUInt32()).assertEqual(0xffffffff);
      expect(reader.readInt64() === -0x8000000000000000n).assertTrue();
      expect(reader.readInt64() === 0x7fffffffffffffffn).assertTrue();
      expect(reader.readUInt64() === 0xffffffffffffffffn).assertTrue();
      expect(reader.isAtEnd()).assertTrue();
    });

    it('encodesZigZagWireVectorsAndBoundaries', 0, () => {
      const writer: ProtoWriter = new ProtoWriter();
      writer.writeSInt32(0);
      writer.writeSInt32(-1);
      writer.writeSInt32(1);
      writer.writeSInt32(-0x80000000);
      writer.writeSInt64(-0x8000000000000000n);
      writer.writeSInt64(0x7fffffffffffffffn);

      const bytes: collections.Uint8Array = writer.finish();
      assertBytes(collections.Uint8Array.from([bytes[0], bytes[1], bytes[2]]), [0x00, 0x01, 0x02]);

      const reader: ProtoReader = new ProtoReader(bytes);
      expect(reader.readSInt32()).assertEqual(0);
      expect(reader.readSInt32()).assertEqual(-1);
      expect(reader.readSInt32()).assertEqual(1);
      expect(reader.readSInt32()).assertEqual(-0x80000000);
      expect(reader.readSInt64() === -0x8000000000000000n).assertTrue();
      expect(reader.readSInt64() === 0x7fffffffffffffffn).assertTrue();
    });

    it('usesLittleEndianForFixedIntegers', 0, () => {
      const writer: ProtoWriter = new ProtoWriter();
      writer.writeFixed32(0x78563412);
      writer.writeSFixed32(-2);
      writer.writeFixed64(0x0807060504030201n);
      writer.writeSFixed64(-2n);

      assertBytes(writer.finish(), [
        0x12, 0x34, 0x56, 0x78,
        0xfe, 0xff, 0xff, 0xff,
        0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
        0xfe, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff
      ]);

      const reader: ProtoReader = new ProtoReader(writer.finish());
      expect(reader.readFixed32()).assertEqual(0x78563412);
      expect(reader.readSFixed32()).assertEqual(-2);
      expect(reader.readFixed64() === 0x0807060504030201n).assertTrue();
      expect(reader.readSFixed64() === -2n).assertTrue();
    });

    it('roundTripsFloatingPointSpecialValues', 0, () => {
      const writer: ProtoWriter = new ProtoWriter();
      writer.writeFloat(1.5);
      writer.writeFloat(Number.NaN);
      writer.writeDouble(Number.POSITIVE_INFINITY);
      writer.writeDouble(Number.NEGATIVE_INFINITY);
      writer.writeDouble(-0);

      const reader: ProtoReader = new ProtoReader(writer.finish());
      expect(reader.readFloat()).assertEqual(1.5);
      expect(Number.isNaN(reader.readFloat())).assertTrue();
      expect(reader.readDouble()).assertEqual(Number.POSITIVE_INFINITY);
      expect(reader.readDouble()).assertEqual(Number.NEGATIVE_INFINITY);
      expect(1 / reader.readDouble()).assertEqual(Number.NEGATIVE_INFINITY);
    });

    it('roundTripsBoolStringAndBytesIncludingEmptyString', 0, () => {
      const writer: ProtoWriter = new ProtoWriter();
      writer.writeBool(false);
      writer.writeBool(true);
      writer.writeString('');
      writer.writeString('鸿蒙 protobuf');
      writer.writeBytes(collections.Uint8Array.from([0x00, 0x80, 0xff]));

      const reader: ProtoReader = new ProtoReader(writer.finish());
      expect(reader.readBool()).assertFalse();
      expect(reader.readBool()).assertTrue();
      expect(reader.readString()).assertEqual('');
      expect(reader.readString()).assertEqual('鸿蒙 protobuf');
      const bytes: collections.Uint8Array = reader.readBytes();
      assertBytes(bytes, [0x00, 0x80, 0xff]);
    });

    it('acceptsNativeAndSendableDecodeInput', 0, () => {
      const writer: ProtoWriter = new ProtoWriter();
      writer.writeTag(1, ProtoWireType.VARINT);
      writer.writeUInt32(300);
      const sendable: collections.Uint8Array = writer.finish();

      // Sendable 入口：构造函数内部拷贝一次。
      const sendableReader: ProtoReader = new ProtoReader(sendable);
      expect(sendableReader.readTag()).assertEqual(0x08);
      expect(sendableReader.readUInt32()).assertEqual(300);

      // 原生入口：零拷贝视图，读取结果必须一致。
      const nativeReader: ProtoReader = new ProtoReader(new Uint8Array(writer.finishBuffer()));
      expect(nativeReader.readTag()).assertEqual(0x08);
      expect(nativeReader.readUInt32()).assertEqual(300);
      expect(nativeReader.isAtEnd()).assertTrue();
    });

    it('finishBufferReturnsNativeBufferTrimmedToLength', 0, () => {
      const writer: ProtoWriter = new ProtoWriter();
      writer.writeTag(1, ProtoWireType.VARINT);
      writer.writeUInt32(300);

      // 底层缓冲区按 2 倍扩容，finishBuffer 必须截取到实际写入长度。
      const buffer: ArrayBuffer = writer.finishBuffer();
      expect(buffer.byteLength).assertEqual(3);

      // 该 ArrayBuffer 可直接回灌 reader，无需经过 Sendable 容器。
      const reader: ProtoReader = ProtoReader.fromBuffer(buffer);
      expect(reader.readTag()).assertEqual(0x08);
      expect(reader.readUInt32()).assertEqual(300);
      expect(reader.isAtEnd()).assertTrue();
    });

    it('finishAndFinishBufferAgreeOnBytes', 0, () => {
      const writer: ProtoWriter = new ProtoWriter();
      writer.writeTag(1, ProtoWireType.LENGTH_DELIMITED);
      writer.writeString('鸿蒙 protobuf');
      const sendable: collections.Uint8Array = writer.finish();

      const other: ProtoWriter = new ProtoWriter();
      other.writeTag(1, ProtoWireType.LENGTH_DELIMITED);
      other.writeString('鸿蒙 protobuf');
      const native: Uint8Array = new Uint8Array(other.finishBuffer());

      expect(native.length).assertEqual(sendable.length);
      for (let index: number = 0; index < sendable.length; index++) {
        expect(native[index]).assertEqual(sendable[index]);
      }
    });

    it('readsFromNativeArrayBufferOfAnyLength', 0, () => {
      // 长度 3 不是 4 的整数倍；原生视图不受 collections.Uint8Array 的对齐约束。
      const arrayBuffer: ArrayBuffer = new ArrayBuffer(3);
      const view: Uint8Array = new Uint8Array(arrayBuffer);
      view[0] = 0x08;
      view[1] = 0xac;
      view[2] = 0x02;

      const reader: ProtoReader = ProtoReader.fromBuffer(arrayBuffer);
      expect(reader.readTag()).assertEqual(0x08);
      expect(reader.readUInt32()).assertEqual(300);
      expect(reader.isAtEnd()).assertTrue();
    });

    it('readsSliceWithoutCopyingAndKeepsPositionAligned', 0, () => {
      const inner: ProtoWriter = new ProtoWriter();
      inner.writeTag(1, ProtoWireType.VARINT);
      inner.writeUInt32(7);

      const writer: ProtoWriter = new ProtoWriter();
      writer.writeTag(1, ProtoWireType.LENGTH_DELIMITED);
      writer.writeBytes(inner.finish());
      writer.writeTag(2, ProtoWireType.VARINT);
      writer.writeUInt32(9);

      const reader: ProtoReader = new ProtoReader(writer.finish());
      expect(reader.readTag()).assertEqual(0x0a);
      const slice: Uint8Array = reader.readSlice();
      expect(slice.length).assertEqual(2);

      const nested: ProtoReader = new ProtoReader(slice);
      expect(nested.readTag()).assertEqual(0x08);
      expect(nested.readUInt32()).assertEqual(7);
      expect(nested.isAtEnd()).assertTrue();

      // readSlice 必须跨过整个字节段，外层继续读取后续字段。
      expect(reader.readTag()).assertEqual(0x10);
      expect(reader.readUInt32()).assertEqual(9);
      expect(reader.isAtEnd()).assertTrue();
    });

    it('rejectsTruncatedSlice', 0, () => {
      expect(didThrow((): void => {
        new ProtoReader(collections.Uint8Array.from([0x05, 0x01, 0x02])).readSlice();
      })).assertTrue();
    });

    it('supportsPackedAndUnpackedComposition', 0, () => {
      const packedValues: collections.Array<number> = new collections.Array<number>(-1, 0, 1);
      const writer: ProtoWriter = new ProtoWriter();
      writer.writePackedSInt32(1, packedValues);
      writer.writeTag(1, ProtoWireType.VARINT);
      writer.writeSInt32(-2);

      const reader: ProtoReader = new ProtoReader(writer.finish());
      expect(reader.readTag()).assertEqual(0x0a);
      const decoded: collections.Array<number> = new collections.Array<number>();
      reader.readPackedSInt32(decoded);
      expect(decoded.length).assertEqual(3);
      expect(decoded[0]).assertEqual(-1);
      expect(decoded[1]).assertEqual(0);
      expect(decoded[2]).assertEqual(1);
      expect(reader.readTag()).assertEqual(0x08);
      expect(reader.readSInt32()).assertEqual(-2);

      const emptyWriter: ProtoWriter = new ProtoWriter();
      emptyWriter.writePackedInt32(1, new collections.Array<number>());
      expect(emptyWriter.finish().length).assertEqual(0);
    });

    it('roundTripsMapEntryFramework', 0, () => {
      const values: collections.Map<string, number> = new collections.Map<string, number>();
      values.set('a', 7);
      const writer: ProtoWriter = new ProtoWriter();
      writer.writeMap<string, number>(1, values, ProtoWireType.LENGTH_DELIMITED, ProtoWireType.VARINT,
        (entry: ProtoWriter, key: string): void => entry.writeString(key),
        (entry: ProtoWriter, value: number): void => entry.writeInt32(value));

      const reader: ProtoReader = new ProtoReader(writer.finish());
      expect(reader.readTag()).assertEqual(0x0a);
      const decoded: collections.Map<string, number> = new collections.Map<string, number>();
      reader.readMapEntry<string, number>(decoded, '', 0, 0x0a, 0x10,
        (entry: ProtoReader): string => entry.readString(),
        (entry: ProtoReader): number => entry.readInt32());
      expect(decoded.size).assertEqual(1);
      expect(decoded.get('a')).assertEqual(7);
    });

    it('skipsEveryUnknownWireTypeAndContinues', 0, () => {
      const bytes: collections.Uint8Array = collections.Uint8Array.from([
        0x10, 0x96, 0x01,
        0x19, 1, 2, 3, 4, 5, 6, 7, 8,
        0x22, 0x03, 0xaa, 0xbb, 0xcc,
        0x2b, 0x08, 0x01, 0x2c,
        0x35, 9, 8, 7, 6,
        0x08, 0x2a
      ]);
      const reader: ProtoReader = new ProtoReader(bytes);

      for (let index: number = 0; index < 5; index++) {
        const tag: number = reader.readTag();
        reader.skipField(Math.floor(tag / 8), tag & 0x07);
      }
      expect(reader.readTag()).assertEqual(0x08);
      expect(reader.readInt32()).assertEqual(42);
    });

    it('skipsDeeplyNestedUnknownGroupsWithoutRecursion', 0, () => {
      const depth: number = 4096;
      const values: number[] = [];
      for (let index: number = 0; index < depth; index++) {
        values.push(0x0b);
      }
      for (let index: number = 0; index < depth; index++) {
        values.push(0x0c);
      }
      values.push(0x10);
      values.push(0x2a);

      const reader: ProtoReader = new ProtoReader(collections.Uint8Array.from(values));
      const tag: number = reader.readTag();
      reader.skipField(Math.floor(tag / 8), tag & 0x07);
      expect(reader.readTag()).assertEqual(0x10);
      expect(reader.readUInt32()).assertEqual(42);
      expect(reader.isAtEnd()).assertTrue();
    });

    it('encodesVarintAcrossEveryByteLengthBoundary', 0, () => {
      // 覆盖 1..5 字节的每个进位边界，确保 32 位快路径的移位与掩码逐字节正确。
      const writer: ProtoWriter = new ProtoWriter();
      writer.writeUInt32(127);
      writer.writeUInt32(128);
      writer.writeUInt32(16383);
      writer.writeUInt32(16384);
      writer.writeUInt32(2097151);
      writer.writeUInt32(2097152);
      writer.writeUInt32(268435455);
      writer.writeUInt32(268435456);

      assertBytes(writer.finish(), [
        0x7f,
        0x80, 0x01,
        0xff, 0x7f,
        0x80, 0x80, 0x01,
        0xff, 0xff, 0x7f,
        0x80, 0x80, 0x80, 0x01,
        0xff, 0xff, 0xff, 0x7f,
        0x80, 0x80, 0x80, 0x80, 0x01
      ]);
    });

    it('encodesHighBitSetVarintsWithoutSignContamination', 0, () => {
      // 这三个值编码后都设了第 31 位；若快路径误用有符号右移会产出错误字节。
      const writer: ProtoWriter = new ProtoWriter();
      writer.writeTag(0x1fffffff, ProtoWireType.FIXED32);
      writer.writeUInt32(0xffffffff);
      writer.writeSInt32(-0x80000000);

      assertBytes(writer.finish(), [
        0xfd, 0xff, 0xff, 0xff, 0x0f,
        0xff, 0xff, 0xff, 0xff, 0x0f,
        0xff, 0xff, 0xff, 0xff, 0x0f
      ]);

      const reader: ProtoReader = new ProtoReader(writer.finish());
      expect(reader.readTag()).assertEqual(0xfffffffd);
      expect(reader.readUInt32()).assertEqual(0xffffffff);
      expect(reader.readSInt32()).assertEqual(-0x80000000);
      expect(reader.isAtEnd()).assertTrue();
    });

    it('rejectsOutOfRangeWriterValues', 0, () => {
      expect(didThrow((): void => new ProtoWriter().writeInt32(0x80000000))).assertTrue();
      expect(didThrow((): void => new ProtoWriter().writeUInt32(-1))).assertTrue();
      expect(didThrow((): void => new ProtoWriter().writeUInt32(1.5))).assertTrue();
      expect(didThrow((): void => new ProtoWriter().writeInt64(0x8000000000000000n))).assertTrue();
      expect(didThrow((): void => new ProtoWriter().writeUInt64(-1n))).assertTrue();
      expect(didThrow((): void => new ProtoWriter().writeFixed32(0x100000000))).assertTrue();
      expect(didThrow((): void => new ProtoWriter().writeTag(0, ProtoWireType.VARINT))).assertTrue();
      expect(didThrow((): void => new ProtoWriter().writeTag(1, 6))).assertTrue();
    });

    // 32 位字段在 wire 上按 64 位 varint 编码；超出 32 位的部分按规范截断，不得报错。
    it('truncates32BitFieldsInsteadOfRejectingWideVarints', 0, () => {
      // 0x200000000 截断到 32 位是 0。
      const wideUInt32: ProtoReader = new ProtoReader(
        collections.Uint8Array.from([0x80, 0x80, 0x80, 0x80, 0x20])
      );
      expect(wideUInt32.readUInt32()).assertEqual(0);

      // 0x100000002 先截断为 2，再 zigzag 解码得 1；顺序反了会得到错误的负数。
      const wideSInt32: ProtoReader = new ProtoReader(
        collections.Uint8Array.from([0x82, 0x80, 0x80, 0x80, 0x10])
      );
      expect(wideSInt32.readSInt32()).assertEqual(1);
    });

    // tag 是 32 位值，最长 5 字节；更长的编码即使数值合法也属畸形输入。
    it('rejectsOverlongTagVarints', 0, () => {
      expect(didThrow((): void => new ProtoReader(collections.Uint8Array.from([
        0x88, 0x80, 0x80, 0x80, 0x80, 0x00
      ])).readTag())).assertTrue();

      // 5 字节的最大合法 tag 仍须接受。
      const maxTag: ProtoReader = new ProtoReader(
        collections.Uint8Array.from([0xfd, 0xff, 0xff, 0xff, 0x0f])
      );
      expect(maxTag.readTag()).assertEqual(0xfffffffd);
    });

    it('rejectsMalformedAndTruncatedInput', 0, () => {
      expect(didThrow((): void => new ProtoReader(collections.Uint8Array.from([0x00])).readTag())).assertTrue();
      expect(didThrow((): void => new ProtoReader(collections.Uint8Array.from([0x0e])).readTag())).assertTrue();
      expect(didThrow((): void => new ProtoReader(collections.Uint8Array.from([
        0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80
      ])).readInt64())).assertTrue();
      expect(didThrow((): void => new ProtoReader(collections.Uint8Array.from([1, 2, 3])).readFixed32())).assertTrue();
      expect(didThrow((): void => new ProtoReader(collections.Uint8Array.from([0x03, 0x41])).readString())).assertTrue();
      expect(didThrow((): void => new ProtoReader(collections.Uint8Array.from([0x01, 0xff])).readString())).assertTrue();
      expect(didThrow((): void => {
        const reader: ProtoReader = new ProtoReader(collections.Uint8Array.from([0x0b, 0x14]));
        const tag: number = reader.readTag();
        reader.skipField(Math.floor(tag / 8), tag & 0x07);
      })).assertTrue();
      expect(didThrow((): void => {
        const reader: ProtoReader = new ProtoReader(collections.Uint8Array.from([0x0b, 0x08, 0x01]));
        const tag: number = reader.readTag();
        reader.skipField(Math.floor(tag / 8), tag & 0x07);
      })).assertTrue();
    });
  });
}
