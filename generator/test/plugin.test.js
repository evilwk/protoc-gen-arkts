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
  assert.match(
    shared,
    /import \{ ProtoContainers, ProtoReader, ProtoWireType, ProtoWriter \} from 'protoc-gen-arkts-runtime';/
  );
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

// 显式 [packed = false] 的 repeated 字段：编码按非 packed 写出，但解码必须同时
// 接受两种 tag —— 规范要求 parser 不依赖字段声明的 packed 形态。
// 该不对称由 protobuf conformance 套件的 PackedInput.UnpackedOutput 一族守护。
test('decodes both packed and unpacked input for an explicitly unpacked field', () => {
  const complex = readFileSync(join(generateComplex(), 'Complex.ets'), 'utf8');
  // 字段 10：非 packed tag = 80，packed tag = 82。
  assert.match(complex, /case 80:\n\s+ProtoContainers\.append\(message\.unpackedValues, reader\.readInt32\(\)\);/);
  assert.match(complex, /case 82: \{/);
  // 编码侧仍是一元素一 tag，不得退化成 packed 块。
  assert.doesNotMatch(complex, /packedWriter[\s\S]{0,200}this\.unpackedValues/);
});

test('rejects an imported dependency that is neither generated nor declared', () => {
  const outputDir = mkdtempSync(join(tmpdir(), 'protoc-gen-arkts-wkt-'));
  const result = spawnSync('protoc', [
    '-I', '.',
    `--plugin=protoc-gen-arkts=${plugin}`,
    `--arkts_out=output_prefix=v2:${outputDir}`,
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
    `--arkts_out=${outputDir}`,
    'wkt_probe.proto'
  ], { cwd: vectorDir, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /is imported but not generated/);
});

test('generates registry-backed Any JSON methods', () => {
  const outputDir = mkdtempSync(join(tmpdir(), 'protoc-gen-arkts-wkt-json-'));
  execFileSync('protoc', [
    '-I', '.',
    `--plugin=protoc-gen-arkts=${plugin}`,
    `--arkts_out=json=true:${outputDir}`,
    'any_probe.proto',
    'google/protobuf/any.proto'
  ], { cwd: vectorDir });
  const any = readFileSync(join(outputDir, 'google/protobuf/Any.ets'), 'utf8');
  assert.match(any, /return ProtoJson\.writeAny\(this\.typeUrl, this\.value\);/);
  assert.match(any, /const value = ProtoJson\.readAny\(reader, ignoreUnknownFields\);/);
});

test('generates canonical JSON methods for Timestamp', () => {
  const outputDir = mkdtempSync(join(tmpdir(), 'protoc-gen-arkts-timestamp-json-'));
  execFileSync('protoc', [
    '-I', '.',
    `--plugin=protoc-gen-arkts=${plugin}`,
    `--arkts_out=json=true:${outputDir}`,
    'wkt_probe.proto',
    'google/protobuf/timestamp.proto'
  ], { cwd: vectorDir });
  const timestamp = readFileSync(join(outputDir, 'google/protobuf/Timestamp.ets'), 'utf8');
  const probe = readFileSync(join(outputDir, 'WktProbe.ets'), 'utf8');
  assert.match(timestamp, /return ProtoJson\.writeTimestamp\(this\.seconds, this\.nanos\);/);
  assert.match(timestamp, /const value = ProtoJson\.readTimestamp\(reader\);/);
  // WKT 的 toJson() 可能返回字符串，父 message 只能整体嵌入而不能流式展开。
  assert.match(probe, /visitor\.visitMessage\(this\.createdAt, fieldInfo\);/);
});

test('generates canonical JSON methods for Struct, Value, and ListValue', () => {
  const outputDir = mkdtempSync(join(tmpdir(), 'protoc-gen-arkts-struct-json-'));
  execFileSync('protoc', [
    `--plugin=protoc-gen-arkts=${plugin}`,
    `--arkts_out=json=true:${outputDir}`,
    'google/protobuf/struct.proto'
  ]);
  const generated = readFileSync(join(outputDir, 'google/protobuf/Struct.ets'), 'utf8');
  assert.match(generated, /export class Struct[\s\S]*return ProtoJson\.writeRawObject\(keys, jsonValues\);/);
  assert.match(generated, /export class Value[\s\S]*ProtoJson\.isObject\(reader\)/);
  assert.match(generated, /export class ListValue[\s\S]*return ProtoJson\.writeRawArray\(jsonValues\);/);
  assert.match(generated, /visitor\.visitNull\(fieldInfo\);/);
});

test('uses ordinary JSON mapping for google.protobuf object-shaped types', () => {
  const outputDir = mkdtempSync(join(tmpdir(), 'protoc-gen-arkts-type-json-'));
  execFileSync('protoc', [
    `--plugin=protoc-gen-arkts=${plugin}`,
    `--arkts_out=json=true:${outputDir}`,
    'google/protobuf/type.proto',
    'google/protobuf/any.proto',
    'google/protobuf/source_context.proto'
  ]);
  const generated = readFileSync(join(outputDir, 'google/protobuf/Type.ets'), 'utf8');
  assert.match(generated, /export class Type implements ProtoMessage/);
  assert.match(generated, /return ProtoJson\.write\(this\);/);
});

test('keeps ordinary generation available when json is enabled', () => {
  const outputDir = mkdtempSync(join(tmpdir(), 'protoc-gen-arkts-json-'));
  execFileSync('protoc', [
    `--plugin=protoc-gen-arkts=${plugin}`,
    `--arkts_out=json=true:${outputDir}`,
    'scalar_fixture.proto'
  ], { cwd: vectorDir });
  const generated = readFileSync(join(outputDir, 'ScalarFixture.ets'), 'utf8');
  assert.match(generated, /export class ScalarFixture implements ProtoMessage/);
  assert.match(generated, /traverse\(visitor: ProtoVisitor\): void/);
  assert.match(generated, /toJson\(\): string/);
  assert.match(generated, /static fromJson\(text: string, ignoreUnknownFields: boolean = false\): ScalarFixture/);
  assert.match(
    generated,
    /import \{ FieldInfo, JsonReader, ProtoJson, ProtoMessage, ProtoValueKind, ProtoVisitor \} from 'protoc-gen-arkts-runtime';/
  );
  assert.doesNotMatch(
    generated,
    /import \{[^}]*\b(?:readInt32|readInt64|encodeBase64|decodeBase64)\b[^}]*\}/
  );
  // 字段元数据是编译期常量，必须提为 static 而不是每次 traverse 都新建。
  // protoName 在前，命名不同的字段必须分别传入。
  assert.match(generated, /const fieldInfo: FieldInfo = new FieldInfo\(1, "int32_value", "int32Value"\);/);
  assert.match(generated, /const fieldInfo: FieldInfo = new FieldInfo\(\d+, "bool_value", "boolValue"\);/);
});

