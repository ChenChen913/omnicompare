#!/usr/bin/env bash
# 生成对抗性测试用的多规格短视频（几秒时长、不同分辨率/方向）
set -euo pipefail

DIR="/home/z/my-project/scripts/test-videos"
mkdir -p "$DIR"

# 参数：文件名 尺寸 时长 秒 颜色 文字
gen() {
  local name="$1" size="$2" dur="$3" color="$4" label="$5"
  ffmpeg -y -hide_banner -loglevel error \
    -f lavfi -i "testsrc2=size=${size}:rate=24:duration=${dur}" \
    -f lavfi -i "sine=frequency=440:duration=${dur}" \
    -vf "drawtext=text='${label}':x=(w-text_w)/2:y=(h-text_h)/2:fontsize=72:fontcolor=${color}:borderw=3:bordercolor=black" \
    -c:v libx264 -pix_fmt yuv420p -preset ultrafast -crf 30 \
    -c:a aac -b:a 64k -shortest \
    "$DIR/$name"
  echo "OK  $name ($size, ${dur}s)"
}

gen v01-landscape.mp4 1280x720 4 white  "1-横屏720p"
gen v02-portrait.mp4   720x1280 4 lime   "2-竖屏"
gen v03-square.mp4     640x640   4 cyan   "3-方形"
gen v04-ultrawide.mp4  1280x400  5 orange "4-超宽"
gen v05-tiny.mp4       320x240   4 yellow "5-小尺寸"
gen v06-landscape.mp4  1280x720  5 white  "6-横屏720p"
gen v07-portrait.mp4   720x1280  4 lime   "7-竖屏"
gen v08-square.mp4     640x640   4 cyan   "8-方形"
gen v09-4k-ish.mp4     1920x1080 5 pink   "9-1080p"
gen v10-ultrawide.mp4  1280x400  4 orange "10-超宽"
gen v11-tiny.mp4       320x240   4 yellow "11-小尺寸"
gen v12-landscape.mp4  1280x720  4 white  "12-横屏720p"

echo "--- 全部完成 ---"
du -sh "$DIR"
