#!/usr/bin/env bash
# OmniCompare 数据备份脚本
# 备份 data/projects（全部项目的清单 + 上传文件）为 tar.gz，保留最近 KEEP 份
#
# 用法：
#   bash scripts/backup-data.sh                 # 备份到 backups/，保留 14 份
#   KEEP=30 bash scripts/backup-data.sh         # 自定义保留份数
#   DEST=/var/backups bash scripts/backup-data.sh  # 自定义输出目录
#
# 建议 crontab 每日备份：
#   0 3 * * * cd /path/to/omnicompare && KEEP=14 bash scripts/backup-data.sh >> backups/backup.log 2>&1
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC_DIR="$ROOT/data/projects"
DEST="${DEST:-$ROOT/backups}"
KEEP="${KEEP:-14}"

if [ ! -d "$SRC_DIR" ]; then
  echo "错误：数据目录不存在 $SRC_DIR" >&2
  exit 1
fi

mkdir -p "$DEST"
TS="$(date +%Y%m%d-%H%M%S)"
OUT="$DEST/omnicompare-data-$TS.tar.gz"

# 打包清单与文件（原子：先写临时名再 rename，避免读到半个包）
TMP="$OUT.partial"
tar -czf "$TMP" -C "$ROOT/data" projects
mv "$TMP" "$OUT"

SIZE="$(du -h "$OUT" | cut -f1)"
COUNT="$(tar -tzf "$OUT" | rg -c 'manifest\.json$' || echo 0)"
echo "✅ 备份完成：$OUT（$SIZE，含 $COUNT 个项目清单）"

# 滚动清理：只保留最近 KEEP 份
LS_PARTS=$(ls -1t "$DEST"/omnicompare-data-*.tar.gz 2>/dev/null || true)
if [ -n "$LS_PARTS" ]; then
  echo "$LS_PARTS" | tail -n +$((KEEP + 1)) | while IFS= read -r old; do
    rm -f "$old"
    echo "  已清理过期备份：$(basename "$old")"
  done
fi

echo "恢复方法：tar -xzf <备份包> -C data/（解出 projects/ 目录后重启服务）"
