# 变更日志

## 1.0.3 - 2026-08-08

- 新增 proto3 canonical JSON 编解码运行时（`JsonReader`、`JsonWriter`、`JsonEncodingVisitor`、`JsonSupport`），支撑生成代码的 `toJson()`/`fromJson()`。
- 新增 Well-known types 的 canonical JSON 表示与 Any 类型注册表（`runtime/json/wkt/`），供 `ProtoJson.registerAnyType()` / `registerAnyCustomType()` 使用。
- 将基础 wire 契约 `ProtoMessage` 与 JSON 契约 `ProtoJsonMessage` 分离；所有生成 message 实现 `ProtoMessage`，启用 JSON 时额外实现 `ProtoJsonMessage`。
- 新增统一输入类型 `ProtoBytes`，覆盖原生 `Uint8Array`、`collections.Uint8Array` 与 `ArrayBuffer`。
- 支持原生内存直连：新增 `ProtoReader.fromBuffer(ArrayBuffer)` 与 `ProtoWriter.finishBuffer(): ArrayBuffer`，可直接对接 RCP 等网络栈返回的原生 `ArrayBuffer`，无需拷贝；嵌套 message、map entry 与 packed 字段的递归解码改用共享底层内存的视图（`readSlice()`）。
- 新增协议无关的 `RpcClient` 接口，供生成的 unary service 调用类使用。
- 修正 wire 层与 protobuf 规范的偏离（由官方 conformance 套件发现）：`readUInt32`/`readSInt32` 按规范截断超长 varint、拒绝 overlong tag、`readVarint` 增加编码长度上限。
- varint 解码增加 32 位快路径，writer 热路径不再分配 `BigInt`。
- 生成器 `0.5.x` 生成的代码需要该版本或更高。

## 1.0.2 - 2026-08-03

- 更新 npm 生成器与 OHPM runtime 的安装、生成和本地调试说明。
- 修正包元数据中的源码仓库地址。
- runtime 公共 API 与运行时行为保持不变，继续兼容 `protoc-gen-arkts` 0.4.x。

## 1.0.0 - 2026-08-03

- 首次发布到 OpenHarmony 三方库中心仓。
- 提供 `ProtoReader`、`ProtoWriter`、`ProtoWireType` 和 Sendable 容器辅助函数。
- 支持 `protoc-gen-arkts` 0.4.x 生成的代码。
- 最低兼容 HarmonyOS API 12，使用 API 24 SDK 编译。
