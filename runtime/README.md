# protoc-gen-arkts-runtime

`protoc-gen-arkts` 生成代码依赖的纯 ArkTS runtime。

## 支持范围

- proto3 二进制编码与解码
- proto3 canonical JSON
- Empty、Wrappers、NullValue、Timestamp、Duration、FieldMask、Struct、Value、ListValue 和 Any
- HarmonyOS Sendable Array、Map 和 bytes
- 原生 `Uint8Array`、`collections.Uint8Array` 与 `ArrayBuffer` 统一解码输入
- `ProtoMessage`、`ProtoJsonMessage` 与协议无关的 `RpcClient` 契约

## 不支持范围

- proto2
- Editions
- TextFormat
- 解码后保留并重新写出未知字段

## 环境要求

- HarmonyOS API 12 或更高版本
- Stage 模型工程

## 安装

在 HarmonyOS 应用或 HAR 模块目录执行：

```shell
ohpm install protoc-gen-arkts-runtime
```

也可以在 `oh-package.json5` 中声明：

```json5
{
  dependencies: {
    "protoc-gen-arkts-runtime": "^1.0.3",
  },
}
```

生成代码固定从 `protoc-gen-arkts-runtime` 导入 runtime，依赖名称请保持一致。

## 使用

通常只需调用生成类提供的方法：

```typescript
const message: Greeting = Greeting.decode(bytes);
const bytes: collections.Uint8Array = message.encode();
```

启用生成器的 `json=true` 后可以使用 JSON：

```typescript
const message: Greeting = Greeting.fromJson('{"text":"hello"}');
const json: string = message.toJson();
```

Any 的二进制编码与解码不需要注册。使用 Any JSON 前，在当前线程注册可能出现的类型：

```typescript
ProtoJson.registerAnyType(
  'example.Profile',
  Profile.decode,
  Profile.fromJson
);
```

完整生成和使用说明见 [项目 README](https://github.com/evilwk/protoc-gen-arkts)。

## 许可证

[Apache License 2.0](https://github.com/evilwk/protoc-gen-arkts/blob/main/LICENSE)
