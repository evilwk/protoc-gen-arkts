import { collections, taskpool } from '@kit.ArkTS';
import { BusinessError } from '@kit.BasicServicesKit';
import { ProtoMessage, RpcClient } from 'protoc-gen-arkts-runtime';
import { DemoService, Envelope, Profile, Status } from '../generated/Demo';
import {
  decodeInTask,
  decodeRpcResponseInTask,
  encodeInTask,
  mutateInTask
} from '../checks/ConcurrentChecks';
import { encodeOuterResponse } from '../checks/RpcCodec';

/**
 * 单项验证的执行状态，驱动列表行的文案与配色。
 */
enum CheckStatus {
  Pending,
  Running,
  Passed,
  Failed
}

class RecordingRpcClient implements RpcClient {
  service: string = '';
  method: string = '';
  request: ProtoMessage | undefined = undefined;

  async invoke<Response extends ProtoMessage>(
    service: string,
    method: string,
    request: ProtoMessage
  ): Promise<Response> {
    this.service = service;
    this.method = method;
    this.request = request;
    if (method !== 'GetProfile') {
      throw new Error(`Unexpected test RPC method: ${method}`);
    }
    const response: ProtoMessage = Profile.decode(request.encode());
    return response as Response;
  }
}

/**
 * 列表中的一项验证。key 决定执行哪段断言，status 与 detail 由执行结果回写。
 */
@Observed
class CheckItem {
  readonly key: string;
  readonly name: string;
  readonly summary: string;
  status: CheckStatus = CheckStatus.Pending;
  detail: string = '';

  constructor(key: string, name: string, summary: string) {
    this.key = key;
    this.name = name;
    this.summary = summary;
  }
}

const COLOR_PAGE_BG: string = '#F1F3F5';
const COLOR_CARD_BG: string = '#FFFFFF';
const COLOR_TEXT_PRIMARY: string = '#182431';
const COLOR_TEXT_SECONDARY: string = '#99182431';
const COLOR_PASSED: string = '#41BA41';
const COLOR_FAILED: string = '#E84026';
const COLOR_RUNNING: string = '#0A59F7';

/**
 * 一行验证项：显示名称、状态与说明，点击可单独重跑。
 */
@Component
struct CheckRow {
  @ObjectLink item: CheckItem;
  onRun: (key: string) => void = () => {
  };

  private statusLabel(): string {
    switch (this.item.status) {
      case CheckStatus.Running:
        return '运行中';
      case CheckStatus.Passed:
        return '通过';
      case CheckStatus.Failed:
        return '失败';
      default:
        return '待运行';
    }
  }

  private statusColor(): string {
    switch (this.item.status) {
      case CheckStatus.Running:
        return COLOR_RUNNING;
      case CheckStatus.Passed:
        return COLOR_PASSED;
      case CheckStatus.Failed:
        return COLOR_FAILED;
      default:
        return COLOR_TEXT_SECONDARY;
    }
  }

  build() {
    Column({ space: 4 }) {
      Row() {
        Text(this.item.name)
          .fontSize($r('app.float.item_title_font_size'))
          .fontColor(COLOR_TEXT_PRIMARY)
          .fontWeight(FontWeight.Medium)
          .layoutWeight(1)
        Text(this.statusLabel())
          .fontSize($r('app.float.page_body_font_size'))
          .fontColor(this.statusColor())
      }
      .width('100%')

      Text(this.item.detail.length > 0 ? this.item.detail : this.item.summary)
        .fontSize($r('app.float.item_detail_font_size'))
        .fontColor(this.item.status === CheckStatus.Failed ? COLOR_FAILED : COLOR_TEXT_SECONDARY)
        .width('100%')
    }
    .alignItems(HorizontalAlign.Start)
    .width('100%')
    .padding(12)
    .borderRadius(12)
    .backgroundColor(COLOR_CARD_BG)
    .onClick(() => {
      this.onRun(this.item.key);
    })
  }
}

@Entry
@Component
struct Index {
  @State items: CheckItem[] = this.createItems();
  @State running: boolean = false;
  @State passed: number = 0;
  @State failed: number = 0;

