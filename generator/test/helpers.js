import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export const pluginDir = resolve(import.meta.dirname, '..');
export const plugin = join(pluginDir, 'bin/protoc-gen-arkts.js');
export const vectorDir = join(import.meta.dirname, 'fixture');
export const groupFixtureDir = join(import.meta.dirname, 'fixture', 'groups');

const LEGACY_PASS = [
  `--arkts_out=output_prefix=legacy,dep_root=v2,dep_prefix=v2:`,
  ['common/shared.proto', 'common/backref.proto']
];
const V2_PASS = [
  `--arkts_out=output_prefix=v2,dep_root=legacy,dep_prefix=legacy:`,
  ['gateway/envelope.proto']
];

export function generateFixture() {
  const outputDir = mkdtempSync(join(tmpdir(), 'protoc-gen-arkts-'));
  execFileSync('protoc', [
    `--plugin=protoc-gen-arkts=${plugin}`,
    `--arkts_out=${outputDir}`,
    'scalar_fixture.proto'
  ], { cwd: vectorDir });
  return readFileSync(join(outputDir, 'ScalarFixture.ets'), 'utf8');
}

export function generateComplex() {
  const outputDir = mkdtempSync(join(tmpdir(), 'protoc-gen-arkts-complex-'));
  const result = spawnSync('protoc', [
    `--plugin=protoc-gen-arkts=${plugin}`,
    `--arkts_out=${outputDir}`,
    '-I.',
    'complex.proto',
    'shared.proto'
  ], { cwd: vectorDir, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr);
  }
  return outputDir;
}

export function generateServices() {
  const outputDir = mkdtempSync(join(tmpdir(), 'protoc-gen-arkts-service-'));
  const result = spawnSync('protoc', [
    `--plugin=protoc-gen-arkts=${plugin}`,
    `--arkts_out=${outputDir}`,
    '-I.',
    'service_fixture.proto',
    'shared.proto'
  ], { cwd: vectorDir, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr);
  }
  return readFileSync(join(outputDir, 'ServiceFixture.ets'), 'utf8');
}

export function generateGroups(order = 'legacy-first') {
  const outputDir = mkdtempSync(join(tmpdir(), 'protoc-gen-arkts-groups-'));
  const passes = order === 'legacy-first' ? [LEGACY_PASS, V2_PASS] : [V2_PASS, LEGACY_PASS];
  for (const [outFlag, protoFiles] of passes) {
    const result = spawnSync('protoc', [
      '-I', 'legacy',
      '-I', 'v2',
      `--plugin=protoc-gen-arkts=${plugin}`,
      `${outFlag}${outputDir}`,
      ...protoFiles
    ], { cwd: groupFixtureDir, encoding: 'utf8' });
    if (result.status !== 0) {
      throw new Error(result.stderr);
    }
  }
  return outputDir;
}