test('streams ordinary submessages into the parent JSON writer', () => {
  const outputDir = mkdtempSync(join(tmpdir(), 'protoc-gen-arkts-nested-json-'));
  execFileSync('protoc', [
    '-I', vectorDir,
    `--plugin=protoc-gen-arkts=${plugin}`,
    `--arkts_out=json=true:${outputDir}`,
    'complex.proto',
    'shared.proto'
  ], { cwd: vectorDir });
  const generated = readFileSync(join(outputDir, 'Complex.ets'), 'utf8');
  // 普通子 message 直接写入父 writer，避免为每层嵌套各自建串再拼接。
  assert.match(
    generated,
    /visitor\.beginMessage\(fieldInfo\);\n\s*this\.profile\.traverse\(visitor\);\n\s*visitor\.endMessage\(fieldInfo\);/
  );
  assert.doesNotMatch(generated, /visitor\.visitMessage\(this\.profile, /);
  // 单词字段两种命名一致，省略 jsonName 交给 FieldInfo 构造函数回填。
  assert.match(generated, /const fieldInfo: FieldInfo = new FieldInfo\(1, "values"\);/);
  assert.match(generated, /const fieldInfo: FieldInfo = new FieldInfo\(10, "unpacked_values", "unpackedValues"\);/);
});

test('converts non-string map keys to JSON object names', () => {
  const outputDir = mkdtempSync(join(tmpdir(), 'protoc-gen-arkts-map-json-'));
  execFileSync('protoc', [
    '-I', vectorDir,
    `--plugin=protoc-gen-arkts=${plugin}`,
    `--arkts_out=json=true:${outputDir}`,
    'json_map.proto'
  ], { cwd: vectorDir });
  const generated = readFileSync(join(outputDir, 'JsonMap.ets'), 'utf8');
  assert.match(generated, /visitor\.mapKey\(`\$\{key\}`\);/);
});

test('keeps JSON APIs and imports out of default generation', () => {
  const generated = generateFixture();
  assert.doesNotMatch(generated, /traverse\(visitor: ProtoVisitor\)|toJson\(\)|fromJson\(/);
  assert.doesNotMatch(generated, /FieldInfo|JsonReader|JsonWriter|ProtoJson|ProtoVisitor/);
});

test('initializes generated oneof JSON state before conflict checks', () => {
  const outputDir = mkdtempSync(join(tmpdir(), 'protoc-gen-arkts-oneof-json-'));
  execFileSync('protoc', [
    '-I', vectorDir,
    `--plugin=protoc-gen-arkts=${plugin}`,
    `--arkts_out=json=true:${outputDir}`,
    'complex.proto',
    'shared.proto'
  ], { cwd: vectorDir });
  const generated = readFileSync(join(outputDir, 'Complex.ets'), 'utf8');
  assert.match(generated, /const oneofCases: number\[\] = \[0\];/);
  assert.match(generated, /if \(oneofCases\[0\] !== 0\)/);
});
