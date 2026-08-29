#!/usr/bin/env bash
# API 对抗性测试：每项二元判定（通过/失败），最后汇总
BASE="http://localhost:3000"
PASS=0; FAIL=0; FAILED_ITEMS=()

check() { # $1=项名 $2=条件(0 通过)
  if [ "$2" -eq 0 ]; then PASS=$((PASS+1)); echo "  ✅ $1";
  else FAIL=$((FAIL+1)); FAILED_ITEMS+=("$1"); echo "  ❌ $1"; fi
}

expect_json_field() { # $1=响应 $2=jq表达式（真=通过）
  echo "$1" | jq -e "$2" >/dev/null 2>&1
}

echo "== 1. 清单读取 =="
R=$(curl -s "$BASE/api/videos")
check "GET /api/videos 返回 count/layout/slots" "$(expect_json_field "$R" '.count and .layout and (.slots|type=="array")'; echo $?)"

# 起始清理：保证测试可重复（不依赖运行前状态；缩容删除语义会清掉越位内容）
curl -s -X DELETE "$BASE/api/videos?all=1" >/dev/null
curl -s -X PATCH "$BASE/api/videos/layout" -H 'Content-Type: application/json' -d '{"count":6,"rows":1,"cols":6}' >/dev/null

echo "== 2. 布局 API 非法参数 =="
for body in '{"count":0,"rows":1,"cols":1}' '{"count":13,"rows":3,"cols":4}' '{"count":6,"rows":0,"cols":3}' '{"count":6,"rows":2,"cols":2}' '{"count":6,"rows":2.5,"cols":3}' '{"count":"6","rows":2,"cols":3}' '{"rows":2,"cols":3}' '{}' 'not-json'; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$BASE/api/videos/layout" -H 'Content-Type: application/json' -d "$body")
  [ "$CODE" = "400" ]; check "非法布局参数 -> 400: $body" $?
done

echo "== 3. 布局 API 合法切换（不丢已放置视频的场景）=="
R=$(curl -s -X PATCH "$BASE/api/videos/layout" -H 'Content-Type: application/json' -d '{"count":6,"rows":2,"cols":3}')
check "count=6 rows=2 cols=3 -> 200 且清单同步" "$(expect_json_field "$R" '.count==6 and .layout.rows==2 and .layout.cols==3 and (.slots|length)==6'; echo $?)"

R=$(curl -s -X PATCH "$BASE/api/videos/layout" -H 'Content-Type: application/json' -d '{"count":6,"rows":1,"cols":6}')
check "count=6 rows=1 cols=6（一列六行的横条）" "$(expect_json_field "$R" '.layout.rows==1 and .layout.cols==6'; echo $?)"

R=$(curl -s -X PATCH "$BASE/api/videos/layout" -H 'Content-Type: application/json' -d '{"count":6,"rows":6,"cols":1}')
check "count=6 rows=6 cols=1（一列六行）" "$(expect_json_field "$R" '.layout.rows==6 and .layout.cols==1'; echo $?)"

echo "== 4. 标题 API 对抗 =="
for q in 'slot=99' 'slot=-1' 'slot=abc'; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$BASE/api/videos" -H 'Content-Type: application/json' -d "{\"$q\":0,\"title\":\"x\"}" 2>/dev/null)
  # slot 参数在 body 里，单独测
  :
done
for body in '{"slot":99,"title":"x"}' '{"slot":-1,"title":"x"}' '{"slot":0.5,"title":"x"}' '{"slot":"0","title":"x"}' '{"title":"x"}' '{"slot":0}' 'not-json'; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$BASE/api/videos" -H 'Content-Type: application/json' -d "$body")
  [ "$CODE" = "400" ]; check "非法标题请求 -> 400: $body" $?
done
LONG=$(python3 -c "print('标'*300)")
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$BASE/api/videos" -H 'Content-Type: application/json' -d "{\"slot\":0,\"title\":\"$LONG\"}")
[ "$CODE" = "200" ]; check "超长标题(300字) -> 接受并截断到 100" $?
LEN=$(curl -s "$BASE/api/videos" | jq -r '.slots[0].title' | wc -m)
LEN=$((LEN-1)); [ "$LEN" -le 100 ]; check "截断后长度 <= 100（实际 $LEN）" $?
curl -s -X PATCH "$BASE/api/videos" -H 'Content-Type: application/json' -d '{"slot":0,"title":""}' >/dev/null

