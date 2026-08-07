import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  JsonEncodingVisitor
} from '../native/runtime/src/main/ets/json/JsonEncodingVisitor';
import { JsonReader } from '../native/runtime/src/main/ets/json/JsonReader';
import { JsonToken } from '../native/runtime/src/main/ets/json/JsonToken';
import { JsonWriter } from '../native/runtime/src/main/ets/json/JsonWriter';
import { ProtoJson } from '../native/runtime/src/main/ets/json/ProtoJson';
import { FieldInfo } from '../native/runtime/src/main/ets/visitor/FieldInfo';
import { ProtoValueKind } from '../native/runtime/src/main/ets/visitor/ProtoValueKind';
import { Envelope, Profile, Status } from '../native/entry-generated/Demo';
import { Duration } from '../native/generated-json/google/protobuf/Duration';
import { Empty } from '../native/generated-json/google/protobuf/Empty';
import { FieldMask } from '../native/generated-json/google/protobuf/FieldMask';
import { ListValue, Struct, Value } from '../native/generated-json/google/protobuf/Struct';
import { Timestamp } from '../native/generated-json/google/protobuf/Timestamp';
import { Any } from '../native/generated/google/protobuf/Any';
import { DoubleValue, Int64Value, StringValue } from '../native/generated-json/google/protobuf/Wrappers';

function assertRejected(json: string): void {
  assert.throws(() => {
    const reader = new JsonReader(json);
    reader.skipValue();
    reader.requireEndOfInput();
  });
}

test('tokenizes nested values and skips them without losing boundaries', () => {
  const reader = new JsonReader('{"known":1,"skip":{"nested":[true,null,"x"]}}');
  reader.beginObject();
  assert.equal(reader.hasMoreMembers(), true);
  assert.equal(reader.readKey(), 'known');
  assert.equal(reader.readNumberAsNumber(), 1);
  assert.equal(reader.hasMoreMembers(), true);
  assert.equal(reader.readKey(), 'skip');
  reader.skipValue();
  assert.equal(reader.hasMoreMembers(), false);
  reader.endObject();
  reader.requireEndOfInput();
});

test('preserves exact int64 values from strings and numeric tokens', () => {
  assert.equal(ProtoJson.readInt64(new JsonReader('"9223372036854775807"')), 9223372036854775807n);
  assert.equal(ProtoJson.readInt64(new JsonReader('-9223372036854775808')), -9223372036854775808n);
  assert.equal(ProtoJson.readInt64(new JsonReader('9.223372036854775807e18')), 9223372036854775807n);
  assert.throws(() => ProtoJson.readInt64(new JsonReader('9223372036854775808')));
});

test('normalizes integral exponents without expanding out-of-range values', () => {
  assert.equal(ProtoJson.readInt64(new JsonReader('0e-2')), 0n);
  assert.equal(ProtoJson.readInt64(new JsonReader('"-0.000e-100000"')), 0n);
  assert.equal(ProtoJson.readInt64(new JsonReader('1.000e3')), 1000n);
  assert.throws(() => ProtoJson.readInt64(new JsonReader('1e100000')));
  assert.throws(() => ProtoJson.parseUInt64MapKey('100000000000000000000'));
});

test('decodes JSON string escapes and rejects malformed JSON grammar', () => {
  const reader = new JsonReader('"line\\n\\uD83D\\uDE00"');
  assert.equal(reader.peek(), JsonToken.STRING);
  assert.equal(reader.readString(), 'line\n😀');
  reader.requireEndOfInput();

  for (const malformed of [
    '{"a":1,}', '[1,]', '{a:1}', '01', '1.', '1e', 'NaN', '"\\uD800"', 'true false'
  ]) {
    assertRejected(malformed);
  }
});

test('defaults FieldInfo jsonName to the proto name when omitted', () => {
  const omitted = new FieldInfo(1, 'code');
  assert.equal(omitted.protoName, 'code');
  assert.equal(omitted.jsonName, 'code');
  const distinct = new FieldInfo(2, 'failure_message', 'failureMessage');
  assert.equal(distinct.protoName, 'failure_message');
  assert.equal(distinct.jsonName, 'failureMessage');
});

test('round trips standard and URL-safe base64', () => {
  const bytes = Uint8Array.from([0xfb, 0xff, 0xef]);
  assert.equal(ProtoJson.encodeBase64(bytes), '+//v');
  assert.deepEqual(ProtoJson.decodeBase64('-__v'), bytes);
  assert.throws(() => ProtoJson.decodeBase64('a'));
  assert.throws(() => ProtoJson.decodeBase64('!!!!'));
});

test('writes scalar, repeated, map, nested, enum, and special floating values', () => {
  const scalar = new FieldInfo(1, 'count');
  const repeated = new FieldInfo(2, 'values');
  const mapped = new FieldInfo(3, 'labels');
  const child = new FieldInfo(4, 'child');
  const mode = new FieldInfo(5, 'mode');
  const special = new FieldInfo(6, 'special');
  const writer = new JsonWriter();
  const visitor = new JsonEncodingVisitor(writer);

  visitor.visitNumber(7, ProtoValueKind.INT32, scalar);
  visitor.beginRepeated(repeated);
  visitor.visitString('a', repeated);
  visitor.visitString('b', repeated);
  visitor.endRepeated(repeated);
  visitor.beginMap(mapped);
  visitor.mapKey('1');
  visitor.visitBool(true, mapped);
  visitor.endMap(mapped);
  visitor.beginMessage(child);
  visitor.visitBigInt(9n, ProtoValueKind.INT64, scalar);
  visitor.endMessage(child);
  visitor.visitEnum(1, 'READY', mode);
  visitor.visitNumber(Number.NaN, ProtoValueKind.DOUBLE, special);

  assert.equal(
    writer.finish(),
    '{"count":7,"values":["a","b"],"labels":{"1":true},"child":{"count":"9"},"mode":"READY","special":"NaN"}'
  );
});

