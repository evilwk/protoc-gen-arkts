import type { PluginOptions } from './model/plugin.js';
import { scanProtoRoot, type ProtoScanner } from './proto-scanner.js';

const KNOWN_OPTIONS = new Set([
  'json',
  'output_prefix',
  'dep_root',
  'dep_prefix'
]);

/**
 * 解析 `--arkts_out` 冒号前的插件参数。
 *
 * 本次生成的文件按 `output_prefix` 落盘；`dep_root` 声明依赖协议所在的 `-I` 根，
 * 插件遍历该目录得到依赖清单，并按 `dep_prefix` 计算依赖的 import 路径。
 */
export function parseOptions(
  parameter: string,
  scan: ProtoScanner = scanProtoRoot
): PluginOptions {
  let outputPrefix: string = '';
  let depRoot: string = '';
  let depPrefix: string | undefined;
  let json: boolean = false;

  const seenOptions: Set<string> = new Set();
  for (const item of parameter.length === 0 ? [] : parameter.split(',')) {
    const separator: number = item.indexOf('=');
    const name: string = separator >= 0 ? item.slice(0, separator) : item;
    const value: string = separator >= 0 ? item.slice(separator + 1) : '';

    if (!KNOWN_OPTIONS.has(name)) {
      throw new Error(`unknown plugin option "${name}"`);
    }

    if (seenOptions.has(name)) {
      throw new Error(`duplicate plugin option "${name}"`);
    }

    if (value.length === 0) {
      throw new Error(`plugin option "${name}" requires a non-empty value`);
    }

    seenOptions.add(name);

    switch (name) {
      case 'json':
        json = requireBoolean(name, value);
        break;
      case 'output_prefix':
        outputPrefix = requirePrefix(name, value);
        break;
      case 'dep_root':
        depRoot = value;
        break;
      case 'dep_prefix':
        depPrefix = requirePrefix(name, value);
        break;
      default:
        throw new Error(`unhandled plugin option "${name}"`);
    }
  }

  if (depPrefix !== undefined && depRoot.length === 0) {
    throw new Error('dep_prefix requires dep_root');
  }

  // dep_prefix 未声明时依赖与本次生成同目录。
  const resolvedDepPrefix: string = depPrefix ?? outputPrefix;
  const depFiles: ReadonlySet<string> = depRoot.length === 0
    ? new Set()
    : new Set(scan(depRoot).map((file): string => requireProtoPath('dep_root', file)));

  return {
    json,
    outputPrefix,
    depPrefix: resolvedDepPrefix,
    depFiles
  };
}

function requireBoolean(name: string, value: string): boolean {
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  throw new Error(`plugin option "${name}" must be "true" or "false"`);
}

function requirePrefix(name: string, value: string): string {
  if (!isValidRelativePath(value)) {
    throw new Error(`plugin option "${name}" must be a relative directory prefix without ".."`);
  }
  return value;
}

function requireProtoPath(name: string, value: string): string {
  if (!isValidRelativePath(value)) {
    throw new Error(`plugin option "${name}" contains an invalid proto path "${value}"`);
  }
  return value;
}

function isValidRelativePath(value: string): boolean {
  const segments = value.split('/');
  return (
    !value.startsWith('/') &&
    !value.endsWith('/') &&
    !value.includes('\\') &&
    !segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')
  );
}
