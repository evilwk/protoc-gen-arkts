import { JsonToken } from './JsonToken';

const JSON_OBJECT: number = 1;
const JSON_ARRAY: number = 2;

/**
 * 生成式 message parser 使用的严格流式 JSON tokenizer。
 */
export class JsonReader {
  private position: number = 0;
  private readonly containerKinds: number[] = [];
  private readonly containerCounts: number[] = [];
  private readonly objectKeys: Set<string>[] = [];
  private readonly text: string;

  constructor(text: string) {
    this.text = text;
  }

  peek(): JsonToken {
    this.skipWhitespace();
    if (this.position >= this.text.length) {
      throw this.error('Unexpected end of JSON input');
    }
    const code: number = this.text.charCodeAt(this.position);
    switch (code) {
      case 0x7b:
        return JsonToken.BEGIN_OBJECT;
      case 0x7d:
        return JsonToken.END_OBJECT;
      case 0x5b:
        return JsonToken.BEGIN_ARRAY;
      case 0x5d:
        return JsonToken.END_ARRAY;
      case 0x22:
        return JsonToken.STRING;
      case 0x74:
      case 0x66:
        return JsonToken.BOOL;
      case 0x6e:
        return JsonToken.NULL;
      default:
        if (code === 0x2d || this.isDigit(code)) {
          return JsonToken.NUMBER;
        }
        throw this.error('Invalid JSON token');
    }
  }

  beginObject(): void {
    this.requireCharacter(0x7b, 'Expected JSON object');
    this.containerKinds.push(JSON_OBJECT);
    this.containerCounts.push(0);
    this.objectKeys.push(new Set<string>());
  }

  hasMoreMembers(): boolean {
    return this.hasMore(JSON_OBJECT, 0x7d, 'object');
  }

  readKey(): string {
    this.requireContainer(JSON_OBJECT, 'object');
    const key: string = this.readString();
    const keys: Set<string> = this.objectKeys[this.objectKeys.length - 1];
    if (keys.has(key)) {
      throw this.error(`Duplicate JSON object key: ${key}`);
    }
    keys.add(key);
    this.skipWhitespace();
    this.requireCharacter(0x3a, 'Expected colon after JSON object key');
    this.incrementContainerCount();
    return key;
  }

  endObject(): void {
    this.endContainer(JSON_OBJECT, 0x7d, 'object');
  }

  beginArray(): void {
    this.requireCharacter(0x5b, 'Expected JSON array');
    this.containerKinds.push(JSON_ARRAY);
    this.containerCounts.push(0);
  }

  hasMoreElements(): boolean {
    const more: boolean = this.hasMore(JSON_ARRAY, 0x5d, 'array');
    if (more) {
      this.incrementContainerCount();
    }
    return more;
  }

  endArray(): void {
    this.endContainer(JSON_ARRAY, 0x5d, 'array');
  }

  readString(): string {
    this.skipWhitespace();
    if (this.position >= this.text.length || this.text.charCodeAt(this.position) !== 0x22) {
      throw this.error('Expected JSON string');
    }
    this.position++;
    let result: string = '';
    while (this.position < this.text.length) {
      const code: number = this.text.charCodeAt(this.position++);
      if (code === 0x22) {
        return result;
      }
      if (code < 0x20) {
        throw this.error('Unescaped control character in JSON string');
      }
      if (code === 0x5c) {
        result += this.readEscape();
        continue;
      }
      if (this.isHighSurrogate(code)) {
        if (this.position >= this.text.length) {
          throw this.error('Unpaired high surrogate in JSON string');
        }
        const low: number = this.text.charCodeAt(this.position++);
        if (!this.isLowSurrogate(low)) {
          throw this.error('Unpaired high surrogate in JSON string');
        }
        result += String.fromCharCode(code, low);
        continue;
      }
      if (this.isLowSurrogate(code)) {
        throw this.error('Unpaired low surrogate in JSON string');
      }
      result += String.fromCharCode(code);
    }
    throw this.error('Unterminated JSON string');
  }

