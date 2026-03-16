#!/usr/bin/env bash
# X-Computer 多环境部署脚本
# 用法：
#   ./scripts/deploy-multi.sh [环境名]
#   ./scripts/deploy-multi.sh dev       # 部署到开发环境
#   ./scripts/deploy-multi.sh staging   # 部署到测试环境
#   ./scripts/deploy-multi.sh production # 部署到生产环境
#   ./scripts/deploy-multi.sh --list    # 列出所有环境

set -e
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
CONFIG_FILE="$(dirname "$0")/deploy.config.json"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
  echo -e "${BLUE}>>> $1${NC}"
}

log_success() {
  echo -e "${GREEN}✅ $1${NC}"
}

log_warning() {
  echo -e "${YELLOW}⚠️  $1${NC}"
}

log_error() {
  echo -e "${RED}❌ $1${NC}"
}

# 检查配置文件
if [ ! -f "$CONFIG_FILE" ]; then
  log_error "配置文件不存在: $CONFIG_FILE"
  echo ""
  echo "请执行以下步骤："
  echo "  1. cp scripts/deploy.config.example.json scripts/deploy.config.json"
  echo "  2. 编辑 scripts/deploy.config.json，配置服务器信息"
  echo ""
  exit 1
fi

# 列出所有环境
if [ "$1" = "--list" ]; then
  log_info "可用的部署环境："
  echo ""
  node -e "
    const config = require('$CONFIG_FILE');
    const envs = config.environments || {};
    Object.keys(envs).forEach(key => {
      const env = envs[key];
      console.log(\`  \${key.padEnd(12)} - \${env.name || key}\`);
      console.log(\`               主机: \${env.host || 'N/A'}\`);
      console.log(\`               路径: \${env.path || 'N/A'}\`);
      console.log(\`               分支: \${env.branch || 'main'}\`);
      console.log('');
    });
  "
  exit 0
fi

# 获取环境名
ENV_NAME="${1:-}"
if [ -z "$ENV_NAME" ]; then
  # 使用默认环境
  ENV_NAME=$(node -e "const c = require('$CONFIG_FILE'); console.log(c.default || 'staging');")
  log_warning "未指定环境，使用默认环境: $ENV_NAME"
fi

# 读取环境配置
log_info "读取环境配置: $ENV_NAME"
ENV_CONFIG=$(node -e "
  const config = require('$CONFIG_FILE');
  const env = config.environments?.[process.argv[1]];
  if (!env) {
    console.error('环境不存在: ' + process.argv[1]);
    process.exit(1);
  }
  console.log(JSON.stringify(env));
" "$ENV_NAME")

if [ $? -ne 0 ]; then
  log_error "环境配置读取失败"
  echo ""
  echo "可用环境列表："
  ./scripts/deploy-multi.sh --list
  exit 1
fi

# 解析配置
DEPLOY_HOST=$(echo "$ENV_CONFIG" | node -e "const c=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(c.host || '');")
DEPLOY_PORT=$(echo "$ENV_CONFIG" | node -e "const c=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(c.port || 22);")
DEPLOY_PATH=$(echo "$ENV_CONFIG" | node -e "const c=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(c.path || '/apps/x-computer');")
FRONTEND_SYNC_PATH=$(echo "$ENV_CONFIG" | node -e "const c=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(c.frontendSyncPath || '');")
DEPLOY_BRANCH=$(echo "$ENV_CONFIG" | node -e "const c=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(c.branch || 'main');")
REQUIRE_CONFIRM=$(echo "$ENV_CONFIG" | node -e "const c=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(c.requireConfirmation ? 'true' : 'false');")
ENV_DISPLAY_NAME=$(echo "$ENV_CONFIG" | node -e "const c=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(c.name || process.argv[1]);" "$ENV_NAME")

# 解析认证配置
AUTH_TYPE=$(echo "$ENV_CONFIG" | node -e "const c=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(c.auth?.type || (c.password ? 'password' : 'key'));")
AUTH_KEY_PATH=$(echo "$ENV_CONFIG" | node -e "const c=JSON.parse(require('fs').readFileSync(0,'utf8')); const p=c.auth?.keyPath || '~/.ssh/id_rsa'; console.log(p.replace(/^~/, process.env.HOME));")
AUTH_PASSWORD=$(echo "$ENV_CONFIG" | node -e "const c=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(c.auth?.password || c.password || '');")

# 显示部署信息
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  部署环境: $ENV_DISPLAY_NAME ($ENV_NAME)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  主机: $DEPLOY_HOST:$DEPLOY_PORT"
echo "  路径: $DEPLOY_PATH"
echo "  分支: $DEPLOY_BRANCH"
if [ "$AUTH_TYPE" = "key" ]; then
  echo "  认证: SSH 密钥 ($AUTH_KEY_PATH)"
else
  echo "  认证: 密码"
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 生产环境需要确认
if [ "$REQUIRE_CONFIRM" = "true" ]; then
  log_warning "这是生产环境，需要确认！"
  read -p "确认部署到生产环境？(yes/no): " CONFIRM
  if [ "$CONFIRM" != "yes" ]; then
    log_error "部署已取消"
    exit 1
  fi
fi

# 检查当前分支
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" != "$DEPLOY_BRANCH" ]; then
  log_warning "当前分支 ($CURRENT_BRANCH) 与目标分支 ($DEPLOY_BRANCH) 不匹配"
  read -p "是否继续？(yes/no): " CONFIRM
  if [ "$CONFIRM" != "yes" ]; then
    log_error "部署已取消"
    exit 1
  fi
fi

# 同步内置 skills
log_info "同步内置 skills"
if [ -f ./scripts/sync-builtin-skills.sh ]; then
  chmod +x ./scripts/sync-builtin-skills.sh 2>/dev/null || true
  ./scripts/sync-builtin-skills.sh
fi

# 构建项目
log_info "构建项目"
npm run build

# 生成环境配置文件
log_info "生成环境配置文件"
TEMP_CONFIG="/tmp/x-computer-env-config-$$.json"
TEMP_ENV_EXPORTS="/tmp/x-computer-env-exports-$$.sh"
echo "$ENV_CONFIG" | node -e "
  const c = JSON.parse(require('fs').readFileSync(0, 'utf8'));
  const config = c.config || {};
  require('fs').writeFileSync('$TEMP_CONFIG', JSON.stringify(config, null, 2));
  const env = c.env || {};
  const lines = Object.entries(env).map(([k, v]) => {
    const val = String(v).replace(/'/g, \"'\\\\''\");
    return \"export \" + k + \"='\" + val + \"'\";
  });
  require('fs').writeFileSync('$TEMP_ENV_EXPORTS', lines.join(\"\\n\") + \"\\n\");
"

# SSH 配置
SSH_PREFIX=""
SSH_OPTS="-o StrictHostKeyChecking=no"
SSH_PORT_OPT="-p $DEPLOY_PORT"
SCP_PORT_OPT="-P $DEPLOY_PORT"

if [ "$AUTH_TYPE" = "password" ]; then
  # 密码认证
  if [ -n "$AUTH_PASSWORD" ]; then
    if command -v sshpass &>/dev/null; then
      export SSHPASS="$AUTH_PASSWORD"
      SSH_PREFIX="sshpass -e "
      log_info "使用密码认证"
    else
      log_error "密码认证需要安装 sshpass"
      echo ""
      echo "安装方法："
      echo "  macOS: brew install sshpass"
      echo "  Linux: sudo apt install sshpass"
      echo ""
      exit 1
    fi
  else
    log_error "auth.type 为 password 但未配置 auth.password"
    exit 1
  fi
else
  # 密钥认证
  if [ -f "$AUTH_KEY_PATH" ]; then
    SSH_KEY_OPT="-i $AUTH_KEY_PATH"
    log_info "使用密钥认证: $AUTH_KEY_PATH"
  else
    SSH_KEY_OPT=""
    log_warning "密钥文件不存在: $AUTH_KEY_PATH"
    log_info "尝试使用默认密钥"
  fi
fi

# 打包前检查：必须存在 docker/qdrant，否则部署后无法启动 Qdrant
if [ ! -f "$ROOT/docker/qdrant/docker-compose.yml" ]; then
  log_error "缺少 docker/qdrant，无法打包。请先拉取最新代码: git pull"
  exit 1
fi

# 打包项目（显式包含 docker 各子目录，确保 qdrant 等一定被打进包）
TARBALL="/tmp/x-computer-deploy-$$.tar.gz"
log_info "打包项目（包含构建产物，排除源代码）"
COPYFILE_DISABLE=1 tar -czf "$TARBALL" \
  --exclude 'node_modules' \
  --exclude '.git' \
  --exclude 'frontend/node_modules' \
  --exclude 'server/node_modules' \
  --exclude 'shared/node_modules' \
  --exclude 'workflow-engine/node_modules' \
  --exclude 'projects-for-reference' \
  --exclude '*.db' \
  --exclude '.env.local' \
  --exclude 'server/.x-config.json' \
  --exclude 'scripts/deploy.config.json' \
  -C "$ROOT" \
  server shared frontend workflow-engine scripts docs skills docker \
  package.json package-lock.json .nvmrc .gitignore README.md

# 上传
log_info "上传到 $DEPLOY_HOST:$DEPLOY_PATH"
${SSH_PREFIX}scp $SSH_OPTS $SCP_PORT_OPT $SSH_KEY_OPT -q "$TARBALL" "$DEPLOY_HOST:/tmp/x-computer-deploy.tar.gz"
${SSH_PREFIX}scp $SSH_OPTS $SCP_PORT_OPT $SSH_KEY_OPT -q "$TEMP_CONFIG" "$DEPLOY_HOST:/tmp/x-computer-env-config.json"
${SSH_PREFIX}scp $SSH_OPTS $SCP_PORT_OPT $SSH_KEY_OPT -q "$TEMP_ENV_EXPORTS" "$DEPLOY_HOST:/tmp/x-computer-env-exports.sh"
rm -f "$TARBALL" "$TEMP_CONFIG" "$TEMP_ENV_EXPORTS"

# 远程部署
log_info "远程解压、安装依赖并重启"
${SSH_PREFIX}ssh $SSH_OPTS $SSH_PORT_OPT $SSH_KEY_OPT "$DEPLOY_HOST" "export LC_ALL=en_US.UTF-8 LANG=en_US.UTF-8;
  PARENT=\$(dirname $DEPLOY_PATH)
  BASE=\$(basename $DEPLOY_PATH)
  mkdir -p \$PARENT
  cd \$PARENT
  
  # 备份
  BACKUP=\${BASE}.backup-\$(date +%Y%m%d-%H%M%S)
  if [ -d \$BASE ]; then
    echo '>>> 备份当前版本到 '\$BACKUP
    mv \$BASE \$BACKUP
  fi
  
  # 解压
  mkdir -p \$BASE
  tar -xzf /tmp/x-computer-deploy.tar.gz -C \$BASE
  rm -f /tmp/x-computer-deploy.tar.gz
  cd $DEPLOY_PATH
  
  # 恢复持久化数据（紧接解压后执行，避免中间步骤影响）
  if [ -d \$PARENT/\$BACKUP ]; then
    echo '>>> 恢复持久化数据（从 '\$BACKUP'）'
    if [ -f \$PARENT/\$BACKUP/x-computer.db ]; then
      cp \$PARENT/\$BACKUP/x-computer.db $DEPLOY_PATH/ && echo '  - x-computer.db 已恢复' || echo '  - x-computer.db 恢复失败'
    else
      echo '  - 备份中无 x-computer.db，跳过'
    fi
    if [ -f \$PARENT/\$BACKUP/server/.x-config.json ]; then
      cp \$PARENT/\$BACKUP/server/.x-config.json $DEPLOY_PATH/server/ && echo '  - .x-config.json 已恢复' || echo '  - .x-config.json 恢复失败'
    else
      echo '  - 备份中无 .x-config.json，跳过'
    fi
    if [ -d \$PARENT/\$BACKUP/users ]; then
      cp -r \$PARENT/\$BACKUP/users $DEPLOY_PATH/ && echo '  - users/ 已恢复' || echo '  - users/ 恢复失败'
    else
      echo '  - 备份中无 users/，跳过'
    fi
  else
    echo '>>> 无备份目录 '\$PARENT/\$BACKUP'，跳过恢复（首次部署或无上一版）'
  fi
  
  # 加载 NVM
  export NVM_DIR=\"\$HOME/.nvm\"
  [ -s \"\$NVM_DIR/nvm.sh\" ] && . \"\$NVM_DIR/nvm.sh\"
  nvm use 22 2>/dev/null || nvm use default 2>/dev/null || true
  
  # 配置 Python 3.9（如果存在）
  if command -v python3.9 &>/dev/null; then
    echo 'python=/usr/local/bin/python3.9' > .npmrc
  fi
  
  # 启用 GCC 11（如果存在）
  if [ -f /opt/rh/gcc-toolset-11/enable ]; then
    source /opt/rh/gcc-toolset-11/enable
  fi
  
  # 安装依赖（复用 node_modules 与 package-lock 以加速增量部署）
  echo '>>> 安装依赖'
  if [ -d \"\$PARENT/\$BACKUP/node_modules\" ]; then
    echo '>>> 复用上一版本 node_modules 做增量更新'
    cp -a \"\$PARENT/\$BACKUP/node_modules\" .
  fi
  # 保留 package-lock.json，不清理 npm 缓存，加快安装
  npm install --ignore-scripts --omit=dev
  
  # 尝试编译 better-sqlite3
  if [ -d node_modules/better-sqlite3 ]; then
    npm rebuild better-sqlite3 --build-from-source 2>/dev/null || echo '>>> 警告: better-sqlite3 编译失败'
  fi
  
  # ESM 解析：确保 server 能找到根 node_modules 的包（如 dockerode）
  if [ -d node_modules/dockerode ] && [ ! -d server/node_modules ]; then
    mkdir -p server/node_modules
  fi
  if [ -d node_modules/dockerode ] && [ ! -e server/node_modules/dockerode ]; then
    ln -sf ../../node_modules/dockerode server/node_modules/dockerode
    echo '>>> 已创建 dockerode 符号链接'
  fi
  
  # 应用环境配置（合并到现有配置，不覆盖 llm_config 等）
  if [ -f /tmp/x-computer-env-config.json ]; then
    echo '>>> 应用环境配置（合并）'
    mkdir -p $DEPLOY_PATH/server
    node -e \"
      const fs = require('fs');
      const confPath = '$DEPLOY_PATH/server/.x-config.json';
      const overlayPath = '/tmp/x-computer-env-config.json';
      fs.mkdirSync(require('path').dirname(confPath), { recursive: true });
      let base = {};
      if (fs.existsSync(confPath)) {
        base = JSON.parse(fs.readFileSync(confPath, 'utf8'));
      }
      const overlay = JSON.parse(fs.readFileSync(overlayPath, 'utf8'));
      for (const k of Object.keys(overlay)) {
        base[k] = typeof overlay[k] === 'object' && overlay[k] !== null && !Array.isArray(overlay[k])
          ? Object.assign({}, base[k] || {}, overlay[k])
          : overlay[k];
      }
      fs.writeFileSync(confPath, JSON.stringify(base, null, 2));
    \"
    rm -f /tmp/x-computer-env-config.json
  fi
  
  # 同步前端到 1Panel 站点目录（若配置了 frontendSyncPath）
  if [ -n \"$FRONTEND_SYNC_PATH\" ] && [ -d \"$FRONTEND_SYNC_PATH\" ] && [ -d $DEPLOY_PATH/frontend/dist ]; then
    echo '>>> 同步前端到 1Panel 站点'
    cp -r $DEPLOY_PATH/frontend/dist/* \"$FRONTEND_SYNC_PATH\"/
    echo '>>> 前端已同步'
  fi
  
  # 清理旧备份（保留最近 5 个）
  ls -dt \${BASE}.backup-* 2>/dev/null | tail -n +6 | xargs -r rm -rf
  
  # 检查构建产物
  if [ ! -f server/dist/server/src/index.js ]; then
    echo '>>> 错误: 构建产物不存在 (server/dist/server/src/index.js)'
    echo '>>> 请确保本地已执行: npm run build'
    exit 1
  fi
  
  # 安装 PM2（如果未安装）
  if ! command -v pm2 &>/dev/null; then
    echo '>>> 安装 PM2...'
    npm install -g pm2
  fi
  
  # 加载部署环境变量（env 配置）
  if [ -f /tmp/x-computer-env-exports.sh ]; then
    echo '>>> 加载部署环境变量'
    set -a
    . /tmp/x-computer-env-exports.sh
    set +a
    rm -f /tmp/x-computer-env-exports.sh
  fi
  
  # 若使用 MySQL 且 config.database.useDocker=true，则启动 MySQL 容器；否则假定已有 MySQL 在运行
  USE_MYSQL_DOCKER=\$(node -e \"try { const c=JSON.parse(require('fs').readFileSync('$DEPLOY_PATH/server/.x-config.json','utf8')); console.log(c.database?.useDocker === true ? 'yes' : 'no'); } catch(e){ console.log('no'); }\" 2>/dev/null || echo 'no')
  if [ \"\${DATABASE_TYPE:-}\" = 'mysql' ] && [ \"\$USE_MYSQL_DOCKER\" = 'yes' ]; then
    echo '>>> 启动 MySQL 容器'
    if command -v docker &>/dev/null; then
      docker compose -f $DEPLOY_PATH/docker/mysql/docker-compose.yml up -d
      echo '>>> 等待 MySQL 就绪...'
      for i in 1 2 3 4 5 6 7 8 9 10; do
        if docker exec x-computer-mysql mysqladmin ping -h localhost -u root -pxcomputer 2>/dev/null; then
          echo '>>> MySQL 已就绪'
          break
        fi
        sleep 2
      done
    else
      echo '>>> 警告: 未检测到 docker，请确保 MySQL 已运行'
    fi
  elif [ \"\${DATABASE_TYPE:-}\" = 'mysql' ]; then
    echo '>>> 使用已有 MySQL（跳过 Docker 容器）'
  fi
  
  # 重启服务
  echo '>>> 重启服务'
  pm2 delete x-computer 2>/dev/null || true
  X_COMPUTER_WORKSPACE=$DEPLOY_PATH pm2 start server/dist/server/src/index.js --name x-computer --interpreter node --cwd $DEPLOY_PATH
  pm2 delete x-computer-workflow 2>/dev/null || true
  pm2 start workflow-engine/dist/index.js --name x-computer-workflow --interpreter node --cwd $DEPLOY_PATH
  pm2 save
  
  echo '>>> 服务状态:'
  pm2 status
  
  echo '>>> 部署完成'
"

log_success "部署成功！"
echo ""
echo "环境: $ENV_DISPLAY_NAME"
echo "主机: $DEPLOY_HOST"
echo "路径: $DEPLOY_PATH"
echo ""
log_info "查看日志: ssh $DEPLOY_HOST 'pm2 logs x-computer'"
