# Protobuf Conformance 验证

用 Google 官方的 `conformance_test_runner` 黑盒验证本仓库的 wire 实现。

## 为什么要移植

ArkTS 代码跑在 HarmonyOS 的 ArkTS 运行时上，runner 需要的是本地进程。
`port/` 把 `runtime/src/main/ets/ProtoWire.ets` 与生成代码机械转换为可在 Node 上编译运行的 TypeScript，只做替换、不改 wire 逻辑：

| ArkTS                                      | 原生                           |
| ------------------------------------------ | ------------------------------ |
| `collections.Array` / `Map` / `Uint8Array` | 同名原生类型                   |
| `util.TextEncoder().encodeInto()`          | `TextEncoder().encode()`       |
| `util.TextDecoder().decodeToString()`      | `TextDecoder().decode()`       |
| `@Sendable`、`lang.ISendable`              | 去掉 / `object`                |
| `const enum`                               | `enum`（前者不属于可擦除语法） |

因此这里验的是 wire 层的正确性，不是 ArkTS 的 Sendable 语义 —— 后者不参与 wire 格式，由仓库内的 on-device 单测覆盖。

## 目录

```
conformance/
├── scripts/          setup.sh（一次性编 runner）、run.sh（端到端）
├── port/             ArkTS -> 原生的转换规则（transform.mjs）与驱动（index.mjs）
├── src/testee.ts     被测程序：实现 runner 的 stdin/stdout 协议
├── failure-list.txt  已知偏离，runner 据此区分预期失败与意外失败
└── tsconfig.json
```

以下目录由脚本生成，均不入库：`.third_party/`（protobuf 源码与 runner）、
`generated-ets/`（插件产出的 ArkTS）、`native/`（移植后的 TypeScript）、`build/`（编译产物）。

## 用法

```shell
./scripts/setup.sh   # 一次性：拉 protobuf 源码并编译 runner（homebrew 版不带）
./scripts/run.sh     # 生成 -> 移植 -> 编译 -> 验证
```

两个脚本都以 conformance/ 为基准解析相对路径，从任意 cwd 调用都可以。

`ARKTS_CONFORMANCE_TALLY=1` 可让 testee 在 stderr 打出 skip 原因分布，用来确认"跳过"的构成，避免把未实现的特性误当成通过。

## 当前结果

两个套件均 PASSED（含 `--enforce_recommended`）：

| 套件          | 通过 | 跳过 | 预期失败 | 意外失败 |
| ------------- | ---- | ---- | -------- | -------- |
| BinaryAndJson | 705  | 2101 | 2        | 0        |
| TextFormat    | 0    | 445  | 0        | 0        |

跳过的 2101 项构成：proto2 消息类型 1007、非 binary 测试类别 794、非 protobuf 输出格式 300。实跑 707 项中有 199 项是"应当拒绝的畸形输入"。

两项预期失败见 `failure-list.txt`：未知字段不保留。

## 这轮验证发现并修复的缺陷

1. **`readUInt32` / `readSInt32` 越界误报**（runtime）。32 位字段在 wire 上按 64 位 varint 编码，超出部分应按规范截断，而非抛错。sint32 还必须先截断再 zigzag 解码。
2. **overlong tag 未被拒绝**（runtime）。tag 是 32 位值，最长 5 字节；更长的编码即使数值合法也属畸形输入。
3. **非 packed 声明的 repeated 字段不接受 packed 输入**（generator）。
   规范要求 parser 无论字段声明为哪种形态，两种编码都必须接受；编码侧仍按声明。
   为此在字段模型上把"编码形态"`packed` 与"解码形态"`packable` 分开。

前两项修复使意外失败从 15 降到 2，第三项清掉了 14 条 `Recommended` 级告警。
