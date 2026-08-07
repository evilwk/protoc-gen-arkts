#!/bin/sh
# 端到端跑一次 protobuf conformance：生成 -> 移植 -> 编译 -> 验证。
# 前置：先跑一次 scripts/setup.sh 拉取并编译 conformance_test_runner。
set -e
# 所有相对路径都以 conformance/ 为基准。
cd "$(dirname "$0")/.."

PROTOBUF=.third_party/protobuf
RUNNER=$PROTOBUF/build/conformance_test_runner
WKT="any duration empty field_mask struct timestamp wrappers"

if [ ! -x "$RUNNER" ]; then
  echo "conformance_test_runner 不存在，请先运行 scripts/setup.sh" >&2
  exit 1
fi

echo "==> 构建生成器"
(cd ../generator && npm run build >/dev/null)

echo "==> 生成 ArkTS"
rm -rf generated-ets && mkdir -p generated-ets
rm -rf generated-json-ets && mkdir -p generated-json-ets
set -- conformance.proto google/protobuf/test_messages_proto3.proto optional.proto
for w in $WKT; do set -- "$@" "google/protobuf/$w.proto"; done
protoc \
  --plugin=protoc-gen-arkts=../generator/bin/protoc-gen-arkts.js \
  -I "$PROTOBUF/conformance" -I "$PROTOBUF/src" -I fixture \
  --arkts_out=json=true:generated-ets "$@"

protoc \
  --plugin=protoc-gen-arkts=../generator/bin/protoc-gen-arkts.js \
  -I "$PROTOBUF/src" \
  --arkts_out=json=true:generated-json-ets \
  google/protobuf/duration.proto \
  google/protobuf/empty.proto \
  google/protobuf/field_mask.proto \
  google/protobuf/struct.proto \
  google/protobuf/timestamp.proto \
  google/protobuf/wrappers.proto

echo "==> 移植为原生 TypeScript"
node port/index.mjs

echo "==> 编译 testee"
../generator/node_modules/.bin/tsc -p tsconfig.json

echo "==> 运行 runtime 定向 conformance"
node --test build/src/*.test.js

echo "==> 运行 conformance"
# runner 用 execv 起被测程序，不查 PATH，所以 node 必须给绝对路径；
# 其余参数由 runner 原样转发给被测程序。
exec "$RUNNER" --enforce_recommended --failure_list ./failure-list.txt \
  "$(command -v node)" build/src/testee.js
