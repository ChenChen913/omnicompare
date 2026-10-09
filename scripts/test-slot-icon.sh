#!/usr/bin/env bash
# 卡片图标 API 测试（above 标题带头像/图标）
# 覆盖：上传落盘、文件服务、替换删旧文件、标题写路径不丢图标、移除清文件、
#       非法类型/越界/空位/超限拒收、DELETE 幂等
# 结束时移除图标恢复原状，不污染演示数据

set -u
BASE="http://localhost:3000"
PASS=0; FAIL=0

req() { # method url body -> "code|body"
  local m="$1" u="$2" b="${3:-}"
  if [ -n "$b" ]; then
    curl -s -w "\n%{http_code}" -X "$m" -H 'Content-Type: application/json' -d "$b" "$BASE$u"
  else
    curl -s -w "\n%{http_code}" -X "$m" "$BASE$u"
  fi
}

check() { # name expect_code actual_code expect_regex actual_body
  local name="$1" exp_code="$2" act_code="$3" exp_re="$4" act_body="$5"
  if [ "$exp_code" = "$act_code" ] && echo "$act_body" | grep -qE "$exp_re"; then
    PASS=$((PASS+1)); echo "PASS  $name"
  else
    FAIL=$((FAIL+1)); echo "FAIL  $name (code=$act_code, want=$exp_code)"
    echo "      body: $(echo "$act_body" | head -c 300)"
  fi
}

# 1x1 红色像素 PNG（最小合法图片）
TMPDIR_LOCAL="$(dirname "$0")/../.tmp-icon-test"
mkdir -p "$TMPDIR_LOCAL"
echo 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' | base64 -d > "$TMPDIR_LOCAL/icon.png"
# 2x2 蓝色像素 PNG（第二枚，用于替换场景）
printf '\x89PNG\r\n\x1a\n' > "$TMPDIR_LOCAL/icon2.png" 2>/dev/null || true
echo 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0qAAAAEUlEQVR42mNk+M+ACzDhWGYA2wF+0QkAAAAASUVORK5CYII=' | base64 -d > "$TMPDIR_LOCAL/icon2.png"

echo "=== A. 前置：确认演示项目 slot 0 有内容 ==="
R=$(req GET /api/videos)
BODY=$(echo "$R" | head -n -1); CODE=$(echo "$R" | tail -n 1)
check "GET /api/videos 200" 200 "$CODE" '"count"' "$BODY"
if ! echo "$BODY" | grep -q '"video":{.*"filename"'; then
  if ! echo "$BODY" | grep -qE '"(html|image)":{'; then
    echo "FATAL slot 0 无内容，图标测试需要已有内容的槽位；请先在演示项目上传一个视频"
    exit 1
  fi
fi
# 说明：此处不断言"初始无图标"——前次运行残留的图标会被本脚本的 B→E→H 全流程覆盖并最终移除

