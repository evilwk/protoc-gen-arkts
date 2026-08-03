import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  generateComplex,
  generateFixture,
  generateGroups,
  plugin,
  vectorDir
} from './helpers.js';

test('reports the locked plugin version', () => {
  const output = execFileSync(process.execPath, [plugin, '--version'], { encoding: 'utf8' });
  assert.equal(output, 'protoc-gen-arkts 0.4.0\n');
});

test('generates deterministic ArkTS and ignores services', () => {
  const first = generateFixture();
  const second = generateFixture();
  assert.equal(first, second);
  assert.match(first, /@Sendable\nexport class ScalarFixture/);
  assert.match(first, /writer\.writeSInt64/);
  assert.doesNotMatch(first, /IgnoredScalarService|Echo/);
});

test('generates nested, imported, repeated, map, and oneof fields', () => {
  const outputDir = generateComplex();
  const complex = readFileSync(join(outputDir, 'Complex.ets'), 'utf8');
  assert.match(complex, /export class EnvelopeNested/);
  assert.match(complex, /collections\.Array<number>/);
  assert.match(complex, /const packedWriter: ProtoWriter/);
  assert.match(complex, /collections\.Map<string, SharedItem>/);
  assert.match(complex, /setEmail\(value: string\)/);
  assert.match(complex, /SharedItem\.mergeFrom/);
  assert.match(complex, /import \{ SharedItem \} from '\.\/Shared';/);
});

test('resolves cross-group imports in both directions', () => {
  const outputDir = generateGroups();
  const envelope = readFileSync(join(outputDir, 'v2/gateway/Envelope.ets'), 'utf8');
  const backref = readFileSync(join(outputDir, 'legacy/common/Backref.ets'), 'utf8');
  assert.match(envelope, /import \{ LegacyShared \} from '\.\.\/\.\.\/legacy\/common\/Shared';/);
  assert.match(backref, /import \{ V2Envelope \} from '\.\.\/\.\.\/v2\/gateway\/Envelope';/);
});

test('imports the wire runtime by HarmonyOS module name', () => {
  const outputDir = generateGroups();
  const shared = readFileSync(join(outputDir, 'legacy/common/Shared.ets'), 'utf8');
  assert.match(shared, /import \{ ProtoReader,[^}]*\} from 'proto_runtime';/);
});

test('generates identical output regardless of group order', () => {
  const first = generateGroups('legacy-first');
  const second = generateGroups('v2-first');
  for (const relative of ['legacy/common/Shared.ets', 'legacy/common/Backref.ets', 'v2/gateway/Envelope.ets']) {
    assert.equal(
      readFileSync(join(first, relative), 'utf8'),
      readFileSync(join(second, relative), 'utf8'),
      relative
    );
  }
});

test('rejects dependencies outside every protocol source group', () => {
  const outputDir = mkdtempSync(join(tmpdir(), 'protoc-gen-arkts-wkt-'));
  const result = spawnSync('protoc', [
    '-I', '.',
    `--plugin=protoc-gen-arkts=${plugin}`,
    `--arkts_out=runtime_import=proto_runtime,group_prefix=v2,other_group_prefix=legacy:${outputDir}`,
    'wkt_probe.proto'
  ], { cwd: vectorDir, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /does not belong to any protocol source group/);
});
