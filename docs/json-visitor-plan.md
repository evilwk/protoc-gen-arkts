# Visitor 改造与 JSON 支持规划

本文自包含，不依赖任何会话上下文。目标读者是接手实现的人（可能是新会话）。

## 目标

1. 引入 visitor 模式，把「遍历字段」与「每个字段做什么」解耦
2. 在此基础上支持 proto3 canonical JSON 的读写

## 关键架构事实：visitor 只覆盖出方向

`traverse(visitor)` 的前提是**已有 message 对象可遍历**，所以：

| 方向 | 方案 | 原因 |
| --- | --- | --- |
| 序列化（message → JSON） | visitor | 有对象可遍历 |
| 反序列化（JSON → message） | tokenizer + 逐字段生成 | 对象尚不存在，无从 traverse |

这不是取舍，是模式的固有边界。参考实现 `xiaofenger_705/protobuf-arkts-generator`
也是如此：`runtime/arkpb/` 下只有 `BinaryEncodingVisitor` 与 `JsonEncodingVisitor`，
没有任何 DecodingVisitor，其 `fromJson` 是逐字段生成的。

**不要试图用 visitor 做解析方向**，会走弯路。

## 不改动 binary codec

现有 `writeTo`/`decode` 是 imperative 生成，保持原样：

- 它是 RPC 热路径，visitor 多一层间接调用
- 它已通过 705 项官方 conformance，重写等于拿验证结果换体积

`traverse` 是**纯增量**方法，与 `writeTo` 并存。

### 由此引入的风险与对策

`traverse` 和 `writeTo` 会成为字段结构的两份真相，可能漂移。

对策：两者都由同一个 field model 渲染，漂移只可能来自生成器 bug。
再加一道交叉校验测试——在 conformance harness 里写一个 test-only 的
`BinaryEncodingVisitor`，断言 `message.encode()` 与「`traverse` 走该 visitor
产出的字节」逐字节相等。现有 fixture 全过即可认为无漂移。

## Phase 0：ArkTS 探针（阻塞项，必须先做）

以下构造**未经验证**，后续设计全部依赖它们成立。请在 DevEco 建一个 `.ets`
文件，过编译和 codelinter，再决定设计。

```typescript
import { collections } from '@kit.ArkTS';

// 探针 1：Record 索引写入与读取
// 不合规则 JsonEncodingVisitor 的累加器改为手写字符串拼接。
function probeRecord(): string {
  const bag: Record<string, Object> = {};
  bag['key'] = 42 as Object;
  const back: Object = bag['key'];
  return `${back}`;
}

// 探针 2：@Sendable 类能否实现带方法的自定义接口 —— 最关键的一条
// 不合规则 traverse 无法走接口，visitor 方案需整体重新评估。
interface Probe {
  visitInt32(value: number, fieldNumber: number): void;
}

@Sendable
class ProbeMessage {
  code: number = 0;
  traverse(v: Probe): void {
    v.visitInt32(this.code, 1);
  }
}

// 探针 3：模块级 const Map（enum value→name 用）
// 已有先例：生成的 DEMO_SERVICE_RSP_DECODERS 即模块级 Map，预期可行。
const NAMES: Map<number, string> = new Map<number, string>([[0, 'FOO']]);
```

**探针 2 决定方案是否成立，务必先验。**

## 已验证的规范规则

以下均已用 protobuf v35.1 官方 conformance 套件源码核实，可直接照做，
不需要重新查规范。括号内是 `conformance/binary_json_conformance_suite.cc` 的行号。

| 规则 | 证据 |
| --- | --- |
| int64/uint64 等 64 位整数**发字符串**，解析时字符串与裸数字都接受 | `Int64FieldMaxValue` 发 `"9223372036854775807"`（2457）；`Int64FieldMaxValueNotQuoted` 收裸数字（2472） |
| enum **发名字**，解析时名字与数字都接受 | `EnumField` 发 `{"optionalNestedEnum": "FOO"}`（2757）；`EnumFieldNumericValueZero/NonZero`（2780） |
| NaN/Infinity **发带引号字符串**，裸 `NaN` 必须拒绝 | `"NaN"`/`"Infinity"`/`"-Infinity"` 为 valid（2640-2645）；裸 `NaN` 在拒绝用例（2663） |
| map 一律发**对象**，非 string key 转成字符串；未加引号的 key 拒绝 | `Int32MapField` 发 `{"mapInt32Int32": {"1": 2}}`（2877）；`Int32MapFieldKeyNotQuoted` 拒绝（2881） |
| Timestamp 小数位裁到 0/3/6/9 位 | `.000000000Z` → `00:00:00Z`；`.010000000Z` → `.010Z`（3345-3355，RECOMMENDED 级） |
| 默认值字段省略 | proto3 规则；现有 binary encoder 本来就省略默认值，天然一致 |
| bytes 用标准 base64，解析兼容 url-safe | `Base64Helper` 的 `Type.BASIC` / `BASIC_URL_SAFE` 正好对应 |

