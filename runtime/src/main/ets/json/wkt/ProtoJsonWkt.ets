import { collections } from '@kit.ArkTS';
import { quoteJson } from '../JsonSupport';
import { JsonReader } from '../JsonReader';
import { ProtoContainers } from '../../ProtoContainers';

const TIMESTAMP_MIN_SECONDS: bigint = -62135596800n;
const TIMESTAMP_MAX_SECONDS: bigint = 253402300799n;
const DURATION_MAX_SECONDS: bigint = 315576000000n;

/**
 * Timestamp 与 Duration 共用的 JSON 解析结果。
 */
export class ProtoJsonTimeValue {
  readonly seconds: bigint;
  readonly nanos: number;

  constructor(seconds: bigint, nanos: number) {
    this.seconds = seconds;
    this.nanos = nanos;
  }
}

/**
 * protobuf well-known types 的 JSON 专用输出能力。
 *
 * 二进制编解码不经过该类型，仍按普通 protobuf message 处理。
 */
export class ProtoJsonWkt {
  static writeTimestamp(seconds: bigint, nanos: number): string {
    requireTimestamp(seconds, nanos);
    const parts: DateTimeParts = secondsToDateTime(seconds);
    const text: string = `${padYear(parts.year)}-${pad2(parts.month)}-${pad2(parts.day)}` +
      `T${pad2(parts.hour)}:${pad2(parts.minute)}:${pad2(parts.second)}` +
      `${formatNanos(nanos)}Z`;
    return quoteJson(text);
  }

  static readTimestamp(reader: JsonReader): ProtoJsonTimeValue {
    const text: string = reader.readString();
    const match: RegExpMatchArray | null = text.match(
      /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/
    );
    if (match === null) {
      throw new Error('Invalid Timestamp JSON value');
    }
    const year: number = parsePart(match[1]);
    const month: number = parsePart(match[2]);
    const day: number = parsePart(match[3]);
    const hour: number = parsePart(match[4]);
    const minute: number = parsePart(match[5]);
    const second: number = parsePart(match[6]);
    if (year < 1 || year > 9999 || month < 1 || month > 12 ||
      day < 1 || day > daysInMonth(year, month) || hour > 23 || minute > 59 || second > 59) {
      throw new Error('Timestamp JSON value is out of range');
    }
    const zone: string = match[8];
    let offsetSeconds: number = 0;
    if (zone !== 'Z') {
      const offsetHour: number = parsePart(zone.substring(1, 3));
      const offsetMinute: number = parsePart(zone.substring(4, 6));
      if (offsetHour > 23 || offsetMinute > 59) {
        throw new Error('Timestamp JSON timezone is out of range');
      }
      offsetSeconds = (offsetHour * 60 + offsetMinute) * 60;
      if (zone.charAt(0) === '-') {
        offsetSeconds = -offsetSeconds;
      }
    }
    const days: number = daysBeforeYear(year) - daysBeforeYear(1970) + daysBeforeMonth(year, month) + day - 1;
    const localSeconds: bigint = BigInt(days * 86400 + hour * 3600 + minute * 60 + second);
    const seconds: bigint = localSeconds - BigInt(offsetSeconds);
    const fraction: string = match[7] ?? '';
    const nanos: number = fraction.length === 0 ? 0 : Number(`${fraction}${'0'.repeat(9 - fraction.length)}`);
    requireTimestamp(seconds, nanos);
    return new ProtoJsonTimeValue(seconds, nanos);
  }

  static writeDuration(seconds: bigint, nanos: number): string {
    requireDuration(seconds, nanos);
    const negative: boolean = seconds < 0n || nanos < 0;
    const absoluteSeconds: bigint = seconds < 0n ? -seconds : seconds;
    const absoluteNanos: number = nanos < 0 ? -nanos : nanos;
    return quoteJson(`${negative ? '-' : ''}${absoluteSeconds}${formatNanos(absoluteNanos)}s`);
  }

  static readDuration(reader: JsonReader): ProtoJsonTimeValue {
    const text: string = reader.readString();
    const match: RegExpMatchArray | null = text.match(/^(-)?(0|[1-9]\d*)(?:\.(\d{1,9}))?s$/);
    if (match === null) {
      throw new Error('Invalid Duration JSON value');
    }
    const negative: boolean = match[1] !== undefined;
    let seconds: bigint = BigInt(match[2]);
    const fraction: string = match[3] ?? '';
    let nanos: number = fraction.length === 0 ? 0 : Number(`${fraction}${'0'.repeat(9 - fraction.length)}`);
    if (negative) {
      seconds = -seconds;
      nanos = -nanos;
    }
    requireDuration(seconds, nanos);
    return new ProtoJsonTimeValue(seconds, nanos);
  }

  static writeFieldMask(paths: collections.Array<string>): string {
    const jsonPaths: string[] = [];
    for (let index: number = 0; index < paths.length; index++) {
      jsonPaths.push(fieldMaskPathToJson(paths[index]));
    }
    return quoteJson(jsonPaths.join(','));
  }

