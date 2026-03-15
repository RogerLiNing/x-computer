#!/usr/bin/env bash
# 服务器环境自动配置脚本
# 用法：在服务器上执行此脚本，自动安装所需环境

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
echo "  X-Computer 服务器环境配置"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 检测操作系统
if [ -f /etc/os-release ]; then
  . /etc/os-release
  OS=$ID
  VERSION=$VERSION_ID
else
  OS=$(uname -s)
fi

log_info "操作系统: $OS $VERSION"
echo ""

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 1. 检查并安装 Node.js 22+ (使用 NVM)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

log_info "检查 Node.js..."

REQUIRED_NODE_VERSION=22

if command -v node &>/dev/null; then
  NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
  log_info "当前 Node.js 版本: $(node -v)"
  
  if [ "$NODE_VERSION" -lt "$REQUIRED_NODE_VERSION" ]; then
    log_warning "Node.js 版本过低（需要 ${REQUIRED_NODE_VERSION}+），准备升级"
    NEED_NODE_INSTALL=true
  else
    log_success "Node.js 版本符合要求"
    NEED_NODE_INSTALL=false
  fi
else
  log_warning "Node.js 未安装"
  NEED_NODE_INSTALL=true
fi

if [ "$NEED_NODE_INSTALL" = true ]; then
  log_info "使用 NVM 安装 Node.js ${REQUIRED_NODE_VERSION}..."
  
  # 检查是否已安装 NVM
  if [ ! -d "$HOME/.nvm" ]; then
    log_info "安装 NVM..."
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
    
    # 加载 NVM
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
    
    log_success "NVM 安装完成"
  else
    log_info "NVM 已安装"
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
  fi
  
  # 安装 Node.js 22
  log_info "安装 Node.js ${REQUIRED_NODE_VERSION}..."
  nvm install ${REQUIRED_NODE_VERSION}
  nvm use ${REQUIRED_NODE_VERSION}
  nvm alias default ${REQUIRED_NODE_VERSION}
  
  log_success "Node.js 安装完成: $(node -v)"
  
  # 确保 .bashrc 和 .zshrc 中有 NVM 配置
  for RC_FILE in "$HOME/.bashrc" "$HOME/.zshrc"; do
    if [ -f "$RC_FILE" ]; then
      if ! grep -q "NVM_DIR" "$RC_FILE"; then
        log_info "配置 NVM 到 $RC_FILE..."
        cat >> "$RC_FILE" <<'EOF'

# NVM Configuration
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"
EOF
      fi
    fi
  done
  
  log_success "NVM 配置完成"
fi

echo ""

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 2. 检查并安装 PM2
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

log_info "检查 PM2..."

if command -v pm2 &>/dev/null; then
  log_success "PM2 已安装: $(pm2 -v)"
else
  log_warning "PM2 未安装"
  log_info "安装 PM2..."
  
  npm install -g pm2
  
  log_success "PM2 安装完成: $(pm2 -v)"
  
  # 配置 PM2 开机自启
  log_info "配置 PM2 开机自启..."
  pm2 startup || true
fi

echo ""

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 3. 检查并安装 Docker（可选）
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

log_info "检查 Docker..."

if command -v docker &>/dev/null; then
  log_success "Docker 已安装: $(docker --version)"
else
  log_warning "Docker 未安装（容器隔离需要）"
  
  read -p "是否安装 Docker？(y/n): " INSTALL_DOCKER
  
  if [ "$INSTALL_DOCKER" = "y" ] || [ "$INSTALL_DOCKER" = "Y" ]; then
    log_info "安装 Docker..."
    
    if [ "$OS" = "ubuntu" ] || [ "$OS" = "debian" ]; then
      # Ubuntu/Debian
      curl -fsSL https://get.docker.com | sh
      sudo usermod -aG docker $USER
      
    elif [ "$OS" = "centos" ] || [ "$OS" = "rhel" ]; then
      # CentOS/RHEL
      curl -fsSL https://get.docker.com | sh
      sudo systemctl start docker
      sudo systemctl enable docker
      sudo usermod -aG docker $USER
      
    else
      log_warning "请手动安装 Docker: https://docs.docker.com/engine/install/"
    fi
    
    log_success "Docker 安装完成"
    log_warning "需要重新登录以使 Docker 权限生效"
  else
    log_info "跳过 Docker 安装"
  fi
fi

echo ""

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 4. 创建部署目录
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

log_info "创建部署目录..."

DEPLOY_DIR="/apps"

if [ ! -d "$DEPLOY_DIR" ]; then
  sudo mkdir -p "$DEPLOY_DIR"
  sudo chown -R $USER:$USER "$DEPLOY_DIR"
  log_success "创建目录: $DEPLOY_DIR"
else
  log_success "目录已存在: $DEPLOY_DIR"
fi

echo ""

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 5. 配置防火墙（可选）
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

log_info "检查防火墙..."

if command -v ufw &>/dev/null; then
  log_info "检测到 UFW 防火墙"
  
  read -p "是否配置防火墙规则？(y/n): " CONFIG_FIREWALL
  
  if [ "$CONFIG_FIREWALL" = "y" ] || [ "$CONFIG_FIREWALL" = "Y" ]; then
    log_info "配置防火墙规则..."
    
    sudo ufw allow 22/tcp    # SSH
    sudo ufw allow 80/tcp    # HTTP
    sudo ufw allow 443/tcp   # HTTPS
    sudo ufw allow 4000/tcp  # X-Computer API
    
    log_success "防火墙规则已配置"
  fi
fi

echo ""

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 总结
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  环境配置完成"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

log_success "环境配置完成！"
echo ""

log_info "已安装的软件："
echo "  - Node.js: $(node -v)"
echo "  - npm: $(npm -v)"
echo "  - PM2: $(pm2 -v)"
if command -v docker &>/dev/null; then
  echo "  - Docker: $(docker --version)"
fi

echo ""
log_info "下一步："
echo "  1. 在本地配置部署：cp scripts/deploy.config.example.json scripts/deploy.config.json"
echo "  2. 编辑配置文件，填入服务器信息"
echo "  3. 部署应用：npm run deploy:staging"
echo ""
