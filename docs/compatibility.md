# 兼容性说明

## 当前契约

生成器自 `0.4.x` 起把现有 proto3、nested、repeated、packed、map、oneof、跨文件、跨组 import 和 enum 行为视为稳定契约。
内部重构应保持同一输入、参数与工具链下生成的 `.ets` 逐字节一致。

生成文件依赖 HarmonyOS ArkTS 的 `@Sendable`、`collections.Array`、`collections.Map` 和 `collections.Uint8Array`。runtime 当前最低兼容 API 12，目标 API 24。

runtime HAR 采用独立的 `1.x` 包版本，以符合当前 HarmonyOS 包工具对版本号的校验规则；它与生成器版本不要求数值相同。正式发布后以如下兼容矩阵为准：

| 生成器版本 | runtime 版本     | 最低 API | 说明                                                                        |
| ---------- | ---------------- | -------- | --------------------------------------------------------------------------- |
| `0.4.x`    | `>=1.0.0 <2.0.0` | 12       | 首个稳定 wire API；生成代码仅使用 runtime 1.x 公共导出。                    |
| `0.5.x`    | `>=1.0.3 <2.0.0` | 12       | 生成代码调用 `ProtoReader.readSlice()` 与 `ProtoWriter.finishBuffer()`，最低 runtime 版本提升到 `1.0.3`。 |

生成器新增能力但不改变已生成代码依赖的 runtime API 时，可以独立升级生成器；若生成代码开始调用新的 runtime API，生成器的 CHANGELOG 必须声明最低 runtime版本，并在本表新增一行。
runtime 删除或改变既有公共 API 时必须升级主版本。

## 不在当前契约中的能力

- `proto3 optional` 与 synthetic oneof；
- proto2、Editions、extensions 与 group；
- WKT 专用语义、反射和 `Any` 注册；
- service/rpc API；
- native runtime。

这些能力只有在单独设计、补齐 fixture 和兼容性测试后才会纳入。

## 版本策略

- 修复和不改变输出的内部优化使用补丁版本。
- 新增向后兼容的生成能力使用次版本。
- 修改生成类 API、字段语义或 runtime 公共 API 的不兼容变化使用主版本，并在 `CHANGELOG.md` 中提供迁移说明。
