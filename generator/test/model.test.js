import assert from 'node:assert/strict';
import protobuf from 'protobufjs';
import test from 'node:test';
import { ArkTSGenerator } from '../dist/generator.js';
import { runPlugin } from '../dist/index.js';
import { DescriptorModel } from '../dist/model/descriptor-model.js';
import { parseOptions } from '../dist/options.js';

const DEFAULT_OPTIONS = parseOptions('');

function protoFile(name, messageType = [], extra = {}) {
  return { name, syntax: 'proto3', messageType, ...extra };
}

function generateMessage(message, extraFiles = []) {
  return new ArkTSGenerator().generate({
    filesToGenerate: ['invalid.proto'],
    parameter: '',
    protoFiles: [protoFile('invalid.proto', [message], { package: 'test' }), ...extraFiles]
  });
}

test('rejects duplicate descriptors, targets, and missing targets', () => {
  const empty = protoFile('empty.proto');
  assert.throws(
    () => DescriptorModel.build([empty, empty], ['empty.proto'], DEFAULT_OPTIONS),
    /duplicate file descriptor/
  );
  assert.throws(
    () => DescriptorModel.build([empty], ['empty.proto', 'empty.proto'], DEFAULT_OPTIONS),
    /duplicate file_to_generate/
  );
  assert.throws(
    () => DescriptorModel.build([empty], ['missing.proto'], DEFAULT_OPTIONS),
    /descriptor for file "missing.proto" was not provided/
  );
  assert.throws(
    () => DescriptorModel.build([{ syntax: 'proto3' }], [''], DEFAULT_OPTIONS),
    /file descriptor contains an empty name/
  );
  assert.throws(
    () => DescriptorModel.build(
      [{ name: 'legacy.proto', syntax: 'proto2' }],
      ['legacy.proto'],
      DEFAULT_OPTIONS
    ),
    /only syntax = "proto3" is supported/
  );
});

test('rejects duplicate symbols and flattened ArkTS names deterministically', () => {
  const first = protoFile('a.proto', [{ name: 'Item' }], { package: 'test' });
  const second = protoFile('b.proto', [{ name: 'Item' }], { package: 'test' });
  assert.throws(
    () => DescriptorModel.build([second, first], ['a.proto', 'b.proto'], DEFAULT_OPTIONS),
    /duplicate protobuf symbol \.test\.Item in a\.proto, b\.proto/
  );

  const flattened = protoFile('flat.proto', [
    { name: 'OuterInner' },
    { name: 'Outer', nestedType: [{ name: 'Inner' }] }
  ]);
  assert.throws(
    () => DescriptorModel.build([flattened], ['flat.proto'], DEFAULT_OPTIONS),
    /flattened ArkTS type name OuterInner conflicts/
  );
});

test('rejects generated output name collisions', () => {
  assert.throws(
    () => DescriptorModel.build(
      [protoFile('foo_bar.proto'), protoFile('foo-bar.proto')],
      ['foo_bar.proto', 'foo-bar.proto'],
      DEFAULT_OPTIONS
    ),
    /generated output FooBar\.ets conflicts between foo-bar\.proto and foo_bar\.proto/
  );
});

test('rejects invalid fields and unsupported descriptor semantics', () => {
  assert.throws(
    () => generateMessage({ name: 'Broken', field: [{ name: 'bad', number: 0, type: 5 }] }),
    /\.test\.Broken\.bad: invalid field number 0/
  );
  assert.throws(
    () => generateMessage({
      name: 'Broken',
      oneofDecl: [{ name: 'choice' }],
      field: [{ name: 'bad', number: 1, type: 5, oneofIndex: 1 }]
    }),
    /invalid oneof index 1/
  );
  assert.throws(
    () => generateMessage({ name: 'Broken', field: [{ name: 'bad', number: 1, type: 10 }] }),
    /group fields are not supported/
  );
  assert.throws(
    () => generateMessage({
      name: 'Broken',
      field: [{ name: 'bad', number: 1, type: 5, proto3Optional: true }]
    }),
    /proto3 optional field is missing its synthetic oneof/
  );
  assert.throws(
    () => generateMessage({
      name: 'Broken',
      oneofDecl: [{ name: '_bad' }],
      field: [
        { name: 'bad', number: 1, type: 5, oneofIndex: 0, proto3Optional: true },
        { name: 'also_bad', number: 2, type: 5, oneofIndex: 0 }
      ]
    }),
    /proto3 optional synthetic oneof must contain exactly one field/
  );
  assert.throws(
    () => generateMessage({
      name: 'Broken',
      field: [{ name: 'missing', number: 1, type: 11, typeName: '.test.Missing' }]
    }),
    /unresolved protobuf type \.test\.Missing/
  );
});

