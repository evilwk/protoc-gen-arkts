/**
 * 区分 ArkTS 类型相同、但 JSON 表示不同的 Protobuf 值类型。
 */
export const enum ProtoValueKind {
  INT32,
  UINT32,
  SINT32,
  FIXED32,
  SFIXED32,
  INT64,
  UINT64,
  SINT64,
  FIXED64,
  SFIXED64,
  FLOAT,
  DOUBLE,
  BOOL,
  STRING,
  BYTES,
  ENUM,
  MESSAGE
}
