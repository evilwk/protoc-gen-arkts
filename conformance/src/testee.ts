// conformance_test_runner 的被测程序。
//
// 协议：stdin/stdout 上各自 4 字节小端长度前缀 + 序列化的 Conformance{Request,Response}。
// runner 严格一问一答，所以这里用同步读写，避免任何缓冲导致的乱序。
import { readSync, writeSync } from 'node:fs';
import { ConformanceRequest, ConformanceResponse, TestCategory, WireFormat } from '../native/generated/Conformance';
import { TestAllTypesProto3 } from '../native/generated/google/protobuf/TestMessagesProto3';

const PROTO3_MESSAGE = 'protobuf_test_messages.proto3.TestAllTypesProto3';

/** 读满 length 字节；返回 null 表示 runner 已关闭 stdin，正常收尾。 */
function readExactly(length: number): Buffer | null {
  const buffer = Buffer.alloc(length);
  let filled = 0;
  while (filled < length) {
    let read: number;
    try {
      read = readSync(0, buffer, filled, length - filled, null);
    } catch (error) {
      // 管道尚未就绪时重试；EOF 由 read === 0 判定。
      if ((error as NodeJS.ErrnoException).code === 'EAGAIN') continue;
      if ((error as NodeJS.ErrnoException).code === 'EOF') return null;
      throw error;
    }
    if (read === 0) return null;
    filled += read;
  }
  return buffer;
}

function writeExactly(payload: Uint8Array): void {
  let written = 0;
  while (written < payload.length) {
    written += writeSync(1, payload, written, payload.length - written);
  }
}

/**
 * 处理单个请求。
 *
 * 射程：proto3 binary wire。其余格式（JSON / text / JSPB）和 proto2、editions 的
 * 消息类型一律回 skipped —— 这是 conformance 协议为"实现不覆盖该特性"预留的答案，
 * 与 failure 区分统计。
 */
function handle(request: ConformanceRequest): ConformanceResponse {
  const response = new ConformanceResponse();

  if (request.testCategory !== TestCategory.BINARY_TEST) {
    response.setSkipped(`unsupported test category: ${request.testCategory}`);
    return response;
  }
  if (!request.hasProtobufPayload()) {
    response.setSkipped('only protobuf payloads are supported');
    return response;
  }
  if (request.messageType !== PROTO3_MESSAGE) {
    response.setSkipped(`unsupported message type: ${request.messageType}`);
    return response;
  }
  if (request.requestedOutputFormat !== WireFormat.PROTOBUF) {
    response.setSkipped(`unsupported output format: ${request.requestedOutputFormat}`);
    return response;
  }

  let message: TestAllTypesProto3;
  try {
    message = TestAllTypesProto3.decode(request.getProtobufPayload());
  } catch (error) {
    // 解析失败是被测能力的一部分：runner 对畸形输入就期望这个答案。
    response.setParseError(String((error as Error).message ?? error));
    return response;
  }

  try {
    response.setProtobufPayload(message.encode());
  } catch (error) {
    response.setSerializeError(String((error as Error).message ?? error));
  }
  return response;
}

/**
 * 设 ARKTS_CONFORMANCE_TALLY=1 时，退出前把 skip 原因分布打到 stderr。
 * 用于确认"跳过"的构成，避免把未实现的特性误当成通过。
 */
const tally = new Map<string, number>();
const tallyEnabled = process.env.ARKTS_CONFORMANCE_TALLY === '1';

function record(response: ConformanceResponse): void {
  if (!tallyEnabled) return;
  const reason = response.hasSkipped()
    ? response.getSkipped().replace(/: .*$/, '')
    : response.hasParseError() ? 'parse_error' : 'handled';
  tally.set(reason, (tally.get(reason) ?? 0) + 1);
}

function main(): void {
  for (;;) {
    const header = readExactly(4);
    if (header === null) break;
    const request = readExactly(header.readUInt32LE(0));
    if (request === null) break;

    const response = handle(ConformanceRequest.decode(new Uint8Array(request)));
    record(response);
    const payload = response.encode();
    const prefix = Buffer.alloc(4);
    prefix.writeUInt32LE(payload.length, 0);
    writeExactly(prefix);
    writeExactly(payload);
  }

  if (tallyEnabled) {
    for (const [reason, count] of [...tally].sort((left, right) => right[1] - left[1])) {
      process.stderr.write(`${String(count).padStart(6)}  ${reason}\n`);
    }
  }
}

main();
