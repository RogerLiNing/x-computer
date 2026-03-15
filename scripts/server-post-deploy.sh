#!/usr/bin/env bash
# 服务器部署后配置脚本
# 在服务器上执行，解决依赖安装和服务启动问题

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

DEPLOY_PATH="${1:-/apps/x-computer-staging}"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  服务器部署后配置"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

cd "$DEPLOY_PATH"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 1. 配置环境
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

log_info "配置环境..."

# 加载 NVM
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# 使用 Node.js 22
nvm use 22 2>/dev/null || nvm use default

log_success "Node.js: $(node -v)"
log_success "npm: $(npm -v)"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 2. 创建 .npmrc 配置 Python 3.9
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

log_info "配置 npm 使用 Python 3.9..."

if command -v python3.9 &>/dev/null; then
  PYTHON_PATH=$(which python3.9)
  log_success "找到 Python 3.9: $PYTHON_PATH"
  
  # 创建 .npmrc
  cat > .npmrc << EOF
python=$PYTHON_PATH
EOF
  
  log_success "已创建 .npmrc"
else
  log_warning "Python 3.9 未安装，将使用系统默认 Python"
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 3. 清理并重新安装依赖
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

log_info "清理并重新安装依赖..."

rm -rf node_modules package-lock.json
npm cache clean --force
rm -rf ~/.cache/node-gyp

# 检查是否有 GCC 工具集
if [ -d "/opt/rh/gcc-toolset-11" ]; then
  log_info "使用 GCC 工具集 11..."
  source /opt/rh/gcc-toolset-11/enable
  log_success "GCC: $(gcc --version | head -n1)"
fi

# 安装依赖
log_info "安装依赖（这可能需要几分钟）..."
npm install --omit=dev

log_success "依赖安装完成"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 4. 检查 PM2
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

log_info "检查 PM2..."

if ! command -v pm2 &>/dev/null; then
  log_warning "PM2 未安装，正在安装..."
  npm install -g pm2
  log_success "PM2 安装完成: $(pm2 -v)"
else
  log_success "PM2 已安装: $(pm2 -v)"
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 5. 启动服务
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

log_info "启动服务..."

# 停止旧服务
pm2 delete x-computer-server 2>/dev/null || true

# 启动新服务
X_COMPUTER_WORKSPACE="$DEPLOY_PATH" pm2 start server/dist/server/src/index.js \
  --name x-computer-server \
  --interpreter node \
  --cwd "$DEPLOY_PATH"

# 保存 PM2 配置
pm2 save

log_success "服务已启动"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 6. 显示状态
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  配置完成"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

log_info "服务状态："
pm2 status

echo ""
log_info "查看日志："
echo "  pm2 logs x-computer-server"
echo ""
log_info "重启服务："
echo "  pm2 restart x-computer-server"
echo ""
