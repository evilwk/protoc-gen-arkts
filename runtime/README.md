# protoc-gen-arkts-runtime

`protoc-gen-arkts` 生成代码使用的纯 ArkTS Protobuf wire runtime。它提供 Protobuf 二进制读写、未知字段跳过，以及生成代码所需的 Sendable 容器辅助函数，不依赖 Native 库。

## 环境要求

- HarmonyOS API 12 或更高版本
- Stage 模型工程
- 当前包使用 HarmonyOS SDK API 24 编译，最低兼容 API 12

## 安装

在应用或 HAR 模块目录执行：

```shell
ohpm install protoc-gen-arkts-runtime
```

也可以在 `oh-package.json5` 中添加：

```json5
{
  dependencies: {
    "protoc-gen-arkts-runtime": "^1.0.3",
  },
}
```

调试本地构建的 release HAR 时，也可以使用文件依赖：

```json5
{
  dependencies: {
    "protoc-gen-arkts-runtime": "file:../runtime.har",
  },
}
```

依赖键、包内 `name` 和源码中的 import 必须完全一致：

```typescript
import { ProtoReader, ProtoWireType, ProtoWriter } from "protoc-gen-arkts-runtime";
```

生成器默认就按这个包名导入 runtime，因此依赖键保持默认时无需额外传参：

```shell
npm install -g protoc-gen-arkts
protoc --arkts_out=entry/src/main/ets/generated your.proto
```

若改用了其他依赖键，用 `runtime_import` 把同一名字传给生成器。

## 公共 API

`Index.ets` 只导出以下稳定接口：

| API                | 用途                                                                                                            |
| ------------------ | --------------------------------------------------------------------------------------------------------------- |
| `ProtoWireType`    | Protobuf wire type 常量                                                                                         |
| `ProtoWriter`      | 编码标量、tag 和 length-delimited 数据；`finish()` 返回 Sendable bytes，`finishBuffer()` 返回原生 `ArrayBuffer` |
| `ProtoReader`      | 解码标量、tag 和跳过未知字段；构造函数接受原生或 Sendable bytes，`fromBuffer()` 直接读原生 `ArrayBuffer`        |
| `appendProtoValue` | 向 Sendable Array 添加值                                                                                        |
| `setProtoMapValue` | 写入 Sendable Map                                                                                               |
| `getProtoMapKeys`  | 获取 Sendable Map 的确定性 key 快照                                                                             |
| `getProtoMapValue` | 读取 Sendable Map                                                                                               |

完整生成器用法、能力边界和兼容关系见 [项目主页](https://github.com/evilwk/protoc-gen-arkts)。

## 许可证

本包以 Apache License 2.0 开源，详见 [LICENSE](LICENSE)。
