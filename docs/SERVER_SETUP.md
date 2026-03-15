## 🖥️ 服务器环境配置指南

本文档介绍如何配置服务器环境以运行 X-Computer。

---

## 📋 环境要求

### 最低要求

- **操作系统**：Ubuntu 20.04+ / CentOS 7+ / Debian 10+
- **Node.js**：20.0.0+
- **内存**：4 GB
- **磁盘**：20 GB
- **CPU**：2 核

### 推荐配置

- **操作系统**：Ubuntu 22.04 LTS
- **Node.js**：20.x LTS
- **内存**：8 GB
- **磁盘**：50 GB
- **CPU**：4 核

---

## 🚀 快速配置（自动化）

### 方式 1：远程自动配置（推荐）

从本地电脑一键配置远程服务器：

```bash
# 配置测试环境
npm run deploy:setup staging

# 配置生产环境
npm run deploy:setup production
```

**自动完成**：
- ✅ 安装 Node.js 20+
- ✅ 安装 PM2
- ✅ 安装 Docker（可选）
- ✅ 创建部署目录
- ✅ 配置防火墙（可选）

### 方式 2：服务器上手动执行

```bash
# 1. SSH 登录服务器
ssh user@your-server.com

# 2. 下载配置脚本
curl -fsSL https://raw.githubusercontent.com/your-repo/x-computer/main/scripts/setup-server.sh -o setup-server.sh

# 3. 执行配置
chmod +x setup-server.sh
./setup-server.sh
```

---

## 🔧 手动配置

如果自动配置失败，可以手动安装。

### 1. 安装 Node.js 20+

#### Ubuntu/Debian

```bash
# 添加 NodeSource 仓库
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -

# 安装 Node.js
sudo apt-get install -y nodejs

# 验证
node -v  # 应该显示 v20.x.x
npm -v
```

#### CentOS/RHEL

```bash
# 添加 NodeSource 仓库
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -

# 安装 Node.js
sudo yum install -y nodejs

# 验证
node -v
npm -v
```

#### Alpine Linux

```bash
# 安装 Node.js
apk add --no-cache nodejs npm

# 验证
node -v
npm -v
```

### 2. 安装 PM2

```bash
# 全局安装 PM2
npm install -g pm2

# 验证
pm2 -v

# 配置开机自启
pm2 startup
# 按照提示执行命令
```

### 3. 安装 Docker（可选，容器隔离需要）

#### Ubuntu/Debian

```bash
# 安装 Docker
curl -fsSL https://get.docker.com | sh

# 添加当前用户到 docker 组
sudo usermod -aG docker $USER

# 启动 Docker
sudo systemctl start docker
sudo systemctl enable docker

# 验证
docker --version

# 重新登录以使权限生效
exit
```

#### CentOS/RHEL

```bash
# 安装 Docker
curl -fsSL https://get.docker.com | sh

# 启动 Docker
sudo systemctl start docker
sudo systemctl enable docker

# 添加用户到 docker 组
sudo usermod -aG docker $USER

# 验证
docker --version

# 重新登录
exit
```

### 4. 创建部署目录

```bash
# 创建目录
sudo mkdir -p /apps

# 授权给当前用户
sudo chown -R $USER:$USER /apps

# 验证
ls -la /apps
```

### 5. 配置防火墙

#### Ubuntu/Debian (UFW)

```bash
# 允许 SSH
sudo ufw allow 22/tcp

# 允许 HTTP/HTTPS
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# 允许 X-Computer API
sudo ufw allow 4000/tcp

# 启用防火墙
sudo ufw enable

# 查看状态
sudo ufw status
```

#### CentOS/RHEL (firewalld)

```bash
# 允许端口
sudo firewall-cmd --permanent --add-port=22/tcp
sudo firewall-cmd --permanent --add-port=80/tcp
sudo firewall-cmd --permanent --add-port=443/tcp
sudo firewall-cmd --permanent --add-port=4000/tcp

# 重载配置
sudo firewall-cmd --reload

# 查看状态
sudo firewall-cmd --list-all
```

---

## ✅ 验证环境

### 1. 检查 Node.js

```bash
node -v
# 应该显示 v20.x.x 或更高

npm -v
# 应该显示 10.x.x 或更高
```

### 2. 检查 PM2

```bash
pm2 -v
# 应该显示版本号

pm2 list
# 应该显示进程列表（可能为空）
```

### 3. 检查 Docker（可选）

```bash
docker --version
# 应该显示版本号

docker ps
# 应该能正常执行（可能为空）
```

### 4. 检查目录权限

```bash
ls -la /apps
# 应该显示当前用户有读写权限
```

---

## 🔍 故障排查

### 问题 1：Node.js 版本过低

**错误信息**：

```
❌ This package requires Node.js 20+ to run reliably.
You are using Node.js 18.0.0.
```

**解决**：

```bash
# 卸载旧版本
sudo apt remove nodejs npm

# 安装新版本
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# 验证
node -v
```

### 问题 2：PM2 未安装

**错误信息**：

```
bash: pm2: command not found
```

**解决**：

```bash
# 安装 PM2
npm install -g pm2

# 如果权限不足
sudo npm install -g pm2

# 验证
pm2 -v
```

### 问题 3：权限不足

**错误信息**：

```
EACCES: permission denied, mkdir '/apps/x-computer'
```

**解决**：

```bash
# 创建目录并授权
sudo mkdir -p /apps
sudo chown -R $USER:$USER /apps

# 或使用 sudo 部署
sudo npm run deploy
```

### 问题 4：Docker 权限问题

**错误信息**：

```
permission denied while trying to connect to the Docker daemon socket
```

**解决**：

```bash
# 添加用户到 docker 组
sudo usermod -aG docker $USER

# 重新登录
exit
ssh user@your-server.com

# 验证
docker ps
```

### 问题 5：防火墙阻止连接

**现象**：本地无法访问服务器的 4000 端口

**解决**：

```bash
# Ubuntu/Debian
sudo ufw allow 4000/tcp
sudo ufw reload

# CentOS/RHEL
sudo firewall-cmd --permanent --add-port=4000/tcp
sudo firewall-cmd --reload
```

---

## 📊 环境检查清单

部署前请确认：

- [ ] Node.js 版本 >= 20.0.0
- [ ] npm 版本 >= 10.0.0
- [ ] PM2 已安装
- [ ] Docker 已安装（容器模式需要）
- [ ] /apps 目录存在且有权限
- [ ] 防火墙已配置
- [ ] SSH 连接正常

---

## 🎯 快速命令参考

| 命令 | 说明 |
|------|------|
| `npm run deploy:setup staging` | 自动配置测试环境 |
| `npm run deploy:setup production` | 自动配置生产环境 |
| `node -v` | 检查 Node.js 版本 |
| `pm2 -v` | 检查 PM2 版本 |
| `docker --version` | 检查 Docker 版本 |
| `pm2 list` | 查看运行中的进程 |
| `pm2 logs x-computer` | 查看应用日志 |

---

## 📚 相关文档

- [部署快速开始](./DEPLOYMENT_QUICKSTART.md)
- [SSH 密钥配置](./SSH_KEY_SETUP.md)
- [完整部署指南](./DEPLOYMENT_GUIDE.md)

---

**最后更新**：2026-03-02  
**版本**：v1.0
