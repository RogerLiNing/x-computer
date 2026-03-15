# CentOS 8 快速修复指南

## 当前问题

在 CentOS 8 上安装依赖时遇到以下错误：

1. ✅ Node.js 已升级到 v22.22.0
2. ❌ Python 3.6.8 版本过低（需要 3.7+）
3. ❌ GLIBC 2.28 版本过低（预编译二进制需要 2.29+）
4. ❌ `node-gyp` 编译失败

## 立即执行（复制粘贴到服务器）

```bash
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 步骤 1：安装 Python 3.9
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

echo ">>> 安装 Python 3.9..."

# 启用 PowerTools 仓库
sudo dnf config-manager --set-enabled powertools 2>/dev/null || \
sudo dnf config-manager --set-enabled PowerTools 2>/dev/null || true

# 安装 Python 3.9
sudo dnf install -y python39 python39-devel

# 配置 npm 使用 Python 3.9
npm config set python python3.9

echo "✅ Python 版本: $(python3.9 --version)"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 步骤 2：安装编译工具
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

echo ">>> 安装编译工具..."

sudo dnf groupinstall -y "Development Tools" 2>/dev/null || true
sudo dnf install -y gcc-c++ make

echo "✅ GCC 版本: $(gcc --version | head -n1)"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 步骤 3：清理并重新安装
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

echo ">>> 清理旧依赖..."

cd /apps/x-computer-staging
rm -rf node_modules package-lock.json

# 清理缓存
npm cache clean --force
rm -rf ~/.cache/node-gyp

echo ">>> 重新安装依赖（这可能需要几分钟）..."

# 尝试安装
npm install

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  安装完成！"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "✅ Node.js: $(node -v)"
echo "✅ npm: $(npm -v)"
echo "✅ Python: $(python3.9 --version)"
echo ""
echo "下一步："
echo "  npm run build"
echo "  npm run start:prod"
echo ""
```

## 如果上面的命令仍然失败

### 尝试方案 A：跳过预构建

```bash
cd /apps/x-computer-staging
rm -rf node_modules package-lock.json

# 先安装其他依赖（跳过构建脚本）
npm install --ignore-scripts

# 单独编译 better-sqlite3
npm rebuild better-sqlite3 --build-from-source
```

### 尝试方案 B：使用 GCC 工具集 11

```bash
# 安装 GCC 工具集
sudo dnf install -y gcc-toolset-11

# 在新的 shell 中使用 GCC 11
scl enable gcc-toolset-11 bash

# 重新安装
cd /apps/x-computer-staging
rm -rf node_modules package-lock.json
npm config set python python3.9
npm install
```

### 尝试方案 C：降级 better-sqlite3

如果所有方案都失败，可以尝试使用较旧版本的 `better-sqlite3`：

```bash
cd /apps/x-computer-staging

# 编辑 package.json，将 better-sqlite3 版本改为 9.6.0
# "better-sqlite3": "^9.6.0"

rm -rf node_modules package-lock.json
npm install
```

## 验证安装

```bash
# 测试 better-sqlite3
node -e "const db = require('better-sqlite3')(':memory:'); console.log('✅ better-sqlite3 工作正常');"

# 构建项目
npm run build

# 启动服务
npm run start:prod
```

## 错误排查

### 查看详细日志

```bash
# 查看最新的 npm 错误日志
cat ~/.npm/_logs/*-debug-0.log | tail -100
```

### 检查环境

```bash
echo "Node.js: $(node -v)"
echo "npm: $(npm -v)"
echo "Python: $(python3.9 --version 2>/dev/null || python3 --version)"
echo "GCC: $(gcc --version | head -n1)"
echo "npm Python 配置: $(npm config get python)"
```

### 手动测试编译

```bash
cd /apps/x-computer-staging/node_modules/better-sqlite3

# 清理
rm -rf build

# 手动编译
node-gyp rebuild --python=python3.9
```

## 相关文档

- [完整修复指南](./NODE_VERSION_FIX.md)
- [CentOS 8 修复](../CENTOS8_FIX.md)
- [部署快速开始](../DEPLOYMENT_QUICKSTART.md)