test('round trips generated messages through canonical JSON APIs', () => {
  const message = new Envelope();
  message.code = -7;
  message.status = Status.STATUS_OK;
  message.scores.push(1, 2);
  message.tags.push('x');
  message.counters.set('ready', 3);
  message.profile = new Profile();
  message.profile.nickname = 'Ada';
  message.payload = Uint8Array.from([0xfb, 0xff]);
  message.setFailure('no');

  const json = message.toJson();
  assert.equal(
    json,
    '{"code":-7,"status":"STATUS_OK","scores":[1,2],"tags":["x"],"counters":{"ready":3},"profile":{"nickname":"Ada"},"payload":"+/8=","failure":"no"}'
  );
  const decoded = Envelope.fromJson(json);
  assert.equal(decoded.code, -7);
  assert.equal(decoded.status, Status.STATUS_OK);
  assert.deepEqual(decoded.scores, [1, 2]);
  assert.equal(decoded.counters.get('ready'), 3);
  assert.equal(decoded.profile?.nickname, 'Ada');
  assert.equal(decoded.getFailure(), 'no');
});

test('generated parsers enforce aliases, duplicate fields, oneof, null, and unknown policy', () => {
  assert.equal(Envelope.fromJson('{"code":null}').code, 0);
  assert.deepEqual(Envelope.fromJson('{"scores":null}').scores, []);
  assert.equal(Envelope.fromJson('{"counters":null}').counters.size, 0);
  assert.equal(Envelope.fromJson('{"unknown":{"x":[1]}}', true).code, 0);
  assert.throws(() => Envelope.fromJson('{"unknown":1}'));
  assert.throws(() => Envelope.fromJson('{"code":1,"code":2}'));
  assert.throws(() => Envelope.fromJson('{"ok":{},"failure":"x"}'));
});

test('maps wrapper and Empty well-known types without changing their wire fields', () => {
  const doubleValue = DoubleValue.fromJson('"NaN"');
  assert.equal(Number.isNaN(doubleValue.value), true);
  assert.equal(doubleValue.toJson(), '"NaN"');
  assert.equal(Int64Value.fromJson('"9223372036854775807"').value, 9223372036854775807n);
  assert.equal(StringValue.fromJson('"text"').toJson(), '"text"');
  assert.equal(Empty.fromJson('{}').toJson(), '{}');
  assert.throws(() => Empty.fromJson('{"unknown":1}'));
  assert.equal(Empty.fromJson('{"unknown":1}', true).toJson(), '{}');
});

test('accepts an empty Any without requiring a registered type', () => {
  const value = Any.fromJson('{}');
  assert.equal(value.typeUrl, '');
  assert.equal(value.value.length, 0);
  assert.equal(value.toJson(), '{}');
});

test('formats and parses Timestamp and Duration canonical JSON', () => {
  const timestamp = new Timestamp();
  timestamp.seconds = 0n;
  timestamp.nanos = 10000000;
  assert.equal(timestamp.toJson(), '"1970-01-01T00:00:00.010Z"');
  const offset = Timestamp.fromJson('"1970-01-01T08:00:00+08:00"');
  assert.equal(offset.seconds, 0n);
  assert.equal(offset.nanos, 0);
  assert.equal(Timestamp.fromJson('"0001-01-01T00:00:00Z"').seconds, -62135596800n);
  assert.throws(() => Timestamp.fromJson('"10000-01-01T00:00:00Z"'));

  const duration = Duration.fromJson('"-0.000001s"');
  assert.equal(duration.seconds, 0n);
  assert.equal(duration.nanos, -1000);
  assert.equal(duration.toJson(), '"-0.000001s"');
  assert.throws(() => Duration.fromJson('"315576000001s"'));
});

test('maps FieldMask and dynamic Value JSON forms', () => {
  const mask = new FieldMask();
  mask.paths.push('user.display_name', 'photo');
  assert.equal(mask.toJson(), '"user.displayName,photo"');
  assert.deepEqual(FieldMask.fromJson('"user.displayName,photo"').paths, ['user.display_name', 'photo']);
  assert.throws(() => FieldMask.fromJson('"user_displayName"'));

  const struct = Struct.fromJson('{"name":"Ada","active":true,"items":[null,2]}');
  assert.equal(struct.toJson(), '{"name":"Ada","active":true,"items":[null,2]}');
  assert.equal(Value.fromJson('null').toJson(), 'null');
  assert.equal(Value.fromJson('[1,"x"]').toJson(), '[1,"x"]');
  assert.equal(ListValue.fromJson('[false,{}]').toJson(), '[false,{}]');
  assert.throws(() => Struct.fromJson('{"key":1,"key":2}'));
});

test('joins raw JSON containers without trailing commas', () => {
  assert.equal(ProtoJson.writeRawArray([]), '[]');
  assert.equal(ProtoJson.writeRawArray(['1']), '[1]');
  assert.equal(ProtoJson.writeRawArray(['1', '2']), '[1,2]');
  assert.equal(ProtoJson.writeRawObject([], []), '{}');
  assert.equal(ProtoJson.writeRawObject(['a'], ['1']), '{"a":1}');
  assert.equal(ProtoJson.writeRawObject(['a', 'b'], ['1', '2']), '{"a":1,"b":2}');
});
