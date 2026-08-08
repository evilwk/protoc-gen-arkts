const OUTER_HEADER: number = 0;

export function encodeOuterResponse(payload: ArrayBuffer): ArrayBuffer {
  const result: ArrayBuffer = new ArrayBuffer(payload.byteLength + 1);
  const bytes: Uint8Array = new Uint8Array(result);
  bytes[0] = OUTER_HEADER;
  bytes.set(new Uint8Array(payload), 1);
  return result;
}

export function decodeOuterResponse(rawBytes: ArrayBuffer): ArrayBuffer {
  if (rawBytes.byteLength === 0 || new Uint8Array(rawBytes)[0] !== OUTER_HEADER) {
    throw new Error('Invalid simulated RPC envelope');
  }
  return rawBytes.slice(1);
}
