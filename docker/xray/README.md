# Xray Docker 代理配置

这个目录包含 Xray 代理的 Docker 配置，用于为 X-Computer 提供稳定的代理服务。

## 配置步骤

### 1. 编辑配置文件

编辑 `config.json`，替换以下占位符为你的实际 VMess 配置：

- `YOUR_SERVER_ADDRESS`: 你的 VMess 服务器地址（如 `example.com`）
- `YOUR_UUID`: 你的 VMess UUID（如 `12345678-1234-1234-1234-123456789abc`）
- `port`: 服务器端口（默认 443）
- `path`: WebSocket 路径（默认 `/`，根据你的服务器配置修改）
- `serverName`: TLS SNI 服务器名称（通常与 address 相同）

**从 V2Box/Quantumult X 获取配置：**

1. 打开 V2Box 或 Quantumult X
2. 找到你正在使用的节点
3. 查看节点详情，复制以下信息：
   - 服务器地址（address）
   - 端口（port）
   - UUID（id）
   - 传输协议（network）：ws、tcp、grpc 等
   - TLS 设置
   - WebSocket 路径（如果使用 ws）

**配置示例：**

```json
{
  "address": "hk1.example.com",
  "port": 443,
  "users": [
    {
      "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "alterId": 0,
      "security": "auto"
    }
  ]
}
```

### 2. 启动 Xray 容器

```bash
cd ~/code/x-computer/docker/xray
docker-compose up -d
```

### 3. 查看日志

```bash
docker-compose logs -f xray
```

### 4. 测试代理

```bash
# 测试 HTTP 代理
curl -x http://127.0.0.1:10809 https://www.google.com -I

# 测试 SOCKS5 代理
curl -x socks5://127.0.0.1:10808 https://www.google.com -I
```

### 5. 在 X-Computer 中配置

在 X-Computer 的 WhatsApp 设置中，填入：

```
http://127.0.0.1:10809
```

或者（如果 HTTP 不稳定）：

```
socks5://127.0.0.1:10808
```

## 管理命令

```bash
# 启动
docker-compose up -d

# 停止
docker-compose down

# 重启
docker-compose restart

# 查看状态
docker-compose ps

# 查看日志
docker-compose logs -f
```

## 端口说明

- **10809**: HTTP 代理端口（推荐用于 WhatsApp）
- **10808**: SOCKS5 代理端口

## 故障排查

### 连接失败

1. 检查容器是否运行：`docker-compose ps`
2. 查看日志：`docker-compose logs xray`
3. 确认配置文件中的服务器信息正确
4. 测试服务器是否可达：`ping YOUR_SERVER_ADDRESS`

### 配置文件错误

如果修改了 `config.json`，需要重启容器：

```bash
docker-compose restart
```

## 高级配置

### 修改路由规则

编辑 `config.json` 中的 `routing` 部分，可以配置：

- 国内网站直连
- 广告屏蔽
- 自定义域名/IP 路由

### 性能优化

如果需要更好的性能，可以在 `streamSettings` 中启用 mux（多路复用）：

```json
"mux": {
  "enabled": true,
  "concurrency": 8
}
```
