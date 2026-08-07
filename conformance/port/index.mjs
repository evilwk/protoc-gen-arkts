// 驱动 ArkTS -> 原生 TypeScript 的移植；产物写入 native/。
import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { convert, emit, generatedRules, walk, RUNTIME_RULES } from './transform.mjs';

const here = dirname(new URL(import.meta.url).pathname);
const conformance = resolve(here, '..');
const repo = resolve(conformance, '..');
const nativeDir = join(conformance, 'native');
const runtimeRoot = join(repo, 'runtime');
const runtimeNativeRoot = join(nativeDir, 'runtime');
const runtimeOut = join(runtimeNativeRoot, 'Index.ts');
const generatedRoot = join(nativeDir, 'generated');

// runtime 完整入口与源码树。
const runtimePaths = [join(runtimeRoot, 'Index.ets'), ...walk(join(runtimeRoot, 'src/main/ets'))];
for (const path of runtimePaths) {
  const outPath = join(runtimeNativeRoot, relative(runtimeRoot, path).replace(/\.ets$/, '.ts'));
  emit(outPath, convert(readFileSync(path, 'utf8'), RUNTIME_RULES));
}
console.log(`runtime -> native/runtime/ (${runtimePaths.length} files)`);

// 生成代码；每个文件按自身深度补 runtime 的相对 import。
portGeneratedRoot(join(conformance, 'generated-ets'), generatedRoot, 'generated');
portGeneratedRoot(
  join(conformance, 'generated-json-ets'),
  join(nativeDir, 'generated-json'),
  'generated JSON WKT'
);
portGeneratedRoot(
  join(repo, 'entry/src/main/ets/generated'),
  join(nativeDir, 'entry-generated'),
  'entry fixture'
);

function portGeneratedRoot(etsRoot, outputRoot, label) {
  let count = 0;
  for (const path of walk(etsRoot)) {
    const outPath = join(outputRoot, relative(etsRoot, path).replace(/\.ets$/, '.ts'));
    const toRuntime = relative(dirname(outPath), runtimeOut).replace(/\.ts$/, '');
    const runtimeImport = toRuntime.startsWith('.') ? toRuntime : `./${toRuntime}`;
    emit(outPath, convert(readFileSync(path, 'utf8'), generatedRules(runtimeImport)));
    count += 1;
  }
  console.log(`${label} -> ${relative(conformance, outputRoot)}/ (${count} files)`);
}
