import { collections } from '@kit.ArkTS';
import { FieldInfo } from '../visitor/FieldInfo';
import { ProtoValueKind } from '../visitor/ProtoValueKind';
import { ProtoJsonMessage, ProtoVisitor } from '../visitor/ProtoVisitor';
import { JsonWriter } from './JsonWriter';
import { formatJsonNumber, quoteJson, encodeBase64 } from './JsonSupport';

const JSON_OBJECT: number = 1;
const JSON_ARRAY: number = 2;

/**
 * 基于生成式 message 遍历实现 Proto3 JSON 出方向映射。
 */
export class JsonEncodingVisitor implements ProtoVisitor {
  private readonly scopes: number[] = [JSON_OBJECT];
  private pendingMapKey: string | undefined = undefined;
  private readonly writer: JsonWriter;

  constructor(writer: JsonWriter) {
    this.writer = writer;
  }

  visitNumber(value: number, _kind: ProtoValueKind, field: FieldInfo): void {
    this.beforeValue(field);
    this.writer.writeRawValue(formatJsonNumber(value));
  }

  visitBigInt(value: bigint, _kind: ProtoValueKind, field: FieldInfo): void {
    this.beforeValue(field);
    this.writer.writeRawValue(quoteJson(value.toString()));
  }

  visitBool(value: boolean, field: FieldInfo): void {
    this.beforeValue(field);
    this.writer.writeRawValue(value ? 'true' : 'false');
  }

  visitString(value: string, field: FieldInfo): void {
    this.beforeValue(field);
    this.writer.writeRawValue(quoteJson(value));
  }

  visitBytes(value: collections.Uint8Array, field: FieldInfo): void {
    this.beforeValue(field);
    this.writer.writeRawValue(quoteJson(encodeBase64(value)));
  }

  visitEnum(value: number, name: string | undefined, field: FieldInfo): void {
    this.beforeValue(field);
    this.writer.writeRawValue(name === undefined ? `${value}` : quoteJson(name));
  }

  visitNull(field: FieldInfo): void {
    this.beforeValue(field);
    this.writer.writeRawValue('null');
  }

  visitMessage(value: ProtoJsonMessage, field: FieldInfo): void {
    this.beforeValue(field);
    this.writer.writeRawValue(value.toJson());
  }

  beginMessage(field: FieldInfo): void {
    this.beforeValue(field);
    this.writer.beginObjectValue();
    this.scopes.push(JSON_OBJECT);
  }

  endMessage(_field: FieldInfo): void {
    this.requireScope(JSON_OBJECT);
    this.writer.endObjectValue();
    this.scopes.pop();
  }

  beginRepeated(field: FieldInfo): void {
    this.beforeValue(field);
    this.writer.beginArrayValue();
    this.scopes.push(JSON_ARRAY);
  }

  endRepeated(_field: FieldInfo): void {
    this.requireScope(JSON_ARRAY);
    this.writer.endArrayValue();
    this.scopes.pop();
  }

  beginMap(field: FieldInfo): void {
    this.beforeValue(field);
    this.writer.beginObjectValue();
    this.scopes.push(JSON_OBJECT);
  }

  endMap(_field: FieldInfo): void {
    this.requireScope(JSON_OBJECT);
    if (this.pendingMapKey !== undefined) {
      throw new Error('JSON map key has no value');
    }
    this.writer.endObjectValue();
    this.scopes.pop();
  }

  mapKey(key: string): void {
    this.requireScope(JSON_OBJECT);
    if (this.pendingMapKey !== undefined) {
      throw new Error('JSON map key has no value');
    }
    this.pendingMapKey = key;
  }

  private beforeValue(field: FieldInfo): void {
    const scope: number = this.scopes[this.scopes.length - 1];
    if (scope === JSON_ARRAY) {
      this.writer.writeArrayPrefix();
      return;
    }
    const name: string = this.pendingMapKey ?? field.jsonName;
    this.pendingMapKey = undefined;
    this.writer.writeObjectName(name);
  }

  private requireScope(kind: number): void {
    if (this.scopes[this.scopes.length - 1] !== kind) {
      throw new Error('Mismatched JSON visitor scope');
    }
  }
}
