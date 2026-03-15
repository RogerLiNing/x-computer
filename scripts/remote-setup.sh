#!/usr/bin/env bash
# 远程服务器环境配置脚本
# 用法：./scripts/remote-setup.sh [环境名]

set -e
cd "$(dirname "$0")/.."
CONFIG_FILE="$(dirname "$0")/deploy.config.json"

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

ENV_NAME="${1:-staging}"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  远程服务器环境配置: $ENV_NAME"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 检查配置文件
if [ ! -f "$CONFIG_FILE" ]; then
  log_error "配置文件不存在: $CONFIG_FILE"
  exit 1
fi

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

log_info "目标服务器: $DEPLOY_HOST:$DEPLOY_PORT"
echo ""

# SSH 配置
SSH_OPTS="-o StrictHostKeyChecking=no"
SSH_PORT_OPT="-p $DEPLOY_PORT"
SCP_PORT_OPT="-P $DEPLOY_PORT"

if [ "$AUTH_TYPE" = "key" ] && [ -f "$AUTH_KEY_PATH" ]; then
  SSH_KEY_OPT="-i $AUTH_KEY_PATH"
else
  SSH_KEY_OPT=""
fi

# 1. 上传配置脚本
log_info "上传环境配置脚本..."
scp $SSH_OPTS $SCP_PORT_OPT $SSH_KEY_OPT -q ./scripts/setup-server.sh "$DEPLOY_HOST:/tmp/setup-server.sh"
log_success "脚本已上传"
echo ""

# 2. 执行配置脚本
log_info "在服务器上执行配置脚本..."
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

ssh $SSH_OPTS $SSH_PORT_OPT $SSH_KEY_OPT "$DEPLOY_HOST" "chmod +x /tmp/setup-server.sh && /tmp/setup-server.sh"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

log_success "服务器环境配置完成！"
echo ""

log_info "下一步："
echo "  1. 验证配置：npm run deploy:validate"
echo "  2. 测试连接：npm run deploy:test $ENV_NAME"
echo "  3. 开始部署：npm run deploy:$ENV_NAME"
echo ""
