# CentOS 8 部署完整指南

## 问题总结

在 CentOS 8 上部署 X-Computer 时遇到的主要问题：

### 1. Node.js 版本问题
- **问题**：服务器默认 Node.js v20.5.0，项目要求 >=22
- **解决**：使用 NVM 安装 Node.js 22

### 2. Python 版本问题
- **问题**：CentOS 8 默认 Python 3.6.8，`node-gyp` 需要 Python 3.7+
- **错误**：`SyntaxError: invalid syntax` (`:=` 运算符是 Python 3.8+ 特性)
- **解决**：安装 Python 3.9 并配置 npm 使用它

### 3. GCC 版本问题
- **问题**：GCC 8.5 不支持 C++20 标准
- **错误**：`g++: error: unrecognized command line option '-std=c++20'`
- **解决**：安装 GCC 工具集 11

### 4. GLIBC 版本问题
- **问题**：预编译的 `better-sqlite3` 需要 GLIBC 2.29+，CentOS 8 只有 2.28
- **解决**：跳过预编译，从源码编译

### 5. 部署脚本问题
- **问题**：部署时没有包含 `docker/` 目录和构建产物
- **解决**：更新部署脚本，打包 `dist` 目录，排除 `src` 目录

## 已修复的文件

### 1. 服务器配置脚本
- `scripts/setup-server.sh` - 使用 NVM 安装 Node.js 22
- `scripts/fix-centos8-deps.sh` - 一键修复 CentOS 8 依赖问题
- `scripts/server-post-deploy.sh` - 部署后配置脚本

### 2. 部署脚本
- `scripts/deploy.sh` - 单环境部署
  - 打包 `docker/` 目录
  - 打包构建产物 (`dist/`)，排除源代码 (`src/`)
  - 远程配置 Python 3.9 和 GCC 11
  - 使用 `--ignore-scripts` 跳过构建脚本
  - 单独编译 `better-sqlite3`
  - 检查构建产物是否存在
  - 自动安装 PM2

- `scripts/deploy-multi.sh` - 多环境部署
  - 相同的修复

### 3. 文档
- `docs/fixes/NODE_VERSION_FIX.md` - Node.js 版本升级指南
- `docs/fixes/CENTOS8_QUICK_FIX.md` - CentOS 8 快速修复
- `docs/deployment/CENTOS8_DEPLOYMENT_COMPLETE.md` - 本文档

## 部署流程

### 方案 1：自动部署（推荐）

```bash
# 在本地执行
npm run build
npm run deploy:staging
```

部署脚本会自动：
1. 构建项目
2. 打包构建产物
3. 上传到服务器
4. 配置环境（Node.js 22, Python 3.9, GCC 11）
5. 安装依赖
6. 启动服务

### 方案 2：手动部署

#### 步骤 1：配置服务器环境

```bash
# SSH 到服务器
ssh root@your-server

# 执行环境配置
cd /apps/x-computer-staging
bash scripts/fix-centos8-deps.sh
```

#### 步骤 2：在本地构建并上传

```bash
# 在本地
npm run build
rsync -avz --exclude 'node_modules' --exclude '.git' \
  ./ root@your-server:/apps/x-computer-staging/
```

#### 步骤 3：在服务器上安装依赖

```bash
# SSH 到服务器
cd /apps/x-computer-staging

# 加载环境
export NVM_DIR="$HOME/.nvm"
source "$NVM_DIR/nvm.sh"
nvm use 22

# 配置 Python
cat > .npmrc << 'EOF'
python=/usr/local/bin/python3.9
EOF

# 启用 GCC 11
source /opt/rh/gcc-toolset-11/enable

# 安装依赖
rm -rf node_modules package-lock.json
npm cache clean --force
npm install --ignore-scripts --omit=dev
npm rebuild better-sqlite3 --build-from-source

# 启动服务
pm2 delete x-computer 2>/dev/null || true
pm2 start server/dist/server/src/index.js \
  --name x-computer \
  --interpreter node \
  --cwd /apps/x-computer-staging

pm2 save
pm2 logs x-computer
```

