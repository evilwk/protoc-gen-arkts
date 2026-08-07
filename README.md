# protoc-gen-arkts

`protoc-gen-arkts` 将 proto3 协议文件生成为 HarmonyOS ArkTS 类型，并提供纯 ArkTS runtime。

- [`protoc-gen-arkts`](https://www.npmjs.com/package/protoc-gen-arkts)：`protoc` 生成器插件
- [`protoc-gen-arkts-runtime`](https://ohpm.openharmony.cn/#/cn/detail/protoc-gen-arkts-runtime)：生成代码依赖的 HAR

## 支持范围

- proto3 message、enum 和嵌套类型
- 全部标准标量类型
- singular、repeated、packed/unpacked 字段
- proto3 optional 显式 presence
- map、oneof 和跨文件引用
- Protobuf 二进制编码与解码
- proto3 canonical JSON 编码与解码
- Empty、Wrappers、NullValue、Timestamp、Duration、FieldMask、Struct、Value、ListValue 和 Any
- 按 service 生成响应解码表
- 多协议目录分组和跨组 import

官方 conformance 当前结果：

```text
BinaryAndJson: 1492 通过 / 1314 跳过 / 2 预期失败 / 0 意外失败
TextFormat:    445 跳过
```

1314 项跳过均为 proto2 测试，445 项跳过均为 TextFormat 测试。

## 不支持范围

- proto2
- Editions
- TextFormat
- group 和 extensions
- 解码后保留未知字段并在重新编码时原样写回

由于未知字段不会保留，本项目不适合要求透明转发未知字段的代理或存储中间层。

## 环境要求

- Node.js 22 或更高版本
- `protoc` 已安装并加入 `PATH`
- HarmonyOS API 12 或更高版本

DevEco Studio 内置 Node 版本可能低于生成器要求，执行前请先确认：

```shell
node --version
protoc --version
```

## 安装

全局安装生成器：

```shell
npm install -g protoc-gen-arkts
```

在 HarmonyOS 模块中安装 runtime：

```shell
ohpm install protoc-gen-arkts-runtime
```

也可以将生成器安装为项目开发依赖：

```shell
npm install --save-dev protoc-gen-arkts
```

## 使用

### 生成二进制编解码代码

```shell
mkdir -p entry/src/main/ets/generated
protoc \
  -I proto \
  --arkts_out=entry/src/main/ets/generated \
  proto/greeting.proto
```

项目内安装生成器时，显式指定插件位置：

```shell
protoc \
  -I proto \
  --plugin=protoc-gen-arkts=./node_modules/.bin/protoc-gen-arkts \
  --arkts_out=entry/src/main/ets/generated \
  proto/greeting.proto
```

生成代码固定从 `protoc-gen-arkts-runtime` 导入依赖，请确保 HarmonyOS 模块已经安装同名 ohpm 包。

### 启用 JSON

JSON 默认关闭。使用 `json=true` 生成 `toJson()` 和 `fromJson()`：

```shell
protoc \
  -I proto \
  --arkts_out=json=true:entry/src/main/ets/generated \
  proto/greeting.proto
```

```typescript
const message: Greeting = Greeting.fromJson('{"text":"hello"}');
const json: string = message.toJson();
```

### 使用 Any JSON

Any 的二进制编码与解码不需要注册。使用 Any JSON 前，需要在当前线程注册 `type_url` 可能引用的类型：

```typescript
ProtoJson.registerAnyType("example.Profile", Profile.decode, Profile.fromJson);

ProtoJson.registerAnyCustomType("google.protobuf.Timestamp", Timestamp.decode, Timestamp.fromJson);
```

普通 message 和 Empty 使用 `registerAnyType`；具有特殊 JSON 表示的 WKT 使用 `registerAnyCustomType`。

### 插件参数

参数写在 `--arkts_out=<参数>:<输出目录>` 中，多个参数使用逗号分隔。

| 参数              | 默认值               | 用途                 |
|-----------------|-------------------|--------------------|
| `json`          | `false`           | 生成 proto3 JSON API |
| `output_prefix` | 空                 | 当前协议的输出目录前缀        |
| `dep_root`      | 空                 | 外部依赖协议所在的 `-I` 根目录 |
| `dep_prefix`    | 同 `output_prefix` | 外部依赖协议的输出目录前缀      |

跨协议目录生成示例：

```shell
protoc \
  -I legacy -I v2 \
  --arkts_out=output_prefix=legacy,dep_root=v2,dep_prefix=v2:out \
  legacy/**/*.proto
```

## 许可证

本项目使用 [Apache License 2.0](LICENSE)。