test('rejects malformed map entries and illegal map keys', () => {
  assert.throws(
    () => generateMessage({
      name: 'Broken',
      field: [{
        name: 'values', number: 1, label: 3, type: 11, typeName: '.test.Broken.ValuesEntry'
      }],
      nestedType: [{
        name: 'ValuesEntry',
        options: { mapEntry: true },
        field: [{ name: 'key', number: 1, type: 9 }]
      }]
    }),
    /invalid map entry/
  );
  assert.throws(
    () => generateMessage({
      name: 'Broken',
      field: [{
        name: 'values', number: 1, label: 3, type: 11, typeName: '.test.Broken.ValuesEntry'
      }],
      nestedType: [{
        name: 'ValuesEntry',
        options: { mapEntry: true },
        field: [
          { name: 'key', number: 1, type: 12 },
          { name: 'value', number: 2, type: 5 }
        ]
      }]
    }),
    /invalid map key type 12/
  );
  assert.throws(
    () => generateMessage({
      name: 'Broken',
      field: [{
        name: 'values', number: 1, type: 11, typeName: '.test.Broken.ValuesEntry'
      }],
      nestedType: [{
        name: 'ValuesEntry',
        options: { mapEntry: true },
        field: [
          { name: 'key', number: 1, type: 9 },
          { name: 'value', number: 2, type: 5 }
        ]
      }]
    }),
    /map entry \.test\.Broken\.ValuesEntry cannot be used as a normal field type/
  );
});

test('rejects generated ArkTS member name collisions', () => {
  assert.throws(
    () => generateMessage({
      name: 'Broken',
      field: [
        { name: 'first_name', jsonName: 'sameName', number: 1, type: 9 },
        { name: 'second_name', jsonName: 'sameName', number: 2, type: 9 }
      ]
    }),
    /ArkTS member sameName conflicts between first_name and second_name/
  );
});

test('rejects generated service class and member name collisions', () => {
  const messages = [{ name: 'Request' }, { name: 'Response' }];
  const rpc = (name) => ({
    name,
    inputType: '.test.Request',
    outputType: '.test.Response'
  });

  assert.throws(
    () => DescriptorModel.build([
      protoFile('service.proto', [...messages, { name: 'Gateway' }], {
        package: 'test',
        service: [{ name: 'Gateway', method: [rpc('Call')] }]
      })
    ], ['service.proto'], DEFAULT_OPTIONS),
    /generated service class Gateway conflicts/
  );

  assert.throws(
    () => DescriptorModel.build([
      protoFile('service.proto', messages, {
        package: 'test',
        service: [{ name: 'Gateway', method: [rpc('Client')] }]
      })
    ], ['service.proto'], DEFAULT_OPTIONS),
    /ArkTS member client conflicts/
  );

  assert.throws(
    () => DescriptorModel.build([
      protoFile('service.proto', messages, {
        package: 'test',
        service: [{ name: 'Gateway', method: [rpc('Get_item'), rpc('get_item')] }]
      })
    ], ['service.proto'], DEFAULT_OPTIONS),
    /ArkTS member getItem conflicts/
  );
});

test('rejects invalid unary request and response types', () => {
  const messages = [{ name: 'Request' }, { name: 'Response' }];

  assert.throws(
    () => DescriptorModel.build([
      protoFile('service.proto', messages, {
        package: 'test',
        service: [{
          name: 'Gateway',
          method: [{ name: 'Call', inputType: '.test.Missing', outputType: '.test.Response' }]
        }]
      })
    ], ['service.proto'], DEFAULT_OPTIONS),
    /request: unresolved protobuf type \.test\.Missing/
  );

  assert.throws(
    () => DescriptorModel.build([
      protoFile('service.proto', messages, {
        package: 'test',
        enumType: [{ name: 'Result', value: [{ name: 'RESULT_UNSPECIFIED', number: 0 }] }],
        service: [{
          name: 'Gateway',
          method: [{ name: 'Call', inputType: '.test.Request', outputType: '.test.Result' }]
        }]
      })
    ], ['service.proto'], DEFAULT_OPTIONS),
    /response: type \.test\.Result is not a message/
  );
});

test('encodes generation failures in CodeGeneratorResponse.error', () => {
  const response = runPlugin(new Uint8Array());
  const reader = protobuf.Reader.create(response);
  assert.equal(reader.uint32(), 10);
  assert.equal(reader.string(), 'CodeGeneratorRequest does not contain file_to_generate');
  assert.equal(reader.pos, reader.len);
});
