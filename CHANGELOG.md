# 变更日志

本项目按版本记录面向使用者的变化。

## 0.5.0 - 2026-08-08

- 新增 proto3 canonical JSON 编解码：`json=true` 时为每个 message 生成 `toJson()` 与 `fromJson()`。
- 新增 proto3 optional 显式 presence 支持。
- 新增 Well-known types 专用支持：Empty、Wrappers、NullValue、Timestamp、Duration、FieldMask、Struct、Value、ListValue 与 Any。
  其中 Any 二进制编解码无需注册；Any JSON 需通过 `ProtoJson.registerAnyType()` / `registerAnyCustomType()` 注册可能引用的类型。
- 为每个含 unary 方法的 `service` 生成强类型调用类、实例方法与静态 `decodeResponse()`；调用层协议无关，不绑定网络与 TaskPool。
- 支持原生内存直连：新增 `encodeBuffer(): ArrayBuffer`，`decode`/`mergeFrom` 放宽为接受 `Uint8Array`/`ArrayBuffer`，可直接与 RCP 等网络栈交换请求体，无需往返拷贝 Sendable 容器。
- 插件参数重命名（破坏性）：`group_prefix`/`other_group_prefix`/`other_group_files` → `output_prefix`/`dep_root`/`dep_prefix`，外部依赖清单改为遍历 `-I` 根目录得出，不再需要手写分号分隔的文件清单；旧参数名不再识别。
- 接入 protobuf 官方 conformance 套件，并据此修正 wire 层与规范的偏离（如非 packed 声明的 repeated 字段同时接受 packed 输入）。
- varint 解码增加 32 位快路径，writer 热路径不再分配 `BigInt`。
- **最低 runtime 版本提升到 `1.0.3`**，升级生成器时必须同时升级 runtime。

## 0.4.0 - 2026-08-03

- 首次以独立 GitHub 仓库形式开源。
- 提供 `protoc-gen-arkts` Node.js CLI 和纯 ArkTS HAR runtime。
- 生成器版本为 `0.4.0`；HAR 使用 HarmonyOS 包工具可接受的初始版本 `1.0.0`。
- 支持 proto3 message、enum、nested、repeated、packed、map、oneof、跨文件与跨组 import。
- 将生成流程重构为 DescriptorModel、ArkTSFileRenderer、ArkTSMessageRenderer、FieldCodecRenderer 与 FieldModelResolver 等明确职责。
- 补充模型、参数、渲染、CLI 集成和生成结果兼容性测试。
- 将 protobuf.js 更新到 `7.6.5`，避开已公开的旧版本安全问题。
