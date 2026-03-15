#!/usr/bin/env bash
# CentOS 8 依赖修复脚本
# 解决 Python 版本和 GLIBC 版本问题

set -e

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}>>> $1${NC}"; }
log_success() { echo -e "${GREEN}✅ $1${NC}"; }
log_warning() { echo -e "${YELLOW}⚠️  $1${NC}"; }
log_error() { echo -e "${RED}❌ $1${NC}"; }

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  CentOS 8 依赖修复"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 检查系统版本
if [ -f /etc/os-release ]; then
  . /etc/os-release
  log_info "操作系统: $ID $VERSION_ID"
else
  log_error "无法检测操作系统版本"
  exit 1
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 1. 升级 Python 到 3.9+
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

log_info "检查 Python 版本..."

PYTHON_VERSION=$(python3 --version 2>&1 | awk '{print $2}' | cut -d. -f1,2)
log_info "当前 Python 版本: $PYTHON_VERSION"

if [[ $(echo "$PYTHON_VERSION < 3.7" | bc -l) -eq 1 ]]; then
  log_warning "Python 版本过低，需要升级到 3.9+"
  
  log_info "安装 Python 3.9..."
  
  # 启用 PowerTools 仓库
  sudo dnf config-manager --set-enabled powertools 2>/dev/null || \
  sudo dnf config-manager --set-enabled PowerTools 2>/dev/null || true
  
  # 安装 Python 3.9
  sudo dnf install -y python39 python39-devel
  
  # 设置 npm 使用 Python 3.9
  npm config set python python3.9
  
  log_success "Python 3.9 安装完成: $(python3.9 --version)"
else
  log_success "Python 版本符合要求"
  npm config set python python3
fi

echo ""

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 2. 安装编译工具
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

log_info "安装编译工具..."

sudo dnf groupinstall -y "Development Tools" || true
sudo dnf install -y gcc-c++ make

log_success "编译工具安装完成"

echo ""

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 3. 清理并重新安装
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

if [ -d "/apps/x-computer-staging" ]; then
  log_info "清理旧的依赖..."
  cd /apps/x-computer-staging
  rm -rf node_modules package-lock.json
  
  # 清理 npm 缓存
  npm cache clean --force
  
  # 清理 node-gyp 缓存
  rm -rf ~/.cache/node-gyp
  
  log_success "清理完成"
  echo ""
  
  log_info "重新安装依赖..."
  
  # 尝试安装，如果失败则使用预编译版本
  if npm install; then
    log_success "依赖安装成功！"
  else
    log_warning "标准安装失败，尝试使用预编译版本..."
    
    # 使用预编译版本
    npm install --build-from-source=false || {
      log_error "预编译版本也失败了"
      log_info "尝试最后的方案：跳过 better-sqlite3 的预构建..."
      
      # 强制从源码编译，但使用更宽松的选项
      npm install --ignore-scripts
      npm rebuild better-sqlite3 --build-from-source || {
        log_error "所有安装方式都失败了"
        log_info "建议："
        echo "  1. 检查 Python 版本：python3.9 --version"
        echo "  2. 检查 GCC 版本：gcc --version"
        echo "  3. 查看完整日志：cat ~/.npm/_logs/*-debug-0.log"
        exit 1
      }
    }
  fi
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  修复完成"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

log_success "环境配置："
echo "  - Node.js: $(node -v)"
echo "  - npm: $(npm -v)"
echo "  - Python: $(python3.9 --version 2>/dev/null || python3 --version)"
echo "  - GCC: $(gcc --version | head -n1)"

echo ""
log_info "验证安装："
echo "  cd /apps/x-computer-staging"
echo "  npm run build"
echo "  npm run start:prod"
echo ""
