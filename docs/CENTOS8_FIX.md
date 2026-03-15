# CentOS 8 镜像源修复指南

## 🐛 问题描述

CentOS 8 已于 2021 年 12 月 31 日停止维护（EOL），官方镜像源 `mirrorlist.centos.org` 已失效。

**错误信息**：
```
Error: Failed to download metadata for repo 'appstream': 
Cannot prepare internal mirrorlist: Curl error (6): 
Couldn't resolve host name for http://mirrorlist.centos.org/...
```

---

## ✅ 自动修复

我们的配置脚本已经内置了自动修复功能：

```bash
npm run deploy:setup staging
```

脚本会自动：
1. 检测 CentOS 8
2. 切换到 vault 镜像源
3. 继续安装 Node.js 20+

---

## 🔧 手动修复

如果自动修复失败，可以手动执行：

### 步骤 1：备份原有源

```bash
sudo mkdir -p /etc/yum.repos.d.bak
sudo mv /etc/yum.repos.d/*.repo /etc/yum.repos.d.bak/
```

### 步骤 2：创建新的源配置

```bash
sudo tee /etc/yum.repos.d/CentOS-Base.repo > /dev/null <<'EOF'
[baseos]
name=CentOS Stream 8 - BaseOS
baseurl=https://vault.centos.org/centos/8-stream/BaseOS/x86_64/os/
gpgcheck=1
enabled=1
gpgkey=file:///etc/pki/rpm-gpg/RPM-GPG-KEY-centosofficial

[appstream]
name=CentOS Stream 8 - AppStream
baseurl=https://vault.centos.org/centos/8-stream/AppStream/x86_64/os/
gpgcheck=1
enabled=1
gpgkey=file:///etc/pki/rpm-gpg/RPM-GPG-KEY-centosofficial

[extras]
name=CentOS Stream 8 - Extras
baseurl=https://vault.centos.org/centos/8-stream/extras/x86_64/os/
gpgcheck=1
enabled=1
gpgkey=file:///etc/pki/rpm-gpg/RPM-GPG-KEY-centosofficial
EOF
```

### 步骤 3：清理缓存

```bash
sudo dnf clean all
sudo dnf makecache
```

### 步骤 4：测试

```bash
sudo dnf update -y
```

---

## 🚀 安装 Node.js 20

修复镜像源后，安装 Node.js：

```bash
# 添加 NodeSource 仓库
curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -

# 安装 Node.js
dnf install -y nodejs

# 验证
node -v  # 应该显示 v20.x.x
npm -v
```

---

## 📝 替代方案

### 方案 1：使用 NVM（推荐）

```bash
# 安装 NVM
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash

# 重新加载配置
source ~/.bashrc

# 安装 Node.js 20
nvm install 20
nvm use 20
nvm alias default 20

# 验证
node -v
```

### 方案 2：使用官方二进制包

```bash
# 下载 Node.js 20
cd /tmp
wget https://nodejs.org/dist/v20.11.0/node-v20.11.0-linux-x64.tar.xz

# 解压
tar -xJf node-v20.11.0-linux-x64.tar.xz

# 移动到系统目录
sudo mv node-v20.11.0-linux-x64 /usr/local/node-20

# 创建软链接
sudo ln -sf /usr/local/node-20/bin/node /usr/bin/node
sudo ln -sf /usr/local/node-20/bin/npm /usr/bin/npm
sudo ln -sf /usr/local/node-20/bin/npx /usr/bin/npx

# 验证
node -v
```

### 方案 3：升级到 CentOS Stream 9

```bash
# 升级系统（谨慎操作）
sudo dnf install centos-release-stream
sudo dnf swap centos-linux-repos centos-stream-repos
sudo dnf distro-sync
```

---

## 🔍 故障排查

### 问题 1：镜像源仍然失败

**尝试使用国内镜像**：

```bash
sudo tee /etc/yum.repos.d/CentOS-Base.repo > /dev/null <<'EOF'
[baseos]
name=CentOS Stream 8 - BaseOS
baseurl=https://mirrors.aliyun.com/centos-vault/centos/8-stream/BaseOS/x86_64/os/
gpgcheck=1
enabled=1
gpgkey=file:///etc/pki/rpm-gpg/RPM-GPG-KEY-centosofficial

[appstream]
name=CentOS Stream 8 - AppStream
baseurl=https://mirrors.aliyun.com/centos-vault/centos/8-stream/AppStream/x86_64/os/
gpgcheck=1
enabled=1
gpgkey=file:///etc/pki/rpm-gpg/RPM-GPG-KEY-centosofficial
EOF

sudo dnf clean all
sudo dnf makecache
```

### 问题 2：网络连接问题

**检查网络**：

```bash
# 测试网络
ping -c 3 vault.centos.org

# 测试 DNS
nslookup vault.centos.org

# 如果 DNS 失败，临时使用 Google DNS
echo "nameserver 8.8.8.8" | sudo tee /etc/resolv.conf
```

### 问题 3：GPG 密钥问题

**跳过 GPG 检查**（不推荐）：

```bash
sudo dnf install -y nodejs --nogpgcheck
```

---

## 📊 CentOS 版本对比

| 版本 | 状态 | 支持 | 建议 |
|------|------|------|------|
| CentOS 7 | ✅ 支持 | 至 2024-06-30 | 可用 |
| CentOS 8 | ⚠️ EOL | 已结束 | 切换镜像源 |
| CentOS Stream 8 | ✅ 支持 | 持续更新 | 推荐 |
| CentOS Stream 9 | ✅ 支持 | 持续更新 | 推荐 |

---

## 🎯 推荐操作

### 短期方案（立即可用）

1. 使用我们的自动配置脚本（已内置修复）：
   ```bash
   npm run deploy:setup staging
   ```

2. 或使用 NVM 安装 Node.js：
   ```bash
   ssh root@your-server-ip
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
   source ~/.bashrc
   nvm install 20
   ```

### 长期方案（推荐）

考虑升级到 CentOS Stream 9 或切换到 Ubuntu 22.04 LTS。

---

## 📚 相关文档

- [服务器配置指南](./SERVER_SETUP.md)
- [部署快速开始](./DEPLOYMENT_QUICKSTART.md)

---

**最后更新**：2026-03-02  
**适用版本**：CentOS 8 / CentOS Stream 8
