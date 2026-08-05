/**
 * FieldDescriptorProto 的 label / type 枚举值，以及基于它们的判定谓词。
 *
 * 类型编号只应由标量形态表（按编号建索引）直接使用，其余调用方一律通过谓词提问，
 * 避免 `type === TYPE_MESSAGE || type === TYPE_ENUM` 这类比较散落到解析与渲染层。
 */
const LABEL_REPEATED = 3;

const TYPE_DOUBLE = 1;
const TYPE_FLOAT = 2;
const TYPE_INT64 = 3;
const TYPE_UINT64 = 4;
const TYPE_INT32 = 5;
const TYPE_FIXED64 = 6;
const TYPE_FIXED32 = 7;
const TYPE_BOOL = 8;
const TYPE_STRING = 9;
const TYPE_GROUP = 10;
const TYPE_MESSAGE = 11;
const TYPE_BYTES = 12;
const TYPE_UINT32 = 13;
const TYPE_ENUM = 14;
const TYPE_SFIXED32 = 15;
const TYPE_SFIXED64 = 16;
const TYPE_SINT32 = 17;
const TYPE_SINT64 = 18;

/**
 * protobuf 标量类型的名称，作为标量形态表的键。
 *
 * 用名称而非编号建键，使形态表能被编译器检查完整性，也让编号止步于本模块。
 */
export type ScalarTypeName =
  | 'double' | 'float' | 'int64' | 'uint64' | 'int32'
  | 'fixed64' | 'fixed32' | 'bool' | 'string' | 'bytes'
  | 'uint32' | 'sfixed32' | 'sfixed64' | 'sint32' | 'sint64';

const SCALAR_TYPE_NAMES: Readonly<Record<number, ScalarTypeName>> = {
  [TYPE_DOUBLE]: 'double',
  [TYPE_FLOAT]: 'float',
  [TYPE_INT64]: 'int64',
  [TYPE_UINT64]: 'uint64',
  [TYPE_INT32]: 'int32',
  [TYPE_FIXED64]: 'fixed64',
  [TYPE_FIXED32]: 'fixed32',
  [TYPE_BOOL]: 'bool',
  [TYPE_STRING]: 'string',
  [TYPE_BYTES]: 'bytes',
  [TYPE_UINT32]: 'uint32',
  [TYPE_SFIXED32]: 'sfixed32',
  [TYPE_SFIXED64]: 'sfixed64',
  [TYPE_SINT32]: 'sint32',
  [TYPE_SINT64]: 'sint64'
};

/**
 * 把 descriptor 类型编号翻译为标量类型名；message / enum / group 等非标量返回 undefined。
 */
export function scalarTypeName(type: number): ScalarTypeName | undefined {
  return SCALAR_TYPE_NAMES[type];
}

// proto3 允许作为 map key 的标量类型：整数族、bool 与 string。
const MAP_KEY_TYPES: ReadonlySet<number> = new Set([
  TYPE_INT32,
  TYPE_INT64,
  TYPE_UINT32,
  TYPE_UINT64,
  TYPE_SINT32,
  TYPE_SINT64,
  TYPE_FIXED32,
  TYPE_FIXED64,
  TYPE_SFIXED32,
  TYPE_SFIXED64,
  TYPE_BOOL,
  TYPE_STRING
]);

/**
 * 判断字段是否声明为 repeated。
 */
export function isRepeatedLabel(label: number | undefined): boolean {
  return label === LABEL_REPEATED;
}

/**
 * 判断字段是否为已废弃的 group 编码。
 */
export function isGroupType(type: number): boolean {
  return type === TYPE_GROUP;
}

/**
 * 判断字段是否引用具名类型（message 或 enum），即需要解析 typeName。
 */
export function isNamedType(type: number): boolean {
  return type === TYPE_MESSAGE || type === TYPE_ENUM;
}

/**
 * 判断字段是否为 bytes，其空值判定需按长度而非默认值比较。
 */
export function isBytesType(type: number): boolean {
  return type === TYPE_BYTES;
}

/**
 * 判断 protobuf 字段类型能否使用 packed repeated 编码。
 */
export function isPackable(type: number): boolean {
  return type !== TYPE_STRING && type !== TYPE_BYTES &&
    type !== TYPE_MESSAGE && type !== TYPE_GROUP;
}

/**
 * 判断 protobuf 类型能否作为 map 的 key。
 */
export function isMapKeyType(type: number): boolean {
  return MAP_KEY_TYPES.has(type);
}
