#!/usr/bin/env bash
# X-Computer 自动部署脚本
# 用法：
#   1. 配置 scripts/deploy.config.json（复制 deploy.config.example.json）填入 host、password、path
#   2. 执行 npm run deploy 即可部署
#   3. 仅构建：./scripts/deploy.sh --build-only
#   4. 服务器上拉取并重启：./scripts/deploy.sh --pull-only  （在服务器上执行）

set -e
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
CONFIG_FILE="$(dirname "$0")/deploy.config.json"

BUILD_ONLY=false
PULL_ONLY=false
for arg in "$@"; do
  case $arg in
    --build-only) BUILD_ONLY=true ;;
    --pull-only)  PULL_ONLY=true ;;
  esac
done

if [ "$PULL_ONLY" = true ]; then
  echo ">>> 服务器模式：拉取代码并重启"
  git pull --ff-only
  npm install
  npm run build
  if command -v pm2 &>/dev/null; then
    PROJ_ROOT="$(pwd)"
    pm2 delete x-computer 2>/dev/null || true
    X_COMPUTER_WORKSPACE="$PROJ_ROOT" pm2 start server/dist/server/src/index.js --name x-computer --interpreter node --cwd "$PROJ_ROOT"
    pm2 delete x-computer-workflow 2>/dev/null || true
    pm2 start workflow-engine/dist/index.js --name x-computer-workflow --interpreter node --cwd "$PROJ_ROOT"
  elif [ -f "/etc/systemd/system/x-computer.service" ]; then
    sudo systemctl restart x-computer
  else
    echo "请手动重启服务（pm2 或 systemd）"
  fi
  echo ">>> 完成"
  exit 0
fi

echo ">>> 同步内置 skills（从 projects-for-reference）"
if [ -f ./scripts/sync-builtin-skills.sh ]; then
  chmod +x ./scripts/sync-builtin-skills.sh 2>/dev/null || true
  ./scripts/sync-builtin-skills.sh
fi

echo ">>> 构建项目"
npm run build

# 检查构建产物
if [ ! -f server/dist/server/src/index.js ]; then
  echo ">>> 错误: 构建失败，server/dist/server/src/index.js 不存在"
  exit 1
fi
echo ">>> 构建成功，已生成构建产物"

if [ "$BUILD_ONLY" = true ]; then
  echo ">>> 仅构建完成（--build-only）"
  exit 0
fi

