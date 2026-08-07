#!/bin/sh
# 拉取 protobuf 源码并编译 conformance_test_runner。
# abseil 走 find_package，若本机没有请先 `brew install abseil`。
set -e
# 所有相对路径都以 conformance/ 为基准。
cd "$(dirname "$0")/.."

VERSION=v35.1
DIR=.third_party/protobuf

mkdir -p .third_party
if [ ! -d "$DIR" ]; then
  echo "==> 克隆 protobuf $VERSION"
  git clone --depth 1 --branch "$VERSION" --recurse-submodules --shallow-submodules \
    https://github.com/protocolbuffers/protobuf.git "$DIR"
fi

echo "==> 配置"
cmake -S "$DIR" -B "$DIR/build" \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_CXX_STANDARD=17 \
  -Dprotobuf_BUILD_CONFORMANCE=ON \
  -Dprotobuf_BUILD_TESTS=OFF \
  -Dprotobuf_BUILD_EXAMPLES=OFF

echo "==> 编译 runner"
cmake --build "$DIR/build" --target conformance_test_runner -j "$(sysctl -n hw.ncpu 2>/dev/null || nproc)"

echo "==> 完成：$DIR/build/conformance_test_runner"
