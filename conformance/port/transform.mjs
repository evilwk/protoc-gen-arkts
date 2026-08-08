// 把 ArkTS 源码机械转换为可在 Node 上编译运行的 TypeScript。
//
// 只做替换，不改任何 wire 逻辑：conformance 验的就是被转换后依然等价的那部分。
// ArkTS 侧的 Sendable 语义（跨并发边界的不可变共享）在 Node 上无对应物，
// 也不参与 wire 格式，因此直接落到原生容器。
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const RUNTIME_RULES = [
  // 运行时入口：collections/util/lang 全部落到原生实现。
  [/^import \{ collections(?:, (?:lang|util))? \} from '@kit\.ArkTS';\n/m, ''],
  // Node 无 Sendable 对应物，移除基础消息接口的 Sendable 父接口。
  [/ extends lang\.ISendable/g, ''],
  // const enum 不属于 TS 的可擦除语法，Node 的类型剥离拒绝它；退化为普通 enum。
  [/export const enum /g, 'export enum '],
  // ArkTS 的 encodeInto 返回新数组，语义等于原生 encode；
  // 原生 encodeInto 是写入调用方缓冲区的另一套签名，不能直接换名。
  [/new util\.TextEncoder\(\)\.encodeInto\(/g, 'new TextEncoder().encode('],
  // decodeToString 对应原生 decode，fatal 选项一并保留以维持 UTF-8 严格校验。
  [/new util\.TextDecoder\((.*?)\)\.decodeToString\(/g, 'new TextDecoder($1).decode(']
];

// 生成代码可能位于任意包深度，runtime 的相对路径由调用方按文件位置补。
function generatedRules(runtimeImport) {
  return [
    [/^import \{ collections(, lang)? \} from '@kit\.ArkTS';\n/m, ''],
    [/^@Sendable\n/gm, ''],
    [/\blang\.ISendable\b/g, 'object'],
    [/from 'protoc-gen-arkts-runtime'/g, `from '${runtimeImport}'`]
  ];
}

// collections.X -> X，对两侧都适用。
const SHARED_RULES = [[/\bcollections\.(Array|Map|Uint8Array)\b/g, '$1']];

function apply(source, rules) {
  return rules.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), source);
}

function convert(source, rules) {
  return apply(apply(source, rules), SHARED_RULES);
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path);
    return entry.name.endsWith('.ets') ? [path] : [];
  });
}

function emit(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

export { convert, emit, generatedRules, walk, RUNTIME_RULES };
