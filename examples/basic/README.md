# 基础示例

该示例把 `proto/greeting.proto` 生成到 `generated/Greeting.ets`，生成代码通过模块名
`@evilwk/protoc-gen-arkts-runtime` 导入仓库中的纯 ArkTS runtime。

在仓库根目录执行：

```shell
cd generator
npm ci
cd ..
node examples/basic/generate.mjs
```

脚本会先构建生成器，再清理并重新创建 `generated/`。正常情况下，重新生成后
`git diff -- examples/basic/generated` 应为空。

将文件接入实际 HarmonyOS 应用时：

1. 把生成的 `.ets` 放进应用模块源码目录；
2. 在应用模块 `oh-package.json5` 中添加
   `"@evilwk/protoc-gen-arkts-runtime": "file:<本仓库>/runtime"`；
3. 在业务代码中导入 `Greeting`，调用其生成的 encode/decode API。