  readNumberAsNumber(): number {
    const literal: string = this.readNumberLiteral();
    const value: number = Number(literal);
    if (!Number.isFinite(value)) {
      throw this.error('JSON number is out of range');
    }
    return value;
  }

  readNumberAsBigInt(maximumDigits: number = 0): bigint {
    return parseExactInteger(this.readNumberLiteral(), 'JSON integer', maximumDigits);
  }

  readBool(): boolean {
    this.skipWhitespace();
    if (this.consumeLiteral('true')) {
      return true;
    }
    if (this.consumeLiteral('false')) {
      return false;
    }
    throw this.error('Expected JSON boolean');
  }

  readNull(): void {
    this.skipWhitespace();
    if (!this.consumeLiteral('null')) {
      throw this.error('Expected JSON null');
    }
  }

  skipValue(): void {
    switch (this.peek()) {
      case JsonToken.BEGIN_OBJECT:
        this.beginObject();
        while (this.hasMoreMembers()) {
          this.readKey();
          this.skipValue();
        }
        this.endObject();
        return;
      case JsonToken.BEGIN_ARRAY:
        this.beginArray();
        while (this.hasMoreElements()) {
          this.skipValue();
        }
        this.endArray();
        return;
      case JsonToken.STRING:
        this.readString();
        return;
      case JsonToken.NUMBER:
        this.readNumberLiteral();
        return;
      case JsonToken.BOOL:
        this.readBool();
        return;
      case JsonToken.NULL:
        this.readNull();
        return;
      default:
        throw this.error('Expected JSON value');
    }
  }

  readRawValue(): string {
    this.skipWhitespace();
    const start: number = this.position;
    this.skipValue();
    return this.text.substring(start, this.position);
  }

  requireEndOfInput(): void {
    this.skipWhitespace();
    if (this.position !== this.text.length) {
      throw this.error('Unexpected trailing JSON input');
    }
    if (this.containerKinds.length !== 0) {
      throw this.error('Unclosed JSON container');
    }
  }

  private readEscape(): string {
    if (this.position >= this.text.length) {
      throw this.error('Unterminated JSON escape');
    }
    const code: number = this.text.charCodeAt(this.position++);
    switch (code) {
      case 0x22:
        return '"';
      case 0x5c:
        return '\\';
      case 0x2f:
        return '/';
      case 0x62:
        return '\b';
      case 0x66:
        return '\f';
      case 0x6e:
        return '\n';
      case 0x72:
        return '\r';
      case 0x74:
        return '\t';
      case 0x75:
        return this.readUnicodeEscape();
      default:
        throw this.error('Invalid JSON escape');
    }
  }

  private readUnicodeEscape(): string {
    const first: number = this.readHexCodeUnit();
    if (this.isHighSurrogate(first)) {
      if (this.position + 2 > this.text.length ||
        this.text.charCodeAt(this.position) !== 0x5c ||
        this.text.charCodeAt(this.position + 1) !== 0x75) {
        throw this.error('Unpaired high surrogate in JSON escape');
      }
      this.position += 2;
      const second: number = this.readHexCodeUnit();
      if (!this.isLowSurrogate(second)) {
        throw this.error('Unpaired high surrogate in JSON escape');
      }
      return String.fromCharCode(first, second);
    }
    if (this.isLowSurrogate(first)) {
      throw this.error('Unpaired low surrogate in JSON escape');
    }
    return String.fromCharCode(first);
  }

  private readHexCodeUnit(): number {
    if (this.position + 4 > this.text.length) {
      throw this.error('Incomplete JSON unicode escape');
    }
    let value: number = 0;
    for (let index: number = 0; index < 4; index++) {
      const digit: number = this.hexValue(this.text.charCodeAt(this.position++));
      if (digit < 0) {
        throw this.error('Invalid JSON unicode escape');
      }
      value = value * 16 + digit;
    }
    return value;
  }

