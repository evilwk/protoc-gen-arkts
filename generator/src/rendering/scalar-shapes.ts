import { type ScalarShape, TYPE_BYTES, TYPE_GROUP, TYPE_MESSAGE } from '../model/types.js';

export const TYPE_DOUBLE = 1;
export const TYPE_FLOAT = 2;
export const TYPE_INT64 = 3;
export const TYPE_UINT64 = 4;
export const TYPE_INT32 = 5;
export const TYPE_FIXED64 = 6;
export const TYPE_FIXED32 = 7;
export const TYPE_BOOL = 8;
export const TYPE_STRING = 9;
export const TYPE_UINT32 = 13;
export const TYPE_SFIXED32 = 15;
export const TYPE_SFIXED64 = 16;
export const TYPE_SINT32 = 17;
export const TYPE_SINT64 = 18;

const SCALAR_SHAPES: Readonly<Record<number, ScalarShape>> = {
  [TYPE_DOUBLE]: shape('number', '0', 'writeDouble', 'readDouble', 'FIXED64'),
  [TYPE_FLOAT]: shape('number', '0', 'writeFloat', 'readFloat', 'FIXED32'),
  [TYPE_INT64]: shape('bigint', '0n', 'writeInt64', 'readInt64', 'VARINT'),
  [TYPE_UINT64]: shape('bigint', '0n', 'writeUInt64', 'readUInt64', 'VARINT'),
  [TYPE_INT32]: shape('number', '0', 'writeInt32', 'readInt32', 'VARINT'),
  [TYPE_FIXED64]: shape('bigint', '0n', 'writeFixed64', 'readFixed64', 'FIXED64'),
  [TYPE_FIXED32]: shape('number', '0', 'writeFixed32', 'readFixed32', 'FIXED32'),
  [TYPE_BOOL]: shape('boolean', 'false', 'writeBool', 'readBool', 'VARINT'),
  [TYPE_STRING]: shape('string', "''", 'writeString', 'readString', 'LENGTH_DELIMITED'),
  [TYPE_BYTES]: shape(
    'collections.Uint8Array',
    'new collections.Uint8Array(0)',
    'writeBytes',
    'readBytes',
    'LENGTH_DELIMITED'
  ),
  [TYPE_UINT32]: shape('number', '0', 'writeUInt32', 'readUInt32', 'VARINT'),
  [TYPE_SFIXED32]: shape('number', '0', 'writeSFixed32', 'readSFixed32', 'FIXED32'),
  [TYPE_SFIXED64]: shape('bigint', '0n', 'writeSFixed64', 'readSFixed64', 'FIXED64'),
  [TYPE_SINT32]: shape('number', '0', 'writeSInt32', 'readSInt32', 'VARINT'),
  [TYPE_SINT64]: shape('bigint', '0n', 'writeSInt64', 'readSInt64', 'VARINT')
};

/**
 * 获取标量类型形态，并在类型不受支持时抛出带上下文的错误。
 */
export function requireScalarShape(type: number, context: string): ScalarShape {
  const result: ScalarShape | undefined = scalarShape(type);
  if (result === undefined) {
    throw new Error(`${context}: unsupported protobuf type ${type}`);
  }
  return result;
}

/**
 * 查询 protobuf 标量类型对应的 ArkTS 类型、默认值及读写方法。
 */
function scalarShape(type: number): ScalarShape | undefined {
  return SCALAR_SHAPES[type];
}

/**
 * 构造描述字段类型及其线格式读写方式的标量形态。
 */
export function shape(
  arkType: string,
  defaultValue: string,
  writerMethod: string,
  readerMethod: string,
  wireType: string
): ScalarShape {
  return {
    arkType,
    defaultValue,
    writerMethod,
    readerMethod,
    wireType
  };
}

/**
 * 判断 protobuf 字段类型能否使用 packed repeated 编码。
 */
export function isPackable(type: number): boolean {
  return type !== TYPE_STRING && type !== TYPE_BYTES && type !== TYPE_MESSAGE && type !== TYPE_GROUP;
}

/**
 * 将内部线类型名称转换为 protobuf tag 使用的数值。
 */
export function wireTypeNumber(wireType: string): number {
  if (wireType === 'FIXED64') {
    return 1;
  }
  if (wireType === 'LENGTH_DELIMITED') {
    return 2;
  }
  if (wireType === 'FIXED32') {
    return 5;
  }
  return 0;
}
