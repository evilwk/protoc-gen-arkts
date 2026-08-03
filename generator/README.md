# protoc-gen-arkts

`protoc-gen-arkts` 是面向 HarmonyOS 的 `protoc` 插件，把 proto3 message 转换为可在 ArkTS 中使用的 `@Sendable` 类型。

## 安装

需要 Node.js 22 或更高版本，并确保 `protoc` 已加入 `PATH`：

```shell
npm install --save-dev protoc-gen-arkts
```

生成代码还需要在 HarmonyOS 项目中安装 `protoc-gen-arkts-runtime`。

```shell
ohpm install protoc-gen-arkts-runtime
```

## 使用

使用系统安装的 `protoc` 时，显式指定项目内的插件：

```shell
protoc \
  -I proto \
  --plugin=protoc-gen-arkts=./node_modules/.bin/protoc-gen-arkts \
  --arkts_out=runtime_import=protoc-gen-arkts-runtime:entry/src/main/ets/generated \
  proto/greeting.proto
```

支持的生成参数、兼容性说明和开发文档见[项目仓库](https://github.com/evilwk/protoc-gen-arkts)。

## 许可证

[Apache License 2.0](https://github.com/evilwk/protoc-gen-arkts/blob/main/LICENSE)
