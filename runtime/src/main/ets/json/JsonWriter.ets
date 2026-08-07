import { quoteJson } from './JsonSupport';

const JSON_OBJECT: number = 1;
const JSON_ARRAY: number = 2;

/**
 * 带最小状态的 JSON writer，根值固定为 message 对象。
 */
export class JsonWriter {
  private output: string = '{';
  private readonly containerKinds: number[] = [JSON_OBJECT];
  private readonly containerCounts: number[] = [0];
  private finished: boolean = false;

  writeObjectName(name: string): void {
    this.requireOpen();
    const index: number = this.containerKinds.length - 1;
    if (this.containerKinds[index] !== JSON_OBJECT) {
      throw new Error('JSON object name written outside an object');
    }
    this.writeComma(index);
    this.output += `${quoteJson(name)}:`;
  }

  writeArrayPrefix(): void {
    this.requireOpen();
    const index: number = this.containerKinds.length - 1;
    if (this.containerKinds[index] !== JSON_ARRAY) {
      throw new Error('JSON array value written outside an array');
    }
    this.writeComma(index);
  }

  writeRawValue(value: string): void {
    this.requireOpen();
    this.output += value;
  }

  beginObjectValue(): void {
    this.writeRawValue('{');
    this.containerKinds.push(JSON_OBJECT);
    this.containerCounts.push(0);
  }

  endObjectValue(): void {
    this.endContainer(JSON_OBJECT, '}');
  }

  beginArrayValue(): void {
    this.writeRawValue('[');
    this.containerKinds.push(JSON_ARRAY);
    this.containerCounts.push(0);
  }

  endArrayValue(): void {
    this.endContainer(JSON_ARRAY, ']');
  }

  finish(): string {
    if (this.finished) {
      return this.output;
    }
    if (this.containerKinds.length !== 1 || this.containerKinds[0] !== JSON_OBJECT) {
      throw new Error('Cannot finish JSON with unclosed containers');
    }
    this.output += '}';
    this.containerKinds.pop();
    this.containerCounts.pop();
    this.finished = true;
    return this.output;
  }

  private writeComma(index: number): void {
    if (this.containerCounts[index] > 0) {
      this.output += ',';
    }
    this.containerCounts[index] = this.containerCounts[index] + 1;
  }

  private endContainer(kind: number, suffix: string): void {
    this.requireOpen();
    const index: number = this.containerKinds.length - 1;
    if (index === 0 || this.containerKinds[index] !== kind) {
      throw new Error('Mismatched JSON container end');
    }
    this.output += suffix;
    this.containerKinds.pop();
    this.containerCounts.pop();
  }

  private requireOpen(): void {
    if (this.finished) {
      throw new Error('JSON writer is already finished');
    }
  }
}
