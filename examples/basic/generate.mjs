import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const exampleDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(exampleDir, '../..');
const generatorDir = join(rootDir, 'generator');
const outputDir = join(exampleDir, 'generated');
const plugin = join(generatorDir, 'bin/protoc-gen-arkts.js');

execFileSync('npm', ['run', 'build'], { cwd: generatorDir, stdio: 'inherit' });
rmSync(outputDir, { recursive: true, force: true });
mkdirSync(outputDir, { recursive: true });

execFileSync('protoc', [
  '-I', join(exampleDir, 'proto'),
  `--plugin=protoc-gen-arkts=${plugin}`,
  `--arkts_out=runtime_import=protoc-gen-arkts-runtime:${outputDir}`,
  'greeting.proto'
], { cwd: exampleDir, stdio: 'inherit' });