  private createItems(): CheckItem[] {
    return [
      new CheckItem('scalar', '标量与 enum', 'int32 负数、string、enum 单值往返一致'),
      new CheckItem('repeated', 'repeated 与 map', 'packed repeated、非 packed repeated、map 往返一致'),
      new CheckItem('nested', '嵌套 message 与 bytes', '子 message 字段与 bytes 高位字节不丢失'),
      new CheckItem('oneof', 'oneof presence', '成员互斥、case 号切换、has/get 语义正确'),
      new CheckItem('native', '原生 ArrayBuffer 解码', 'encodeBuffer 的结果可直接被 decode 接受'),
      new CheckItem('consistency', 'encode 一致性', 'encode 与 encodeBuffer 产出相同字节序列'),
      new CheckItem('defaults', '默认值不上线', 'proto3 默认值不写入 wire，空 message 编码长度为 0'),
      new CheckItem('crossthread', '跨线程编解码', 'taskpool 子线程编码/解码，结果回主线程一致'),
      new CheckItem('reference', '@Sendable 引用传递', '子线程改写字段后主线程可见，嵌套 message 同为共享实例'),
      new CheckItem('response', 'Service 响应解码', '同步与 TaskPool 统一调用静态 decodeResponse'),
      new CheckItem('rpc', 'RpcClient 调用', '生成的 service 方法传递正确请求与方法标识')
    ];
  }

  /**
   * 依次运行全部验证项，每步之间让出一帧，便于观察运行中状态。
   */
  private async runAll(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    for (const item of this.items) {
      item.status = CheckStatus.Pending;
      item.detail = '';
    }
    this.refreshCounters();
    for (const item of this.items) {
      await this.execute(item);
    }
    this.running = false;
  }

  /**
   * 只重跑列表中的某一项，用于定位单个失败点。
   */
  private async runSingle(key: string): Promise<void> {
    if (this.running) {
      return;
    }
    const item: CheckItem | undefined = this.items.find((candidate: CheckItem) => candidate.key === key);
    if (item === undefined) {
      return;
    }
    this.running = true;
    await this.execute(item);
    this.running = false;
  }

  private async execute(item: CheckItem): Promise<void> {
    item.status = CheckStatus.Running;
    item.detail = '';
    this.refreshCounters();
    await this.delay(80);

    const reason: string = await this.runCheck(item.key);
    if (reason.length === 0) {
      item.status = CheckStatus.Passed;
      item.detail = '';
    } else {
      item.status = CheckStatus.Failed;
      item.detail = `失败：${reason}`;
    }
    this.refreshCounters();
  }

  private reset(): void {
    if (this.running) {
      return;
    }
    for (const item of this.items) {
      item.status = CheckStatus.Pending;
      item.detail = '';
    }
    this.refreshCounters();
  }

  private refreshCounters(): void {
    let passed: number = 0;
    let failed: number = 0;
    for (const item of this.items) {
      if (item.status === CheckStatus.Passed) {
        passed++;
      } else if (item.status === CheckStatus.Failed) {
        failed++;
      }
    }
    this.passed = passed;
    this.failed = failed;
  }

  private delay(ms: number): Promise<number> {
    return new Promise<number>((resolve: (value: number) => void) => {
      setTimeout(() => {
        resolve(ms);
      }, ms);
    });
  }

  private summaryText(): string {
    const total: number = this.items.length;
    const pending: number = total - this.passed - this.failed;
    return `共 ${total} 项 · 通过 ${this.passed} · 失败 ${this.failed} · 待运行 ${pending}`;
  }

