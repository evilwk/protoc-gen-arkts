# protoc-gen-arkts

`protoc-gen-arkts` 把 `proto3` 描述文件转换为可在 ArkTS 中使用的 `@Sendable` 类型，并提供不依赖 Native 库的纯 ArkTS wire runtime。

## 能力范围

- `proto3` message、enum 与嵌套类型
- 全部标准标量类型
- singular、repeated、packed/unpacked 字段
- map 字段、oneof presence 与跨文件引用
- 多协议来源分组和跨组 import
- 未知字段跳过、message merge 与确定性 map 编码

暂不支持 `proto3 optional`、proto2、Editions、group、extensions、service/rpc 代码生成以及 `Any` 等 WKT 的专用 API。

## 环境要求

- Node.js 22 或更高版本
- `protoc`，并确保命令已加入 `PATH`
- 使用 runtime 时需要 HarmonyOS SDK；仓库当前以 API 12 为最低兼容版本、API 24 为目标版本

## 快速开始

在项目中安装生成器：

```shell
npm install --save-dev protoc-gen-arkts
```

在 HarmonyOS 应用或 HAR 模块目录安装生成代码依赖的 runtime：

```shell
ohpm install protoc-gen-arkts-runtime
```

也可以直接在该模块的 `oh-package.json5` 中声明：

```json5
{
  dependencies: {
    "protoc-gen-arkts-runtime": "^1.0.2",
  },
}
```

假设项目中存在 `proto/greeting.proto`，可以执行：

```shell
mkdir -p entry/src/main/ets/generated
protoc \
  -I proto \
  --plugin=protoc-gen-arkts=./node_modules/.bin/protoc-gen-arkts \
  --arkts_out=runtime_import=protoc-gen-arkts-runtime:entry/src/main/ets/generated \
  greeting.proto
```

`runtime_import` 必须和依赖名一致。如需将 runtime 源码直接纳入项目，也可以复制 `runtime/src/main/ets/ProtoWire.ets`，再将 `runtime_import` 设置为生成文件到该文件的相对路径。

完整可运行的生成命令见 [基础示例](examples/basic/README.md)。

## 插件参数

参数写在 `--arkts_out=<参数>:<输出目录>` 的冒号前，多个参数以逗号分隔：

| 参数                 | 默认值        | 用途                                    |
| -------------------- | ------------- | --------------------------------------- |
| `runtime_import`     | `./ProtoWire` | 生成代码导入 runtime 的模块名或相对路径 |
| `group_prefix`       | 空            | 当前协议来源的输出目录前缀              |
| `other_group_prefix` | 空            | 另一个协议来源的输出目录前缀            |
| `other_group_files`  | 空            | 另一个来源的 proto 文件清单，以分号分隔 |

跨组生成需要分两次调用 `protoc`。详细约束与数据流见 [架构说明](docs/architecture.md)。

## 仓库结构

```text
entry/           本地 HAR 消费验证应用
runtime/         生成代码依赖的纯 ArkTS HAR
generator/       独立 Node.js protoc 插件、fixture 与测试
examples/basic/  最小 proto 和已锁定的生成结果
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
node examples/basic/generate.mjs

devecocli build --modules runtime
devecocli build --modules entry
```

`npm test` 包含模型、参数、渲染、CLI 集成测试以及生成源码的 SHA-256 兼容性基线。提交前还应确认重新生成示例后 `git diff` 为空。

## 路线图

1. 保持现有合法输入生成结果稳定，继续加固模型与诊断。
2. 单独设计 `proto3 optional` 的 presence 与 synthetic oneof 行为。
3. 调研 Timestamp、Duration、Wrappers 等 WKT。
4. service/rpc 使用独立 protoc 插件实现。

## 参与贡献

问题反馈与代码贡献见 [贡献指南](CONTRIBUTING.md)，安全问题见 [安全策略](SECURITY.md)。

## 许可证

项目以 [Apache License 2.0](LICENSE) 开源。
