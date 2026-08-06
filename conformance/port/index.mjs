// 驱动 ArkTS -> 原生 TypeScript 的移植；产物写入 native/。
import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { convert, emit, generatedRules, walk, RUNTIME_RULES } from './transform.mjs';

const here = dirname(new URL(import.meta.url).pathname);
const conformance = resolve(here, '..');
const repo = resolve(conformance, '..');
const nativeDir = join(conformance, 'native');
const runtimeOut = join(nativeDir, 'ProtoWire.ts');
const generatedRoot = join(nativeDir, 'generated');

// runtime 入口。
const runtimeSource = readFileSync(join(repo, 'runtime/src/main/ets/ProtoWire.ets'), 'utf8');
emit(runtimeOut, convert(runtimeSource, RUNTIME_RULES));
console.log('runtime -> native/ProtoWire.ts');

// 生成代码；每个文件按自身深度补 runtime 的相对 import。
const etsRoot = join(conformance, 'generated-ets');
let count = 0;
for (const path of walk(etsRoot)) {
  const outPath = join(generatedRoot, relative(etsRoot, path).replace(/\.ets$/, '.ts'));
  const toRuntime = relative(dirname(outPath), runtimeOut).replace(/\.ts$/, '');
  const runtimeImport = toRuntime.startsWith('.') ? toRuntime : `./${toRuntime}`;
  emit(outPath, convert(readFileSync(path, 'utf8'), generatedRules(runtimeImport)));
  count += 1;
}
console.log(`generated -> native/generated/ (${count} files)`);
