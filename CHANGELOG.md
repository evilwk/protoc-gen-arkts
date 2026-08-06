# 变更日志

本项目按版本记录面向使用者的变化。

## 0.5.0 - 2026-08-04

- 为每个 `service` 生成响应解码表，键为 rpc 方法名，值为响应类型的 `decode`。
- 生成的 `decode`/`mergeFrom` 签名放宽为 `Uint8Array | collections.Uint8Array`，
  可直接接收网络栈（如 RCP）返回的原生 `ArrayBuffer` 视图，无需先转成 Sendable 容器。
- 嵌套 message、map entry、oneof message 和 packed 字段的递归解码改用 `ProtoReader.readSlice()`，
  通过共享底层内存的视图替换原先每层一次的 `collections.Uint8Array` 分配与逐字节拷贝。
- 新增生成方法 `encodeBuffer(): ArrayBuffer`，可直接作为 RCP 等网络接口的请求体，
  不必先经过 `encode()` 得到 Sendable bytes 再拷回原生。
- 编码逻辑抽取为私有 `writeTo(writer)`，由 `encode()` 与 `encodeBuffer()` 共用，避免生成代码重复一份 encoder 体。
- `bytes` 字段类型保持 `collections.Uint8Array`，继续使用 `readBytes()`；`encode()` 签名与返回类型不变。
  Sendable 容器与原生内存之间不存在视图转换，该字段的读取仍为一次拷贝。
- **最低 runtime 版本提升到 `1.0.3`**（生成代码调用 `readSlice()`）。升级生成器时必须同时升级 runtime。

## 0.4.0 - 2026-08-03

- 首次以独立 GitHub 仓库形式开源。
- 提供 `protoc-gen-arkts` Node.js CLI 和纯 ArkTS HAR runtime。
- 生成器版本为 `0.4.0`；HAR 使用 HarmonyOS 包工具可接受的初始版本 `1.0.0`。
- 支持 proto3 message、enum、nested、repeated、packed、map、oneof、跨文件与跨组 import。
- 将生成流程重构为 DescriptorModel、ArkTSFileRenderer、ArkTSMessageRenderer、FieldCodecRenderer 与 FieldModelResolver 等明确职责。
- 补充模型、参数、渲染、CLI 集成和生成结果兼容性测试。
- 将 protobuf.js 更新到 `7.6.5`，避开已公开的旧版本安全问题。
