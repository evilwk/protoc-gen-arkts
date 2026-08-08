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
  generateOptional,
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
  assert.match(first, /@Sendable\nexport class ScalarFixture implements ProtoMessage/);
  assert.match(first, /static decode\(bytes: ProtoBytes\): ScalarFixture/);
  assert.match(first, /const reader: ProtoReader = bytes instanceof ArrayBuffer/);
  assert.match(first, /\? ProtoReader\.fromBuffer\(bytes\)/);
  assert.match(first, /writer\.writeSInt64/);
});

test('generates nested, imported, repeated, map, and oneof fields', () => {
  const outputDir = generateComplex();
  const complex = readFileSync(join(outputDir, 'Complex.ets'), 'utf8');
  assert.match(complex, /export class EnvelopeNested/);
  assert.match(complex, /collections\.Array<number>/);
  assert.match(complex, /writer\.writePackedInt32\(1, this\.values\);/);
  assert.match(complex, /reader\.readPackedInt32\(message\.values\);/);
  assert.match(complex, /writer\.writeMap<string, SharedItem>\(/);
  assert.match(complex, /reader\.readMapEntry<string, SharedItem>\(/);
  assert.doesNotMatch(complex, /private static readItemByNameEntry/);
  assert.match(complex, /collections\.Map<string, SharedItem>/);
  assert.match(complex, /setEmail\(value: string\)/);
  assert.match(complex, /SharedItem\.mergeFrom/);
  assert.match(complex, /import \{ SharedItem \} from '\.\/Shared';/);
});

test('generates field presence APIs for proto3 optional', () => {
  const generated = generateOptional();
  assert.match(generated, /private count: number = 0;/);
  assert.match(generated, /private countCase: number = 0;/);
  assert.match(generated, /hasCount\(\): boolean \{\n\s+return this\.countCase === 1;/);
  assert.match(generated, /getCount\(\): number \{\n\s+return this\.hasCount\(\) \? this\.count : 0;/);
  assert.match(generated, /setCount\(value: number\): void \{\n\s+this\.count = value;\n\s+this\.countCase = 1;/);
  assert.match(generated, /clearCount\(\): void \{\n\s+this\.count = 0;\n\s+this\.countCase = 0;/);
  assert.match(generated, /setChild\(value: OptionalFixtureChild\): void/);

  // 显式设置默认值仍需编码；普通 proto3 标量继续按非默认值编码。
  assert.match(generated, /if \(this\.countCase === 1\) \{\n\s+writer\.writeTag\(1,/);
  assert.match(generated, /if \(this\.implicitCount !== 0\) \{/);
  assert.match(generated, /case 8:\n\s+message\.setCount\(reader\.readInt32\(\)\);/);

  // synthetic oneof 不应暴露成普通 oneof API，真实 oneof 仍然保留。
  assert.doesNotMatch(generated, /getCountCase\(\)/);
  assert.match(generated, /getChoiceCase\(\): number/);
});

test('uses proto3 optional presence when generating JSON', () => {
  const generated = generateOptional(true);
  assert.match(
    generated,
    /ProtoJson\.traverseNumberField\(visitor, this\.countCase === 1, this\.count, ProtoValueKind\.INT32, 1, "count"\);/
  );
  assert.match(generated, /case "count":\n\s+if \(ProtoJson\.skipNullField\([\s\S]*?message\.setCount\(/);
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
    /import \{ ProtoBytes, ProtoContainers, ProtoMessage, ProtoReader, ProtoWireType, ProtoWriter \} from 'protoc-gen-arkts-runtime';/
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

test('generates a typed RPC class and response decoder per service', () => {
  const service = generateServices();
  assert.match(service, /export class ItemService \{/);
  assert.match(service, /static readonly SERVICE_NAME: string = 'ItemService';/);
  assert.match(service, /private readonly client: RpcClient;/);
  assert.match(service, /getItem\(request: GetItemRequest\): Promise<GetItemResponse>/);
  assert.match(service, /return this\.client\.invoke<GetItemResponse>\([\s\S]*?ItemService\.SERVICE_NAME,[\s\S]*?'GetItem'/);
  assert.match(service, /static decodeResponse\(method: string, bytes: ProtoBytes\): ProtoMessage/);
  assert.match(service, /case 'GetItem':\n\s+return GetItemResponse\.decode\(bytes\);/);
  assert.match(service, /Unknown RPC response: \$\{ItemService\.SERVICE_NAME\}\/\$\{method\}/);
  assert.doesNotMatch(service, /RspDecoder|RSP_DECODERS|lang\.ISendable/);
});

test('generates each method branch when responses share a type', () => {
  const service = generateServices();
  assert.match(service, /case 'RefreshItem':\n\s+return GetItemResponse\.decode\(bytes\);/);
});

test('imports request and response types declared in another proto file', () => {
  const service = generateServices();
  assert.match(service, /import \{ SharedItem \} from '\.\/Shared';/);
  assert.match(service, /getShared\(request: GetItemRequest\): Promise<SharedItem>/);
  assert.match(service, /updateShared\(request: SharedItem\): Promise<GetItemResponse>/);
  assert.match(service, /case 'GetShared':\n\s+return SharedItem\.decode\(bytes\);/);
});

test('omits streaming methods and pure streaming service classes', () => {
  const service = generateServices();
  assert.doesNotMatch(service, /WatchItems|UploadItems/);
  assert.doesNotMatch(service, /export class StreamOnlyService/);
});

test('decodes methods whose response has no fields', () => {
  const service = generateServices();
  assert.match(service, /case 'Touch':\n\s+return EmptyResponse\.decode\(bytes\);/);
});

test('keeps lang and RpcClient imports scoped to their owners', () => {
  const outputDir = generateComplex();
  const shared = readFileSync(join(outputDir, 'Shared.ets'), 'utf8');
  assert.match(shared, /import \{ collections \} from '@kit\.ArkTS';/);
  assert.doesNotMatch(shared, /\bRpcClient\b|\blang\b/);
});

// 显式 [packed = false] 的 repeated 字段：编码按非 packed 写出，但解码必须同时
// 接受两种 tag —— 规范要求 parser 不依赖字段声明的 packed 形态。
// 该不对称由 protobuf conformance 套件的 PackedInput.UnpackedOutput 一族守护。
test('decodes both packed and unpacked input for an explicitly unpacked field', () => {
  const complex = readFileSync(join(generateComplex(), 'Complex.ets'), 'utf8');
  // 字段 10：非 packed tag = 80，packed tag = 82。
  assert.match(complex, /case 80:\n\s+ProtoContainers\.append\(message\.unpackedValues, reader\.readInt32\(\)\);/);
  assert.match(complex, /case 82:\n\s+reader\.readPackedInt32\(message\.unpackedValues\);/);
  // 编码侧仍是一元素一 tag，不得退化成 packed 块。
  assert.doesNotMatch(complex, /writePackedInt32\(10, this\.unpackedValues\)/);
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
  assert.match(probe, /ProtoJson\.visitMessageField\(visitor, this\.createdAt !== undefined, this\.createdAt,/);
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
  assert.match(generated, /export class Type implements ProtoJsonMessage/);
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
  assert.match(generated, /export class ScalarFixture implements ProtoJsonMessage/);
  assert.match(generated, /traverse\(visitor: ProtoVisitor\): void/);
  assert.match(generated, /toJson\(\): string/);
  assert.match(generated, /static fromJson\(text: string, ignoreUnknownFields: boolean = false\): ScalarFixture/);
  assert.match(
    generated,
    /import \{ FieldInfo, JsonReader, ProtoJson, ProtoJsonMessage, ProtoValueKind, ProtoVisitor \} from 'protoc-gen-arkts-runtime';/
  );
  assert.doesNotMatch(
    generated,
    /import \{[^}]*\b(?:readInt32|readInt64|encodeBase64|decodeBase64)\b[^}]*\}/
  );
  // 字段元数据保留 protoName/jsonName；命名不同时必须分别传入。
  assert.match(generated, /ProtoJson\.traverseNumberField\([^\n]+1, "int32_value", "int32Value"\);/);
  assert.match(generated, /ProtoJson\.traverseBoolField\([^\n]+"bool_value", "boolValue"\);/);
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
    /ProtoJson\.traverseMessageField\(visitor, this\.nested !== undefined, this\.nested, 5, "nested"\);/
  );
  assert.doesNotMatch(generated, /visitor\.visitMessage\(this\.profile, /);
  // 单词字段两种命名一致时传 undefined，命名不同时保留显式 jsonName。
  assert.match(generated, /visitor, this\.values, 1, "values", undefined,/);
  assert.match(generated, /visitor, this\.unpackedValues, 10, "unpacked_values", "unpackedValues",/);
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
  assert.match(generated, /ProtoJson\.readMap<number, number>\(reader,/);
  assert.match(generated, /ProtoJson\.readRepeatedEnum\(reader,/);
  assert.match(generated, /return knownEnumValue \? value : undefined;/);
  assert.match(generated, /ProtoJson\.readMap<string, number>\(reader,[\s\S]*?return knownEnumValue \? value : undefined;/);
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
  assert.match(generated, /ProtoJson\.requireOneof\(oneofCases, 0, 7, "contact"\);/);
});
