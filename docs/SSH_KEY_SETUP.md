# SSH 密钥配置指南

本文档介绍如何为 X-Computer 部署配置 SSH 密钥认证。

---

## 📋 目录

1. [为什么使用 SSH 密钥](#为什么使用-ssh-密钥)
2. [生成 SSH 密钥](#生成-ssh-密钥)
3. [配置服务器](#配置服务器)
4. [配置部署](#配置部署)
5. [多服务器管理](#多服务器管理)
6. [故障排查](#故障排查)

---

## 🔐 为什么使用 SSH 密钥

### 优势

| 特性 | SSH 密钥 | 密码 |
|------|---------|------|
| **安全性** | ✅ 高（2048/4096 位） | ⚠️ 低（易被暴力破解） |
| **便捷性** | ✅ 无需输入密码 | ❌ 每次都要输入 |
| **自动化** | ✅ 支持 | ⚠️ 需要 sshpass |
| **审计** | ✅ 可追踪 | ❌ 难追踪 |

### 推荐

- ✅ **生产环境**：必须使用 SSH 密钥
- ✅ **测试环境**：推荐使用 SSH 密钥
- ⚠️ **开发环境**：可选

---

## 🔑 生成 SSH 密钥

### 方式 1：默认密钥（推荐）

适合只有一个服务器的情况。

```bash
# 生成 RSA 密钥（4096 位）
ssh-keygen -t rsa -b 4096 -C "your-email@example.com"

# 提示输入文件名，直接回车使用默认路径
# Enter file in which to save the key (/Users/you/.ssh/id_rsa): [回车]

# 提示输入密码，可留空或设置密码
# Enter passphrase (empty for no passphrase): [回车或输入密码]
```

**生成的文件**：
- `~/.ssh/id_rsa` - 私钥（保密）
- `~/.ssh/id_rsa.pub` - 公钥（可公开）

### 方式 2：指定名称密钥

适合多个服务器的情况。

```bash
# 为生产服务器生成专用密钥
ssh-keygen -t rsa -b 4096 -C "prod-server" -f ~/.ssh/id_rsa_prod

# 为测试服务器生成专用密钥
ssh-keygen -t rsa -b 4096 -C "staging-server" -f ~/.ssh/id_rsa_staging
```

**生成的文件**：
- `~/.ssh/id_rsa_prod` / `~/.ssh/id_rsa_prod.pub`
- `~/.ssh/id_rsa_staging` / `~/.ssh/id_rsa_staging.pub`

### 方式 3：ED25519 密钥（更安全）

```bash
# 生成 ED25519 密钥（更短、更安全）
ssh-keygen -t ed25519 -C "your-email@example.com"
```

---

## 🖥️ 配置服务器

### 方式 1：使用 ssh-copy-id（推荐）

```bash
# 复制默认密钥
ssh-copy-id user@your-server.com

# 复制指定密钥
ssh-copy-id -i ~/.ssh/id_rsa_prod.pub user@prod-server.com

# 指定端口
ssh-copy-id -p 2222 user@your-server.com
```

### 方式 2：手动复制

```bash
# 1. 查看公钥内容
cat ~/.ssh/id_rsa.pub

# 2. 登录服务器
ssh user@your-server.com

# 3. 添加公钥到 authorized_keys
mkdir -p ~/.ssh
chmod 700 ~/.ssh
echo "你的公钥内容" >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys

# 4. 退出
exit
```

### 方式 3：一键脚本

```bash
# 将公钥内容通过 SSH 直接追加
cat ~/.ssh/id_rsa.pub | ssh user@your-server.com "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
```

---

## ⚙️ 配置部署

### 配置文件示例

`scripts/deploy.config.json`：

```json
{
  "environments": {
    "dev": {
      "name": "开发环境",
      "host": "user@dev.example.com",
      "port": 22,
      "auth": {
        "type": "key",
        "keyPath": "~/.ssh/id_rsa"
      },
      "path": "/apps/x-computer-dev"
    },
    "production": {
      "name": "生产环境",
      "host": "admin@prod.example.com",
      "port": 22,
      "auth": {
        "type": "key",
        "keyPath": "~/.ssh/id_rsa_prod"
      },
      "path": "/apps/x-computer"
    }
  }
}
```

### 字段说明

| 字段 | 说明 | 示例 |
|------|------|------|
| `auth.type` | 认证方式 | `"key"` 或 `"password"` |
| `auth.keyPath` | 私钥路径 | `"~/.ssh/id_rsa"` |
| `port` | SSH 端口 | `22`（默认） |

---

## 🗂️ 多服务器管理

### 场景 1：不同服务器使用不同密钥

```json
{
  "environments": {
    "dev": {
      "host": "dev@dev-server.com",
      "auth": {
        "type": "key",
        "keyPath": "~/.ssh/id_rsa_dev"
      }
    },
    "staging": {
      "host": "staging@staging-server.com",
      "auth": {
        "type": "key",
        "keyPath": "~/.ssh/id_rsa_staging"
      }
    },
    "production": {
      "host": "admin@prod-server.com",
      "auth": {
        "type": "key",
        "keyPath": "~/.ssh/id_rsa_prod"
      }
    }
  }
}
```

### 场景 2：所有服务器使用同一密钥

```json
{
  "environments": {
    "dev": {
      "host": "user@dev-server.com",
      "auth": {
        "type": "key",
        "keyPath": "~/.ssh/id_rsa"
      }
    },
    "staging": {
      "host": "user@staging-server.com",
      "auth": {
        "type": "key",
        "keyPath": "~/.ssh/id_rsa"
      }
    },
    "production": {
      "host": "user@prod-server.com",
      "auth": {
        "type": "key",
        "keyPath": "~/.ssh/id_rsa"
      }
    }
  }
}
```

### 场景 3：使用 SSH Config

**`~/.ssh/config`**：

```
Host dev-server
    HostName dev.example.com
    User dev
    Port 22
    IdentityFile ~/.ssh/id_rsa_dev

Host staging-server
    HostName staging.example.com
    User staging
    Port 22
    IdentityFile ~/.ssh/id_rsa_staging

Host prod-server
    HostName prod.example.com
    User admin
    Port 22
    IdentityFile ~/.ssh/id_rsa_prod
```

**`deploy.config.json`**：

```json
{
  "environments": {
    "dev": {
      "host": "dev-server",
      "auth": { "type": "key" }
    },
    "staging": {
      "host": "staging-server",
      "auth": { "type": "key" }
    },
    "production": {
      "host": "prod-server",
      "auth": { "type": "key" }
    }
  }
}
```

---

## 🔍 验证配置

### 1. 验证部署配置

```bash
npm run deploy:validate
```

输出示例：

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  部署配置验证
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ 配置文件存在: scripts/deploy.config.json
✅ JSON 格式正确
ℹ️  找到 3 个环境

━━━ 验证环境: production ━━━
✅ 主机: admin@prod.example.com:22
✅ 路径: /apps/x-computer
✅ 认证: SSH 密钥 (~/.ssh/id_rsa_prod)
ℹ️  测试 SSH 连接...
✅ SSH 连接成功
✅ 容器隔离: 已启用

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  验证完成
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ 配置验证通过！
```

### 2. 手动测试 SSH 连接

```bash
# 测试默认密钥
ssh user@your-server.com

# 测试指定密钥
ssh -i ~/.ssh/id_rsa_prod user@prod-server.com

# 测试指定端口
ssh -p 2222 user@your-server.com
```

---

## 🔧 故障排查

### 问题 1：Permission denied (publickey)

**原因**：公钥未添加到服务器或权限错误

**解决**：

```bash
# 1. 确认公钥已复制到服务器
ssh-copy-id -i ~/.ssh/id_rsa.pub user@your-server.com

# 2. 检查服务器权限
ssh user@your-server.com
chmod 700 ~/.ssh
chmod 600 ~/.ssh/authorized_keys
```

### 问题 2：密钥文件权限过于开放

**错误信息**：

```
@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
@         WARNING: UNPROTECTED PRIVATE KEY FILE!          @
@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
Permissions 0644 for '/Users/you/.ssh/id_rsa' are too open.
```

**解决**：

```bash
# 修复私钥权限
chmod 600 ~/.ssh/id_rsa
chmod 600 ~/.ssh/id_rsa_prod

# 修复公钥权限（可选）
chmod 644 ~/.ssh/id_rsa.pub
```

### 问题 3：找不到密钥文件

**错误信息**：

```
⚠️  密钥文件不存在: ~/.ssh/id_rsa_prod
```

**解决**：

```bash
# 检查密钥是否存在
ls -la ~/.ssh/

# 如果不存在，生成新密钥
ssh-keygen -t rsa -b 4096 -f ~/.ssh/id_rsa_prod
```

### 问题 4：SSH 连接超时

**原因**：防火墙、网络或端口配置问题

**解决**：

```bash
# 1. 检查服务器是否可达
ping your-server.com

# 2. 检查 SSH 端口是否开放
telnet your-server.com 22

# 3. 检查防火墙
# 在服务器上执行：
sudo ufw status
sudo ufw allow 22/tcp
```

### 问题 5：密钥有密码保护

**现象**：每次部署都要输入密钥密码

**解决方案 A**：使用 ssh-agent

```bash
# 启动 ssh-agent
eval "$(ssh-agent -s)"

# 添加密钥到 agent
ssh-add ~/.ssh/id_rsa_prod

# 验证
ssh-add -l
```

**解决方案 B**：移除密钥密码

```bash
# 移除密码保护
ssh-keygen -p -f ~/.ssh/id_rsa_prod
# 提示输入旧密码，然后新密码留空
```

---

## 🔐 安全最佳实践

### 1. 密钥管理

- ✅ 为不同环境使用不同密钥
- ✅ 生产密钥使用密码保护
- ✅ 定期轮换密钥（每 6-12 个月）
- ❌ 不要将私钥提交到 Git

### 2. 权限设置

```bash
# 私钥权限
chmod 600 ~/.ssh/id_rsa*

# 公钥权限
chmod 644 ~/.ssh/id_rsa*.pub

# .ssh 目录权限
chmod 700 ~/.ssh

# authorized_keys 权限（服务器上）
chmod 600 ~/.ssh/authorized_keys
```

### 3. 服务器配置

编辑 `/etc/ssh/sshd_config`：

```bash
# 禁用密码认证
PasswordAuthentication no

# 禁用 root 登录
PermitRootLogin no

# 只允许公钥认证
PubkeyAuthentication yes

# 重启 SSH 服务
sudo systemctl restart sshd
```

### 4. 备份密钥

```bash
# 备份私钥到安全位置
cp ~/.ssh/id_rsa ~/Dropbox/backup/ssh-keys/
cp ~/.ssh/id_rsa_prod ~/Dropbox/backup/ssh-keys/

# 或使用加密备份
tar -czf ssh-keys-backup.tar.gz ~/.ssh/id_rsa*
gpg -c ssh-keys-backup.tar.gz
```

---

## 📝 快速参考

### 常用命令

| 命令 | 说明 |
|------|------|
| `ssh-keygen -t rsa -b 4096` | 生成 RSA 密钥 |
| `ssh-copy-id user@host` | 复制公钥到服务器 |
| `ssh -i ~/.ssh/key user@host` | 使用指定密钥连接 |
| `ssh-add ~/.ssh/key` | 添加密钥到 agent |
| `chmod 600 ~/.ssh/id_rsa` | 修复密钥权限 |
| `npm run deploy:validate` | 验证部署配置 |

### 文件路径

| 文件 | 说明 |
|------|------|
| `~/.ssh/id_rsa` | 默认私钥 |
| `~/.ssh/id_rsa.pub` | 默认公钥 |
| `~/.ssh/config` | SSH 客户端配置 |
| `~/.ssh/authorized_keys` | 服务器授权公钥列表 |

---

## 📚 相关文档

- [部署快速开始](./DEPLOYMENT_QUICKSTART.md)
- [完整部署指南](./DEPLOYMENT_GUIDE.md)
- [配置指南](./CONFIGURATION.md)

---

**最后更新**：2026-03-02  
**版本**：v1.0
