#!/bin/bash
# 构建 X-Computer 沙箱镜像

set -e

echo "🔨 构建 X-Computer 沙箱镜像..."
docker build -f docker/sandbox.Dockerfile -t x-computer-sandbox:latest .

echo "✅ 沙箱镜像构建完成！"
echo ""
echo "镜像信息："
docker images | grep x-computer-sandbox

echo ""
echo "测试镜像："
docker run --rm x-computer-sandbox:latest whoami
docker run --rm x-computer-sandbox:latest node --version
docker run --rm x-computer-sandbox:latest python3 --version

echo ""
echo "✅ 镜像测试通过！"