  /**
   * 按 key 分派到具体断言，捕获异常以免单项崩溃打断整轮验证。
   * 跨线程两项需要等待 taskpool，因此整体签名为异步。
   */
  private async runCheck(key: string): Promise<string> {
    try {
      switch (key) {
        case 'scalar':
          return this.verifyScalarAndEnum();
        case 'repeated':
          return this.verifyRepeatedAndMap();
        case 'nested':
          return this.verifyNestedAndBytes();
        case 'oneof':
          return this.verifyOneof();
        case 'native':
          return this.verifyNativeBufferDecode();
        case 'consistency':
          return this.verifyEncodeConsistency();
        case 'defaults':
          return this.verifyDefaultsOmitted();
        case 'crossthread':
          return await this.verifyCrossThreadCodec();
        case 'reference':
          return await this.verifySendableReference();
        case 'response':
          return await this.verifyResponseDecoding();
        case 'rpc':
          return await this.verifyRpcClient();
        default:
          return `未知的验证项 ${key}`;
      }
    } catch (error) {
      const err: BusinessError = error as BusinessError;
      return `抛出异常 ${err.message}`;
    }
  }

  /**
   * 两个方向都验证：主线程编码交给子线程解码，子线程编码回主线程解码。
   * 覆盖生成代码在非 UI 线程实例化与执行编解码的路径。
   */
  private async verifyCrossThreadCodec(): Promise<string> {
    const envelope: Envelope = this.buildEnvelope();

    let decodeReason: string = '';
    let encoded: collections.Uint8Array = new collections.Uint8Array(0);
    try {
      decodeReason = await taskpool.execute(decodeInTask, envelope.encode()) as string;
      encoded = await taskpool.execute(encodeInTask, envelope) as collections.Uint8Array;
    } catch (error) {
      const err: BusinessError = error as BusinessError;
      return `taskpool 执行失败 code=${err.code} ${err.message}`;
    }
    if (decodeReason.length > 0) {
      return decodeReason;
    }

    const expected: collections.Uint8Array = envelope.encode();
    if (encoded.length !== expected.length) {
      return `子线程编码长度 ${encoded.length}，主线程 ${expected.length}`;
    }
    for (let index: number = 0; index < expected.length; index++) {
      if (encoded[index] !== expected[index]) {
        return `子线程编码第 ${index} 字节不一致：${encoded[index]} 与 ${expected[index]}`;
      }
    }

    const roundTrip: Envelope = Envelope.decode(encoded);
    if (roundTrip.code !== -42 || roundTrip.message !== '鸿蒙 protobuf') {
      return `子线程字节回主线程解码错误：code=${roundTrip.code} message=「${roundTrip.message}」`;
    }
    return '';
  }

  /**
   * @Sendable 默认引用传递：子线程改写字段后，主线程持有的同一实例须看到新值。
   * 若退化为拷贝传递，这里的断言会失败。
   */
  private async verifySendableReference(): Promise<string> {
    const envelope: Envelope = this.buildEnvelope();
    const marker: number = 20260805;
    const nickname: string = '子线程改写';

    let reason: string = '';
    try {
      reason = await taskpool.execute(mutateInTask, envelope, marker, nickname) as string;
    } catch (error) {
      const err: BusinessError = error as BusinessError;
      return `taskpool 执行失败 code=${err.code} ${err.message}`;
    }
    if (reason.length > 0) {
      return reason;
    }

    if (envelope.code !== marker) {
      return `顶层字段未共享：期望 ${marker}，实际 ${envelope.code}`;
    }
    const profile: Profile | undefined = envelope.profile;
    if (profile === undefined) {
      return 'profile 变为 undefined';
    }
    if (profile.nickname !== nickname) {
      return `嵌套 message 未共享：期望「${nickname}」，实际「${profile.nickname}」`;
    }

    // 改写后的对象仍须能正常编解码，确认引用共享没有破坏内部状态。
    const decoded: Envelope = Envelope.decode(envelope.encode());
    if (decoded.code !== marker || decoded.profile?.nickname !== nickname) {
      return `改写后往返不一致：code=${decoded.code} nickname=「${decoded.profile?.nickname}」`;
    }
    return '';
  }