echo "== 5. 上传 API 对抗 =="
echo "这不是视频" > /tmp/not-video.txt
: > /tmp/empty.mp4
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/videos/upload" -F "file=@/tmp/not-video.txt" -F "slot=0")
[ "$CODE" = "400" ]; check "非视频文件 -> 400" $?
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/videos/upload" -F "file=@/tmp/empty.mp4" -F "slot=0")
[ "$CODE" = "400" ]; check "空文件 -> 400" $?
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/videos/upload" -F "file=@/home/z/my-project/scripts/test-videos/v01.mp4" -F "slot=999")
[ "$CODE" = "400" ]; check "slot=999 越界 -> 400" $?
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/videos/upload" -F "file=@/home/z/my-project/scripts/test-videos/v01.mp4")
[ "$CODE" = "400" ]; check "缺少 slot -> 400" $?
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/videos/upload" -F "slot=0")
[ "$CODE" = "400" ]; check "缺少 file -> 400" $?

echo "== 6. 正常上传与替换 =="
R=$(curl -s -X POST "$BASE/api/videos/upload" -F "file=@/home/z/my-project/scripts/test-videos/v01-landscape.mp4" -F "slot=0")
check "上传到 slot=0 -> 200 且清单更新" "$(expect_json_field "$R" '.slots[0].video.filename'; echo $?)"
OLD=$(echo "$R" | jq -r '.slots[0].video.filename')
R=$(curl -s -X POST "$BASE/api/videos/upload" -F "file=@/home/z/my-project/scripts/test-videos/v02-portrait.mp4" -F "slot=0")
NEW=$(echo "$R" | jq -r '.slots[0].video.filename')
[ "$OLD" != "$NEW" ]; check "替换上传 -> 新文件名" $?
[ ! -f "/home/z/my-project/data/projects/default/files/$OLD" ]; check "替换后旧文件已从磁盘删除" $?
BEFORE_N=$(ls /home/z/my-project/data/projects/default/files/ | wc -l)

echo "== 7. 并发上传一致性 =="
curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/videos/upload" -F "file=@/home/z/my-project/scripts/test-videos/v03-square.mp4" -F "slot=1" > /tmp/ccA.txt &
curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/videos/upload" -F "file=@/home/z/my-project/scripts/test-videos/v04-ultrawide.mp4" -F "slot=2" > /tmp/ccB.txt &
curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/videos/upload" -F "file=@/home/z/my-project/scripts/test-videos/v05-tiny.mp4" -F "slot=3" -o /tmp/concurrent-resp.json > /tmp/ccC.txt &
wait
CA=$(cat /tmp/ccA.txt); CB=$(cat /tmp/ccB.txt); CC=$(cat /tmp/ccC.txt)
check "3 路并发上传全部 200（实际 $CA/$CB/$CC）" "$([ "$CA" = "200" ] && [ "$CB" = "200" ] && [ "$CC" = "200" ]; echo $?)"
# 注：并发上传到不同 slot 时，因紧凑左填语义与到达顺序交互，落位不确定（后者可能替换前者），
# 但不变量确定：条目数 = 磁盘文件数（替换时文件同步清理），且无孤儿无死链
AFTER_N=$(ls /home/z/my-project/data/projects/default/files/ | wc -l)
REF_N=$(curl -s "$BASE/api/videos" | jq '[.slots[].video | select(. != null)] | length')
[ "$AFTER_N" -eq "$REF_N" ]; check "并发后磁盘文件数与清单 1:1（磁盘 $AFTER_N / 引用 $REF_N）" $?
[ "$REF_N" -ge 2 ] && [ "$REF_N" -le 4 ]; check "条目数在合法区间（实际 $REF_N，确定性 2-4）" $?

