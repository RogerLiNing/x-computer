# 部署问题快速修复

## 🎯 当前问题

你的服务器 `root@your-server-ip` 遇到了两个问题：

1. ❌ **Node.js 版本过低**：18.0.0（需要 20+）
2. ❌ **PM2 未安装**
3. ❌ **依赖包缺失**：`Cannot find package 'ws'`

---

## ⚡ 快速修复（5 分钟）

### 步骤 1：安装 Node.js 20 + PM2

复制以下命令，在**服务器上**执行：

```bash
# SSH 登录服务器
ssh root@your-server-ip

# 一键安装（NVM 方式）
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash && \
export NVM_DIR="$HOME/.nvm" && \
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh" && \
nvm install 20 && \
nvm use 20 && \
nvm alias default 20 && \
npm install -g pm2 && \
pm2 startup && \
mkdir -p /apps && \
echo "✅ 环境配置完成！"

# 验证
node -v  # 应该显示 v20.x.x
pm2 -v   # 应该显示版本号

# 退出服务器
exit
```

### 步骤 2：重新部署

回到**本地电脑**执行：

```bash
# 重新部署
npm run deploy:staging

# 查看日志
ssh root@your-server-ip 'pm2 logs x-computer'
```

---

## 🔍 如果还有问题

### 问题 A：依赖安装失败

在服务器上手动安装：

```bash
ssh root@your-server-ip

cd /apps/x-computer-staging

# 重新安装所有依赖
npm install

# 或分别安装
npm install --workspace=shared
npm install --workspace=server
npm install --workspace=frontend
npm install --workspace=workflow-engine

# 重启
pm2 restart x-computer
```

### 问题 B：PM2 找不到

添加到 PATH：

```bash
# 在服务器上执行
echo 'export PATH="$HOME/.nvm/versions/node/$(nvm current)/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc

# 或创建软链接
sudo ln -sf $(which pm2) /usr/bin/pm2
```

### 问题 C：端口被占用

```bash
# 查看端口占用
lsof -i :4000

# 杀死进程
pm2 delete x-computer
pm2 start server/dist/server/src/index.js --name x-computer
```

---

## 📝 完整命令（复制粘贴）

### 在服务器上执行

```bash
# 1. 安装环境
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
nvm install 20
nvm use 20
nvm alias default 20
npm install -g pm2
pm2 startup
mkdir -p /apps

# 2. 进入部署目录（如果已部署）
cd /apps/x-computer-staging

# 3. 重新安装依赖
npm install

# 4. 重启服务
pm2 restart x-computer || pm2 start server/dist/server/src/index.js --name x-computer --cwd /apps/x-computer-staging

# 5. 查看状态
pm2 list
pm2 logs x-computer --lines 50
```

### 在本地执行

```bash
# 如果服务器环境已配置好，重新部署
npm run deploy:staging
```

---

## ✅ 验证清单

- [ ] Node.js 版本 >= 20.0.0
- [ ] PM2 已安装
- [ ] 依赖包已安装（`node_modules` 存在）
- [ ] PM2 进程运行中
- [ ] 日志无错误
- [ ] API 可访问

---

## 🎯 预期结果

```bash
# pm2 list
┌─────┬──────────────────────┬─────────┬─────────┬──────────┐
│ id  │ name                 │ mode    │ status  │ cpu      │
├─────┼──────────────────────┼─────────┼─────────┼──────────┤
│ 0   │ x-computer           │ fork    │ online  │ 0%       │
│ 1   │ x-computer-workflow  │ fork    │ online  │ 0%       │
└─────┴──────────────────────┴─────────┴─────────┴──────────┘

# pm2 logs x-computer
✅ 服务器启动成功
✅ 监听端口 4000
```

---

## 📚 相关文档

- [手动配置指南](docs/MANUAL_SERVER_SETUP.md)
- [CentOS 8 修复](docs/CENTOS8_FIX.md)
- [部署速查表](DEPLOYMENT_CHEATSHEET.md)

---

**快速修复指南** ⚡  
**预计时间**：5 分钟
