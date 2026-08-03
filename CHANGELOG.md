# 变更日志

本项目按版本记录面向使用者的变化。

## 0.4.0 - 2026-08-03

- 首次以独立 GitHub 仓库形式开源。
- 提供 `protoc-gen-arkts` Node.js CLI 和纯 ArkTS HAR runtime。
- 生成器版本为 `0.4.0`；HAR 使用 HarmonyOS 包工具可接受的初始版本 `1.0.0`。
- 支持 proto3 message、enum、nested、repeated、packed、map、oneof、跨文件与跨组 import。
- 将生成流程重构为 DescriptorModel、ArkTSFileRenderer、ArkTSMessageRenderer、FieldCodecRenderer 与 FieldModelResolver 等明确职责。
- 补充模型、参数、渲染、CLI 集成和生成结果兼容性测试。
- 将 protobuf.js 更新到 `7.6.5`，避开已公开的旧版本安全问题。
