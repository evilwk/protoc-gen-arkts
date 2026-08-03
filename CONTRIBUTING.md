# 贡献指南

感谢你愿意改进 `protoc-gen-arkts`。项目优先保证生成结果稳定、错误信息可追踪，并保持生成器与 runtime 的职责边界清晰。

## 提交问题

请尽量提供：

- 使用的 `protoc`、Node.js、HarmonyOS SDK 版本；
- 可最小复现的 `.proto`；
- 完整生成命令；
- 实际结果与预期结果；
- 如果是 runtime 问题，附上 ArkTS 编译错误或最小调用代码。

请勿在公开 issue 中提交密钥、内部协议或其他敏感数据。

## 本地开发

```shell
cd generator
npm ci
npm test

cd ..
node examples/basic/generate.mjs
devecocli build --modules runtime
devecocli build --modules entry
git diff --check
git status --short
```

生成器测试依赖系统中的 `protoc`。HarmonyOS runtime 构建依赖本地可用的 HarmonyOS SDK 和 `devecocli`。

## 变更原则

- 修复或重构不得无意改变合法输入的 `.ets` 输出；需要变化时必须说明兼容影响，更新测试基线和 `CHANGELOG.md`。
- 新增 Protobuf 能力前先明确 presence、默认值、未知字段和兼容性语义。
- message codec 与 service/rpc 传输层保持分离。
- 新诊断应包含 `proto 文件 → message/enum → field` 上下文，并保持确定性排序。
- 中文是本仓库文档和代码注释的默认语言。

## Pull Request

PR 请保持主题单一，并在描述中列出验证命令。涉及生成输出时，同时提交可复现的 fixture、断言和生成结果；不要提交 `node_modules`、`oh_modules`、`dist`、HAR 或其他本机构建产物。
