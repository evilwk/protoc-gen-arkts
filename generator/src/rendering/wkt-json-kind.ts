/**
 * well-known types 的 JSON 形态分类。
 */
export const EMPTY: string = '.google.protobuf.Empty';

export const TIMESTAMP: string = '.google.protobuf.Timestamp';

export const DURATION: string = '.google.protobuf.Duration';

export const FIELD_MASK: string = '.google.protobuf.FieldMask';

export const STRUCT: string = '.google.protobuf.Struct';

export const VALUE: string = '.google.protobuf.Value';

export const LIST_VALUE: string = '.google.protobuf.ListValue';

export const ANY: string = '.google.protobuf.Any';

export const WRAPPERS: ReadonlyMap<string, string> = new Map<string, string>([
  ['.google.protobuf.DoubleValue', 'Double'],
  ['.google.protobuf.FloatValue', 'Float'],
  ['.google.protobuf.Int64Value', 'Int64'],
  ['.google.protobuf.UInt64Value', 'UInt64'],
  ['.google.protobuf.Int32Value', 'Int32'],
  ['.google.protobuf.UInt32Value', 'UInt32'],
  ['.google.protobuf.BoolValue', 'Bool'],
  ['.google.protobuf.StringValue', 'String'],
  ['.google.protobuf.BytesValue', 'Bytes'],
]);

export enum WktJsonKind {
  ORDINARY,
  EMPTY,
  WRAPPER,
  TIMESTAMP,
  DURATION,
  FIELD_MASK,
  STRUCT,
  VALUE,
  LIST_VALUE,
  ANY,
}

export function wktJsonKind(fullName: string): WktJsonKind {
  switch (fullName) {
    case EMPTY:
      return WktJsonKind.EMPTY;
    case TIMESTAMP:
      return WktJsonKind.TIMESTAMP;
    case DURATION:
      return WktJsonKind.DURATION;
    case FIELD_MASK:
      return WktJsonKind.FIELD_MASK;
    case STRUCT:
      return WktJsonKind.STRUCT;
    case VALUE:
      return WktJsonKind.VALUE;
    case LIST_VALUE:
      return WktJsonKind.LIST_VALUE;
    case ANY:
      return WktJsonKind.ANY;
    default:
      return WRAPPERS.has(fullName) ? WktJsonKind.WRAPPER : WktJsonKind.ORDINARY;
  }
}

export function isSpecialWktMessage(fullName: string): boolean {
  return wktJsonKind(fullName) !== WktJsonKind.ORDINARY;
}
