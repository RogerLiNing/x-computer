#!/usr/bin/env bash
# 测试 SSH 连接

set -e
cd "$(dirname "$0")/.."
CONFIG_FILE="$(dirname "$0")/deploy.config.json"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}ℹ️  $1${NC}"; }
log_success() { echo -e "${GREEN}✅ $1${NC}"; }
log_error() { echo -e "${RED}❌ $1${NC}"; }

ENV_NAME="${1:-staging}"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  测试 SSH 连接: $ENV_NAME"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 读取配置
ENV_CONFIG=$(node -e "
  const config = require('$CONFIG_FILE');
  const env = config.environments?.['$ENV_NAME'];
  if (!env) {
    console.error('环境不存在: $ENV_NAME');
    process.exit(1);
  }
  console.log(JSON.stringify(env));
")

# 解析配置
DEPLOY_HOST=$(echo "$ENV_CONFIG" | node -e "const c=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(c.host || '');")
DEPLOY_PORT=$(echo "$ENV_CONFIG" | node -e "const c=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(c.port || 22);")
AUTH_TYPE=$(echo "$ENV_CONFIG" | node -e "const c=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(c.auth?.type || 'key');")
AUTH_KEY_PATH=$(echo "$ENV_CONFIG" | node -e "const c=JSON.parse(require('fs').readFileSync(0,'utf8')); const p=c.auth?.keyPath || '~/.ssh/id_rsa'; console.log(p.replace(/^~/, process.env.HOME));")

log_info "主机: $DEPLOY_HOST"
log_info "端口: $DEPLOY_PORT"
log_info "认证: $AUTH_TYPE"

if [ "$AUTH_TYPE" = "key" ]; then
  log_info "密钥: $AUTH_KEY_PATH"
  
  if [ ! -f "$AUTH_KEY_PATH" ]; then
    log_error "密钥文件不存在: $AUTH_KEY_PATH"
    exit 1
  fi
  
  log_success "密钥文件存在"
  
  # 测试连接
  log_info "测试 SSH 连接..."
  echo ""
  
  SSH_CMD="ssh -i $AUTH_KEY_PATH -p $DEPLOY_PORT -o StrictHostKeyChecking=no -o ConnectTimeout=10 $DEPLOY_HOST"
  
  echo "执行命令:"
  echo "  $SSH_CMD 'echo \"连接成功！\" && uname -a'"
  echo ""
  
  if $SSH_CMD 'echo "连接成功！" && uname -a'; then
    echo ""
    log_success "SSH 连接测试通过！"
  else
    echo ""
    log_error "SSH 连接失败"
    exit 1
  fi
fi

echo ""