  /**
   * 构造一个填满各类字段的 Envelope，供多项验证复用。
   * collections 容器的写入接口声明为可抛异常，这里统一兜住并转成可读信息。
   */
  /**
   * 验证同步与 TaskPool 路径都通过 service 静态边界完成响应解码。
   */
  private async verifyResponseDecoding(): Promise<string> {
    const envelope: Envelope = this.buildEnvelope();
    const profile: Profile = new Profile();
    profile.nickname = 'kyle';
    profile.age = 30;

    const syncProfile: Profile = DemoService.decodeResponse(
      'GetProfile', profile.encodeBuffer()
    ) as Profile;
    if (syncProfile.nickname !== 'kyle') {
      return `同步解码 Profile 错误：「${syncProfile.nickname}」`;
    }

    try {
      const taskProfile: Profile = await taskpool.execute(
        decodeRpcResponseInTask,
        DemoService.SERVICE_NAME,
        'GetProfile',
        encodeOuterResponse(profile.encodeBuffer())
      ) as Profile;
      if (taskProfile.nickname !== 'kyle') {
        return `TaskPool 解码 Profile 错误：「${taskProfile.nickname}」`;
      }

      const taskEnvelope: Envelope = await taskpool.execute(
        decodeRpcResponseInTask,
        DemoService.SERVICE_NAME,
        'GetEnvelope',
        encodeOuterResponse(envelope.encodeBuffer())
      ) as Envelope;
      if (taskEnvelope.code !== -42) {
        return `TaskPool 解码 Envelope 错误：code=${taskEnvelope.code}`;
      }

      let rejected: boolean = false;
      try {
        await taskpool.execute(
          decodeRpcResponseInTask,
          DemoService.SERVICE_NAME,
          'NotARegisteredMethod',
          encodeOuterResponse(profile.encodeBuffer())
        );
      } catch (_error) {
        rejected = true;
      }
      if (!rejected) {
        return '未知方法应在 TaskPool 解码路径中被拒绝';
      }
    } catch (error) {
      const err: BusinessError = error as BusinessError;
      return `taskpool 执行失败 code=${err.code} ${err.message}`;
    }
    return '';
  }

  private async verifyRpcClient(): Promise<string> {
    const client: RecordingRpcClient = new RecordingRpcClient();
    const service: DemoService = new DemoService(client);
    const request: Profile = new Profile();
    request.nickname = 'rpc-client';

    const response: Profile = await service.getProfile(request);
    if (client.service !== 'DemoService' || client.method !== 'GetProfile') {
      return `调用标识错误：${client.service}/${client.method}`;
    }
    if (client.request !== request) {
      return 'RpcClient 没有收到原始 request 实例';
    }
    if (response.nickname !== request.nickname) {
      return `响应类型或内容错误：「${response.nickname}」`;
    }
    return '';
  }

  private buildEnvelope(): Envelope {
    const profile: Profile = new Profile();
    profile.nickname = 'kyle';
    profile.age = 30;

    const envelope: Envelope = new Envelope();
    envelope.code = -42;
    envelope.message = '鸿蒙 protobuf';
    envelope.status = Status.STATUS_OK;
    envelope.profile = profile;
    try {
      envelope.scores.push(100);
      envelope.scores.push(-1);
      envelope.scores.push(0);
      envelope.tags.push('alpha');
      envelope.tags.push('beta');
      envelope.counters.set('hit', 7);
      envelope.counters.set('miss', 3);
      envelope.payload = collections.Uint8Array.from([0x00, 0x80, 0xff]);
    } catch (error) {
      const err: Error = error as Error;
      throw new Error(`构造样本数据失败：${err.message}`);
    }
    return envelope;
  }

  private verifyScalarAndEnum(): string {
    const decoded: Envelope = Envelope.decode(this.buildEnvelope().encode());
    if (decoded.code !== -42) {
      return `code 期望 -42，实际 ${decoded.code}`;
    }
    if (decoded.message !== '鸿蒙 protobuf') {
      return `message 期望「鸿蒙 protobuf」，实际「${decoded.message}」`;
    }
    if (decoded.status !== Status.STATUS_OK) {
      return `status 期望 ${Status.STATUS_OK}，实际 ${decoded.status}`;
    }
    return '';
  }

