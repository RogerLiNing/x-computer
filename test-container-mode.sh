#!/bin/bash

echo "=== 测试容器隔离模式 ==="
echo ""

# 1. 检查 Docker 镜像
echo "1. 检查沙箱镜像..."
if docker images | grep -q "x-computer-sandbox"; then
  echo "   ✅ 镜像已存在"
  docker images | grep x-computer-sandbox
else
  echo "   ❌ 镜像不存在，需要构建"
  echo "   运行: cd docker && ./build-sandbox.sh"
  exit 1
fi

echo ""

# 2. 启动服务器（容器模式）
echo "2. 启动服务器（容器模式）..."
echo "   按 Ctrl+C 停止服务器"
echo ""

cd /Users/rogerlee/code/x-computer/server
USE_CONTAINER_ISOLATION=true npm run dev
