/**
 * 生成遍历逻辑与编码 visitor 共享的稳定字段元数据。
 */
export class FieldInfo {
  readonly number: number;
  readonly protoName: string;
  readonly jsonName: string;

  constructor(number: number, protoName: string, jsonName?: string) {
    this.number = number;
    this.protoName = protoName;
    this.jsonName = jsonName ?? protoName;
  }
}