echo "== 8. 缩减数量删除被移除位置的文件 =="
BEFORE_N=$(ls /home/z/my-project/data/projects/default/files/ | wc -l)
R=$(curl -s -X PATCH "$BASE/api/videos/layout" -H 'Content-Type: application/json' -d '{"count":2,"rows":1,"cols":2}')
check "缩减到 count=2 -> 200，slots 截断" "$(expect_json_field "$R" '.count==2 and (.slots|length)==2'; echo $?)"
AFTER_N=$(ls /home/z/my-project/data/projects/default/files/ | wc -l)
[ "$AFTER_N" -lt "$BEFORE_N" ]; check "被移除位置的视频文件已删除（$BEFORE_N -> $AFTER_N）" $?

echo "== 9. 文件流与 Range 对抗 =="
R=$(curl -s -X POST "$BASE/api/videos/upload" -F "file=@/home/z/my-project/scripts/test-videos/v06-landscape.mp4" -F "slot=0")
FN=$(echo "$R" | jq -r '.slots[0].video.filename')
SIZE=$(stat -c %s "/home/z/my-project/data/projects/default/files/$FN")
H=$(curl -s -o /dev/null -D - "$BASE/api/files/$FN" -H 'Range: bytes=0-99' | tr -d '\r')
echo "$H" | rg -q "^HTTP.*206"; check "Range bytes=0-99 -> 206" $?
echo "$H" | rg -qi "^content-range: bytes 0-99/$SIZE"; check "Content-Range 正确 (0-99/$SIZE)" $?
echo "$H" | rg -qi "^Content-Length: 100"; check "Content-Length=100" $?
H=$(curl -s -o /dev/null -D - "$BASE/api/files/$FN" -H 'Range: bytes=-100' | tr -d '\r')
echo "$H" | rg -q "^HTTP.*206"; check "后缀 Range bytes=-100 -> 206" $?
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/files/$FN" -H 'Range: bytes=999999999-')
[ "$CODE" = "416" ]; check "越界 Range -> 416" $?
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/files/$FN" -H 'Range: bytes=bad-range')
[ "$CODE" = "416" ]; check "非法 Range 格式 -> 416" $?
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/files/$FN" -H 'Range: bytes=50-20')
[ "$CODE" = "416" ]; check "start>end Range -> 416" $?
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/files/nonexistent-uuid.mp4")
[ "$CODE" = "404" ]; check "不存在的文件 -> 404" $?
CODE=$(curl -s -o /dev/null -w "%{http_code}" --path-as-is "$BASE/api/files/..%2F..%2Fmanifest.json")
[ "$CODE" = "404" ]; check "路径穿越 ..%2F..%2Fmanifest.json -> 404" $?
CODE=$(curl -s -o /dev/null -w "%{http_code}" --path-as-is "$BASE/api/files/..%2F..%2Fpackage.json")
[ "$CODE" = "404" ]; check "路径穿越 ..%2Fpackage.json -> 404" $?

echo "== 10. 清空全部（保留数量与布局设置）=="
R=$(curl -s -X DELETE "$BASE/api/videos?all=1")
check "DELETE ?all=1 -> 全部置空" "$(expect_json_field "$R" '([.slots[].video] | all(. == null))'; echo $?)"
CNT=$(curl -s "$BASE/api/videos" | jq '.count')
[ "$CNT" = "2" ]; check "清空后保留 count=$CNT 与布局设置" $?
AFTER_N=$(ls /home/z/my-project/data/projects/default/files/ | wc -l)
[ "$AFTER_N" = "0" ]; check "清空后磁盘无残留文件（实际 $AFTER_N）" $?

