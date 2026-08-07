# RPC 解码与消息内存接口改造计划

## 目标

在不改变“每个 proto 文件只生成一个 ArkTS 文件”的前提下，补齐原生 `ArrayBuffer` 解码入口、统一所有生成消息的 wire 契约，定义协议无关的 `RpcClient` 调用接口，并为同步解码和外部 TaskPool 二次解码提供稳定的 service 静态边界。

本次改造只负责 protobuf 协议层能力。网络请求、RPC envelope、压缩、加密、状态码处理、TaskPool 调度和 `ClientContext` 均由具体 RPC 实现负责。

## 已确认的约束

1. 每个 proto 仍只生成一个 `.ets` 文件，不额外生成 `*.tasks.ets` 或 `*.rpc.ets`。
2. 生成器不生成 `@Concurrent` 函数，也不依赖 `taskpool`。
3. 外部 `@Concurrent` 函数可以 import 生成的 service 类并调用其静态解码方法。
4. 不把 decoder 函数作为 TaskPool 的普通任务参数传递；TaskPool 参数只传 service/method 标识和二进制数据。
5. `@Sendable` 继续标注在生成的 message 类上。Sendable 接口通过 `extends lang.ISendable` 声明，不在 interface 上使用 `@Sendable`。
6. 原生 `ArrayBuffer` 进入 TaskPool 时默认转移所有权；提交任务后调用方不得继续依赖原 buffer。
7. runtime 只定义 `RpcClient` 抽象调用契约，不实现网络、外层编解码或 TaskPool 调度；生成器为 unary 方法生成强类型调用代码。

## 目标 API

### Runtime 消息契约

新增统一二进制输入类型，并把 wire 能力与 JSON 能力拆开：

```ts
import { collections, lang } from '@kit.ArkTS';

export type ProtoBytes =
  Uint8Array | collections.Uint8Array | ArrayBuffer;

export interface ProtoMessage extends lang.ISendable {
  encode(): collections.Uint8Array;

  encodeBuffer(): ArrayBuffer;
}

export interface ProtoJsonMessage extends ProtoMessage {
  traverse(visitor: ProtoVisitor): void;

  toJson(): string;
}
```

规则：

- 所有生成 message 都实现 `ProtoMessage`。
- 开启 `json=true` 时，生成 message 改为实现 `ProtoJsonMessage`。
- JSON runtime 中需要 `traverse()` 或 `toJson()` 的参数改用 `ProtoJsonMessage`，不能继续使用基础 `ProtoMessage`。
- `ProtoVisitor.visitMessage()` 及 JSON/WKT/Any 相关类型按实际能力选择 `ProtoJsonMessage`。
- `ProtoMessage` 不增加实例 `mergeFrom()`；RPC 解码通过 service 静态边界完成，现有静态 `mergeFrom(bytes, message)` 保留给 protobuf 合并语义。

### RpcClient 抽象接口

runtime 新增协议无关的泛型接口，由应用或网络库实现：

```ts
export interface RpcClient<Context> {
  invoke<Response extends ProtoMessage>(
    context: Context | undefined,
    service: string,
    method: string,
    request: ProtoMessage
  ): Promise<Response>;
}
```

设计规则：

- `Context` 由具体 client 定义，协议 runtime 不规定 header、超时、取消、鉴权等字段。
- context 只交给 `RpcClient` 实现处理，不默认作为 TaskPool 参数传递，因此不要求它实现 `lang.ISendable`。
- `RpcClient` 和生成的 service API 类不扩展 `lang.ISendable`、不标注 `@Sendable`；它们保留在调用线程，跨线程的是消息、service/method 字符串和二进制数据。
- `request` 使用基础 `ProtoMessage`，client 可调用 `encode()` 或 `encodeBuffer()`。
- `Response` 必须显式约束为 `ProtoMessage`；生成代码显式调用 `invoke<HelloReply>()`，不依赖 ArkTS 从返回值反推泛型参数。
- `invoke()` 不接收 `new HelloReply()`、decoder 回调或函数对象。具体 client 使用 service/method 标识选择同步解码器或 TaskPool 顶级分发函数。
- client 必须保证 service/method 对应的实际响应类型与 `Response` 一致；生成的 service 方法负责建立这一静态配对。
- 若后续需要 streaming，应新增独立接口，不扩张本轮 unary `invoke()` 的返回契约。

