#!/usr/bin/env bash
# squad-signup 多实例更新辅助脚本
# 用途：主站 update.sh 只迁移主库、只重启主服务；
#      各战队实例（instances/<id>）需要单独跑迁移并重启服务，本脚本补齐这一步。
#
# 用法：bash deploy/update-instances.sh          # 更新所有实例
#       bash deploy/update-instances.sh <id>     # 只更新指定实例（如 shuishangyue）
set -euo pipefail

INSTALL_DIR="/opt/squad-signup"
INSTANCES_DIR="$INSTALL_DIR/instances"

die()  { echo "✗ $*" >&2; exit 1; }
info() { echo "▶ $*"; }
ok()   { echo "✓ $*"; }

command -v node >/dev/null 2>&1 || die "找不到 node"
[[ -x "$INSTALL_DIR/node_modules/.bin/prisma" ]] || die "prisma 未安装（请先跑一次主站 update.sh）"
[[ -x "$INSTALL_DIR/node_modules/.bin/prisma" ]] && PRISMA="$INSTALL_DIR/node_modules/.bin/prisma"

# 生成 Prisma Client（产物更新后需要重新 generate）
info "生成 Prisma Client..."
( cd "$INSTALL_DIR" && "$PRISMA" generate ) || die "prisma generate 失败"

instances=()
if [[ $# -ge 1 ]]; then
  [[ -d "$INSTANCES_DIR/$1" ]] || die "实例不存在：$1"
  instances+=("$1")
else
  for dir in "$INSTANCES_DIR"/*/; do
    [[ -d "$dir" ]] && instances+=("$(basename "$dir")")
  done
fi
[[ ${#instances[@]} -gt 0 ]] || { ok "没有实例需要更新"; exit 0; }

for id in "${instances[@]}"; do
  env_file="$INSTANCES_DIR/$id/.env"
  [[ -f "$env_file" ]] || { echo "! $env_file 不存在，跳过 $id"; continue; }

  info "实例 [$id]：数据库迁移..."
  (
    set -a
    # shellcheck disable=SC1090
    . "$env_file"
    set +a
    cd "$INSTALL_DIR"
    "$PRISMA" migrate deploy
  ) || { echo "! 实例 [$id] 迁移失败，服务未重启（数据库结构不匹配时请勿强行启动）"; continue; }

  service="squad-signup-$id"
  if systemctl list-unit-files | grep -q "^$service.service"; then
    info "实例 [$id]：重启 $service..."
    systemctl restart "$service"
    sleep 2
    if systemctl is-active --quiet "$service"; then
      ok "实例 [$id] 已更新并重启"
    else
      echo "! 实例 [$id] 服务启动失败：journalctl -u $service -n 50"
    fi
  else
    ok "实例 [$id] 迁移完成（未找到 $service 服务，请手动重启）"
  fi
done

echo "✓ 实例更新完成"
