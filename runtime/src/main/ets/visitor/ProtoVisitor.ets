import { collections, lang } from '@kit.ArkTS';
import { FieldInfo } from './FieldInfo';
import { ProtoValueKind } from './ProtoValueKind';

/**
 * 所有生成 message 实现的基础 wire 契约。
 */
export interface ProtoMessage extends lang.ISendable {
  encode(): collections.Uint8Array;

  encodeBuffer(): ArrayBuffer;
}

/**
 * 开启 JSON 后生成 message 实现的 JSON 输出契约。
 */
export interface ProtoJsonMessage extends ProtoMessage {
  traverse(visitor: ProtoVisitor): void;

  toJson(): string;
}

/**
 * 已构造 message 的出方向遍历契约。
 */
export interface ProtoVisitor {
  visitNumber(value: number, kind: ProtoValueKind, field: FieldInfo): void;

  visitBigInt(value: bigint, kind: ProtoValueKind, field: FieldInfo): void;

  visitBool(value: boolean, field: FieldInfo): void;

  visitString(value: string, field: FieldInfo): void;

  visitBytes(value: collections.Uint8Array, field: FieldInfo): void;

  visitEnum(value: number, name: string | undefined, field: FieldInfo): void;

  visitNull(field: FieldInfo): void;

  visitMessage(value: ProtoJsonMessage, field: FieldInfo): void;

  beginMessage(field: FieldInfo): void;

  endMessage(field: FieldInfo): void;

  beginRepeated(field: FieldInfo): void;

  endRepeated(field: FieldInfo): void;

  beginMap(field: FieldInfo): void;

  endMap(field: FieldInfo): void;

  mapKey(key: string): void;
}
