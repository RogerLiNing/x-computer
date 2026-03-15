# 手动服务器配置指南（CentOS 8）

## 🎯 适用场景

- CentOS 8（已 EOL，镜像源失效）
- 自动配置脚本失败
- 需要完全控制安装过程

---

## 🚀 快速安装（推荐 NVM）

### 方式 1：使用 NVM（最简单）

```bash
# 1. SSH 登录服务器
ssh root@your-server-ip

# 2. 安装 NVM
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash

# 3. 重新加载配置
source ~/.bashrc

# 4. 安装 Node.js 20
nvm install 20
nvm use 20
nvm alias default 20

# 5. 验证
node -v  # 应该显示 v20.x.x
npm -v

# 6. 安装 PM2
npm install -g pm2

# 7. 配置 PM2 开机自启
pm2 startup

# 8. 创建部署目录
mkdir -p /apps
chown -R $USER:$USER /apps

# 9. 完成！
echo "✅ 环境配置完成"
```

---

## 📦 方式 2：官方二进制包

```bash
# 1. SSH 登录
ssh root@your-server-ip

# 2. 下载 Node.js 20
cd /tmp
wget https://nodejs.org/dist/v20.11.1/node-v20.11.1-linux-x64.tar.xz

# 3. 解压
tar -xJf node-v20.11.1-linux-x64.tar.xz

# 4. 移动到系统目录
mv node-v20.11.1-linux-x64 /usr/local/node-20

# 5. 创建软链接
ln -sf /usr/local/node-20/bin/node /usr/bin/node
ln -sf /usr/local/node-20/bin/npm /usr/bin/npm
ln -sf /usr/local/node-20/bin/npx /usr/bin/npx

# 6. 验证
node -v
npm -v

# 7. 安装 PM2
npm install -g pm2
ln -sf /usr/local/node-20/bin/pm2 /usr/bin/pm2

# 8. 配置 PM2
pm2 startup

# 9. 创建目录
mkdir -p /apps

# 10. 完成
echo "✅ 环境配置完成"
```

---

## 🔧 方式 3：修复 CentOS 8 镜像源

```bash
# 1. SSH 登录
ssh root@your-server-ip

# 2. 备份原有源
mkdir -p /etc/yum.repos.d.bak
mv /etc/yum.repos.d/*.repo /etc/yum.repos.d.bak/

# 3. 创建新的源配置
cat > /etc/yum.repos.d/CentOS-Base.repo <<'EOF'
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

# 4. 清理缓存
dnf clean all
dnf makecache

# 5. 测试
dnf update -y

# 6. 安装 Node.js
curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
dnf install -y nodejs

# 7. 验证
node -v
npm -v

# 8. 安装 PM2
npm install -g pm2
pm2 startup

# 9. 创建目录
mkdir -p /apps
```

---

## ✅ 验证环境

```bash
# 检查 Node.js
node -v
# 应该显示: v20.x.x

# 检查 npm
npm -v
# 应该显示: 10.x.x

# 检查 PM2
pm2 -v
# 应该显示版本号

# 检查目录
ls -la /apps
# 应该存在且有权限
```

---

## 🎯 完成后的下一步

环境配置完成后，回到本地电脑执行：

```bash
# 1. 测试连接
npm run deploy:test staging

# 2. 验证配置
npm run deploy:validate

# 3. 部署应用
npm run deploy:staging

# 4. 验证部署
ssh root@your-server-ip 'pm2 list'
```

---

## 📊 推荐方案对比

| 方案 | 难度 | 速度 | 稳定性 | 推荐度 |
|------|------|------|--------|--------|
| **NVM** | ⭐ 简单 | ⭐⭐⭐ 快 | ⭐⭐⭐ 高 | ⭐⭐⭐ 强烈推荐 |
| 二进制包 | ⭐⭐ 中等 | ⭐⭐ 中 | ⭐⭐⭐ 高 | ⭐⭐ 推荐 |
| 修复镜像源 | ⭐⭐⭐ 复杂 | ⭐ 慢 | ⭐⭐ 中 | ⭐ 可选 |

**建议**：使用 NVM 方式，最简单快速！

---

## 🆘 常见问题

### Q1：为什么 CentOS 8 镜像源失效？

A：CentOS 8 于 2021 年 12 月 31 日停止维护，官方将镜像移到了 vault.centos.org。

### Q2：应该升级系统吗？

A：长期建议：
- 升级到 CentOS Stream 9
- 或迁移到 Ubuntu 22.04 LTS
- 或使用 Rocky Linux / AlmaLinux

### Q3：NVM 安装后找不到命令？

A：重新加载配置：
```bash
source ~/.bashrc
# 或
source ~/.zshrc
```

### Q4：PM2 安装后找不到命令？

A：创建软链接：
```bash
ln -sf $(which pm2) /usr/bin/pm2
```

---

## 📚 相关文档

- [服务器配置指南](./SERVER_SETUP.md)
- [部署快速开始](./DEPLOYMENT_QUICKSTART.md)
- [SSH 密钥配置](./SSH_KEY_SETUP.md)

---

## 🎉 快速命令（复制粘贴）

```bash
# 一键安装（NVM 方式）
ssh root@your-server-ip 'curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash && source ~/.bashrc && nvm install 20 && nvm use 20 && nvm alias default 20 && npm install -g pm2 && pm2 startup && mkdir -p /apps && echo "✅ 完成"'
```

---

**最后更新**：2026-03-02  
**适用系统**：CentOS 8 / CentOS Stream 8
