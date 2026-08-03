# 变更日志

## 1.0.2 - 2026-08-03

- 更新 npm 生成器与 OHPM runtime 的安装、生成和本地调试说明。
- 修正包元数据中的源码仓库地址。
- runtime 公共 API 与运行时行为保持不变，继续兼容 `protoc-gen-arkts` 0.4.x。

## 1.0.0 - 2026-08-03

- 首次发布到 OpenHarmony 三方库中心仓。
- 提供 `ProtoReader`、`ProtoWriter`、`ProtoWireType` 和 Sendable 容器辅助函数。
- 支持 `protoc-gen-arkts` 0.4.x 生成的代码。
- 最低兼容 HarmonyOS API 12，使用 API 24 SDK 编译。
