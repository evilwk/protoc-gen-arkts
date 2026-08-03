import protobuf from 'protobufjs';
import descriptor, {
  type IFileDescriptorProto
} from 'protobufjs/ext/descriptor/index.js';
import type { GeneratedFile, GeneratorRequest } from './model/types.js';

const { Reader, Writer } = protobuf;

// google.protobuf.compiler.CodeGeneratorRequest 字段号。
const REQUEST_FILE_TO_GENERATE_FIELD = 1;
const REQUEST_PARAMETER_FIELD = 2;
const REQUEST_PROTO_FILE_FIELD = 15;

// google.protobuf.compiler.CodeGeneratorResponse 及其 File 子消息的 wire tag。
const RESPONSE_ERROR_TAG = 10;
const RESPONSE_FILE_TAG = 122;
const RESPONSE_FILE_NAME_TAG = 10;
const RESPONSE_FILE_CONTENT_TAG = 122;

export function decodeRequest(input: Uint8Array): GeneratorRequest {
  const reader: protobuf.Reader = Reader.create(input);
  const filesToGenerate: string[] = [];
  const protoFiles: IFileDescriptorProto[] = [];
  let parameter: string = '';

  while (reader.pos < reader.len) {
    const tag: number = reader.uint32();
    // tag 高位是字段号，低 3 位是 wire type
    switch (tag >>> 3) {
      case REQUEST_FILE_TO_GENERATE_FIELD:
        // repeated string file_to_generate：本次 protoc 要求插件生成的 proto 文件。
        filesToGenerate.push(reader.string());
        break;
      case REQUEST_PARAMETER_FIELD:
        // optional string parameter：--arkts_out 中冒号前传入的插件参数。
        parameter = reader.string();
        break;
      case REQUEST_PROTO_FILE_FIELD: {
        // repeated FileDescriptorProto proto_file：含输入文件及其 import 依赖的完整描述。
        const length: number = reader.uint32();
        const message = descriptor.FileDescriptorProto.decode(reader, length);
        protoFiles.push(descriptor.FileDescriptorProto.toObject(message, {
          arrays: true,
          objects: true
        }) as IFileDescriptorProto);
        break;
      }
      default:
        reader.skipType(tag & 7);
    }
  }
  return { filesToGenerate, parameter, protoFiles };
}

export function encodeResponse(files: GeneratedFile[], error?: string): Uint8Array {
  const writer: protobuf.Writer = Writer.create();
  // 插件错误必须写入 CodeGeneratorResponse.error，不能向 stdout 输出普通文本。
  if (error !== undefined) {
    writer.uint32(RESPONSE_ERROR_TAG).string(error);
  }
  for (const file of files) {
    writer.uint32(RESPONSE_FILE_TAG)
      .fork()
      .uint32(RESPONSE_FILE_NAME_TAG)
      .string(file.name)
      .uint32(RESPONSE_FILE_CONTENT_TAG)
      .string(file.content)
      .ldelim();
  }
  return writer.finish();
}
