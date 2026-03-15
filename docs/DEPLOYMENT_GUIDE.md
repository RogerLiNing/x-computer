# X-Computer 部署指南

本文档介绍如何将 X-Computer 部署到不同的服务器环境。

---

## 📋 目录

1. [快速开始](#快速开始)
2. [多环境部署](#多环境部署)
3. [配置说明](#配置说明)
4. [部署流程](#部署流程)
5. [常见问题](#常见问题)

---

## 🚀 快速开始

### 方式 1：单服务器部署（简单）

适合只有一个服务器的情况。

```bash
# 1. 复制配置文件
cp scripts/deploy.config.example.json scripts/deploy.config.json

# 2. 编辑配置（填入服务器信息）
vim scripts/deploy.config.json

# 3. 部署
npm run deploy
```

### 方式 2：多环境部署（推荐）

适合有开发/测试/生产多个环境的情况。

```bash
# 1. 复制配置文件
cp scripts/deploy.config.example.json scripts/deploy.config.json

# 2. 编辑配置（配置多个环境）
vim scripts/deploy.config.json

# 3. 查看可用环境
npm run deploy:list

# 4. 部署到指定环境
npm run deploy:dev       # 部署到开发环境
npm run deploy:staging   # 部署到测试环境
npm run deploy:prod      # 部署到生产环境
```

---

## 🌍 多环境部署

### 环境配置示例

`scripts/deploy.config.json`：

```json
{
  "environments": {
    "dev": {
      "name": "开发环境",
      "host": "user@dev.example.com",
      "password": "",
      "path": "/apps/x-computer-dev",
      "branch": "develop",
      "config": {
        "container": {
          "enabled": false
        },
        "auth": {
          "allowAnonymous": true
        }
      }
    },
    "staging": {
      "name": "测试环境",
      "host": "user@staging.example.com",
      "password": "",
      "path": "/apps/x-computer-staging",
      "branch": "main",
      "config": {
        "container": {
          "enabled": true,
          "cpuLimit": 0.5,
          "memoryLimit": "256m",
          "networkMode": "none"
        },
        "auth": {
          "allowAnonymous": true
        }
      }
    },
    "production": {
      "name": "生产环境",
      "host": "user@prod.example.com",
      "password": "",
      "path": "/apps/x-computer",
      "branch": "main",
      "config": {
        "container": {
          "enabled": true,
          "cpuLimit": 0.5,
          "memoryLimit": "256m",
          "pidsLimit": 100,
          "networkMode": "none"
        },
        "auth": {
          "allowAnonymous": false
        }
      },
      "requireConfirmation": true
    }
  },
  "default": "staging"
}
```

### 环境字段说明

| 字段 | 说明 | 必填 |
|------|------|------|
| `name` | 环境显示名称 | 否 |
| `host` | SSH 主机（格式：`user@host`） | 是 |
| `password` | SSH 密码（留空使用密钥） | 否 |
| `path` | 服务器上的部署路径 | 是 |
| `branch` | 部署的 Git 分支 | 否（默认 `main`） |
| `config` | 环境特定的配置（`.x-config.json`） | 否 |
| `requireConfirmation` | 是否需要手动确认 | 否（默认 `false`） |

---

## ⚙️ 配置说明

### 1. SSH 认证

**方式 A：SSH 密钥（推荐）**

```json
{
  "host": "user@example.com",
  "password": ""
}
```

**方式 B：密码认证**

需要安装 `sshpass`：

```bash
# macOS
brew install sshpass

# Linux
sudo apt install sshpass
```

配置：

```json
{
  "host": "user@example.com",
  "password": "your-password"
}
```

### 2. 环境配置

每个环境可以有独立的 `.x-config.json` 配置：

```json
{
  "config": {
    "container": {
      "enabled": true,
      "cpuLimit": 0.5,
      "memoryLimit": "256m",
      "pidsLimit": 100,
      "networkMode": "none"
    },
    "auth": {
      "allowAnonymous": false
    },
    "llm_config": {
      "provider": "bailian",
      "model": "qwen-max"
    }
  }
}
```

### 3. 安全建议

| 环境 | 容器隔离 | 匿名访问 | 网络 | 说明 |
|------|---------|---------|------|------|
| **开发** | ❌ 可选 | ✅ 允许 | 允许 | 快速迭代 |
| **测试** | ✅ 启用 | ✅ 允许 | 禁用 | 接近生产 |
| **生产** | ✅ 必须 | ❌ 禁止 | 禁用 | 最高安全 |

---

## 📦 部署流程

### 完整流程

```bash
# 1. 本地构建
npm run build

# 2. 打包项目
# 排除 node_modules、.git、数据库等

# 3. 上传到服务器
scp package.tar.gz user@host:/tmp/

# 4. 远程部署
ssh user@host
cd /apps/x-computer
tar -xzf /tmp/package.tar.gz
npm install --omit=dev
pm2 restart x-computer
```

### 自动化部署

```bash
# 部署到测试环境
npm run deploy:staging

# 部署到生产环境（需要确认）
npm run deploy:prod
```

### 部署输出示例

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  部署环境: 生产环境 (production)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  主机: user@prod.example.com
  路径: /apps/x-computer
  分支: main
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⚠️  这是生产环境，需要确认！
确认部署到生产环境？(yes/no): yes

>>> 同步内置 skills
>>> 构建项目
>>> 生成环境配置文件
>>> 打包项目
>>> 上传到 user@prod.example.com:/apps/x-computer
>>> 远程解压、安装依赖并重启
✅ 部署成功！

环境: 生产环境
主机: user@prod.example.com
路径: /apps/x-computer

>>> 查看日志: ssh user@prod.example.com 'pm2 logs x-computer'
```

---

## 🔧 服务器要求

### 最低配置

- **CPU**：2 核
- **内存**：4 GB
- **磁盘**：20 GB
- **系统**：Ubuntu 20.04+ / CentOS 7+ / macOS

### 推荐配置

- **CPU**：4 核
- **内存**：8 GB
- **磁盘**：50 GB
- **系统**：Ubuntu 22.04 LTS

### 必需软件

```bash
# Node.js 22+
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# PM2（进程管理）
npm install -g pm2

# Docker（容器隔离，推荐）
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
```

---

## 📝 常见问题

### 1. 部署失败：SSH 连接超时

**原因**：防火墙或 SSH 配置问题

**解决**：

```bash
# 测试 SSH 连接
ssh user@host

# 检查防火墙
sudo ufw status
sudo ufw allow 22/tcp
```

### 2. 部署失败：权限不足

**原因**：用户没有写入权限

**解决**：

```bash
# 创建部署目录
sudo mkdir -p /apps
sudo chown -R $USER:$USER /apps
```

### 3. PM2 启动失败

**原因**：PM2 未安装或配置错误

**解决**：

```bash
# 安装 PM2
npm install -g pm2

# 查看日志
pm2 logs x-computer

# 重启服务
pm2 restart x-computer
```

### 4. 容器模式启动失败

**原因**：Docker 未安装或权限不足

**解决**：

```bash
# 安装 Docker
curl -fsSL https://get.docker.com | sh

# 添加用户到 docker 组
sudo usermod -aG docker $USER
newgrp docker

# 测试 Docker
docker ps
```

### 5. 如何回滚到上一个版本？

每次部署都会自动备份：

```bash
# 查看备份
ls -la /apps/*.backup-*

# 回滚
cd /apps
rm -rf x-computer
mv x-computer.backup-20260301-120000 x-computer
pm2 restart x-computer
```

### 6. 如何查看部署日志？

```bash
# 查看 PM2 日志
pm2 logs x-computer

# 查看错误日志
pm2 logs x-computer --err

# 查看实时日志
pm2 logs x-computer --lines 100
```

---

## 🔐 安全检查清单

部署到生产环境前，请确认：

- [ ] 启用容器隔离（`container.enabled: true`）
- [ ] 禁用网络访问（`networkMode: "none"`）
- [ ] 禁用匿名访问（`allowAnonymous: false`）
- [ ] 配置 HTTPS/WSS
- [ ] 设置防火墙规则
- [ ] 配置定期备份
- [ ] 启用日志监控
- [ ] 配置告警通知

---

## 📚 相关文档

- [配置指南](./CONFIGURATION.md) - 详细配置说明
- [安全指南](./SECURITY_HARDENING_COMPLETE.md) - 安全加固
- [容器使用](./SECURITY_CONTAINER_USAGE.md) - 容器配置

---

## 🆘 获取帮助

如果遇到问题：

1. 查看日志：`pm2 logs x-computer`
2. 检查配置：`cat server/.x-config.json`
3. 测试连接：`ssh user@host`
4. 查看文档：`docs/`

---

**最后更新**：2026-03-02  
**版本**：v1.0
