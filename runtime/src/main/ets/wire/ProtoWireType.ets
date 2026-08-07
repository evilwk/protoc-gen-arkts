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

export function isValidWireType(wireType: number): boolean {
  return Number.isInteger(wireType) && wireType >= ProtoWireType.VARINT && wireType <= ProtoWireType.FIXED32;
}
