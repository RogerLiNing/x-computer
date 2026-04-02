#!/bin/bash
# x-computer Docker 一键启动脚本

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

# 检查 Docker 是否安装
if ! command -v docker &> /dev/null; then
    echo "错误: Docker 未安装"
    exit 1
fi

if ! command -v docker compose &> /dev/null; then
    echo "错误: Docker Compose 未安装"
    exit 1
fi

# 显示启动选项
echo "======================================"
echo "  x-computer Docker 启动"
echo "======================================"
echo ""
echo "请选择模式："
echo "  1) 生产模式 (前端 + 后端)"
echo "  2) 开发模式 (前端 + 后端 + 热重载)"
echo "  3) 仅前端 (需要本地后端)"
echo "  4) 完整模式 (包含 MySQL + Qdrant)"
echo "  5) 退出"
echo ""

read -p "请输入选项 [1-5]: " choice

case $choice in
    1)
        echo "启动生产模式..."
        docker compose -f docker/docker-compose.yml up -d --build server frontend
        echo ""
        echo "服务已启动:"
        echo "  前端: http://localhost:3000"
        echo "  后端: http://localhost:4000"
        ;;
    2)
        echo "启动开发模式..."
        docker compose -f docker/docker-compose.dev.yml up -d --build
        echo ""
        echo "服务已启动:"
        echo "  前端 (HMR): http://localhost:3000"
        echo "  后端 (热重载): http://localhost:4000"
        ;;
    3)
        echo "启动仅前端模式..."
        docker compose -f docker/docker-compose.yml up -d --build frontend
        echo ""
        echo "前端已启动: http://localhost:3000"
        echo "注意: 需要本地后端运行在 http://localhost:4000"
        ;;
    4)
        echo "启动完整模式..."
        # 复制环境变量文件（如果不存在）
        if [ ! -f .env ]; then
            cp docker/.env.example .env
            echo "已创建 .env 文件，请根据需要修改"
        fi
        docker compose -f docker/docker-compose.yml up -d --build
        echo ""
        echo "所有服务已启动:"
        echo "  前端: http://localhost:3000"
        echo "  后端: http://localhost:4000"
        echo "  MySQL: localhost:3306"
        echo "  Qdrant: http://localhost:6333"
        ;;
    5)
        echo "退出"
        exit 0
        ;;
    *)
        echo "无效选项"
        exit 1
        ;;
esac

echo ""
echo "查看日志: docker compose -f docker/docker-compose.yml logs -f"
echo "停止服务: docker compose -f docker/docker-compose.yml down"