### Message 二进制方法

生成签名统一使用 `ProtoBytes`：

```ts
static decode(bytes: ProtoBytes): HelloReply {
  return HelloReply.mergeFrom(bytes, new HelloReply());
}

static mergeFrom(
  bytes: ProtoBytes,
  message: HelloReply
): HelloReply {
  const reader: ProtoReader = bytes instanceof ArrayBuffer
    ? ProtoReader.fromBuffer(bytes)
    : new ProtoReader(bytes);
  // 现有字段解码逻辑
  return message;
}
```

行为要求：

- `ArrayBuffer` 通过 `ProtoReader.fromBuffer()` 创建原生 `Uint8Array` 视图，不复制数据。
- 原生 `Uint8Array` 继续零拷贝读取。
- `collections.Uint8Array` 因底层表示不同，继续复制一次到原生 `Uint8Array`。
- `encodeBuffer()` 继续因截取 writer 有效区间产生一次必要复制。
- `Profile.decode(profile.encodeBuffer())` 必须可直接编译和运行，不再要求 `new Uint8Array(buffer)` 包装。

### Service 解码边界

每个非纯 streaming service 在原有生成文件内保留响应解码表，并生成一个 RPC 调用类或 service API 类。类上提供公共静态方法作为唯一稳定解码边界：

```ts
type GreeterResponseDecoder =
  (bytes: ProtoBytes) => ProtoMessage;

const GREETER_RESPONSE_DECODERS:
  Map<string, GreeterResponseDecoder> =
  new Map<string, GreeterResponseDecoder>([
    ['SayHello', HelloReply.decode as GreeterResponseDecoder]
  ]);

export class GreeterApi<Context> {
  static readonly SERVICE_NAME: string = 'helloworld.Greeter';

  private readonly client: RpcClient<Context>;

  constructor(client: RpcClient<Context>) {
    this.client = client;
  }

  sayHello(
    context: Context | undefined,
    request: HelloRequest
  ): Promise<HelloReply> {
    return this.client.invoke<HelloReply>(
      context,
      GreeterApi.SERVICE_NAME,
      'SayHello',
      request
    );
  }

  static decodeResponse(
    method: string,
    bytes: ProtoBytes
  ): ProtoMessage {
    const decoder: GreeterResponseDecoder | undefined =
      GREETER_RESPONSE_DECODERS.get(method);
    if (decoder === undefined) {
      throw new Error(
        `Unknown RPC response: ${GreeterApi.SERVICE_NAME}/${method}`
      );
    }
    return decoder(bytes);
  }
}
```

设计规则：

- 解码表按 service 独立，key 继续使用 proto method name。
- 错误信息必须包含 protobuf service 全名和 method name。
- `decodeResponse()` 返回 `ProtoMessage`，具体类型由调用方法或外部任务在已知 method 的位置收窄。
- 响应 decoder 类型从 `lang.ISendable` 收窄为 `ProtoMessage`。
- 每个 unary 方法生成一个实例方法，参数和返回值使用其 protobuf request/response 类型。
- 实例方法只调用 `RpcClient.invoke<Response>()`，不直接编码、联网、调度 TaskPool 或解码。
- 解码表可以先保持现有导出以兼容消费者；新增代码应只依赖 `GreeterApi.decodeResponse()`。确认无外部兼容需求后，再单独决定是否改为模块私有。
- 同一响应类型被多个方法复用时，每个 method 仍登记一项。
- 空 message 响应必须登记。
- streaming 方法继续不进入 unary 响应解码表。
- 若生成 `GreeterApi` 等新声明，模型层必须校验它与 message、enum、其他 service 生成名之间的冲突。

## TaskPool 集成方式

生成器不生成以下代码；RPC 实现或应用在独立 `.ets` 文件中封装：

```ts
import { GreeterApi } from './generated/Greeter';
import { decodeOuterResponse } from './MyRpcCodec';

@Concurrent
export function decodeRpcResponseTask(
  service: string,
  method: string,
  rawBytes: ArrayBuffer
): ProtoMessage {
  const protobufPayload: ArrayBuffer =
    decodeOuterResponse(rawBytes);
  if (service === GreeterApi.SERVICE_NAME) {
    return GreeterApi.decodeResponse(method, protobufPayload);
  }
  throw new Error(`Unknown RPC service: ${service}`);
}
```

具体 `RpcClient` 实现完成网络请求后，只把可传输的数据交给顶级任务：

