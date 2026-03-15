#!/usr/bin/env bash
# 使用 MySQL 启动 x-computer（先启动 MySQL 容器，再带环境变量跑 server）
set -e
cd "$(dirname "$0")/.."

COMPOSE_FILE="docker/mysql/docker-compose.yml"

# 启动 MySQL（若未运行）
if ! docker compose -f "$COMPOSE_FILE" ps --status running 2>/dev/null | grep -q mysql; then
  echo "[mysql] 启动 MySQL 容器..."
  docker compose -f "$COMPOSE_FILE" up -d
  echo "[mysql] 等待 MySQL 就绪..."
  for i in {1..30}; do
    if docker compose -f "$COMPOSE_FILE" exec -T mysql mysqladmin ping -h localhost -u root -pxcomputer --silent 2>/dev/null; then
      echo "[mysql] 就绪"
      break
    fi
    if [[ $i -eq 30 ]]; then
      echo "[mysql] 超时，请检查容器日志: docker compose -f $COMPOSE_FILE logs mysql"
      exit 1
    fi
    sleep 1
  done
else
  echo "[mysql] 容器已在运行"
fi

# 使用 MySQL 环境变量启动
export DATABASE_TYPE=mysql
export MYSQL_HOST=127.0.0.1
export MYSQL_PORT=3306
export MYSQL_USER=xcom
export MYSQL_PASSWORD=xcomputer
export MYSQL_DATABASE=x_computer

echo "[x-computer] 使用 MySQL 启动 (DATABASE_TYPE=mysql)..."
exec npm run dev