echo "=== B. 上传图标 ==="
R=$(curl -s -w "\n%{http_code}" -X POST -F "file=@$TMPDIR_LOCAL/icon.png;type=image/png" "$BASE/api/videos/icon?slot=0")
BODY=$(echo "$R" | head -n -1); CODE=$(echo "$R" | tail -n 1)
check "POST icon slot=0 → 201" 201 "$CODE" '"icon":\{"filename":"[^"]+\.png"' "$BODY"
ICON1=$(echo "$BODY" | grep -o '"icon":{[^}]*}' | head -1 | grep -o '"filename":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "      icon1 = $ICON1"

echo "=== C. 图标文件可服务 ==="
R=$(req GET "/api/files/$ICON1")
CODE=$(echo "$R" | tail -n 1)
check "GET /api/files/$ICON1 → 200" 200 "$CODE" '.' "$(echo "$R" | head -n -1)"

echo "=== D. 标题写路径不丢图标（v1 PATCH title 往返） ==="
R=$(req PATCH /api/videos '{"slot":0,"title":"图标保持测试"}')
BODY=$(echo "$R" | head -n -1); CODE=$(echo "$R" | tail -n 1)
check "PATCH title 后 icon 仍在" 200 "$CODE" "\"icon\":\{\"filename\":\"$ICON1\"" "$BODY"

echo "=== E. 替换图标：旧文件清理、新文件生效 ==="
R=$(curl -s -w "\n%{http_code}" -X POST -F "file=@$TMPDIR_LOCAL/icon2.png;type=image/png" "$BASE/api/videos/icon?slot=0")
BODY=$(echo "$R" | head -n -1); CODE=$(echo "$R" | tail -n 1)
check "POST 替换 → 201" 201 "$CODE" '"icon":\{"filename"' "$BODY"
ICON2=$(echo "$BODY" | grep -o '"icon":{[^}]*}' | head -1 | grep -o '"filename":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "      icon2 = $ICON2"
if [ "$ICON1" = "$ICON2" ]; then
  FAIL=$((FAIL+1)); echo "FAIL  替换后文件名未变化"
else
  PASS=$((PASS+1)); echo "PASS  替换生成新文件名"
fi
R=$(req GET "/api/files/$ICON1")
CODE=$(echo "$R" | tail -n 1)
check "旧图标文件已删除（404）" 404 "$CODE" 'error|404' "$(echo "$R" | head -n -1)"

echo "=== F. 非法输入拒收 ==="
printf 'not-an-image' > "$TMPDIR_LOCAL/bad.txt"
R=$(curl -s -w "\n%{http_code}" -X POST -F "file=@$TMPDIR_LOCAL/bad.txt;type=text/plain" "$BASE/api/videos/icon?slot=0")
CODE=$(echo "$R" | tail -n 1)
check "文本文件 → 400" 400 "$CODE" '图标|图片' "$(echo "$R" | head -n -1)"
# 挂错扩展名：二进制内容 + .png 扩展名但 MIME 是 video
R=$(curl -s -w "\n%{http_code}" -X POST -F "file=@$TMPDIR_LOCAL/bad.txt;type=video/mp4;filename=fake.png" "$BASE/api/videos/icon?slot=0")
CODE=$(echo "$R" | tail -n 1)
check "video MIME 伪 png 名 → 400" 400 "$CODE" '图标|扩展名' "$(echo "$R" | head -n -1)"
R=$(curl -s -w "\n%{http_code}" -X POST -F "file=@$TMPDIR_LOCAL/icon.png;type=image/png" "$BASE/api/videos/icon?slot=99")
CODE=$(echo "$R" | tail -n 1)
check "slot 越界 → 400" 400 "$CODE" '位置' "$(echo "$R" | head -n -1)"
R=$(curl -s -w "\n%{http_code}" -X POST "$BASE/api/videos/icon?slot=0")
CODE=$(echo "$R" | tail -n 1)
check "缺文件/空请求体 → 400" 400 "$CODE" '缺少|无法解析' "$(echo "$R" | head -n -1)"
# 超限：6MB 随机内容（合法 png 扩展名 + image/png MIME，仅尺寸超 5MB 上限）
dd if=/dev/urandom of="$TMPDIR_LOCAL/big.png" bs=1M count=6 2>/dev/null
R=$(curl -s -w "\n%{http_code}" -X POST -F "file=@$TMPDIR_LOCAL/big.png;type=image/png" "$BASE/api/videos/icon?slot=0")
CODE=$(echo "$R" | tail -n 1)
check "超 5MB → 400" 400 "$CODE" '5MB' "$(echo "$R" | head -n -1)"

echo "=== G. 空位不可设置图标（临时项目，避免污染演示数据） ==="
R=$(req POST /api/projects '{"name":"icon-test-temp"}')
TP_BODY=$(echo "$R" | head -n -1); TP_CODE=$(echo "$R" | tail -n 1)
check "创建临时项目 → 201" 201 "$TP_CODE" '"id"' "$TP_BODY"
TP_ID=$(echo "$TP_BODY" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
if [ -z "$TP_ID" ]; then
  echo "FATAL 未能取得临时项目 id"
  exit 1
fi
# 临时项目扩到 2 位（slot 1 恒为空）
R=$(req PATCH "/api/videos/layout?project=$TP_ID" '{"count":2,"rows":1,"cols":2}')
CODE=$(echo "$R" | tail -n 1)
check "临时项目扩到 2 位" 200 "$CODE" '"count":2' "$(echo "$R" | head -n -1)"
R=$(curl -s -w "\n%{http_code}" -X POST -F "file=@$TMPDIR_LOCAL/icon.png;type=image/png" "$BASE/api/videos/icon?slot=1&project=$TP_ID")
CODE=$(echo "$R" | tail -n 1)
check "空位上传图标 → 400（暂无内容）" 400 "$CODE" '暂无内容' "$(echo "$R" | head -n -1)"
# 空位上传不产生任何文件与清单残留：GET 回读无 icon、无条目
R=$(req GET "/api/videos?project=$TP_ID")
BODY=$(echo "$R" | head -n -1)
check "临时项目无 icon 残留" 0 0 '"count":2.*"slots":\[{"index":0,"title":"","video":null' "$BODY"
# 清理临时项目
R=$(req DELETE "/api/projects/$TP_ID")
CODE=$(echo "$R" | tail -n 1)
check "删除临时项目" 200 "$CODE" '.' "$(echo "$R" | head -n -1)"

echo "=== H. 移除图标（DELETE） ==="
R=$(req DELETE "/api/videos/icon?slot=0")
BODY=$(echo "$R" | head -n -1); CODE=$(echo "$R" | tail -n 1)
check "DELETE icon → 200" 200 "$CODE" '"count"' "$BODY"
if echo "$BODY" | grep -q '"icon":{'; then
  FAIL=$((FAIL+1)); echo "FAIL  移除后 slot 仍带 icon"
else
  PASS=$((PASS+1)); echo "PASS  移除后 slot 无 icon"
fi
R=$(req GET "/api/files/$ICON2")
CODE=$(echo "$R" | tail -n 1)
check "图标文件已删除（404）" 404 "$CODE" 'error|404' "$(echo "$R" | head -n -1)"
# 幂等：再次 DELETE 无图标 → 200 正常返回
R=$(req DELETE "/api/videos/icon?slot=0")
CODE=$(echo "$R" | tail -n 1)
check "重复 DELETE 幂等 → 200" 200 "$CODE" '"count"' "$(echo "$R" | head -n -1)"

echo "=== I. 收尾：标题恢复、临时文件清理 ==="
req PATCH /api/videos '{"slot":0,"title":""}' > /dev/null
rm -rf "$TMPDIR_LOCAL"
echo "已清理临时文件与图标"

echo
echo "================================"
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
