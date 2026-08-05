import { readdirSync, type Dirent } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * 列出目录下所有 proto 的逻辑路径。
 *
 * 逻辑路径以 root 为基准，与 protoc 按 `-I root` 解析出的 `proto_file` 名一致，
 * 因此 dep_root 必须正好是 protoc 的某个 `-I` 搜索根。
 */
export type ProtoScanner = (root: string) => string[];

/**
 * 默认实现：递归遍历磁盘目录。
 *
 * 这是插件内唯一接触文件系统的位置，建模与渲染层保持纯函数以便注入替身测试。
 */
export const scanProtoRoot: ProtoScanner = (root: string): string[] => {
  let entries: Dirent[];
  try {
    entries = readdirSync(root, { recursive: true, withFileTypes: true });
  } catch (error) {
    const reason: string = error instanceof Error ? error.message : String(error);
    throw new Error(`dep_root "${root}" cannot be listed: ${reason}`);
  }

  return entries
    .filter((entry): boolean => entry.isFile() && entry.name.endsWith('.proto'))
    .map((entry): string => toLogicalPath(root, join(entry.parentPath, entry.name)))
    .sort();
};

/**
 * 统一为 protoc 使用的 posix 逻辑路径，Windows 下的分隔符一并归一。
 */
function toLogicalPath(root: string, absolutePath: string): string {
  const relativePath: string = relative(root, absolutePath);
  return sep === '/' ? relativePath : relativePath.split(sep).join('/');
}
