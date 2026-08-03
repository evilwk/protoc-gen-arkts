import assert from 'node:assert/strict';
import test from 'node:test';
import {
  indent,
  outputName,
  relativeModule,
  requireArkIdentifier,
  requireArkMemberName,
  toArkMemberName
} from '../dist/naming.js';
import { renderSource } from '../dist/source-template.js';

test('maps protobuf paths and runtime imports deterministically', () => {
  assert.equal(outputName('gateway/websocket.external.proto'), 'gateway/WebsocketExternal.ets');
  assert.equal(
    relativeModule('gateway/WebsocketExternal.ets', '../../ProtoWire'),
    '../../../ProtoWire'
  );
});

test('converts protobuf names through intent-revealing naming helpers', () => {
  assert.equal(toArkMemberName('display_name'), 'displayName');
  assert.equal(requireArkMemberName('switch', 'oneof name'), 'switchValue');
  assert.equal(requireArkIdentifier('class', 'enum value'), 'classValue');
  assert.throws(() => requireArkMemberName('invalid-name', 'field name'), /field name/);
});

test('renders readable source templates with nested interpolation', () => {
  const statement = renderSource`
    if (ready) {
      run();
    }`;
  assert.equal(renderSource`
    function execute(): void {
      ${statement}
    }`, [
    'function execute(): void {',
    '  if (ready) {',
    '    run();',
    '  }',
    '}'
  ].join('\n'));
  assert.equal(indent('first\n\nsecond'), '  first\n\n  second');
  assert.equal(renderSource`
    class Example {
      ${'first\n\nsecond'}
    }`, 'class Example {\n  first\n\n  second\n}');
});
