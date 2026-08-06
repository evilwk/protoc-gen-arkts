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
  generateServices,
  plugin,
  vectorDir
} from './helpers.js';
import packageJson from '../package.json' with { type: 'json' };

test('reports the locked plugin version', () => {
  const output = execFileSync(process.execPath, [plugin, '--version'], { encoding: 'utf8' });
  assert.equal(output, `protoc-gen-arkts ${packageJson.version}\n`);
});

test('generates deterministic ArkTS', () => {
  const first = generateFixture();
  const second = generateFixture();
  assert.equal(first, second);
  assert.match(first, /@Sendable\nexport class ScalarFixture/);
  assert.match(first, /writer\.writeSInt64/);
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

test('generates a response decoder registry per service', () => {
  const service = generateServices();
  assert.match(service, /export const ITEM_SERVICE_RSP_DECODERS: Map<string, ItemServiceRspDecoder>/);
  assert.match(service, /type ItemServiceRspDecoder = \(bytes: Uint8Array \| collections\.Uint8Array\) => lang\.ISendable;/);
  assert.match(service, /import \{ collections, lang \} from '@kit\.ArkTS';/);
  assert.match(service, /\['GetItem', GetItemResponse\.decode as ItemServiceRspDecoder\]/);
});

// 同一响应类型被多个方法复用时按方法名各登记一次，指向同一个 decode。
test('registers each method name even when responses share a type', () => {
  const service = generateServices();
  assert.match(service, /\['RefreshItem', GetItemResponse\.decode as ItemServiceRspDecoder\]/);
});

// 响应类型定义在别的 proto 文件时，解码表要能引用到，import 由 collectImports 补齐。
test('imports response types declared in another proto file', () => {
  const service = generateServices();
  assert.match(service, /import \{ SharedItem \} from '\.\/Shared';/);
  assert.match(service, /\['GetShared', SharedItem\.decode as ItemServiceRspDecoder\]/);
});

test('omits streaming methods from the registry', () => {
  const service = generateServices();
  assert.doesNotMatch(service, /WatchItems|UploadItems/);
});

// decode 是构造响应实例的唯一入口，无字段响应漏登记会迫使调用方写特例。
test('registers methods whose response has no fields', () => {
  const service = generateServices();
  assert.match(service, /\['Touch', EmptyResponse\.decode as ItemServiceRspDecoder\]/);
});

// 全部方法都不可解码的 service 不应产出空解码表。
test('omits the registry entirely when no method is decodable', () => {
  const service = generateServices();
  assert.doesNotMatch(service, /STREAM_ONLY_SERVICE_RSP_DECODERS/);
});

// 没有解码表的文件不引入 lang，避免无用 import。
test('imports lang only when a registry is generated', () => {
  const outputDir = generateComplex();
  const shared = readFileSync(join(outputDir, 'Shared.ets'), 'utf8');
  assert.doesNotMatch(shared, /RSP_DECODERS/);
  assert.match(shared, /import \{ collections \} from '@kit\.ArkTS';/);
});

test('rejects an imported dependency that is neither generated nor declared', () => {
  const outputDir = mkdtempSync(join(tmpdir(), 'protoc-gen-arkts-wkt-'));
  const result = spawnSync('protoc', [
    '-I', '.',
    `--plugin=protoc-gen-arkts=${plugin}`,
    `--arkts_out=runtime_import=proto_runtime,output_prefix=v2:${outputDir}`,
    'wkt_probe.proto'
  ], { cwd: vectorDir, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /is imported but not generated/);
});

// 未声明 dep_root 时，被 import 但未生成的依赖同样要报错，而不是产出悬空 import。
test('rejects an unresolved dependency even without any prefix option', () => {
  const outputDir = mkdtempSync(join(tmpdir(), 'protoc-gen-arkts-wkt-plain-'));
  const result = spawnSync('protoc', [
    '-I', '.',
    `--plugin=protoc-gen-arkts=${plugin}`,
    `--arkts_out=runtime_import=proto_runtime:${outputDir}`,
    'wkt_probe.proto'
  ], { cwd: vectorDir, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /is imported but not generated/);
});
