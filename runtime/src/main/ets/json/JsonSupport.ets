import { collections } from '@kit.ArkTS';

const BASE64_ALPHABET: string = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function formatJsonNumber(value: number): string {
  if (Number.isNaN(value)) {
    return '"NaN"';
  }
  if (value === Number.POSITIVE_INFINITY) {
    return '"Infinity"';
  }
  if (value === Number.NEGATIVE_INFINITY) {
    return '"-Infinity"';
  }
  return `${value}`;
}

export function quoteJson(value: string): string {
  // 绝大多数字段名与字符串值无需转义，先扫一遍就能整段复用原字符串。
  const firstEscape: number = indexOfEscape(value, 0);
  if (firstEscape < 0) {
    return `"${value}"`;
  }
  let result: string = `"${value.substring(0, firstEscape)}`;
  let index: number = firstEscape;
  while (index < value.length) {
    result += escapeJsonCharacter(value.charCodeAt(index));
    index++;
    // 未转义的片段整段拼接，避免逐字符重建字符串。
    const next: number = indexOfEscape(value, index);
    const end: number = next < 0 ? value.length : next;
    if (end > index) {
      result += value.substring(index, end);
      index = end;
    }
  }
  return `${result}"`;
}

function indexOfEscape(value: string, start: number): number {
  for (let index: number = start; index < value.length; index++) {
    if (requiresEscape(value.charCodeAt(index))) {
      return index;
    }
  }
  return -1;
}

function requiresEscape(code: number): boolean {
  return code === 0x22 || code === 0x5c || code < 0x20;
}

function escapeJsonCharacter(code: number): string {
  switch (code) {
    case 0x22:
      return '\\"';
    case 0x5c:
      return '\\\\';
    case 0x08:
      return '\\b';
    case 0x0c:
      return '\\f';
    case 0x0a:
      return '\\n';
    case 0x0d:
      return '\\r';
    case 0x09:
      return '\\t';
    default:
      return `\\u00${hexDigit(Math.floor(code / 16))}${hexDigit(code & 0x0f)}`;
  }
}

function hexDigit(value: number): string {
  return '0123456789abcdef'.charAt(value);
}


export function encodeBase64(bytes: collections.Uint8Array): string {
  // 每 3 字节一组拼进数组后一次 join，避免每字节 4 次字符串拼接。
  const groups: string[] = [];
  for (let index: number = 0; index < bytes.length; index += 3) {
    const first: number = bytes[index];
    const hasSecond: boolean = index + 1 < bytes.length;
    const hasThird: boolean = index + 2 < bytes.length;
    const second: number = hasSecond ? bytes[index + 1] : 0;
    const third: number = hasThird ? bytes[index + 2] : 0;
    const value: number = first * 0x10000 + second * 0x100 + third;
    groups.push(
      BASE64_ALPHABET.charAt(Math.floor(value / 0x40000) & 0x3f) +
      BASE64_ALPHABET.charAt(Math.floor(value / 0x1000) & 0x3f) +
      (hasSecond ? BASE64_ALPHABET.charAt(Math.floor(value / 0x40) & 0x3f) : '=') +
      (hasThird ? BASE64_ALPHABET.charAt(value & 0x3f) : '=')
    );
  }
  return groups.join('');
}

export function decodeBase64(text: string): collections.Uint8Array {
  const normalized: string = text.replace(/-/g, '+').replace(/_/g, '/');
  if (normalized.length % 4 === 1) {
    throw new Error('Invalid base64 length');
  }
  let padded: string = normalized;
  while (padded.length % 4 !== 0) {
    padded += '=';
  }
  // 输出长度由 padding 唯一确定，直接按最终大小分配，省掉逐字节 push 与末尾整份拷贝。
  const paddingLength: number = padded.length === 0
    ? 0
    : (padded.charCodeAt(padded.length - 1) === 0x3d ? 1 : 0) +
      (padded.length > 1 && padded.charCodeAt(padded.length - 2) === 0x3d ? 1 : 0);
  const result: collections.Uint8Array = new collections.Uint8Array(padded.length / 4 * 3 - paddingLength);
  let outputIndex: number = 0;
  for (let index: number = 0; index < padded.length; index += 4) {
    const lastBlock: boolean = index + 4 === padded.length;
    const first: number = decodeBase64Character(padded.charCodeAt(index));
    const second: number = decodeBase64Character(padded.charCodeAt(index + 1));
    const thirdCode: number = padded.charCodeAt(index + 2);
    const fourthCode: number = padded.charCodeAt(index + 3);
    const third: number = thirdCode === 0x3d ? 0 : decodeBase64Character(thirdCode);
    const fourth: number = fourthCode === 0x3d ? 0 : decodeBase64Character(fourthCode);
    if (first < 0 || second < 0 || third < 0 || fourth < 0 ||
      (!lastBlock && (thirdCode === 0x3d || fourthCode === 0x3d)) ||
      (thirdCode === 0x3d && fourthCode !== 0x3d)) {
      throw new Error('Invalid base64 data');
    }
    const value: number = first * 0x40000 + second * 0x1000 + third * 0x40 + fourth;
    result[outputIndex++] = Math.floor(value / 0x10000) & 0xff;
    if (thirdCode !== 0x3d) {
      result[outputIndex++] = Math.floor(value / 0x100) & 0xff;
    }
    if (fourthCode !== 0x3d) {
      result[outputIndex++] = value & 0xff;
    }
  }
  return result;
}


function decodeBase64Character(code: number): number {
  if (code >= 0x41 && code <= 0x5a) {
    return code - 0x41;
  }
  if (code >= 0x61 && code <= 0x7a) {
    return code - 0x61 + 26;
  }
  if (code >= 0x30 && code <= 0x39) {
    return code - 0x30 + 52;
  }
  if (code === 0x2b) {
    return 62;
  }
  if (code === 0x2f) {
    return 63;
  }
  return -1;
}