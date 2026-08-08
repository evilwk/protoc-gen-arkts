# protoc-gen-arkts

面向 HarmonyOS ArkTS 的 `protoc` 生成器插件。

## 支持范围

- proto3 message、enum 和嵌套类型
- 全部标准标量类型
- singular、repeated、packed/unpacked 字段
- proto3 optional 显式 presence
- map、oneof 和跨文件引用
- Protobuf 二进制编码与解码
- 可选生成 proto3 canonical JSON
- Empty、Wrappers、NullValue、Timestamp、Duration、FieldMask、Struct、Value、ListValue 和 Any
- 为 unary service 生成强类型调用类与静态响应解码入口
- 多协议目录分组和跨组 import

## 不支持范围

- proto2
- Editions
- TextFormat
- group 和 extensions
- 解码后保留并重新写出未知字段

## 环境要求

- Node.js 22 或更高版本
- `protoc` 已安装并加入 `PATH`
- 生成代码所在的 HarmonyOS 模块已安装 `protoc-gen-arkts-runtime`

## 安装

全局安装：

```shell
npm install -g protoc-gen-arkts
```

安装为项目开发依赖：

```shell
npm install --save-dev protoc-gen-arkts
```

## 使用

生成二进制编解码代码：

```shell
protoc \
  -I proto \
  --arkts_out=entry/src/main/ets/generated \
  proto/greeting.proto
```

项目内安装时指定插件位置：

```shell
protoc \
  -I proto \
  --plugin=protoc-gen-arkts=./node_modules/.bin/protoc-gen-arkts \
  --arkts_out=entry/src/main/ets/generated \
  proto/greeting.proto
```

启用 JSON：

```shell
protoc \
  -I proto \
  --arkts_out=json=true:entry/src/main/ets/generated \
  proto/greeting.proto
```

插件参数：

| 参数 | 默认值 | 用途 |
| --- | --- | --- |
| `json` | `false` | 生成 proto3 JSON API |
| `output_prefix` | 空 | 当前协议的输出目录前缀 |
| `dep_root` | 空 | 外部依赖协议所在的 `-I` 根目录 |
| `dep_prefix` | 同 `output_prefix` | 外部依赖协议的输出目录前缀 |

完整使用说明见[项目 README](https://github.com/evilwk/protoc-gen-arkts)。

## 许可证

[Apache License 2.0](https://github.com/evilwk/protoc-gen-arkts/blob/main/LICENSE)
