# 变更日志

## 1.0.3 - 2026-08-04

- `ProtoReader` 内部改用原生 `Uint8Array` 存储输入，构造函数放宽为接受 `Uint8Array | collections.Uint8Array`。
  原生输入零拷贝直接使用；`collections.Uint8Array` 输入拷贝一次转为原生，现有调用无需修改。
- 新增 `ProtoReader.fromBuffer(buffer: ArrayBuffer)`，可直接从网络栈（如 RCP）返回的原生 `ArrayBuffer` 构造 reader，不复制数据。
  该路径也不受 `collections.Uint8Array` 构造函数「字节数须为 4 的整数倍」约束的限制。
- 新增 `ProtoReader.readSlice(): Uint8Array`，通过 `subarray` 返回共享底层内存的视图，供嵌套 message、map entry 和 packed 字段递归解码使用。
- 新增 `ProtoWriter.finishBuffer(): ArrayBuffer`，返回原生 `ArrayBuffer`，可直接作为 RCP 等网络接口的请求体。
  原先只能通过 `finish()` 得到 Sendable bytes，调用方再逐字节拷回原生，共两次拷贝；该接口降为一次
  （底层缓冲区按 2 倍扩容，必须截取到实际写入长度，无法完全避免）。
- `readBytes()` 改为一次批量构造 `collections.Uint8Array`，替换原先逐字节的 JS 下标写入。
  拷贝次数不变（Sendable 容器与原生内存之间无视图转换），但减少了 JS 层的逐元素操作。
- `readBytes()` 行为与返回类型不变，继续返回 `collections.Uint8Array`，供生成代码写入 bytes 字段。
- 本版本只新增和放宽公共 API，未删除或收紧任何既有接口。生成器 `0.5.x` 生成的代码需要该版本或更高。

## 1.0.2 - 2026-08-03

- 更新 npm 生成器与 OHPM runtime 的安装、生成和本地调试说明。
- 修正包元数据中的源码仓库地址。
- runtime 公共 API 与运行时行为保持不变，继续兼容 `protoc-gen-arkts` 0.4.x。

## 1.0.0 - 2026-08-03

- 首次发布到 OpenHarmony 三方库中心仓。
- 提供 `ProtoReader`、`ProtoWriter`、`ProtoWireType` 和 Sendable 容器辅助函数。
- 支持 `protoc-gen-arkts` 0.4.x 生成的代码。
- 最低兼容 HarmonyOS API 12，使用 API 24 SDK 编译。