  static readFieldMask(reader: JsonReader): collections.Array<string> {
    const text: string = reader.readString();
    const paths: collections.Array<string> = new collections.Array<string>();
    if (text.length === 0) {
      return paths;
    }
    const jsonPaths: string[] = text.split(',');
    for (let index: number = 0; index < jsonPaths.length; index++) {
      ProtoContainers.append(paths, fieldMaskPathFromJson(jsonPaths[index]));
    }
    return paths;
  }

  static writeRawObject(keys: collections.Array<string>, values: collections.Array<string>): string {
    if (keys.length !== values.length) {
      throw new Error('JSON object keys and values have different lengths');
    }
    const members: string[] = [];
    for (let index: number = 0; index < keys.length; index++) {
      members.push(`${quoteJson(keys[index])}:${values[index]}`);
    }
    return `{${members.join(',')}}`;
  }

  static writeRawArray(values: collections.Array<string>): string {
    const elements: string[] = [];
    for (let index: number = 0; index < values.length; index++) {
      elements.push(values[index]);
    }
    return `[${elements.join(',')}]`;
  }
}

interface DateTimeParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

function requireTimestamp(seconds: bigint, nanos: number): void {
  if (seconds < TIMESTAMP_MIN_SECONDS || seconds > TIMESTAMP_MAX_SECONDS ||
    !Number.isInteger(nanos) || nanos < 0 || nanos > 999999999) {
    throw new Error('Timestamp value is out of range');
  }
}

function requireDuration(seconds: bigint, nanos: number): void {
  if (seconds < -DURATION_MAX_SECONDS || seconds > DURATION_MAX_SECONDS ||
    !Number.isInteger(nanos) || nanos < -999999999 || nanos > 999999999 ||
    (seconds < 0n && nanos > 0) || (seconds > 0n && nanos < 0)) {
    throw new Error('Duration value is out of range');
  }
}

function formatNanos(nanos: number): string {
  if (nanos === 0) {
    return '';
  }
  const digits: string = `${nanos}`.padStart(9, '0');
  if (nanos % 1000000 === 0) {
    return `.${digits.substring(0, 3)}`;
  }
  if (nanos % 1000 === 0) {
    return `.${digits.substring(0, 6)}`;
  }
  return `.${digits}`;
}

function secondsToDateTime(seconds: bigint): DateTimeParts {
  let days: bigint = floorDiv(seconds, 86400n);
  let secondOfDay: number = Number(seconds - days * 86400n);
  let year: number = 1970;
  if (days >= 0n) {
    while (true) {
      const yearDays: bigint = BigInt(isLeapYear(year) ? 366 : 365);
      if (days < yearDays) {
        break;
      }
      days -= yearDays;
      year++;
    }
  } else {
    do {
      year--;
      days += BigInt(isLeapYear(year) ? 366 : 365);
    } while (days < 0n);
  }
  let month: number = 1;
  while (days >= BigInt(daysInMonth(year, month))) {
    days -= BigInt(daysInMonth(year, month));
    month++;
  }
  const hour: number = Math.floor(secondOfDay / 3600);
  secondOfDay -= hour * 3600;
  const minute: number = Math.floor(secondOfDay / 60);
  const second: number = secondOfDay - minute * 60;
  return { year, month, day: Number(days) + 1, hour, minute, second };
}

function floorDiv(value: bigint, divisor: bigint): bigint {
  const quotient: bigint = value / divisor;
  return value < 0n && value % divisor !== 0n ? quotient - 1n : quotient;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

function daysBeforeYear(year: number): number {
  const preceding: number = year - 1;
  return preceding * 365 + Math.floor(preceding / 4) - Math.floor(preceding / 100) + Math.floor(preceding / 400);
}

function daysBeforeMonth(year: number, month: number): number {
  let days: number = 0;
  for (let current: number = 1; current < month; current++) {
    days += daysInMonth(year, current);
  }
  return days;
}

function parsePart(text: string | undefined): number {
  if (text === undefined) {
    throw new Error('Missing Timestamp JSON component');
  }
  return Number(text);
}

function pad2(value: number): string {
  return `${value}`.padStart(2, '0');
}

function padYear(value: number): string {
  return `${value}`.padStart(4, '0');
}

function fieldMaskPathToJson(path: string): string {
  let result: string = '';
  for (let index: number = 0; index < path.length; index++) {
    const code: number = path.charCodeAt(index);
    if (code >= 0x41 && code <= 0x5a) {
      throw new Error('FieldMask path must not contain uppercase letters');
    }
    if (code !== 0x5f) {
      result += path.charAt(index);
      continue;
    }
    if (index + 1 >= path.length) {
      throw new Error('FieldMask path must not end with underscore');
    }
    const next: number = path.charCodeAt(++index);
    if (next < 0x61 || next > 0x7a) {
      throw new Error('FieldMask underscore must be followed by a lowercase letter');
    }
    result += String.fromCharCode(next - 0x20);
  }
  return result;
}

function fieldMaskPathFromJson(path: string): string {
  let result: string = '';
  for (let index: number = 0; index < path.length; index++) {
    const code: number = path.charCodeAt(index);
    if (code === 0x5f) {
      throw new Error('FieldMask JSON path must not contain underscore');
    }
    if (code >= 0x41 && code <= 0x5a) {
      result += `_${String.fromCharCode(code + 0x20)}`;
    } else {
      result += path.charAt(index);
    }
  }
  return result;
}
