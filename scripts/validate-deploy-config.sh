#!/usr/bin/env bash
# 验证部署配置文件

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
log_warning() { echo -e "${YELLOW}⚠️  $1${NC}"; }
log_error() { echo -e "${RED}❌ $1${NC}"; }

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  部署配置验证"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 检查配置文件
if [ ! -f "$CONFIG_FILE" ]; then
  log_error "配置文件不存在: $CONFIG_FILE"
  echo ""
  echo "请执行："
  echo "  cp scripts/deploy.config.example.json scripts/deploy.config.json"
  echo ""
  exit 1
fi

log_success "配置文件存在: $CONFIG_FILE"
echo ""

# 验证 JSON 格式
if ! node -e "require('$CONFIG_FILE')" 2>/dev/null; then
  log_error "配置文件 JSON 格式错误"
  exit 1
fi

log_success "JSON 格式正确"
echo ""

# 获取所有环境
ENVS=$(node -e "const c = require('$CONFIG_FILE'); console.log(Object.keys(c.environments || {}).join(' '));")

if [ -z "$ENVS" ]; then
  log_error "未配置任何环境"
  exit 1
fi

log_info "找到 $(echo $ENVS | wc -w | xargs) 个环境"
echo ""

# 验证每个环境
ERRORS=0
WARNINGS=0

for ENV in $ENVS; do
  echo "━━━ 验证环境: $ENV ━━━"
  
  # 读取环境配置
  ENV_CONFIG=$(node -e "
    const c = require('$CONFIG_FILE');
    const env = c.environments['$ENV'];
    console.log(JSON.stringify(env));
  ")
  
  # 检查必填字段
  HOST=$(echo "$ENV_CONFIG" | node -e "const c=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(c.host || '');")
  PATH=$(echo "$ENV_CONFIG" | node -e "const c=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(c.path || '');")
  PORT=$(echo "$ENV_CONFIG" | node -e "const c=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(c.port || 22);")
  AUTH_TYPE=$(echo "$ENV_CONFIG" | node -e "const c=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(c.auth?.type || (c.password ? 'password' : 'key'));")
  
  if [ -z "$HOST" ]; then
    log_error "  缺少 host 字段"
    ERRORS=$((ERRORS + 1))
  else
    log_success "  主机: $HOST:$PORT"
  fi
  
  if [ -z "$PATH" ]; then
    log_error "  缺少 path 字段"
    ERRORS=$((ERRORS + 1))
  else
    log_success "  路径: $PATH"
  fi
  
  # 检查认证配置
  if [ "$AUTH_TYPE" = "key" ]; then
    KEY_PATH=$(echo "$ENV_CONFIG" | node -e "const c=JSON.parse(require('fs').readFileSync(0,'utf8')); const p=c.auth?.keyPath || '~/.ssh/id_rsa'; console.log(p.replace(/^~/, process.env.HOME));")
    
    if [ -f "$KEY_PATH" ]; then
      log_success "  认证: SSH 密钥 ($KEY_PATH)"
      
      # 检查密钥权限
      PERMS=$(stat -f "%Lp" "$KEY_PATH" 2>/dev/null || stat -c "%a" "$KEY_PATH" 2>/dev/null)
      if [ "$PERMS" != "600" ] && [ "$PERMS" != "400" ]; then
        log_warning "  密钥权限不安全: $PERMS (建议 600)"
        echo "    修复: chmod 600 $KEY_PATH"
        WARNINGS=$((WARNINGS + 1))
      fi
      
      # 测试 SSH 连接
      log_info "  测试 SSH 连接..."
      if timeout 5 ssh -i "$KEY_PATH" -p "$PORT" -o StrictHostKeyChecking=no -o BatchMode=yes -o ConnectTimeout=5 "$HOST" "echo ok" &>/dev/null; then
        log_success "  SSH 连接成功"
      else
        log_warning "  SSH 连接失败（可能需要配置密钥或检查网络）"
        WARNINGS=$((WARNINGS + 1))
      fi
    else
      log_warning "  密钥文件不存在: $KEY_PATH"
      WARNINGS=$((WARNINGS + 1))
    fi
  elif [ "$AUTH_TYPE" = "password" ]; then
    PASSWORD=$(echo "$ENV_CONFIG" | node -e "const c=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(c.auth?.password || c.password || '');")
    
    if [ -z "$PASSWORD" ]; then
      log_error "  密码认证但未配置密码"
      ERRORS=$((ERRORS + 1))
    else
      log_success "  认证: 密码 (已配置)"
      
      # 检查 sshpass
      if ! command -v sshpass &>/dev/null; then
        log_warning "  未安装 sshpass，密码认证将失败"
        echo "    安装: brew install sshpass (macOS) 或 sudo apt install sshpass (Linux)"
        WARNINGS=$((WARNINGS + 1))
      fi
    fi
  fi
  
  # 检查容器配置
  CONTAINER_ENABLED=$(echo "$ENV_CONFIG" | node -e "const c=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(c.config?.container?.enabled ? 'true' : 'false');")
  
  if [ "$CONTAINER_ENABLED" = "true" ]; then
    log_success "  容器隔离: 已启用"
  else
    if [ "$ENV" = "production" ] || [ "$ENV" = "prod" ]; then
      log_warning "  生产环境建议启用容器隔离"
      WARNINGS=$((WARNINGS + 1))
    else
      log_info "  容器隔离: 未启用"
    fi
  fi
  
  echo ""
done

# 总结
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  验证完成"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if [ $ERRORS -gt 0 ]; then
  log_error "发现 $ERRORS 个错误"
  exit 1
fi

if [ $WARNINGS -gt 0 ]; then
  log_warning "发现 $WARNINGS 个警告"
fi

if [ $ERRORS -eq 0 ] && [ $WARNINGS -eq 0 ]; then
  log_success "配置验证通过！"
fi

echo ""
