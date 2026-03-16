# Qdrant 向量数据库

Qdrant 是高性能向量数据库，用于 AI 应用的语义搜索、推荐系统、RAG 等场景。

## 启动

```bash
# 在项目根目录
docker compose -f docker/qdrant/docker-compose.yml up -d

# 查看日志
docker logs -f x-computer-qdrant
```

## 端口

| 端口 | 用途     |
|------|----------|
| 6333 | REST API |
| 6334 | gRPC     |

## 健康检查

```bash
curl http://localhost:6333/readyz
```

## 数据持久化

数据存储在 Docker volume `qdrant_data`，容器删除后数据仍保留。
