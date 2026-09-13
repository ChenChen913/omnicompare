#!/usr/bin/env bash
# OmniCompare 数据备份脚本
# 备份 data/ 下的项目数据（清单 + 上传文件）为 tar.gz，保留最近 KEEP 份
#
# 用法：
#   bash scripts/backup-data.sh                 # 备份到 backups/，保留 14 份
#   KEEP=30 bash scripts/backup-data.sh         # 自定义保留份数
#   DEST=/var/backups bash scripts/backup-data.sh  # 自定义输出目录
#
# 环境要求：bash + tar + coreutils（du/cut/ls/tail/basename）。刻意不依赖 ripgrep。
#
# 建议 crontab 每日备份：
#   0 3 * * * cd /path/to/omnicompare && KEEP=14 bash scripts/backup-data.sh >> backups/backup.log 2>&1
#
# 恢复：tar -xzf <备份包> -C data/ 后重启服务
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA_DIR="$ROOT/data"
DEST="${DEST:-$ROOT/backups}"
KEEP="${KEEP:-14}"

if [ ! -d "$DATA_DIR" ]; then
  echo "错误：数据目录不存在 $DATA_DIR（服务尚未产生任何数据？）" >&2
  exit 1
fi

# 待打包条目：v2 主线是 projects/；
# 同时兼容尚未完成 v1→v2 迁移的部署 —— 只备份 projects/ 会漏掉全部旧数据，
# 而"升级前先备份一次"恰恰是最需要备份的时候。
PARTS=()
[ -d "$DATA_DIR/projects" ] && PARTS+=(projects)
[ -f "$DATA_DIR/manifest.json" ] && PARTS+=(manifest.json)
[ -d "$DATA_DIR/uploads" ] && PARTS+=(uploads)
[ -d "$DATA_DIR/uploads.v1.bak" ] && PARTS+=(uploads.v1.bak)

if [ ${#PARTS[@]} -eq 0 ]; then
  echo "错误：$DATA_DIR 下没有可备份的数据（未见 projects/ 或 v1 遗留数据）" >&2
  exit 1
fi

mkdir -p "$DEST"
TS="$(date +%Y%m%d-%H%M%S)"
OUT="$DEST/omnicompare-data-$TS.tar.gz"

# 打包（原子：先写临时名再 rename，避免读到半个包）
TMP="$OUT.partial"
tar -czf "$TMP" -C "$DATA_DIR" "${PARTS[@]}"
mv "$TMP" "$OUT"

SIZE="$(du -h "$OUT" | cut -f1)"
# 统计包内项目清单数量。用 POSIX grep 而非 ripgrep：rg 不在环境要求里，
# 缺它时统计会静默给出错误结果。
COUNT="$(tar -tzf "$OUT" | grep -c 'manifest\.json$' || true)"
COUNT="${COUNT:-0}"
echo "✅ 备份完成：$OUT（$SIZE，含 $COUNT 个项目清单；打包条目：${PARTS[*]}）"

# 滚动清理：只保留最近 KEEP 份
LS_PARTS=$(ls -1t "$DEST"/omnicompare-data-*.tar.gz 2>/dev/null || true)
if [ -n "$LS_PARTS" ]; then
  echo "$LS_PARTS" | tail -n +$((KEEP + 1)) | while IFS= read -r old; do
    rm -f "$old"
    echo "  已清理过期备份：$(basename "$old")"
  done
fi

echo "恢复方法：tar -xzf <备份包> -C data/（解出 projects/ 等目录后重启服务）"
