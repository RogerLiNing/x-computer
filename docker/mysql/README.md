# x-computer MySQL 数据库

使用 Docker 运行 MySQL 8，供 x-computer 在 `DATABASE_TYPE=mysql` 时连接。

## 启动 MySQL

在**项目根目录**执行：

```bash
docker compose -f docker/mysql/docker-compose.yml up -d
```

等待健康检查通过（约 15–30 秒）：

```bash
docker compose -f docker/mysql/docker-compose.yml ps
# 状态为 healthy 即可
```

## 环境变量（给 x-computer 用）

| 变量 | 默认值 | 说明 |
|------|--------|------|
| DATABASE_TYPE | mysql | 使用 MySQL |
| MYSQL_HOST | localhost | 主机（本机跑用 localhost） |
| MYSQL_PORT | 3306 | 端口 |
| MYSQL_USER | xcom | 用户名 |
| MYSQL_PASSWORD | xcomputer | 密码 |
| MYSQL_DATABASE | x_computer | 库名 |

可用 root 连接：`MYSQL_USER=root`，`MYSQL_PASSWORD=xcomputer`。

## 停止

```bash
docker compose -f docker/mysql/docker-compose.yml down
# 保留数据卷：不加 -v
# 删除数据：docker compose -f docker/mysql/docker-compose.yml down -v
```