  private readNumberLiteral(): string {
    this.skipWhitespace();
    const start: number = this.position;
    if (this.peekCode() === 0x2d) {
      this.position++;
    }
    if (this.peekCode() === 0x30) {
      this.position++;
      if (this.isDigit(this.peekCode())) {
        throw this.error('Leading zero in JSON number');
      }
    } else {
      this.requireDigits('Expected digits in JSON number');
    }
    if (this.peekCode() === 0x2e) {
      this.position++;
      this.requireDigits('Expected fraction digits in JSON number');
    }
    const exponent: number = this.peekCode();
    if (exponent === 0x65 || exponent === 0x45) {
      this.position++;
      const sign: number = this.peekCode();
      if (sign === 0x2b || sign === 0x2d) {
        this.position++;
      }
      this.requireDigits('Expected exponent digits in JSON number');
    }
    return this.text.substring(start, this.position);
  }

  private requireDigits(message: string): void {
    const start: number = this.position;
    while (this.isDigit(this.peekCode())) {
      this.position++;
    }
    if (this.position === start) {
      throw this.error(message);
    }
  }

  private hasMore(kind: number, endCode: number, name: string): boolean {
    this.requireContainer(kind, name);
    this.skipWhitespace();
    const count: number = this.containerCounts[this.containerCounts.length - 1];
    if (this.peekCode() === endCode) {
      return false;
    }
    if (count > 0) {
      this.requireCharacter(0x2c, `Expected comma in JSON ${name}`);
      this.skipWhitespace();
      if (this.peekCode() === endCode) {
        throw this.error(`Trailing comma in JSON ${name}`);
      }
    }
    return true;
  }

  private endContainer(kind: number, endCode: number, name: string): void {
    this.requireContainer(kind, name);
    this.requireCharacter(endCode, `Expected end of JSON ${name}`);
    this.containerKinds.pop();
    this.containerCounts.pop();
    if (kind === JSON_OBJECT) {
      this.objectKeys.pop();
    }
  }

  private requireContainer(kind: number, name: string): void {
    if (this.containerKinds.length === 0 ||
      this.containerKinds[this.containerKinds.length - 1] !== kind) {
      throw this.error(`Not reading a JSON ${name}`);
    }
  }

  private incrementContainerCount(): void {
    const index: number = this.containerCounts.length - 1;
    this.containerCounts[index] = this.containerCounts[index] + 1;
  }

  private requireCharacter(code: number, message: string): void {
    this.skipWhitespace();
    if (this.peekCode() !== code) {
      throw this.error(message);
    }
    this.position++;
  }

  private consumeLiteral(literal: string): boolean {
    if (this.text.substring(this.position, this.position + literal.length) !== literal) {
      return false;
    }
    this.position += literal.length;
    return true;
  }

  private skipWhitespace(): void {
    while (this.position < this.text.length) {
      const code: number = this.text.charCodeAt(this.position);
      if (code !== 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) {
        break;
      }
      this.position++;
    }
  }

  private peekCode(): number {
    return this.position < this.text.length ? this.text.charCodeAt(this.position) : -1;
  }

  private isDigit(code: number): boolean {
    return code >= 0x30 && code <= 0x39;
  }

  private isHighSurrogate(code: number): boolean {
    return code >= 0xd800 && code <= 0xdbff;
  }

  private isLowSurrogate(code: number): boolean {
    return code >= 0xdc00 && code <= 0xdfff;
  }

  private hexValue(code: number): number {
    if (code >= 0x30 && code <= 0x39) {
      return code - 0x30;
    }
    if (code >= 0x41 && code <= 0x46) {
      return code - 0x41 + 10;
    }
    if (code >= 0x61 && code <= 0x66) {
      return code - 0x61 + 10;
    }
    return -1;
  }

  private error(message: string): Error {
    return new Error(`${message} at offset ${this.position}`);
  }
}

