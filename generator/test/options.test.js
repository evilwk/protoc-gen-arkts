import assert from 'node:assert/strict';
import test from 'node:test';
import { parseOptions } from '../dist/options.js';

// dep_root 的目录遍历由替身提供，选项解析测试无需触碰文件系统。
const noProtos = () => [];
const scanning = (files) => (root) => (root === 'v2' ? files : []);

test('parses plugin options and rejects unknown options', () => {
  assert.deepEqual(parseOptions('', noProtos), {
    json: false,
    outputPrefix: '',
    depPrefix: '',
    depFiles: new Set()
  });
  assert.throws(() => parseOptions('group_prefix=v2', noProtos), /unknown plugin option/);
  assert.throws(() => parseOptions('runtime_import=proto_runtime', noProtos), /unknown plugin option/);
});

test('parses the opt-in json option strictly', () => {
  assert.equal(parseOptions('json=true', noProtos).json, true);
  assert.equal(parseOptions('json=false', noProtos).json, false);
  assert.throws(() => parseOptions('json=1', noProtos), /must be "true" or "false"/);
});

test('collects dependency protos by scanning dep_root', () => {
  const options = parseOptions(
    'output_prefix=v2,dep_root=v2,dep_prefix=legacy',
    scanning(['common/common.proto', 'group.proto'])
  );
  assert.equal(options.outputPrefix, 'v2');
  assert.equal(options.depPrefix, 'legacy');
  assert.deepEqual(options.depFiles, new Set(['common/common.proto', 'group.proto']));
});

test('defaults dep_prefix to output_prefix so dependencies share the output directory', () => {
  const options = parseOptions('output_prefix=api,dep_root=v2', scanning(['shared.proto']));
  assert.equal(options.depPrefix, 'api');
  assert.deepEqual(options.depFiles, new Set(['shared.proto']));
});

test('treats an absent dep_root as having no external dependency', () => {
  const options = parseOptions('output_prefix=v2', noProtos);
  assert.equal(options.depPrefix, 'v2');
  assert.deepEqual(options.depFiles, new Set());
});

test('rejects malformed prefix options', () => {
  assert.throws(() => parseOptions('output_prefix=/legacy', noProtos), /relative directory prefix/);
  assert.throws(() => parseOptions('output_prefix=legacy/', noProtos), /relative directory prefix/);
  assert.throws(() => parseOptions('dep_root=v2,dep_prefix=../legacy', noProtos), /relative directory prefix/);
  assert.throws(() => parseOptions('output_prefix=legacy\\v1', noProtos), /relative directory prefix/);
  assert.throws(() => parseOptions('dep_prefix=legacy', noProtos), /dep_prefix requires dep_root/);
});

test('rejects duplicate options and unusable scan results', () => {
  assert.throws(
    () => parseOptions('json=true,json=false', noProtos),
    /duplicate plugin option/
  );
  assert.throws(
    () => parseOptions('dep_root=v2', scanning(['../escape.proto'])),
    /invalid proto path/
  );
});

test('reports an unreadable dep_root', () => {
  assert.throws(
    () => parseOptions('dep_root=missing-directory'),
    /dep_root "missing-directory" cannot be listed/
  );
});
