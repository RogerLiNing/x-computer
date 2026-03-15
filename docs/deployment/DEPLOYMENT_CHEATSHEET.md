# 部署命令速查表

## 🚀 快速部署（3 步）

```bash
# 1. 配置服务器环境
npm run deploy:setup staging

# 2. 验证配置
npm run deploy:validate

# 3. 部署应用
npm run deploy:staging
```

---

## 📝 所有命令

| 命令 | 说明 |
|------|------|
| `npm run deploy:list` | 列出所有环境 |
| `npm run deploy:validate` | 验证配置 |
| `npm run deploy:test [env]` | 测试 SSH 连接 |
| `npm run deploy:setup [env]` | 配置服务器环境 |
| `npm run deploy:dev` | 部署到开发环境 |
| `npm run deploy:staging` | 部署到测试环境 |
| `npm run deploy:prod` | 部署到生产环境 |

---

## 🔧 服务器命令

登录服务器后：

```bash
# 查看进程
pm2 list

# 查看日志
pm2 logs x-computer

# 重启服务
pm2 restart x-computer

# 停止服务
pm2 stop x-computer

# 查看详细信息
pm2 show x-computer

# 查看监控
pm2 monit
```

---

## 🐛 故障排查

### Node.js 版本过低

```bash
# 服务器上执行
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
node -v
```

### PM2 未安装

```bash
# 服务器上执行
npm install -g pm2
pm2 -v
```

### SSH 连接失败

```bash
# 本地测试
ssh root@your-server-ip

# 检查密钥
ls -la ~/.ssh/id_rsa
chmod 600 ~/.ssh/id_rsa
```

### 部署失败

```bash
# 查看详细日志
npm run deploy:staging 2>&1 | tee deploy.log

# 测试连接
npm run deploy:test staging
```

---

## 📁 配置文件

### scripts/deploy.config.json

```json
{
  "environments": {
    "staging": {
      "name": "测试环境",
      "host": "root@your-server-ip",
      "port": 22,
      "auth": {
        "type": "key",
        "keyPath": "~/.ssh/id_rsa"
      },
      "path": "/apps/x-computer-staging",
      "branch": "main"
    }
  }
}
```

---

## 🔐 SSH 密钥

### 生成密钥

```bash
ssh-keygen -t rsa -b 4096 -C "your-email@example.com"
```

### 复制到服务器

```bash
ssh-copy-id root@your-server-ip
```

### 测试连接

```bash
ssh root@your-server-ip
```

---

## 📚 文档

| 文档 | 说明 |
|------|------|
| [快速开始](docs/DEPLOYMENT_QUICKSTART.md) | 5 分钟部署 |
| [服务器配置](docs/SERVER_SETUP.md) | 环境配置 |
| [SSH 密钥](docs/SSH_KEY_SETUP.md) | 密钥管理 |
| [完整指南](docs/DEPLOYMENT_GUIDE.md) | 详细说明 |

---

## 🎯 当前状态

你的服务器：`root@your-server-ip`

**待执行**：
```bash
# 1. 配置环境（自动安装 Node.js 20 + PM2）
npm run deploy:setup staging

# 2. 部署应用
npm run deploy:staging
```

---

**快速参考** 🚀
