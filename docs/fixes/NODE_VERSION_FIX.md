# Node.js 版本升级修复指南

## 问题描述

服务器上 Node.js 版本为 v20.5.0，但项目要求 Node.js >=22，导致：
1. `npm install` 时出现 `EBADENGINE` 警告
2. `better-sqlite3` 编译失败，原因：
   - **Python 版本过低**：CentOS 8 默认 Python 3.6.8，但 node-gyp 需要 Python 3.7+
   - **GLIBC 版本过低**：预编译二进制需要 GLIBC 2.29+，但 CentOS 8 只有 2.28
   - **GCC 版本过旧**：不支持 C++20 标准

## 快速修复（在服务器上执行）

### 一键修复脚本（推荐）

```bash
# 下载并执行修复脚本
curl -fsSL https://raw.githubusercontent.com/YOUR_REPO/x-computer/main/scripts/fix-centos8-deps.sh | bash

# 或者如果已经克隆了代码
cd /apps/x-computer-staging
bash scripts/fix-centos8-deps.sh
```

### 手动修复步骤

### 步骤 1：升级 Python 到 3.9+

```bash
# 启用 PowerTools 仓库
sudo dnf config-manager --set-enabled powertools || \
sudo dnf config-manager --set-enabled PowerTools

# 安装 Python 3.9
sudo dnf install -y python39 python39-devel

# 配置 npm 使用 Python 3.9
npm config set python python3.9

# 验证版本
python3.9 --version  # 应该显示 3.9.x
```

### 步骤 2：安装编译工具

```bash
# 安装开发工具
sudo dnf groupinstall -y "Development Tools"
sudo dnf install -y gcc-c++ make

# 验证 GCC
gcc --version
```

### 步骤 3：升级 Node.js 到 22

```bash
# 使用 NVM 安装 Node.js 22
nvm install 22
nvm use 22
nvm alias default 22

# 验证版本
node -v  # 应该显示 v22.x.x
```

### 步骤 4：清理并重新安装依赖

```bash
cd /apps/x-computer-staging

# 清理旧依赖
rm -rf node_modules package-lock.json

# 清理缓存
npm cache clean --force
rm -rf ~/.cache/node-gyp

# 重新安装
npm install
```

### 备选方案：如果仍然失败

#### 方案 A：使用预编译版本（可能因 GLIBC 版本问题失败）

```bash
cd /apps/x-computer-staging
rm -rf node_modules package-lock.json
npm install --build-from-source=false
```

#### 方案 B：跳过预构建，直接编译

```bash
cd /apps/x-computer-staging
rm -rf node_modules package-lock.json

# 先安装其他依赖
npm install --ignore-scripts

# 单独编译 better-sqlite3
npm rebuild better-sqlite3 --build-from-source
```

#### 方案 C：升级 GCC 工具链

```bash
# 安装更新的 GCC 工具集
sudo dnf install -y gcc-toolset-11

# 使用新的 GCC 编译
scl enable gcc-toolset-11 bash
cd /apps/x-computer-staging
rm -rf node_modules package-lock.json
npm install
```

## 自动化脚本

我们已更新 `scripts/setup-server.sh` 脚本，现在会自动：
1. 使用 NVM 安装 Node.js 22
2. 配置环境变量
3. 设置默认版本

重新运行服务器配置：

```bash
# 在本地执行
npm run deploy:setup staging
```

## 验证安装

```bash
# 检查 Node.js 版本
node -v  # 应该 >= v22.0.0

# 检查 npm 版本
npm -v

# 测试 better-sqlite3
node -e "console.log(require('better-sqlite3'))"
```

## 常见问题

### Q1: Python 语法错误 `SyntaxError: invalid syntax`

**错误信息**：
```
File "gyp_main.py", line 42
  if flags := os.environ.get(env_name) or []:
            ^
SyntaxError: invalid syntax
```

**原因**：Python 版本过低（3.6），`:=` 运算符需要 Python 3.8+

**解决**：
```bash
# 安装 Python 3.9
sudo dnf install -y python39 python39-devel

# 配置 npm
npm config set python python3.9

# 验证
python3.9 --version
```

### Q2: GLIBC 版本错误

**错误信息**：
```
/lib64/libm.so.6: version `GLIBC_2.29' not found
```

**原因**：预编译的二进制需要更新的 GLIBC，但 CentOS 8 只有 2.28

**解决**：不使用预编译版本，从源码编译：
```bash
npm config set python python3.9
npm install --build-from-source
```

### Q3: GCC 不支持 `-std=c++20`

**错误信息**：
```
g++: error: unrecognized command line option '-std=c++20'
```

**原因**：GCC 版本过旧（< 10）

**解决**：
```bash
# 安装 GCC 工具集 11
sudo dnf install -y gcc-toolset-11

# 使用新的 GCC
scl enable gcc-toolset-11 bash
npm install
```

### Q4: 权限问题

**解决**：
```bash
# 检查目录所有者
ls -la /apps/x-computer-staging

# 修改所有者（如果需要）
sudo chown -R $USER:$USER /apps/x-computer-staging
```

## 下一步

升级完成后：

1. **测试构建**：
   ```bash
   npm run build
   ```

2. **启动服务**：
   ```bash
   npm run start:prod
   ```

3. **验证运行**：
   ```bash
   curl http://localhost:4000/health
   ```

## 相关文档

- [部署快速开始](../DEPLOYMENT_QUICKSTART.md)
- [服务器配置](../SERVER_SETUP.md)
- [CentOS 8 修复](../CENTOS8_FIX.md)