  /**
   * packed repeated、非 packed repeated 和 map 均须往返一致；map 只校验键值对内容。
   */
  private verifyRepeatedAndMap(): string {
    const decoded: Envelope = Envelope.decode(this.buildEnvelope().encode());
    if (decoded.scores.length !== 3) {
      return `scores 长度期望 3，实际 ${decoded.scores.length}`;
    }
    if (decoded.scores[0] !== 100 || decoded.scores[1] !== -1 || decoded.scores[2] !== 0) {
      return `scores 内容错误：${decoded.scores[0]},${decoded.scores[1]},${decoded.scores[2]}`;
    }
    if (decoded.tags.length !== 2) {
      return `tags 长度期望 2，实际 ${decoded.tags.length}`;
    }
    if (decoded.tags[0] !== 'alpha' || decoded.tags[1] !== 'beta') {
      return `tags 内容错误：${decoded.tags[0]},${decoded.tags[1]}`;
    }
    if (decoded.counters.size !== 2) {
      return `counters 大小期望 2，实际 ${decoded.counters.size}`;
    }
    let hit: number | undefined = undefined;
    let miss: number | undefined = undefined;
    try {
      hit = decoded.counters.get('hit');
      miss = decoded.counters.get('miss');
    } catch (error) {
      const err: Error = error as Error;
      return `读取 counters 抛出异常 ${err.message}`;
    }
    if (hit !== 7 || miss !== 3) {
      return `counters 内容错误：hit=${hit} miss=${miss}`;
    }
    return '';
  }

  private verifyNestedAndBytes(): string {
    const decoded: Envelope = Envelope.decode(this.buildEnvelope().encode());
    const profile: Profile | undefined = decoded.profile;
    if (profile === undefined) {
      return 'profile 缺失';
    }
    if (profile.nickname !== 'kyle' || profile.age !== 30) {
      return `profile 内容错误：nickname=「${profile.nickname}」age=${profile.age}`;
    }
    const payload: collections.Uint8Array = decoded.payload;
    if (payload.length !== 3) {
      return `payload 长度期望 3，实际 ${payload.length}`;
    }
    if (payload[0] !== 0x00 || payload[1] !== 0x80 || payload[2] !== 0xff) {
      return `payload 内容错误：${payload[0]},${payload[1]},${payload[2]}`;
    }
    return '';
  }

  /**
   * oneof 成员互斥：设置 failure 后 ok 须失效，且 case 切换到对应字段号。
   */
  private verifyOneof(): string {
    const envelope: Envelope = this.buildEnvelope();
    const profile: Profile = new Profile();
    profile.nickname = 'ok';
    envelope.setOk(profile);

    const withOk: Envelope = Envelope.decode(envelope.encode());
    if (!withOk.hasOk()) {
      return '设置 ok 后 hasOk() 为 false';
    }
    if (withOk.getResultCase() !== 9) {
      return `resultCase 期望 9，实际 ${withOk.getResultCase()}`;
    }
    if (withOk.getOk()?.nickname !== 'ok') {
      return `ok.nickname 期望「ok」，实际「${withOk.getOk()?.nickname}」`;
    }

    envelope.setFailure('boom');
    const withFailure: Envelope = Envelope.decode(envelope.encode());
    if (!withFailure.hasFailure()) {
      return '设置 failure 后 hasFailure() 为 false';
    }
    if (withFailure.hasOk()) {
      return '设置 failure 后 ok 仍然有效，oneof 未互斥';
    }
    if (withFailure.getFailure() !== 'boom') {
      return `failure 期望「boom」，实际「${withFailure.getFailure()}」`;
    }
    if (withFailure.getResultCase() !== 10) {
      return `resultCase 期望 10，实际 ${withFailure.getResultCase()}`;
    }
    return '';
  }