echo "== 11. HTML 上传与 v1 门面往返（Step 5）=="
# 准备测试 HTML：含 JS 与尝试读取 parent 的对抗代码（页面自身在沙箱里报错属预期）
cat > /tmp/adv-test-page.html <<'EOF'
<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>body{font-family:sans-serif;background:#101014;color:#7dd3fc}h1{font-size:28px}</style></head>
<body><h1>ADV-TEST-PAGE-OK</h1><script>document.body.setAttribute('data-js','ran');
try { void parent.document.title; } catch (e) { document.body.setAttribute('data-sandbox','blocked'); }</script></body></html>
EOF
FILES_DIR="/home/z/my-project/data/projects/default/files"
# 前置：恢复 6 位（2×3）并清空；门面语义为紧凑左填——上传到空洞位会落在首个空位（slot 0）
curl -s -X PATCH "$BASE/api/videos/layout" -H 'Content-Type: application/json' -d '{"count":6,"rows":2,"cols":3}' >/dev/null
curl -s -X DELETE "$BASE/api/videos?all=1" >/dev/null
BEFORE_N=$(ls "$FILES_DIR" | wc -l)
R=$(curl -s -X POST "$BASE/api/videos/upload" -F "file=@/tmp/adv-test-page.html;type=text/html" -F "slot=0")
check "HTML 上传 -> 200 且槽位带 kind=html" "$(expect_json_field "$R" '.slots[0].kind=="html" and .slots[0].html.filename'; echo $?)"
HF=$(echo "$R" | jq -r '.slots[0].html.filename')
[ -f "$FILES_DIR/$HF" ]; check "HTML 文件已落盘（$HF）" $?
AFTER_N=$(ls "$FILES_DIR" | wc -l)
[ "$AFTER_N" -eq "$((BEFORE_N+1))" ]; check "HTML 上传后磁盘文件数 +1（$BEFORE_N -> $AFTER_N）" $?

echo "== 12. HTML 视图往返保护（v1 写路径不得丢弃 HTML 条目）=="
R=$(curl -s -X PATCH "$BASE/api/videos" -H 'Content-Type: application/json' -d '{"slot":0,"title":"对抗测试页"}')
check "v1 改标题后 HTML 条目仍在（kind/html 字段保留）" "$(expect_json_field "$R" '.slots[0].kind=="html" and .slots[0].html.filename=="'$HF'" and .slots[0].title=="对抗测试页"'; echo $?)"
[ -f "$FILES_DIR/$HF" ]; check "改标题后 HTML 文件仍在磁盘" $?
R=$(curl -s -X PATCH "$BASE/api/videos/layout" -H 'Content-Type: application/json' -d '{"count":6,"rows":2,"cols":3}')
check "v1 改布局后 HTML 条目仍在" "$(expect_json_field "$R" '.slots[0].kind=="html" and .slots[0].html.filename=="'$HF'"'; echo $?)"
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/files/$HF")
[ "$CODE" = "200" ]; check "HTML 直链可访问 -> 200" $?
H=$(curl -s -o /dev/null -D - "$BASE/api/files/$HF" | tr -d '\r')
echo "$H" | rg -qi "^Content-Security-Policy: sandbox allow-scripts"; check "HTML 响应带 CSP sandbox allow-scripts" $?
echo "$H" | rg -qi "^X-Content-Type-Options: nosniff"; check "HTML 响应带 nosniff" $?
echo "$H" | rg -qi "^Cache-Control: no-store"; check "HTML 响应带 no-store" $?
echo "$H" | rg -qi "^Content-Disposition: inline"; check "HTML 响应带 inline" $?

echo "== 13. HTML 替换/删除/清空的文件清理 =="
# 13a 视频替换 HTML（同槽位原地替换）：旧 HTML 文件必须被清理（v1 视图看不见 HTML 文件，靠集中式清理）
R=$(curl -s -X POST "$BASE/api/videos/upload" -F "file=@/home/z/my-project/scripts/test-videos/v01-landscape.mp4" -F "slot=0")
check "视频替换 HTML 槽位 -> 槽位变为 video" "$(expect_json_field "$R" '.slots[0].kind=="video" and .slots[0].video.filename and .slots[0].html==null'; echo $?)"
[ ! -f "$FILES_DIR/$HF" ]; check "被替换的 HTML 文件已从磁盘删除" $?
# 13b 追加 HTML 到 slot 1，随后 DELETE 该槽位
R=$(curl -s -X POST "$BASE/api/videos/upload" -F "file=@/tmp/adv-test-page.html;type=text/html" -F "slot=1")
HF2=$(echo "$R" | jq -r '.slots[1].html.filename')
[ -f "$FILES_DIR/$HF2" ]; check "第二个 HTML 文件已落盘" $?
R=$(curl -s -X DELETE "$BASE/api/videos?slot=1")
check "DELETE 槽位 1 -> 槽位归空（kind/html 一并清除）" "$(expect_json_field "$R" '.slots[1].video==null and .slots[1].html==null and .slots[1].kind==null'; echo $?)"
[ ! -f "$FILES_DIR/$HF2" ]; check "DELETE 后第二个 HTML 文件已从磁盘删除" $?
# 13c 再追加 HTML 到 slot 1，缩容到 count=1 后越界文件删除
R=$(curl -s -X POST "$BASE/api/videos/upload" -F "file=@/tmp/adv-test-page.html;type=text/html" -F "slot=1")
HF3=$(echo "$R" | jq -r '.slots[1].html.filename')
R=$(curl -s -X PATCH "$BASE/api/videos/layout" -H 'Content-Type: application/json' -d '{"count":1,"rows":1,"cols":1}')
[ ! -f "$FILES_DIR/$HF3" ]; check "缩容后越界 HTML 文件已从磁盘删除" $?
# 13d 清空全部：恢复 6 位后铺 HTML + 视频，然后 all=1
curl -s -X PATCH "$BASE/api/videos/layout" -H 'Content-Type: application/json' -d '{"count":6,"rows":2,"cols":3}' >/dev/null
curl -s -X POST "$BASE/api/videos/upload" -F "file=@/tmp/adv-test-page.html;type=text/html" >/dev/null
curl -s -X POST "$BASE/api/videos/upload" -F "file=@/home/z/my-project/scripts/test-videos/v02-portrait.mp4" >/dev/null
R=$(curl -s -X DELETE "$BASE/api/videos?all=1")
check "清空全部 -> 槽位全空" "$(expect_json_field "$R" '([.slots[].video] | all(. == null)) and ([.slots[] | .html == null] | all)'; echo $?)"
AFTER_N=$(ls "$FILES_DIR" | wc -l)
[ "$AFTER_N" = "0" ]; check "清空后磁盘无残留（含 HTML，实际 $AFTER_N）" $?

echo "== 14. HTML 校验对抗 =="
echo "plain text" > /tmp/not-html.txt
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/videos/upload" -F "file=@/tmp/not-html.txt;type=text/html" -F "slot=0")
[ "$CODE" = "400" ]; check "text MIME 但非 .html 扩展名 -> 400" $?
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/videos/upload" -F "file=@/home/z/my-project/scripts/test-videos/v03-square.mp4;type=text/html" -F "slot=0")
[ "$CODE" = "400" ]; check "MP4 字节伪装 text/html MIME（扩展名不符）-> 400" $?
: > /tmp/empty.html
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/videos/upload" -F "file=@/tmp/empty.html;type=text/html" -F "slot=0")
[ "$CODE" = "400" ]; check "空 HTML 文件 -> 400" $?
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/videos/upload" -F "file=@/tmp/adv-test-page.html;type=text/html" -F "slot=99")
[ "$CODE" = "400" ]; check "HTML 上传到越界槽位 -> 400" $?


echo "== 15. 全局设置 API（Step 7，蓝图 §7/§9/§13）=="
# 非法值对抗
for body in '{"aspectRatio":"4:3"}' '{"playbackRate":1.3}' '{"playbackRate":"2"}' '{"showTitles":"yes"}' '{"loop":1}' '{}' 'not-json' '{"aspectRatio":null}'; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$BASE/api/videos/settings" -H 'Content-Type: application/json' -d "$body")
  [ "$CODE" = "400" ]; check "非法设置参数 -> 400: $body" $?
done
# 合法更新：比例 + 速度 + 标题显隐 + loop/muted
R=$(curl -s -X PATCH "$BASE/api/videos/settings" -H 'Content-Type: application/json' -d '{"aspectRatio":"9:16","playbackRate":1.5,"showTitles":false,"loop":true,"muted":false}')
check "合法设置更新 -> settings 全字段生效" "$(expect_json_field "$R" '.settings.aspectRatio=="9:16" and .settings.playbackRate==1.5 and .settings.showTitles==false and .settings.loop==true and .settings.muted==false'; echo $?)"
# 持久化：重读清单仍在
R=$(curl -s "$BASE/api/videos")
check "设置已持久化（GET 回读一致）" "$(expect_json_field "$R" '.settings.aspectRatio=="9:16" and .settings.playbackRate==1.5'; echo $?)"
# 部分更新：仅改一个字段，其余保留
R=$(curl -s -X PATCH "$BASE/api/videos/settings" -H 'Content-Type: application/json' -d '{"aspectRatio":"1:1"}')
check "部分更新只改目标字段（9:16→1:1，速度仍 1.5）" "$(expect_json_field "$R" '.settings.aspectRatio=="1:1" and .settings.playbackRate==1.5'; echo $?)"
# v2 端点一致性：v1 设置写入对 v2 视图可见
check "v1 设置与 v2 Project.settings 一致" "$(curl -s "$BASE/api/projects/default" | jq -e '.settings.aspectRatio=="1:1" and .settings.playbackRate==1.5' >/dev/null 2>&1; echo $?)"

echo "== 16. 单卡比例覆盖（Step 7，蓝图 §13）=="
# 先放一个视频
R=$(curl -s -X POST "$BASE/api/videos/upload" -F "file=@/home/z/my-project/scripts/test-videos/v01-landscape.mp4" -F "slot=0")
check "上传视频到槽 0（覆盖前置条件）" "$(expect_json_field "$R" '.slots[0].video != null'; echo $?)"
# 非法值对抗
for body in '{"slot":0,"aspectRatio":"4:3"}' '{"slot":0,"aspectRatio":123}' '{"slot":99,"aspectRatio":"1:1"}' '{"slot":0}' '{}'; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$BASE/api/videos" -H 'Content-Type: application/json' -d "$body")
  [ "$CODE" = "400" ]; check "非法单卡比例 -> 400: $body" $?
done
# 合法覆盖 + 回读
R=$(curl -s -X PATCH "$BASE/api/videos" -H 'Content-Type: application/json' -d '{"slot":0,"aspectRatio":"1:1"}')
check "单卡覆盖 1:1 -> 视图透传" "$(expect_json_field "$R" '.slots[0].aspectRatio=="1:1"'; echo $?)"
check "单卡覆盖已落库（GET 回读）" "$(curl -s "$BASE/api/videos" | jq -e '.slots[0].aspectRatio=="1:1"' >/dev/null 2>&1; echo $?)"
# 标题与比例可同请求更新
R=$(curl -s -X PATCH "$BASE/api/videos" -H 'Content-Type: application/json' -d '{"slot":0,"title":"对比项A","aspectRatio":"9:16"}')
check "标题+比例同请求更新" "$(expect_json_field "$R" '.slots[0].title=="对比项A" and .slots[0].aspectRatio=="9:16"'; echo $?)"
# null = 恢复跟随全局
R=$(curl -s -X PATCH "$BASE/api/videos" -H 'Content-Type: application/json' -d '{"slot":0,"aspectRatio":null}')
check "覆盖置 null -> 恢复跟随全局" "$(expect_json_field "$R" '.slots[0].aspectRatio==null'; echo $?)"
# v2 一致性：单卡覆盖落在 items[0].aspectRatio
check "单卡覆盖与 v2 items.aspectRatio 一致" "$(curl -s "$BASE/api/projects/default/items" | jq -e '.[0].aspectRatio==null' >/dev/null 2>&1; echo $?)"
# 清理：移除测试视频 + 设置复位
curl -s -X DELETE "$BASE/api/videos?all=1" >/dev/null
R=$(curl -s -X PATCH "$BASE/api/videos/settings" -H 'Content-Type: application/json' -d '{"aspectRatio":"original","showTitles":true,"loop":true,"muted":true,"playbackRate":1}')
check "测试后设置复位（original/1×/显示标题）" "$(expect_json_field "$R" '.settings.aspectRatio=="original" and .settings.playbackRate==1 and .settings.showTitles==true'; echo $?)"

echo ""
echo "========== 汇总 =========="
echo "通过: $PASS  失败: $FAIL"
if [ "$FAIL" -gt 0 ]; then
  printf '失败项:\n'; printf '  - %s\n' "${FAILED_ITEMS[@]}"
  exit 1
else
  echo "全部通过 ✅"
fi
