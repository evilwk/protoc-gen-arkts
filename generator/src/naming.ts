import { posix } from 'node:path';

const ARKTS_RESERVED = new Set([
  'abstract', 'as', 'async', 'await', 'break', 'case', 'catch', 'class', 'const',
  'constructor', 'continue', 'debugger', 'declare', 'default', 'delete', 'do',
  'else', 'enum', 'export', 'extends', 'false', 'finally', 'for', 'from',
  'function', 'get', 'if', 'implements', 'import', 'in', 'instanceof', 'interface',
  'is', 'keyof', 'let', 'module', 'namespace', 'never', 'new', 'null', 'number',
  'object', 'of', 'package', 'private', 'protected', 'public', 'readonly', 'require',
  'return', 'set', 'static', 'string', 'super', 'switch', 'symbol', 'this', 'throw',
  'true', 'try', 'type', 'typeof', 'undefined', 'unknown', 'var', 'void', 'while',
  'with', 'yield'
]);

export function outputName(protoName: string): string {
  const directory: string = posix.dirname(protoName);
  const basename: string = posix.basename(protoName);
  const filename: string = `${toUpperCamel(stripProtoExtension(basename))}.ets`;
  return directory === '.' ? filename : posix.join(directory, filename);
}

export function stripProtoExtension(value: string): string {
  return value.endsWith('.proto') ? value.slice(0, -6) : value;
}

export function relativeModule(fromOutput: string, toOutputOrModule: string): string {
  const fromDirectory: string = posix.dirname(fromOutput);
  const target: string = stripModuleExtension(toOutputOrModule);
  let relative: string = posix.relative(fromDirectory, target);
  if (!relative.startsWith('.')) {
    relative = `./${relative}`;
  }
  return relative;
}

function stripModuleExtension(value: string): string {
  return value.endsWith('.ets') ? value.slice(0, -4) : value;
}

export function toUpperCamel(value: string): string {
  return value.split(/[^A-Za-z0-9]+/).filter(Boolean).map(
    (part: string): string => `${part.charAt(0).toUpperCase()}${part.slice(1)}`
  ).join('');
}

export function toLowerCamel(value: string): string {
  const upper: string = toUpperCamel(value);
  return upper.length === 0 ? upper : `${upper.charAt(0).toLowerCase()}${upper.slice(1)}`;
}

export function safeIdentifier(value: string): string {
  return ARKTS_RESERVED.has(value) ? `${value}Value` : value;
}

export function toArkMemberName(value: string): string {
  return safeIdentifier(toLowerCamel(value));
}

export function requireArkMemberName(value: string | undefined, context: string): string {
  return toArkMemberName(requireProtoIdentifier(value, context));
}

export function requireArkIdentifier(value: string | undefined, context: string): string {
  return safeIdentifier(requireProtoIdentifier(value, context));
}

export function requireProtoIdentifier(value: string | undefined, context: string): string {
  if (value === undefined || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`${context}: "${value ?? ''}" is not a supported identifier`);
  }
  return value;
}

export function indent(value: string, spaces: number = 2): string {
  const prefix: string = ' '.repeat(spaces);
  return value.split('\n').map(
    (line): string => line.length === 0 ? line : `${prefix}${line}`
  ).join('\n');
}
