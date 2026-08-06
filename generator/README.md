# protoc-gen-arkts

`protoc-gen-arkts` 是面向 HarmonyOS 的 `protoc` 插件，把 proto3 message 转换为可在 ArkTS 中使用的 `@Sendable` 类型。生成代码依赖纯 ArkTS 的 wire runtime，不需要 Native 库。

## 能力范围

- proto3 message、enum 与嵌套类型，以及全部标准标量类型
- singular、repeated、packed/unpacked 字段
- map 字段、oneof presence 与跨文件、跨组 import
- 未知字段跳过、message merge 与确定性 map 编码
- 按 `service` 生成响应解码表，用于跨 `@Concurrent` 边界按方法名分发解码
- 与原生内存直连：`decode`/`mergeFrom` 接受 `Uint8Array | collections.Uint8Array`，`encodeBuffer()` 直接产出 `ArrayBuffer`

`service` 只生成响应解码表，不生成请求编码、URL 映射或传输封装。

暂不支持 `proto3 optional`、proto2、Editions、group、extensions 以及 `Any` 等 WKT 的专用 API。

## 安装

需要 Node.js 22 或更高版本，并确保 `protoc` 已加入 `PATH`。

> DevEco Studio 自带一份 Node（当前为 v18），版本低于本插件要求，且其内置终端会优先使用这份 Node。请在系统终端中安装和执行生成器，先用 `node --version` 确认拿到的是 22 以上的版本。

推荐全局安装 —— `protoc` 会在 `PATH` 中查找 `protoc-gen-<name>` 形式的可执行文件，因此不必再向 `protoc` 显式指定插件路径：

```shell
npm install -g protoc-gen-arkts
protoc-gen-arkts --version
```

HarmonyOS 工程目录默认没有 `package.json`，若希望把生成器锁进协议模块，先初始化 npm 环境：

```shell
npm init -y
npm install --save-dev protoc-gen-arkts
```

生成代码还需要在 HarmonyOS 应用或 HAR 模块中安装 runtime：

```shell
ohpm install protoc-gen-arkts-runtime
```

## 使用

全局安装后：

```shell
protoc -I proto --arkts_out=entry/src/main/ets/generated greeting.proto
```

项目内安装时插件不在 `PATH` 上，需要显式指定（写进 `package.json` 的 `scripts` 并用 `npm run` 执行时可省略）：

```shell
protoc \
  -I proto \
  --plugin=protoc-gen-arkts=./node_modules/.bin/protoc-gen-arkts \
  --arkts_out=entry/src/main/ets/generated \
  greeting.proto
```

生成代码默认按 ohpm 包名 `protoc-gen-arkts-runtime` 导入 runtime。改用其他依赖名，或把 runtime 源码复制进项目时，用 `runtime_import` 指定模块名或相对路径，取值须与 `oh-package.json5` 的依赖键或实际路径一致。

## 版本对应

生成代码调用 runtime 的公共 API，两者版本需要匹配：

| 生成器版本 | runtime 版本     |
| ---------- | ---------------- |
| `0.4.x`    | `>=1.0.0 <2.0.0` |
| `0.5.x`    | `>=1.0.3 <2.0.0` |

升级生成器时请一并检查 runtime 版本。完整矩阵见[兼容性说明](https://github.com/evilwk/protoc-gen-arkts/blob/main/docs/compatibility.md)。

支持的生成参数、生成结果示例和开发文档见[项目仓库](https://github.com/evilwk/protoc-gen-arkts)。

## 许可证

[Apache License 2.0](https://github.com/evilwk/protoc-gen-arkts/blob/main/LICENSE)
