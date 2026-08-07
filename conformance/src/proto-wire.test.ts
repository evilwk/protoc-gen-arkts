import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { ProtoReader } from '../native/runtime/src/main/ets/wire/ProtoReader';

test('skips deeply nested unknown groups without recursion', () => {
  const depth = 4096;
  const values: number[] = [];
  for (let index = 0; index < depth; index++) {
    values.push(0x0b);
  }
  for (let index = 0; index < depth; index++) {
    values.push(0x0c);
  }
  values.push(0x10, 0x2a);

  const reader = new ProtoReader(Uint8Array.from(values));
  const tag = reader.readTag();
  reader.skipField(Math.floor(tag / 8), tag & 0x07);
  assert.equal(reader.readTag(), 0x10);
  assert.equal(reader.readUInt32(), 42);
  assert.equal(reader.isAtEnd(), true);
});

test('reads tag and fixed32 boundaries on number fast paths', () => {
  const reader = new ProtoReader(Uint8Array.from([
    0xfd, 0xff, 0xff, 0xff, 0x0f,
    0xff, 0xff, 0xff, 0xff,
    0xfe, 0xff, 0xff, 0xff
  ]));
  assert.equal(reader.readTag(), 0xfffffffd);
  assert.equal(reader.readFixed32(), 0xffffffff);
  assert.equal(reader.readSFixed32(), -2);
  assert.equal(reader.isAtEnd(), true);
});
