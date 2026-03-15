#!/usr/bin/env bash
# 从 projects-for-reference/skills 同步优质 skills 到主项目 skills/ 作为默认内置
# 用法：./scripts/sync-builtin-skills.sh [--force]
#   --force: 覆盖已存在的 skill（默认不覆盖，保留项目内定制如 pdf）

set -e
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
REF_SKILLS="$ROOT/projects-for-reference/skills/skills"
TARGET="$ROOT/skills"

FORCE=false
for arg in "$@"; do
  case $arg in
    --force) FORCE=true ;;
  esac
done

if [ ! -d "$REF_SKILLS" ]; then
  echo ">>> 参考目录不存在: $REF_SKILLS"
  echo "    请先拉取 projects-for-reference（如 git submodule update --init）"
  exit 1
fi

# 默认内置 skills：办公文档 + 设计与创作 + skill-creator（X 可自创 skill）
DEFAULT_SKILLS="docx xlsx pptx algorithmic-art frontend-design theme-factory skill-creator"

mkdir -p "$TARGET"
synced=0
skipped=0

for name in $DEFAULT_SKILLS; do
  src="$REF_SKILLS/$name"
  dest="$TARGET/$name"
  if [ ! -d "$src" ] || [ ! -f "$src/SKILL.md" ]; then
    echo "  跳过 $name（源缺失或非有效 skill）"
    skipped=$((skipped + 1))
    continue
  fi
  if [ -d "$dest" ] && [ "$FORCE" != "true" ]; then
    echo "  跳过 $name（已存在，用 --force 覆盖）"
    skipped=$((skipped + 1))
    continue
  fi
  echo "  同步 $name -> skills/$name"
  rm -rf "$dest"
  cp -R "$src" "$dest"
  synced=$((synced + 1))
done

# skill-creator 的 X-Computer 适配说明（每次同步后恢复）
if [ -d "$TARGET/skill-creator" ] && [ -f "$ROOT/scripts/skill-creator-X-COMPUTER.md" ]; then
  cp "$ROOT/scripts/skill-creator-X-COMPUTER.md" "$TARGET/skill-creator/X-COMPUTER.md"
  echo "  已写入 skills/skill-creator/X-COMPUTER.md"
fi

echo ">>> 完成：同步 $synced 个，跳过 $skipped 个"
