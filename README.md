# protoc-gen-arkts

`protoc-gen-arkts` 把 `proto3` 协议文件转换为可在 ArkTS 中使用的 `@Sendable` 类型，并提供不依赖 Native 库的纯 ArkTS wire runtime。

- [`protoc-gen-arkts`](https://www.npmjs.com/package/protoc-gen-arkts)（npm，`protoc` 插件）
- [`protoc-gen-arkts-runtime`](https://ohpm.openharmony.cn/#/cn/detail/protoc-gen-arkts-runtime)（ohpm，生成代码依赖的 HAR）

## 能力范围

- `proto3` message、enum 与嵌套类型
- 全部标准标量类型
- singular、repeated、packed/unpacked 字段
- map 字段、oneof presence 与跨文件引用
- 多协议来源分组和跨组 import
- 未知字段跳过、message merge 与确定性 map 编码
- 按 `service` 生成响应解码表，用于跨 `@Concurrent` 边界按方法名分发解码
- 与原生内存直连：
  - `decode`/`mergeFrom` 接受 `Uint8Array | collections.Uint8Array`，可直接传入 RCP 等网络栈返回的 `ArrayBuffer` 视图；
  - `encodeBuffer()` 直接产出 `ArrayBuffer` 作为请求体，无需在 Sendable 容器与原生内存之间来回拷贝。

暂不支持 `proto3 optional`、proto2、Editions、group、extensions 以及 `Any` 等 WKT 的专用 API。

## 环境要求

- Node.js 22 或更高版本
- 安装 `protoc`，并确保命令已加入 `PATH`
- 仓库当前以 API 12 为最低兼容版本、API 24 为目标版本

> 注意：DevEco Studio 自带 Node 环境，版本低于生成器要求，IDE 内置终端会优先使用自带 Node。

## 快速开始

### 安装生成器

推荐全局安装。`protoc` 会在 `PATH` 中查找 `protoc-gen-<name>` 形式的可执行文件，全局安装后无需再向 `protoc` 显式指定插件路径：

```shell
npm install -g protoc-gen-arkts
protoc-gen-arkts --version
```

也可以考虑在协议模块和项目中，通过 node 工程环境去使用：

```shell
cd <protocol-module-dir>
npm init -y
npm install --save-dev protoc-gen-arkts
```

这种方式下调用 `protoc` 时需要补一个 `--plugin=protoc-gen-arkts=./node_modules/.bin/protoc-gen-arkts`。
如果在 `package.json` 中的 `scripts` 配置 protoc 任务，同样可以省略插件位置参数。

### 安装 runtime

在 HarmonyOS 应用或 HAR 模块目录安装生成代码依赖的 runtime：

```shell
ohpm install protoc-gen-arkts-runtime
```

也可以直接在该模块的 `oh-package.json5` 中声明：

```json5
{
  dependencies: {
    "protoc-gen-arkts-runtime": "^1.0.3",
  },
}
```

### 生成代码

假设项目中存在 `proto/greeting.proto`，全局安装生成器后可以执行：

```shell
mkdir -p entry/src/main/ets/generated
protoc -I proto --arkts_out=entry/src/main/ets/generated greeting.proto
```

`runtime_import` 的默认值就是 ohpm 包名 `protoc-gen-arkts-runtime`，按上面的方式安装 runtime 时无需传这个参数。

只有改用其他依赖名，或把 runtime 源码直接纳入项目时才需要显式传入 —— 后者复制 `runtime/src/main/ets/ProtoWire.ets`，再把 `runtime_import` 设为生成文件到该文件的相对路径（以 `.` 开头）：

```shell
protoc \
  -I proto \
  --arkts_out=runtime_import=./ProtoWire:entry/src/main/ets/generated \
  greeting.proto
```

取值必须与 `oh-package.json5` 中的依赖键或实际相对路径完全一致。

### 生成结果

以 `entry/proto/demo.proto` 中的 `Profile` 为例：

```protobuf
message Profile {
  string nickname = 1;
  int32 age = 2;
}
```

生成的 `@Sendable` 类以字段默认值初始化，并暴露四个编解码入口：

```typescript
@Sendable
export class Profile {
  nickname: string = "";
  age: number = 0;

  encode(): collections.Uint8Array;
  encodeBuffer(): ArrayBuffer;
  static decode(bytes: Uint8Array | collections.Uint8Array): Profile;
  static mergeFrom(bytes: Uint8Array | collections.Uint8Array, message: Profile): Profile;
}
```

- `repeated` 与 `map` 字段使用 `collections.Array`／`collections.Map`，`bytes` 使用 `collections.Uint8Array`；
- `oneof` 成员为私有字段，通过生成的 `getXxxCase()`、`hasXxx()`、`getXxx()`、`setXxx()` 访问。

## 响应解码表

每个 `service` 会生成一张以 rpc 方法名为键的响应解码表：

```typescript
type DemoServiceRspDecoder = (bytes: Uint8Array | collections.Uint8Array) => lang.ISendable;

export const DEMO_SERVICE_RSP_DECODERS: Map<string, DemoServiceRspDecoder>;
```

它只为跨 `@Concurrent` 边界的解码而存在。类与函数都不是 Sendable，传不进子线程，

因此跨线程只能传方法名，由子线程侧查表拿到 `decode`：

```typescript
// 独立文件，不能直接或间接引入 UI 装饰器
@Concurrent
export function decodeInTask(methodName: string, bytes: collections.Uint8Array): lang.ISendable {
  const decoder = DEMO_SERVICE_RSP_DECODERS.get(methodName);
  if (decoder === undefined) {
    throw new Error(`未登记的方法 ${methodName}`);
  }
  return decoder(bytes);
}
```

调用侧按大小决定是否让出 UI 线程。protobuf 解码是纯 CPU 计算，没有可等待的 I/O，小消息直接在主线程同步解更快。

```typescript
const profile: Profile =
  body.length < THRESHOLD
    ? Profile.decode(body)
    : ((await taskpool.execute(decodeInTask, "GetProfile", body)) as Profile);
```

## 插件参数

参数写在 `--arkts_out=<参数>:<输出目录>` 的冒号前，多个参数以逗号分隔：

| 参数             | 默认值                     | 用途                                                                    |
| ---------------- | -------------------------- | ----------------------------------------------------------------------- |
| `runtime_import` | `protoc-gen-arkts-runtime` | 生成代码中导入 runtime 的模块名（ohpm 依赖）或相对路径（vendored 源码） |
| `output_prefix`  | 空                         | 本次生成文件的输出目录前缀                                              |
| `dep_root`       | 空                         | 依赖协议所在的 `-I` 根目录，插件遍历其内容                              |
| `dep_prefix`     | 同 `output_prefix`         | 依赖协议的输出目录前缀，用于计算 import                                 |

`output_prefix` 与 `dep_prefix` 只是输出目录前缀，协议自身的嵌套目录会追加在其后。

`dep_root` 必须正好是 `protoc` 的某个 `-I` 根目录，插件按该目录遍历出的相对路径与`proto_file` 中的逻辑路径对齐。
未声明 `dep_root` 时视为没有外部依赖；此时若仍有被`import` 但未生成的文件，插件会报错而不是产出无法编译的 `import`。

要生成的文件可以直接用通配符传给 `protoc`，依赖由 `dep_root` 自动收集：

```shell
protoc \
  -I legacy -I v2 \
  --arkts_out=output_prefix=legacy,dep_root=v2,dep_prefix=v2:out \
  legacy/**/*.proto
```

两个来源互相引用时仍需分两次调用 `protoc`，第二次把 `output_prefix` 与 `dep_root`／`dep_prefix` 对调。详细约束与数据流见 [架构说明](docs/architecture.md)。

## 仓库结构

```text
entry/           示例应用，同时验证本地 HAR 消费与生成代码编解码
runtime/         生成代码依赖的纯 ArkTS HAR
generator/       独立 Node.js protoc 插件、fixture 与测试
scripts/         示例生成脚本
docs/            架构、兼容性与维护说明
```

## 开发与验证

从源码参与开发时，再克隆仓库并安装生成器依赖：

```shell
git clone git@github.com:evilwk/protoc-gen-arkts.git
cd protoc-gen-arkts/generator
npm ci
npm test

cd ..
node scripts/generate-entry.mjs

devecocli build --modules runtime
devecocli build --modules entry
```

`npm test` 包含模型、参数、渲染、CLI 集成测试以及生成源码的 SHA-256 兼容性基线。提交前还应确认重新生成 `entry` 示例后 `git diff` 为空。

## 路线图

1. 保持现有合法输入生成结果稳定，继续加固模型与诊断。
2. 单独设计 `proto3 optional` 的 presence 与 synthetic oneof 行为。
3. 调研 Timestamp、Duration、Wrappers 等 WKT。
4. service/rpc 使用独立 protoc 插件实现。

## 参与贡献

问题反馈与代码贡献见 [贡献指南](CONTRIBUTING.md)，安全问题见 [安全策略](SECURITY.md)。

## 许可证

项目以 [Apache License 2.0](LICENSE) 开源。