```ts
abstract class TaskPoolRpcClient
  implements RpcClient<MyClientContext> {
  protected abstract send(
    context: MyClientContext | undefined,
    service: string,
    method: string,
    requestBytes: ArrayBuffer
  ): Promise<ArrayBuffer>;

  async invoke<Response extends ProtoMessage>(
    context: MyClientContext | undefined,
    service: string,
    method: string,
    request: ProtoMessage
  ): Promise<Response> {
    const rawResponse: ArrayBuffer = await this.send(
      context,
      service,
      method,
      request.encodeBuffer()
    );
    return await taskpool.execute(
      decodeRpcResponseTask,
      service,
      method,
      rawResponse
    ) as Response;
  }
}
```

上例只描述 `invoke()` 内的职责流转，具体子类负责实现 `send()`；`MyClientContext`、连接管理和网络错误模型不属于生成代码。

同步解码：

```ts
const response: HelloReply = GreeterApi.decodeResponse(
  'SayHello',
  protobufPayload
) as HelloReply;
```

边界说明：

- `decodeRpcResponseTask` 必须是顶级 `@Concurrent` 函数。
- 它所在文件通过 import 访问 `GreeterApi` 和外层 decoder；不要在函数体中访问同文件定义的运行时函数或类。
- 多个生成 service 由该外部顶级任务按 `SERVICE_NAME` 分发；生成器只提供各 service 的 `decodeResponse()`，不生成全局应用注册表。
- 生成文件必须保持纯 ArkTS，只依赖 runtime 和其他生成消息，不能引入 UI 或具体网络模块。
- 外层解码和 protobuf 解码在同一个 TaskPool 任务内顺序执行，不需要嵌套提交 TaskPool。
- 不传递 `GreeterApi.decodeResponse`、`HelloReply.decode` 或其他函数对象作为 TaskPool 的 `...args`。

## 单文件生成布局

单个 proto 的生成顺序建议保持为：

```text
文件头与 imports
enum declarations
message declarations
service decoder type/table
service RPC/API class
```

所有声明继续由同一个 `CodeGeneratorResponse.File` 输出。外部 TaskPool 包装器是消费者代码，不属于 protoc 生成产物。

## 实施步骤

### 1. Runtime 契约

- 在 runtime 中导出 `ProtoBytes`。
- 将现有 `ProtoMessage` 改为 `extends lang.ISendable` 的基础 wire 接口。
- 新增 `ProtoJsonMessage extends ProtoMessage`。
- 新增并导出 `RpcClient<Context>` 泛型接口。
- 更新 `runtime/Index.ets` 导出。
- 更新 JSON visitor、`ProtoJson`、WKT/Any registry 和 runtime 测试中的接口类型。
- 将测试辅助 message 标记为 `@Sendable` 并实现 `ProtoJsonMessage`。

主要文件：

- `runtime/src/main/ets/visitor/ProtoVisitor.ets`
- `runtime/src/main/ets/rpc/RpcClient.ets`
- `runtime/src/main/ets/json/ProtoJson.ets`
- `runtime/src/main/ets/json/JsonEncodingVisitor.ets`
- `runtime/src/main/ets/json/wkt/ProtoJsonAnyRegistry.ets`
- `runtime/Index.ets`
- `runtime/src/test/ProtoJson.test.ets`

### 2. ArrayBuffer 解码链路

- 生成的 `decode()` 和 `mergeFrom()` 接受 `ProtoBytes`。
- `ArrayBuffer` 分支调用 `ProtoReader.fromBuffer()`。
- service decoder、Any decoder 等二进制 decoder 类型同步使用 `ProtoBytes`。
- 修改示例，直接执行 `Profile.decode(profile.encodeBuffer())`。
- 保留嵌套 message 的 `readSlice()` 零拷贝路径。

主要文件：

- `generator/src/rendering/message-renderer.ts`
- `generator/src/rendering/service-renderer.ts`
- `generator/src/rendering/file-renderer.ts`
- `runtime/src/main/ets/json/wkt/ProtoJsonAnyRegistry.ets`
- `entry/src/main/ets/pages/Index.ets`

### 3. Service 静态边界

