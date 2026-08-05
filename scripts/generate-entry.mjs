import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const entryDir = join(rootDir, 'entry');

// 构建生成器
const generatorDir = join(rootDir, 'generator');
execFileSync('npm', ['run', 'build'], { cwd: generatorDir, stdio: 'inherit' });

const plugin = join(generatorDir, 'bin/protoc-gen-arkts.js');
const outputDir = join(entryDir, 'src/main/ets/generated');

// 清理目录
rmSync(outputDir, { recursive: true, force: true });
mkdirSync(outputDir, { recursive: true });

// 重新生成
execFileSync('protoc', [
  '-I', join(entryDir, 'proto'),
  `--plugin=protoc-gen-arkts=${plugin}`,
  `--arkts_out=${outputDir}`,
  'demo.proto'
], { cwd: entryDir, stdio: 'inherit' });
