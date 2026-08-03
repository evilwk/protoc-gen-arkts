import type { PluginOptions } from './model/types.js';

const KNOWN_OPTIONS = new Set([
  'runtime_import',
  'group_prefix',
  'other_group_prefix',
  'other_group_files'
]);

/**
 * 解析 `--arkts_out` 冒号前的插件参数。
 *
 * 协议按来源组分次生成：每次调用声明本组输出前缀、另一组输出前缀和另一组的逻辑 proto
 * 清单，插件据此为本次生成文件和跨组依赖分别计算输出路径。
 */
export function parseOptions(parameter: string): PluginOptions {
  let runtimeImport: string = './ProtoWire';
  let groupPrefix: string = '';
  let otherGroupPrefix: string = '';
  const otherGroupFiles: Set<string> = new Set();
  const seenOptions: Set<string> = new Set();
  if (parameter.length === 0) {
    return {
      runtimeImport,
      groupPrefix,
      otherGroupPrefix,
      otherGroupFiles
    };
  }

  for (const item of parameter.split(',')) {
    const separator: number = item.indexOf('=');
    const name: string = separator >= 0 ? item.slice(0, separator) : item;
    const value: string = separator >= 0 ? item.slice(separator + 1) : '';
    if (!KNOWN_OPTIONS.has(name)) {
      throw new Error(`unknown plugin option "${name}"`);
    }
    if (seenOptions.has(name)) {
      throw new Error(`duplicate plugin option "${name}"`);
    }
    seenOptions.add(name);
    if (value.length === 0) {
      throw new Error(`plugin option "${name}" requires a non-empty value`);
    }
    switch (name) {
      case 'runtime_import':
        // 以 "." 开头表示相对输出根的路径，否则视为 HarmonyOS 模块名。
        runtimeImport = value;
        break;
      case 'group_prefix':
        groupPrefix = requireGroupPrefix(name, value);
        break;
      case 'other_group_prefix':
        otherGroupPrefix = requireGroupPrefix(name, value);
        break;
      case 'other_group_files':
        // 分号分隔，避免与插件参数本身的逗号分隔冲突。
        for (const file of value.split(';')) {
          otherGroupFiles.add(requireProtoPath(name, file));
        }
        break;
      default:
        throw new Error(`unhandled plugin option "${name}"`);
    }
  }

  if (otherGroupFiles.size > 0 && otherGroupPrefix.length === 0) {
    throw new Error('other_group_files requires other_group_prefix');
  }
  if (groupPrefix.length > 0 && groupPrefix === otherGroupPrefix) {
    throw new Error('group_prefix and other_group_prefix must be different');
  }
  return {
    runtimeImport,
    groupPrefix,
    otherGroupPrefix,
    otherGroupFiles
  };
}

function requireGroupPrefix(name: string, value: string): string {
  const segments: string[] = value.split('/');
  if (value.startsWith('/') || value.endsWith('/') ||
    value.includes('..') || value.includes('\\') ||
    segments.some((segment): boolean => segment.length === 0 || segment === '.')
  ) {
    throw new Error(`plugin option "${name}" must be a relative directory prefix without ".."`);
  }
  return value;
}

function requireProtoPath(name: string, value: string): string {
  const segments: string[] = value.split('/');
  if (value.length === 0 || value.startsWith('/') ||
    value.endsWith('/') || value.includes('\\') ||
    segments.some((segment): boolean => segment.length === 0 || segment === '.' || segment === '..')
  ) {
    throw new Error(`plugin option "${name}" contains an invalid proto path "${value}"`);
  }
  return value;
}
