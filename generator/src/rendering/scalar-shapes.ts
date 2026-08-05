import { scalarTypeName, type ScalarTypeName } from '../model/descriptor-types.js';
import type { ScalarShape } from '../model/field-model.js';

/**
 * 每个 protobuf 标量类型对应的 ArkTS 类型、默认值与线格式读写方法。
 *
 * 键为标量类型名而非 descriptor 编号，因此漏写一项会被编译器报出。
 */
const SCALAR_SHAPES: Readonly<Record<ScalarTypeName, ScalarShape>> = {
  double: shape('number', '0', 'writeDouble', 'readDouble', 'FIXED64'),
  float: shape('number', '0', 'writeFloat', 'readFloat', 'FIXED32'),
  int64: shape('bigint', '0n', 'writeInt64', 'readInt64', 'VARINT'),
  uint64: shape('bigint', '0n', 'writeUInt64', 'readUInt64', 'VARINT'),
  int32: shape('number', '0', 'writeInt32', 'readInt32', 'VARINT'),
  fixed64: shape('bigint', '0n', 'writeFixed64', 'readFixed64', 'FIXED64'),
  fixed32: shape('number', '0', 'writeFixed32', 'readFixed32', 'FIXED32'),
  bool: shape('boolean', 'false', 'writeBool', 'readBool', 'VARINT'),
  string: shape('string', "''", 'writeString', 'readString', 'LENGTH_DELIMITED'),
  bytes: shape(
    'collections.Uint8Array',
    'new collections.Uint8Array(0)',
    'writeBytes',
    'readBytes',
    'LENGTH_DELIMITED'
  ),
  uint32: shape('number', '0', 'writeUInt32', 'readUInt32', 'VARINT'),
  sfixed32: shape('number', '0', 'writeSFixed32', 'readSFixed32', 'FIXED32'),
  sfixed64: shape('bigint', '0n', 'writeSFixed64', 'readSFixed64', 'FIXED64'),
  sint32: shape('number', '0', 'writeSInt32', 'readSInt32', 'VARINT'),
  sint64: shape('bigint', '0n', 'writeSInt64', 'readSInt64', 'VARINT')
};

/**
 * 获取标量类型形态，并在类型不受支持时抛出带上下文的错误。
 */
export function requireScalarShape(type: number, context: string): ScalarShape {
  const name: ScalarTypeName | undefined = scalarTypeName(type);
  if (name === undefined) {
    throw new Error(`${context}: unsupported protobuf type ${type}`);
  }
  return SCALAR_SHAPES[name];
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
 * 将内部线类型名称转换为 protobuf tag 使用的数值。
 */
export function wireTypeNumber(wireType: string): number {
  switch (wireType) {
    case 'FIXED64':
      return 1;
    case 'LENGTH_DELIMITED':
      return 2;
    case 'FIXED32':
      return 5;
    default:
      return 0;
  }
}
