# 部署快速开始

## 🚀 5 分钟部署到服务器

### 步骤 1：配置服务器信息

```bash
# 复制配置模板
cp scripts/deploy.config.example.json scripts/deploy.config.json

# 编辑配置
vim scripts/deploy.config.json
```

修改以下字段：

```json
{
  "environments": {
    "production": {
      "host": "your-user@your-server.com",  // 改成你的服务器
      "path": "/apps/x-computer",           // 部署路径
      "password": ""                        // 留空使用 SSH 密钥
    }
  }
}
```

### 步骤 2：查看可用环境

```bash
npm run deploy:list
```

输出：

```
可用的部署环境：

  dev          - 开发环境
               主机: user@dev.example.com
               路径: /apps/x-computer-dev
               分支: develop

  staging      - 测试环境
               主机: user@staging.example.com
               路径: /apps/x-computer-staging
               分支: main

  production   - 生产环境
               主机: user@prod.example.com
               路径: /apps/x-computer
               分支: main
```

### 步骤 3：部署

```bash
# 部署到开发环境
npm run deploy:dev

# 部署到测试环境
npm run deploy:staging

# 部署到生产环境（需要确认）
npm run deploy:prod
```

---

## 📋 常用命令

| 命令 | 说明 |
|------|------|
| `npm run deploy:list` | 列出所有环境 |
| `npm run deploy:dev` | 部署到开发环境 |
| `npm run deploy:staging` | 部署到测试环境 |
| `npm run deploy:prod` | 部署到生产环境 |
| `npm run deploy` | 使用旧版单服务器部署 |

---

## 🔐 SSH 认证方式

### 方式 1：SSH 密钥（推荐）

```bash
# 生成密钥（如果还没有）
ssh-keygen -t rsa -b 4096 -C "your-email@example.com"

# 复制公钥到服务器
ssh-copy-id user@your-server.com

# 测试连接
ssh user@your-server.com
```

配置：

```json
{
  "host": "user@your-server.com",
  "port": 22,
  "auth": {
    "type": "key",
    "keyPath": "~/.ssh/id_rsa"
  }
}
```

**不同服务器使用不同密钥**：

```json
{
  "environments": {
    "staging": {
      "host": "user@staging.com",
      "auth": {
        "type": "key",
        "keyPath": "~/.ssh/id_rsa_staging"
      }
    },
    "production": {
      "host": "admin@prod.com",
      "auth": {
        "type": "key",
        "keyPath": "~/.ssh/id_rsa_prod"
      }
    }
  }
}
```

**详细配置**：见 [SSH 密钥配置指南](./SSH_KEY_SETUP.md)

### 方式 2：密码认证（不推荐）

安装 `sshpass`：

```bash
# macOS
brew install sshpass

# Linux
sudo apt install sshpass
```

配置：

```json
{
  "host": "user@your-server.com",
  "port": 22,
  "auth": {
    "type": "password",
    "password": "your-password"
  }
}
```

⚠️ **注意**：密码认证安全性较低，生产环境请使用 SSH 密钥。

---

## 🎯 环境配置示例

### 开发环境（宽松）

```json
{
  "dev": {
    "name": "开发环境",
    "host": "dev@dev-server.com",
    "path": "/apps/x-computer-dev",
    "branch": "develop",
    "config": {
      "container": {
        "enabled": false  // 不启用容器，方便调试
      },
      "auth": {
        "allowAnonymous": true  // 允许匿名访问
      }
    }
  }
}
```

### 生产环境（严格）

```json
{
  "production": {
    "name": "生产环境",
    "host": "admin@prod-server.com",
    "path": "/apps/x-computer",
    "branch": "main",
    "config": {
      "container": {
        "enabled": true,        // 必须启用容器
        "cpuLimit": 0.5,
        "memoryLimit": "256m",
        "pidsLimit": 100,
        "networkMode": "none"   // 禁用网络
      },
      "auth": {
        "allowAnonymous": false // 禁止匿名访问
      }
    },
    "requireConfirmation": true // 需要手动确认
  }
}
```

---

## ✅ 部署成功验证

```bash
# 1. SSH 登录服务器
ssh user@your-server.com

# 2. 查看进程
pm2 list

# 3. 查看日志
pm2 logs x-computer

# 4. 访问服务
curl http://localhost:4000/api/health
```

---

## 🆘 常见问题

### 问题 1：SSH 连接失败

```bash
# 测试连接
ssh user@your-server.com

# 如果失败，检查：
# 1. 服务器地址是否正确
# 2. 用户名是否正确
# 3. SSH 端口是否开放（默认 22）
# 4. 防火墙是否允许
```

### 问题 2：权限不足

```bash
# 在服务器上创建目录并授权
sudo mkdir -p /apps
sudo chown -R $USER:$USER /apps
```

### 问题 3：PM2 未安装

```bash
# 在服务器上安装 PM2
npm install -g pm2
```

### 问题 4：Node.js 版本过低

```bash
# 安装 Node.js 22+
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

---

## 📚 更多文档

- [完整部署指南](./DEPLOYMENT_GUIDE.md) - 详细说明
- [配置指南](./CONFIGURATION.md) - 配置说明
- [安全指南](./SECURITY_HARDENING_COMPLETE.md) - 安全加固

---

**快速开始完成！** 🎉

如有问题，查看 [完整部署指南](./DEPLOYMENT_GUIDE.md)。