### 两个易错点

参考实现 `xiaofenger_705` 在这两处都错了（其文档写 `enum → number`、
`map` 非 string key → `array of {key,value}`），且均为 REQUIRED 级：

- **enum 发名字不是数字**
- **map 永远发对象不是数组**

`readNumberAsBigInt` 必须从 token 原文精确解析，不能过一遍 double，
否则 `"9223372036854775807"` 丢精度，`Int64FieldMaxValue`（REQUIRED）会红。

## 规模基线

当前 conformance 结果（`conformance/scripts/run.sh`）：

```
BinaryAndJson: 705 通过 / 2101 跳过 / 2 预期失败 / 0 意外失败
TextFormat:    445 全跳过
```

JSON 相关的可解锁总量 **1094 项**：`JSON_TEST` 772、
`JSON_IGNORE_UNKNOWN_PARSING_TEST` 22、binary 入 / JSON 出 300。

其中 **121 项是 `ExpectParseFailureForJson`**——正确拒绝畸形输入。
这是入方向的主要工作量，也是 tokenizer 必须手写的核心理由：
需要精确控制拒绝行为（裸 `NaN`、重复 key、未加引号的 map key 等）。

WKT 相关约 75 项（Timestamp 30、Duration 19、Any 15、FieldMask 5、
NullValue 3、Struct 2），**本次不做**，见下节护栏。

## WKT 护栏（重要）

本次不实现 WKT 的 JSON 专用表示。但若某 message 含 WKT 字段而 JSON 已开启，
按普通 message 序列化会产出**违反规范的输出**：

```
实际会输出：{"createdAt": {"seconds": "1700000000", "nanos": 0}}
规范要求：  {"createdAt": "2023-11-14T22:13:20Z"}
```

对端按规范解析会失败，且**失败发生在对端而非本地**，极难排查。

**所以必须在生成阶段直接报错**，不要静默产出错误输出。

判定方式：字段的 `typeName` 是全限定名（形如 `.google.protobuf.Timestamp`），
字符串比对即可，零运行时成本。

先例：generator 已有「依赖未声明时宁可失败也不产出悬空 import」的处理，
`generator/test/plugin.test.js` 有两条用例守着。沿用同样的态度。

WKT 在 binary wire 上**不受影响**，当普通 message 处理，现在就能用。

## 运行时 API 设计

### Visitor 接口

按 ArkTS 的值表示分组，而非 protobuf 的 15 种标量各一个方法。
理由：JSON 真正需要区分的是「能否用 number 表示」「是否 64 位需转字符串」，
protobuf 的具体类型通过参数传递。

```typescript
export const enum ProtoValueKind {
  INT32, UINT32, SINT32, FIXED32, SFIXED32,
  INT64, UINT64, SINT64, FIXED64, SFIXED64,
  FLOAT, DOUBLE, BOOL, STRING, BYTES, ENUM, MESSAGE
}

export interface ProtoVisitor {
  visitNumber(value: number, kind: ProtoValueKind, field: FieldInfo): void;
  visitBigInt(value: bigint, kind: ProtoValueKind, field: FieldInfo): void;
  visitBool(value: boolean, field: FieldInfo): void;
  visitString(value: string, field: FieldInfo): void;
  visitBytes(value: collections.Uint8Array, field: FieldInfo): void;
  visitEnum(value: number, names: Map<number, string>, field: FieldInfo): void;
  beginMessage(field: FieldInfo): void;
  endMessage(field: FieldInfo): void;
  beginRepeated(field: FieldInfo): void;
  endRepeated(field: FieldInfo): void;
  beginMap(field: FieldInfo): void;
  endMap(field: FieldInfo): void;
  mapKey(key: string): void;
}
```

`FieldInfo` 携带 JSON key、字段号、是否 repeated 等：