export function parseExactInteger(text: string, name: string, maximumDigits: number = 0): bigint {
  let index: number = 0;
  let negative: boolean = false;
  if (text.charCodeAt(index) === 0x2d || text.charCodeAt(index) === 0x2b) {
    negative = text.charCodeAt(index) === 0x2d;
    index++;
  }
  let coefficientDigits: number = 0;
  let firstNonZeroDigit: number = -1;
  let lastNonZeroDigit: number = -1;
  const integerStart: number = index;
  let fractionDigits: number = 0;
  let sawDigit: boolean = false;
  while (index < text.length) {
    const code: number = text.charCodeAt(index);
    if (code < 0x30 || code > 0x39) {
      break;
    }
    if (code !== 0x30) {
      if (firstNonZeroDigit < 0) {
        firstNonZeroDigit = coefficientDigits;
      }
      lastNonZeroDigit = coefficientDigits;
    }
    coefficientDigits++;
    index++;
    sawDigit = true;
  }
  const integerEnd: number = index;
  let fractionStart: number = index;
  let fractionEnd: number = index;
  if (index < text.length && text.charCodeAt(index) === 0x2e) {
    index++;
    fractionStart = index;
    while (index < text.length) {
      const code: number = text.charCodeAt(index);
      if (code < 0x30 || code > 0x39) {
        break;
      }
      if (code !== 0x30) {
        if (firstNonZeroDigit < 0) {
          firstNonZeroDigit = coefficientDigits;
        }
        lastNonZeroDigit = coefficientDigits;
      }
      coefficientDigits++;
      index++;
    }
    fractionEnd = index;
    fractionDigits = index - fractionStart;
    if (fractionDigits === 0) {
      throw new Error(`Invalid ${name}: ${text}`);
    }
  }
  let exponent: number = 0;
  if (index < text.length && (text.charCodeAt(index) === 0x65 || text.charCodeAt(index) === 0x45)) {
    index++;
    let exponentNegative: boolean = false;
    if (index < text.length && (text.charCodeAt(index) === 0x2b || text.charCodeAt(index) === 0x2d)) {
      exponentNegative = text.charCodeAt(index) === 0x2d;
      index++;
    }
    const exponentStart: number = index;
    while (index < text.length) {
      const code: number = text.charCodeAt(index);
      if (code < 0x30 || code > 0x39) {
        break;
      }
      exponent = exponent * 10 + code - 0x30;
      if (exponent > 100000) {
        throw new Error(`Invalid ${name}: exponent is too large`);
      }
      index++;
    }
    if (index === exponentStart) {
      throw new Error(`Invalid ${name}: ${text}`);
    }
    if (exponentNegative) {
      exponent = -exponent;
    }
  }
  if (!sawDigit || index !== text.length) {
    throw new Error(`Invalid ${name}: ${text}`);
  }

  if (firstNonZeroDigit < 0) {
    return 0n;
  }

  const trailingZeros: number = coefficientDigits - lastNonZeroDigit - 1;
  const scale: number = exponent - fractionDigits + trailingZeros;
  if (scale < 0) {
    throw new Error(`Expected integral ${name}: ${text}`);
  }

  const significantDigits: number = lastNonZeroDigit - firstNonZeroDigit + 1;
  if (maximumDigits > 0 && significantDigits + scale > maximumDigits) {
    throw new Error(`Protobuf JSON ${name} is out of range`);
  }

  let digits: string = '';
  let digitOffset: number = 0;
  for (let position: number = integerStart; position < integerEnd; position++) {
    if (digitOffset >= firstNonZeroDigit && digitOffset <= lastNonZeroDigit) {
      digits += text.charAt(position);
    }
    digitOffset++;
  }
  for (let position: number = fractionStart; position < fractionEnd; position++) {
    if (digitOffset >= firstNonZeroDigit && digitOffset <= lastNonZeroDigit) {
      digits += text.charAt(position);
    }
    digitOffset++;
  }
  for (let zeroIndex: number = 0; zeroIndex < scale; zeroIndex++) {
    digits += '0';
  }

  const unsigned: bigint = BigInt(digits);
  return negative ? -unsigned : unsigned;
}
