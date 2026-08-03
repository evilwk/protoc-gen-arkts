import { ArkTSGenerator } from './generator.js';
import { decodeRequest, encodeResponse } from './plugin-protocol.js';
import type { GeneratorRequest } from './model/types.js';

const generator: ArkTSGenerator = new ArkTSGenerator();

/**
 * protoc 插件的字节协议边界。
 */
export function runPlugin(input: Uint8Array): Uint8Array {
  try {
    const request: GeneratorRequest = decodeRequest(input);
    return encodeResponse(generator.generate(request));
  } catch (error) {
    const message: string = error instanceof Error ? error.message : String(error);
    return encodeResponse([], message);
  }
}