```typescript
export class FieldInfo {
  readonly number: number;
  readonly jsonName: string;   // 发出时用
  readonly protoName: string;  // 解析时也要接受
}
```

**注意**：不能用生成的 ArkTS 成员名当 JSON key。generator 有关键字冲突改名逻辑
（`plugin.test.js` 有用例），复用会偏离规范。必须生成显式字面量。
`jsonName` 由 protoc 提供，`field-model-resolver.ts:94` 已在消费它。

### JsonReader（入方向，tokenizer）

关键设计是 `peek()` 返回 token 类型，让生成代码在不碰 `any` 的前提下分支：

```typescript
export const enum JsonToken {
  BEGIN_OBJECT, END_OBJECT, BEGIN_ARRAY, END_ARRAY, STRING, NUMBER, BOOL, NULL
}

export class JsonReader {
  peek(): JsonToken;
  beginObject(): void; hasMoreMembers(): boolean; readKey(): string;
  beginArray(): void; hasMoreElements(): boolean;
  readString(): string;
  readNumberAsNumber(): number;
  readNumberAsBigInt(): bigint;  // 从原文精确解析，不过 double
  readBool(): boolean; readNull(): void;
  skipValue(): void;             // ignoreUnknownFields 模式用
}
```

生成代码里 int64 字段的解析长这样，全程强类型：

```typescript
const value: bigint = reader.peek() === JsonToken.STRING
  ? BigInt(reader.readString())
  : reader.readNumberAsBigInt();
```

### 入方向必须处理的语义

- **未知字段**：默认拒绝；`ignoreUnknownFields` 选项开启时调 `skipValue()`
  跳过。conformance 的 `JSON_IGNORE_UNKNOWN_PARSING_TEST`（22 项）走后者，
  所以 `fromJson` 需要一个可选参数控制。
- **重复 key**：拒绝。
- **oneof 冲突**：JSON 里同一 oneof 设了多个成员必须拒绝。binary 是
  last-wins 不报错，所以这条只能在 JSON 层拦——生成代码要带 oneof 分组信息。
- **null**：多数字段视为「未设置」，用默认值；`Value` 类型语义不同（本次不涉及）。
- **字段名**：`jsonName` 与原始 proto 名都要接受。

## 分期

### Phase 0：ArkTS 探针
见上文。**探针 2 不通过则停下重新设计。**

### Phase 1：插件选项 + WKT 护栏
- `generator/src/options.ts`：`KNOWN_OPTIONS` 加 `json`，`parseOptions` 加解析。
  命名保持 snake_case，与 `runtime_import`/`output_prefix` 一致。
- 默认关（opt-in）。理由：生成代码增幅、runtime 固定成本，不用 JSON 的人不该付。
- WKT 护栏：开启 `json` 且 message 含 WKT 字段时生成期报错。
- 测试：护栏的正反用例各一条。

### Phase 2：出方向
- runtime 新增 `ProtoVisitor` 接口、`FieldInfo`、`JsonWriter`、`JsonEncodingVisitor`
- 生成 `traverse(v: ProtoVisitor): void` 与 `toJson(): string`
- 生成 enum 的 value→name 模块级 `Map`
- 交叉校验：test-only `BinaryEncodingVisitor`，断言与 `encode()` 逐字节一致
- **闸门**：conformance 的「binary 入 / JSON 出」300 项应大量转绿

### Phase 3：入方向
- runtime 新增 `JsonReader` tokenizer
- 生成 `static fromJson(text: string, ignoreUnknownFields?: boolean): T`
- 处理未知字段、重复 key、oneof 冲突、null
- **闸门**：`JSON_TEST` 772 + `JSON_IGNORE_UNKNOWN_PARSING_TEST` 22 应大量转绿

建议**先做 Phase 3 的 tokenizer 骨架**再回头做 Phase 2：入方向工作量更大、
风险更高（121 项拒绝用例），且决定 1094 里能过多少。出方向相对确定。

## 需要改动的文件

### 生成器
| 文件 | 改动 |
| --- | --- |
| `src/options.ts` | `KNOWN_OPTIONS` 加 `json`；`parseOptions` 解析 |
| `src/model/plugin.ts` | `PluginOptions` 加 `json: boolean` |
| `src/rendering/field-model-resolver.ts` | 字段模型加 `jsonName`、`protoName`、oneof 分组 |
| `src/rendering/message-renderer.ts` | 渲染 `traverse`/`toJson`/`fromJson` |
| `src/rendering/file-renderer.ts` | `renderEnum`（173 行）旁边加 value→name Map |
| 新增 `src/rendering/json-codec-renderer.ts` | JSON 读写渲染，与 `field-codec-renderer.ts` 并列 |

