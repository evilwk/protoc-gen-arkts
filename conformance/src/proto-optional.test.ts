import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  OptionalPresence,
  OptionalPresenceChild
} from '../native/generated/Optional';

test('preserves proto3 optional presence for default scalar values', () => {
  const message = new OptionalPresence();
  assert.equal(message.hasCount(), false);
  assert.equal(message.getCount(), 0);
  assert.deepEqual(message.encode(), new Uint8Array(0));
  assert.equal(message.toJson(), '{}');

  message.setCount(0);
  assert.equal(message.hasCount(), true);
  assert.deepEqual(message.encode(), Uint8Array.from([0x08, 0x00]));
  assert.equal(message.toJson(), '{"count":0}');

  const decoded = OptionalPresence.decode(message.encode());
  assert.equal(decoded.hasCount(), true);
  assert.equal(decoded.getCount(), 0);

  message.clearCount();
  assert.equal(message.hasCount(), false);
  assert.deepEqual(message.encode(), new Uint8Array(0));
});

test('preserves proto3 optional presence through JSON', () => {
  const present = OptionalPresence.fromJson('{"count":0,"label":""}');
  assert.equal(present.hasCount(), true);
  assert.equal(present.hasLabel(), true);
  assert.equal(present.toJson(), '{"count":0,"label":""}');

  const nullValue = OptionalPresence.fromJson('{"count":null}');
  assert.equal(nullValue.hasCount(), false);
  assert.equal(nullValue.toJson(), '{}');
});

test('merges repeated occurrences of an optional message field', () => {
  const first = new OptionalPresenceChild();
  first.first = 1;
  const second = new OptionalPresenceChild();
  second.second = 2;

  const firstBytes = new OptionalPresence();
  firstBytes.setChild(first);
  const secondBytes = new OptionalPresence();
  secondBytes.setChild(second);

  const mergedWire = Uint8Array.from([...firstBytes.encode(), ...secondBytes.encode()]);
  const decoded = OptionalPresence.decode(mergedWire);
  assert.equal(decoded.hasChild(), true);
  assert.equal(decoded.getChild()?.first, 1);
  assert.equal(decoded.getChild()?.second, 2);
});
