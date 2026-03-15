#!/usr/bin/env bash
# Node.js 版本升级脚本
# 用法：在服务器上执行 curl -fsSL <url> | bash

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
echo "  Node.js 版本升级到 22"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 检查当前版本
if command -v node &>/dev/null; then
  CURRENT_VERSION=$(node -v)
  log_info "当前 Node.js 版本: $CURRENT_VERSION"
else
  log_warning "Node.js 未安装"
fi

# 安装 NVM
if [ ! -d "$HOME/.nvm" ]; then
  log_info "安装 NVM..."
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
  log_success "NVM 安装完成"
else
  log_info "NVM 已安装"
fi

# 加载 NVM
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# 验证 NVM
if ! command -v nvm &>/dev/null; then
  log_error "NVM 加载失败"
  log_info "请手动执行："
  echo "  source ~/.bashrc"
  echo "  source ~/.zshrc"
  exit 1
fi

# 安装 Node.js 22
log_info "安装 Node.js 22..."
nvm install 22
nvm use 22
nvm alias default 22

# 验证安装
NEW_VERSION=$(node -v)
log_success "Node.js 已升级: $NEW_VERSION"

# 配置 shell
log_info "配置 shell 环境..."

for RC_FILE in "$HOME/.bashrc" "$HOME/.zshrc"; do
  if [ -f "$RC_FILE" ]; then
    if ! grep -q "NVM_DIR" "$RC_FILE"; then
      log_info "添加 NVM 配置到 $RC_FILE"
      cat >> "$RC_FILE" <<'EOF'

# NVM Configuration
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"
EOF
    fi
  fi
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  升级完成"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

log_success "Node.js 版本: $(node -v)"
log_success "npm 版本: $(npm -v)"

echo ""
log_info "下一步："
echo "  1. 重新安装依赖："
echo "     cd /apps/x-computer-staging"
echo "     rm -rf node_modules package-lock.json"
echo "     npm install"
echo ""
echo "  2. 如果还有问题，尝试："
echo "     npm install --build-from-source=false"
echo ""