# 从配置文件读取（优先），环境变量覆盖
if [ -f "$CONFIG_FILE" ]; then
  _vals=$(node -e "
    const path = require('path');
    const p = path.resolve(process.cwd(), '$CONFIG_FILE');
    const c = require(p);
    console.log([
      c.host || '',
      c.password || '',
      c.path || '/apps/x-computer'
    ].join('\t'));
  ")
  DEPLOY_HOST="${DEPLOY_HOST:-$(echo "$_vals" | cut -f1)}"
  DEPLOY_PASSWORD="${DEPLOY_PASSWORD:-$(echo "$_vals" | cut -f2)}"
  DEPLOY_PATH="${DEPLOY_PATH:-$(echo "$_vals" | cut -f3)}"
fi
DEPLOY_HOST="${DEPLOY_HOST:-}"
DEPLOY_PASSWORD="${DEPLOY_PASSWORD:-}"
DEPLOY_PATH="${DEPLOY_PATH:-/apps/x-computer}"

if [ -z "$DEPLOY_HOST" ]; then
  echo ">>> 未配置部署目标，跳过部署"
  echo "    1. 复制 scripts/deploy.config.example.json 为 scripts/deploy.config.json"
  echo "    2. 填入 host（如 user@192.168.1.100）、password（可选）、path"
  echo "    3. 或设置环境变量: DEPLOY_HOST=user@host DEPLOY_PATH=/apps/x-computer npm run deploy"
  exit 0
fi

# 有密码时用 sshpass（需安装: brew install sshpass）
SSH_PREFIX=""
SSH_OPTS="-o StrictHostKeyChecking=no"
if [ -n "$DEPLOY_PASSWORD" ]; then
  if command -v sshpass &>/dev/null; then
    export SSHPASS="$DEPLOY_PASSWORD"
    SSH_PREFIX="sshpass -e "
  else
    echo ">>> 已配置密码但未安装 sshpass，将尝试 SSH 密钥认证"
    echo "    安装: brew install sshpass"
  fi
fi

TARBALL="/tmp/x-computer-deploy-$$.tar.gz"
echo ">>> 打包项目（包含构建产物，排除源代码和 node_modules）"
# COPYFILE_DISABLE=1 避免 macOS 扩展属性，Linux 解压时不再报警
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

echo ">>> 上传到 $DEPLOY_HOST:$DEPLOY_PATH"
${SSH_PREFIX}scp $SSH_OPTS -q "$TARBALL" "$DEPLOY_HOST:/tmp/x-computer-deploy.tar.gz"
rm -f "$TARBALL"

echo ">>> 远程解压、安装依赖并重启"
${SSH_PREFIX}ssh $SSH_OPTS "$DEPLOY_HOST" "export LC_ALL=en_US.UTF-8 LANG=en_US.UTF-8;
  # 加载 NVM
  export NVM_DIR=\"\$HOME/.nvm\"
  [ -s \"\$NVM_DIR/nvm.sh\" ] && . \"\$NVM_DIR/nvm.sh\"
  nvm use 22 2>/dev/null || nvm use default 2>/dev/null || true
  
  PARENT=\$(dirname $DEPLOY_PATH)
  BASE=\$(basename $DEPLOY_PATH)
  cd \$PARENT
  
  # 备份到带时间戳的目录
  BACKUP=\${BASE}.backup-\$(date +%Y%m%d-%H%M%S)
  mv \$BASE \$BACKUP 2>/dev/null || true
  mkdir -p \$BASE
  tar -xzf /tmp/x-computer-deploy.tar.gz -C \$BASE
  rm -f /tmp/x-computer-deploy.tar.gz
  cd $DEPLOY_PATH
  
  # 恢复持久化数据（紧接解压后执行）
  if [ -d \$PARENT/\$BACKUP ]; then
    echo '>>> 恢复持久化数据（从 '\$BACKUP'）'
    [ -f \$PARENT/\$BACKUP/x-computer.db ] && cp \$PARENT/\$BACKUP/x-computer.db $DEPLOY_PATH/ && echo '  - x-computer.db 已恢复' || true
    [ -f \$PARENT/\$BACKUP/server/.x-config.json ] && cp \$PARENT/\$BACKUP/server/.x-config.json $DEPLOY_PATH/server/ && echo '  - .x-config.json 已恢复' || true
    [ -d \$PARENT/\$BACKUP/users ] && cp -r \$PARENT/\$BACKUP/users $DEPLOY_PATH/ && echo '  - users/ 已恢复' || true
  else
    echo '>>> 无备份目录，跳过恢复'
  fi
  
  # 配置 Python 3.9（如果存在）
  if command -v python3.9 &>/dev/null; then
    echo 'python=/usr/local/bin/python3.9' > .npmrc
  fi
  
  # 启用 GCC 11（如果存在）
  if [ -f /opt/rh/gcc-toolset-11/enable ]; then
    source /opt/rh/gcc-toolset-11/enable
  fi
  
  # 清理并安装依赖
  rm -rf node_modules package-lock.json
  npm cache clean --force 2>/dev/null || true
  rm -rf ~/.cache/node-gyp
  
  # 跳过构建脚本安装依赖（避免 better-sqlite3 编译问题）
  npm install --ignore-scripts --omit=dev
  
  # 尝试编译 better-sqlite3（如果失败也继续）
  if [ -d node_modules/better-sqlite3 ]; then
    npm rebuild better-sqlite3 --build-from-source 2>/dev/null || echo '>>> 警告: better-sqlite3 编译失败'
  fi
  
  echo \">>> 已备份到 \$BACKUP\"
  
  # 保留最近 5 个备份
  ls -dt \${BASE}.backup-* 2>/dev/null | tail -n +6 | xargs -r rm -rf
  
  # 检查构建产物是否存在
  if [ ! -f server/dist/server/src/index.js ]; then
    echo \">>> 错误: 构建产物不存在 (server/dist/server/src/index.js)\"
    echo \">>> 请确保本地已执行: npm run build\"
    exit 1
  fi
  
  # 安装 PM2（如果未安装）
  if ! command -v pm2 &>/dev/null; then
    echo \">>> 安装 PM2...\"
    npm install -g pm2
  fi
  
  # 重启服务
  pm2 delete x-computer 2>/dev/null || true
  X_COMPUTER_WORKSPACE=$DEPLOY_PATH pm2 start server/dist/server/src/index.js --name x-computer --interpreter node --cwd $DEPLOY_PATH
  pm2 delete x-computer-workflow 2>/dev/null || true
  pm2 start workflow-engine/dist/index.js --name x-computer-workflow --interpreter node --cwd $DEPLOY_PATH
  pm2 save
  
  echo \">>> 服务状态:\"
  pm2 status
"

echo ">>> 部署完成"
