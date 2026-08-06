import { collections, lang } from '@kit.ArkTS';
import { DEMO_SERVICE_RSP_DECODERS, Envelope, Profile, Status } from '../generated/Demo';

/**
 * 子线程侧的验证逻辑。
 *
 * 这些函数刻意放在独立文件里：@Concurrent 函数所在文件不能直接或间接引入 UI 装饰器，
 * 而页面文件带有 @Entry/@Observed，一旦同文件会在子线程解析时抛异常。
 */

/**
 * 在子线程里编码，返回 Sendable bytes 供主线程解码。
 */
@Concurrent
export function encodeInTask(envelope: Envelope): collections.Uint8Array {
  return envelope.encode();
}

/**
 * 在子线程里解码并校验关键字段，返回空串表示通过。
 */
@Concurrent
export function decodeInTask(bytes: collections.Uint8Array): string {
  const decoded: Envelope = Envelope.decode(bytes);
  if (decoded.code !== -42) {
    return `子线程解码 code 期望 -42，实际 ${decoded.code}`;
  }
  if (decoded.message !== '鸿蒙 protobuf') {
    return `子线程解码 message 期望「鸿蒙 protobuf」，实际「${decoded.message}」`;
  }
  if (decoded.status !== Status.STATUS_OK) {
    return `子线程解码 status 期望 ${Status.STATUS_OK}，实际 ${decoded.status}`;
  }
  if (decoded.scores.length !== 3 || decoded.tags.length !== 2) {
    return `子线程解码容器长度错误：scores=${decoded.scores.length} tags=${decoded.tags.length}`;
  }
  if (decoded.payload.length !== 3) {
    return `子线程解码 payload 长度期望 3，实际 ${decoded.payload.length}`;
  }
  const profileNickname: string = decoded.profile !== undefined ? decoded.profile.nickname : '';
  if (profileNickname !== 'kyle') {
    return `子线程解码嵌套 profile 错误：「${profileNickname}」`;
  }
  return '';
}

/**
 * 经生成的响应解码表在子线程里按方法名解码。
 *
 * 类与函数都不是 Sendable，传不进子线程，因此跨线程只传方法名，
 * 由子线程侧查表拿到 decode。这是解码表存在的唯一理由。
 */
@Concurrent
export function decodeByMethodInTask(methodName: string, bytes: collections.Uint8Array): string {
  const decoder: ((bytes: Uint8Array | collections.Uint8Array) => lang.ISendable) | undefined =
    DEMO_SERVICE_RSP_DECODERS.get(methodName);
  if (decoder === undefined) {
    return `解码表里没有方法 ${methodName}`;
  }

  const decoded: lang.ISendable = decoder(bytes);
  if (methodName === 'GetProfile') {
    const profile: Profile = decoded as Profile;
    return profile.nickname === 'kyle' ? '' : `按表解码 Profile 错误：「${profile.nickname}」`;
  }

  const envelope: Envelope = decoded as Envelope;
  return envelope.code === -42 ? '' : `按表解码 Envelope 错误：code=${envelope.code}`;
}

/**
 * 在子线程里改写字段，用于验证 @Sendable 是引用传递而非拷贝。
 * 同时改写顶层标量和嵌套 message，确认嵌套对象也是共享的同一实例。
 */
@Concurrent
export function mutateInTask(envelope: Envelope, marker: number, nickname: string): string {
  envelope.code = marker;
  if (envelope.profile === undefined) {
    return '子线程读到的 profile 为 undefined，引用未传过来';
  }
  envelope.profile.nickname = nickname;
  return '';
}
