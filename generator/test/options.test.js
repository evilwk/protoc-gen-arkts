import assert from 'node:assert/strict';
import test from 'node:test';
import { parseOptions } from '../dist/options.js';

test('parses plugin options and rejects unknown options', () => {
  assert.deepEqual(parseOptions(''), {
    runtimeImport: './ProtoWire',
    groupPrefix: '',
    otherGroupPrefix: '',
    otherGroupFiles: new Set()
  });
  assert.equal(parseOptions('runtime_import=../../ProtoWire').runtimeImport, '../../ProtoWire');
  assert.throws(() => parseOptions('output_prefix=v2'), /unknown plugin option/);
  assert.throws(() => parseOptions('runtime_import='), /requires a non-empty value/);
});

test('accepts a HarmonyOS module name as runtime import', () => {
  assert.equal(parseOptions('runtime_import=proto_runtime').runtimeImport, 'proto_runtime');
});

test('parses protocol source group options', () => {
  const options = parseOptions(
    'group_prefix=v2,other_group_prefix=legacy,other_group_files=common/common.proto;group.proto'
  );
  assert.equal(options.groupPrefix, 'v2');
  assert.equal(options.otherGroupPrefix, 'legacy');
  assert.deepEqual(options.otherGroupFiles, new Set(['common/common.proto', 'group.proto']));
});

test('rejects malformed group options', () => {
  assert.throws(() => parseOptions('group_prefix=/legacy'), /relative directory prefix/);
  assert.throws(() => parseOptions('group_prefix=legacy/'), /relative directory prefix/);
  assert.throws(() => parseOptions('other_group_prefix=../legacy'), /relative directory prefix/);
  assert.throws(
    () => parseOptions('other_group_files=shared.proto'),
    /other_group_files requires other_group_prefix/
  );
});

test('rejects duplicate and ambiguous group options', () => {
  assert.throws(
    () => parseOptions('runtime_import=proto_runtime,runtime_import=other'),
    /duplicate plugin option/
  );
  assert.throws(
    () => parseOptions('group_prefix=v2,other_group_prefix=v2'),
    /must be different/
  );
  assert.throws(
    () => parseOptions('other_group_prefix=v2,other_group_files=common.proto;'),
    /invalid proto path/
  );
  assert.throws(() => parseOptions('group_prefix=legacy\\v1'), /relative directory prefix/);
});