### 运行时
| 文件 | 改动 |
| --- | --- |
| 新增 `runtime/src/main/ets/ProtoVisitor.ets` | 接口 + `FieldInfo` + `ProtoValueKind` |
| 新增 `runtime/src/main/ets/ProtoJson.ets` | `JsonWriter`/`JsonReader`/`JsonEncodingVisitor` |
| `runtime/Index.ets` | 导出新增类型（当前只导出 `ProtoWire` 的 7 个符号） |
| `runtime/src/test/` | 新增 tokenizer 与 visitor 的 hypium 单测 |

### conformance harness
| 文件 | 改动 |
| --- | --- |
| `conformance/port/index.mjs` | **第 14 行硬编码了 `ProtoWire.ets`**，需改为遍历 runtime 目录 |
| `conformance/src/testee.ts` | 放开 JSON：`requested_output_format === JSON` 时调 `toJson`；`json_payload` 时调 `fromJson`；`JSON_IGNORE_UNKNOWN_PARSING_TEST` 传 `ignoreUnknownFields=true` |
| `conformance/failure-list.txt` | WKT 相关约 75 项加入，附原因 |

`conformance/port/transform.mjs` 的替换规则应该不用改（新 runtime 文件用的是
同一批 ArkTS 构造），但如果 `Record` 探针通过并用了它，确认原生 TS 侧也成立。

## 验证方法

```shell
cd conformance && ./scripts/run.sh   # 端到端：生成 → 移植 → 编译 → 验证
cd generator && npm test             # 36 项，含 SHA-256 基线
```

改了生成器输出后 `generator/test/compatibility.test.js` 的 SHA-256 基线会失败，
这是预期的——确认输出正确后更新基线里的哈希。

runtime 的 hypium 单测需要真机/模拟器，命令行跑不了。但**移植后的原生代码可以
在 Node 上验证同一份逻辑**，这是 harness 的额外用途，写完单测建议顺手交叉核一次
期望值。

新增 fixture 时注意：现有 fixture 无 WKT 字段，护栏用例需要新建一个带
`google.protobuf.Timestamp` 的 proto（可参考 `test/fixture/wkt_probe.proto`）。

## 未解决的问题

1. **Phase 0 的四个探针**，尤其探针 2（`@Sendable` + 自定义接口）。
2. **`Record<string, Object>` 索引访问是否合规。** 间接证据倾向合规：
   `ARKTS-COMPLIANCE.md` 给出的规则号显示 `arkts-no-props-by-index` (10605029)
   只禁普通对象、明确列出 Map/Array/TypedArray 例外，而 `Record` 由规则 63
   单独支持；参考实现也在生成 `Record` 索引读取且未纳入其兼容修复脚本。
   但**没有官方文档原文佐证**，按未定处理。
3. **`Any` 的类型注册表**。本次不做。将来做时注意：可变全局注册表过不了
   `@Concurrent` 边界，需要 Sendable 注册表或按线程注册。参考实现用
   `globalThis.protobuf`，在 ArkTS 下行不通。
4. **性能未量化**。visitor 多一层间接调用，JSON 路径的实际开销没测。
   binary 热路径不受影响（不改 `writeTo`/`decode`）。

## 参考实现

`https://gitcode.com/xiaofenger_705/protobuf-arkts-generator`

可参考：`runtime/arkpb/Visitor.ets`（接口分组方式）、`UnknownFields.ets`
（未知字段保留，我们的已知缺口）、`MessageRegistry.ets`（`Any` 的注册表设计）。

**不要参考其 JSON 映射规则**：enum 与 map 两处 REQUIRED 级偏离（见上文），
且该仓库未接入官方 conformance 套件。其 `ARKTS-COMPLIANCE.md` 的规则号可交叉
验证、有价值，但「100% 合规」的自我评定不可信——同仓库 `arkts-type-solutions.ts`
用了它自己列为禁用的 `in` 运算符，生成器也在产出 `any`（`arkpb-gen.js:1124` 等）。

`https://github.com/bytedance/protoc-gen-arkts` 的 JSON 实现**不能参考**：
依赖 `any`/`unknown`/索引签名，且其 conformance 跑在 Deno 而非 ArkTS 上。