- 扩展 `ArkTSServiceRenderer`，在原有表之后生成 service API/RPC 类和 `static decodeResponse()`。
- 为 service 类生成 `RpcClient<Context>` 字段、构造函数和每个 unary RPC 的强类型实例方法。
- 使用 `ServiceModel.fullName` 生成 `SERVICE_NAME`。
- 统一未知 method 的诊断文本。
- 确保跨文件响应类型仍正确 import。
- 仅在文件含 service 时规划并生成 `RpcClient` runtime import。
- 保持一个 proto 对应一个生成文件。
- streaming 方法本轮不生成调用方法，也不进入 unary 响应解码表。

主要文件：

- `generator/src/model/symbols.ts`
- `generator/src/model/descriptor-model.ts`
- `generator/src/rendering/service-renderer.ts`
- `generator/src/rendering/file-renderer.ts`

### 4. 示例与文档

- 将 `ConcurrentChecks.ets` 从直接读取公开 Map 改为 import 生成 service 类并调用静态边界。
- 保留一个外部顶级 `@Concurrent` 示例，先做模拟外层解码，再调用 `decodeResponse()`。
- 增加同步调用 `decodeResponse()` 的示例验证。
- 更新架构说明、README 和 changelog，明确生成器不负责 TaskPool 与网络层。
- 重新生成 `entry/src/main/ets/generated/Demo.ets`，不要手改生成结果替代 renderer 修改。

## 测试与验收

### Generator Node 测试

- 所有 message 无论 `json` 开关都实现基础消息接口。
- `json=true` 时实现 JSON 消息接口并生成 JSON 方法。
- `decode()`/`mergeFrom()` 接受 `ProtoBytes`，并生成 `ArrayBuffer` reader 分支。
- service decoder 返回 `ProtoMessage`。
- 每个 service 生成正确的 `SERVICE_NAME` 和 `decodeResponse()`。
- service 类正确注入 `RpcClient<Context>`，每个 unary 方法显式调用匹配的 `invoke<Response>()`。
- request、response 跨 proto 文件时，RPC 方法签名和 decoder 均生成正确 import。
- 同类型多方法、跨文件响应、空响应、未知方法和 streaming 排除均有覆盖。
- 生成结果仍只有原有目标 `.ets` 文件，没有额外 tasks/rpc 文件。
- 更新兼容性 SHA-256 基线前先人工检查生成 diff。

### HarmonyOS 编译与运行验证

- runtime HAR 编译通过。
- entry 应用编译通过。
- `decode(encode())`、`decode(encodeBuffer())` 均往返一致。
- 任意非 4 字节倍数的 `ArrayBuffer` 可直接解码。
- 同步 service 静态边界返回正确具体消息。
- 使用测试 `RpcClient` 调用生成的 service 实例方法时，service/method/request 和返回类型均正确。
- 外部顶级 `@Concurrent` 函数能 import 生成 service 类、执行模拟外层解码并调用静态边界。
- TaskPool 返回的具体 message 保持 `@Sendable` 方法和字段。
- 未知 method 在同步与 TaskPool 路径中都产生包含 service/method 的明确错误。

### 回归命令

```sh
cd generator
npm test
```

随后使用项目既有 HarmonyOS 构建方式编译 runtime 与 entry，并在设备或模拟器执行 entry 中的并发检查。新会话开始实施前应先确认工作树状态，避免覆盖用户的并行修改。

## 兼容性与版本

- `ProtoMessage` 从 JSON 专用接口改为所有消息的基础 wire 接口，属于公开契约调整。
- JSON 消费者需要改用 `ProtoJsonMessage`，自定义实现类需要同步迁移。
- 新生成代码依赖 runtime 提供 `ProtoBytes`、`ProtoMessage` 和 `ProtoJsonMessage`，生成器与 runtime 版本必须同步提升。
- 新生成的 service API 依赖 runtime 提供 `RpcClient<Context>`，具体 client 实现需要适配该接口。
- 建议实现时评估 generator `0.6.0` 与 runtime `1.1.0`；最终版本号以发布策略为准。
- 现有公开响应解码表先兼容保留，避免在同一版本同时引入不必要的删除性变更。

## 非目标

- 不在本次改造中绑定 RPC、HTTP 或其他网络库。
- 不规定 RPC envelope、压缩、加密、重试、鉴权和错误映射格式。
- 不生成 TaskPool wrapper。
- 不支持 streaming RPC。
- 不把 decoder 回调作为跨线程参数。
- 不为了 RPC 增加 message 实例 `mergeFrom()`。
