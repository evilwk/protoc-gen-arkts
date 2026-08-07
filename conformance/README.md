# Protobuf Conformance 验证

使用 Google 官方 `conformance_test_runner` 验证生成代码和 runtime。

## 覆盖范围

- proto3 二进制输入与输出
- proto3 JSON 输入与输出
- JSON ignore-unknown 模式
- 标准 WKT 和 Any
- REQUIRED 和 RECOMMENDED 测试

## 未覆盖范围

- proto2
- Editions
- TextFormat
- JSPB

## 使用

首次运行时下载并编译官方 runner：

```shell
cd conformance
./scripts/setup.sh
```

执行完整验证：

```shell
./scripts/run.sh
```

输出跳过原因统计：

```shell
ARKTS_CONFORMANCE_TALLY=1 ./scripts/run.sh
```

## 当前结果

| 套件            |   通过 |   跳过 | 预期失败 | 意外失败 |
|---------------|-----:|-----:|-----:|-----:| 
| BinaryAndJson | 1492 | 1314 |    2 |    0 |
| TextFormat    |    0 |  445 |    0 |    0 |

- 1314 项跳过全部属于 `protobuf_test_messages.proto2.TestAllTypesProto2`。
- 445 项跳过全部属于尚未支持的 TextFormat 测试。
- 2 项预期失败来自未知字段不会在重新编码时原样写回。

## 许可证

相关源码与测试数据遵循各自上游许可证，项目自身代码使用 [Apache License 2.0](../LICENSE)。