  /**
   * 模拟 RCP 响应：encodeBuffer 的原生 ArrayBuffer 直接解码，长度 5 不是 4 的整数倍。
   */
  private verifyNativeBufferDecode(): string {
    const profile: Profile = new Profile();
    profile.nickname = 'abc';

    const buffer: ArrayBuffer = profile.encodeBuffer();
    if (buffer.byteLength !== 5) {
      return `byteLength 期望 5，实际 ${buffer.byteLength}`;
    }
    const decoded: Profile = Profile.decode(buffer);
    if (decoded.nickname !== 'abc') {
      return `nickname 期望「abc」，实际「${decoded.nickname}」`;
    }
    if (decoded.age !== 0) {
      return `age 期望 0，实际 ${decoded.age}`;
    }
    return '';
  }

  /**
   * encode 与 encodeBuffer 须产出完全相同的字节序列。
   */
  private verifyEncodeConsistency(): string {
    const envelope: Envelope = this.buildEnvelope();
    const sendable: collections.Uint8Array = envelope.encode();
    const native: Uint8Array = new Uint8Array(envelope.encodeBuffer());
    if (native.length !== sendable.length) {
      return `长度不一致：encode ${sendable.length}，encodeBuffer ${native.length}`;
    }
    for (let index: number = 0; index < sendable.length; index++) {
      if (native[index] !== sendable[index]) {
        return `第 ${index} 字节不一致：${sendable[index]} 与 ${native[index]}`;
      }
    }
    return '';
  }

  /**
   * proto3 默认值不写入 wire，空 message 的编码长度须为 0。
   */
  private verifyDefaultsOmitted(): string {
    const empty: Envelope = new Envelope();
    if (empty.encode().length !== 0) {
      return `空 message 编码长度期望 0，实际 ${empty.encode().length}`;
    }
    const decoded: Envelope = Envelope.decode(empty.encode());
    if (decoded.code !== 0 || decoded.message !== '' || decoded.status !== Status.STATUS_UNKNOWN) {
      return `标量默认值错误：code=${decoded.code} message=「${decoded.message}」status=${decoded.status}`;
    }
    if (decoded.scores.length !== 0 || decoded.counters.size !== 0 || decoded.payload.length !== 0) {
      return `容器默认值非空：scores=${decoded.scores.length} counters=${decoded.counters.size} payload=${decoded.payload.length}`;
    }
    if (decoded.profile !== undefined) {
      return 'profile 期望 undefined';
    }
    if (decoded.getResultCase() !== 0) {
      return `resultCase 期望 0，实际 ${decoded.getResultCase()}`;
    }
    return '';
  }

  build() {
    Column({ space: 12 }) {
      Column({ space: 4 }) {
        Text('编解码验证')
          .fontSize($r('app.float.page_title_font_size'))
          .fontColor(COLOR_TEXT_PRIMARY)
          .fontWeight(FontWeight.Bold)
        Text(this.summaryText())
          .id('RuntimeHarStatus')
          .fontSize($r('app.float.page_body_font_size'))
          .fontColor(COLOR_TEXT_SECONDARY)
        Text('点击下方任意一项可单独重跑')
          .fontSize($r('app.float.item_detail_font_size'))
          .fontColor(COLOR_TEXT_SECONDARY)
      }
      .alignItems(HorizontalAlign.Start)
      .width('100%')

      Row({ space: 12 }) {
        Button(this.running ? '验证中…' : '运行全部')
          .id('RunAllButton')
          .enabled(!this.running)
          .layoutWeight(1)
          .onClick(() => {
            this.runAll();
          })
        Button('重置')
          .enabled(!this.running)
          .layoutWeight(1)
          .backgroundColor(COLOR_CARD_BG)
          .fontColor(COLOR_TEXT_PRIMARY)
          .onClick(() => {
            this.reset();
          })
      }
      .width('100%')

      List({ space: 10 }) {
        ForEach(this.items, (item: CheckItem) => {
          ListItem() {
            CheckRow({
              item: item,
              onRun: (key: string) => {
                this.runSingle(key);
              }
            })
          }
        }, (item: CheckItem) => item.key)
      }
      .layoutWeight(1)
      .width('100%')
      .scrollBar(BarState.Off)
    }
    .padding(16)
    .width('100%')
    .height('100%')
    .backgroundColor(COLOR_PAGE_BG)
  }
}