## 环境要求

### 必需
- Node.js 22+ (通过 NVM 安装)
- Python 3.9+
- GCC 11+ (通过 gcc-toolset-11)
- PM2 (自动安装)

### 可选
- Docker (用于容器隔离)

## 常见问题

### Q1: npm install 仍然使用 Python 3.6

**A:** 确保 `.npmrc` 文件存在且配置正确：

```bash
cat > .npmrc << 'EOF'
python=/usr/local/bin/python3.9
EOF
```

### Q2: better-sqlite3 编译失败

**A:** 使用跳过构建脚本的方式：

```bash
npm install --ignore-scripts --omit=dev
npm rebuild better-sqlite3 --build-from-source
```

### Q3: PM2 找不到命令

**A:** 全局安装 PM2：

```bash
npm install -g pm2
```

### Q4: 服务启动失败，提示找不到模块

**A:** 检查构建产物是否存在：

```bash
ls -la server/dist/server/src/index.js
```

如果不存在，在本地重新构建：

```bash
npm run build
```

### Q5: Docker 镜像不存在

**A:** 构建沙箱镜像：

```bash
cd /apps/x-computer-staging
docker build -f docker/sandbox.Dockerfile -t x-computer-sandbox:latest .
pm2 restart x-computer
```

## 验证部署

```bash
# 检查服务状态
pm2 status

# 查看日志
pm2 logs x-computer

# 测试 API
curl http://localhost:4000/health

# 检查版本
node -v  # 应该是 v22.x.x
python3.9 --version  # 应该是 3.9.x
gcc --version  # 应该是 11.x.x (如果启用了 gcc-toolset-11)
```

## 性能优化

### 1. 启用容器隔离

```bash
# 构建沙箱镜像
docker build -f docker/sandbox.Dockerfile -t x-computer-sandbox:latest .

# 重启服务
pm2 restart x-computer
```

### 2. 配置 PM2 自动重启

```bash
# 配置开机自启
pm2 startup

# 保存当前进程列表
pm2 save
```

### 3. 配置日志轮转

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
```

## 监控和维护

### 查看服务状态

```bash
pm2 status
pm2 monit
```

### 查看日志

```bash
# 实时日志
pm2 logs x-computer

# 错误日志
pm2 logs x-computer --err

# 最近 100 行
pm2 logs x-computer --lines 100
```

### 重启服务

```bash
pm2 restart x-computer
```

### 更新部署

```bash
# 在本地
npm run build
npm run deploy:staging

# 或在服务器上
cd /apps/x-computer-staging
git pull
npm install --ignore-scripts --omit=dev
npm rebuild better-sqlite3 --build-from-source
pm2 restart x-computer
```

## 故障排查

### 1. 服务无法启动

```bash
# 查看详细错误
pm2 logs x-computer --err --lines 50

# 检查构建产物
ls -la server/dist/server/src/index.js

# 检查依赖
npm list better-sqlite3
```

### 2. 依赖安装失败

```bash
# 查看 npm 日志
cat ~/.npm/_logs/*-debug-0.log | tail -100

# 检查环境
echo "Node: $(node -v)"
echo "Python: $(python3.9 --version)"
echo "GCC: $(gcc --version | head -n1)"
```

### 3. 内存不足

```bash
# 查看内存使用
pm2 monit

# 限制内存
pm2 delete x-computer
pm2 start server/dist/server/src/index.js \
  --name x-computer \
  --max-memory-restart 1G
```

## 相关文档

- [部署快速开始](../DEPLOYMENT_QUICKSTART.md)
- [Node.js 版本修复](../fixes/NODE_VERSION_FIX.md)
- [CentOS 8 快速修复](../fixes/CENTOS8_QUICK_FIX.md)
- [服务器配置](../SERVER_SETUP.md)
- [容器隔离配置](../HOW_TO_ENABLE_CONTAINER_ISOLATION.md)
