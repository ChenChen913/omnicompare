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
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/videos/upload" -F "file=@/home/z/my-project/scripts/test-videos/v01-landscape.mp4" -F "slot=999")
[ "$CODE" = "400" ]; check "slot=999 越界 -> 400" $?
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/videos/upload" -F "file=@/home/z/my-project/scripts/test-videos/v01-landscape.mp4")
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
for body in '{"aspectRatio":"4:3"}' '{"playbackRate":1.3}' '{"playbackRate":"2"}' '{"showTitles":"yes"}' '{"showInfo":"yes"}' '{"loop":1}' '{}' 'not-json' '{"aspectRatio":null}'; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$BASE/api/videos/settings" -H 'Content-Type: application/json' -d "$body")
  [ "$CODE" = "400" ]; check "非法设置参数 -> 400: $body" $?
done
# 合法更新：比例 + 速度 + 标题/属性显隐 + loop/muted
R=$(curl -s -X PATCH "$BASE/api/videos/settings" -H 'Content-Type: application/json' -d '{"aspectRatio":"9:16","playbackRate":1.5,"showTitles":false,"showInfo":false,"loop":true,"muted":false}')
check "合法设置更新 -> settings 全字段生效" "$(expect_json_field "$R" '.settings.aspectRatio=="9:16" and .settings.playbackRate==1.5 and .settings.showTitles==false and .settings.showInfo==false and .settings.loop==true and .settings.muted==false'; echo $?)"
# 持久化：重读清单仍在
R=$(curl -s "$BASE/api/videos")
check "设置已持久化（GET 回读一致）" "$(expect_json_field "$R" '.settings.aspectRatio=="9:16" and .settings.playbackRate==1.5 and .settings.showInfo==false'; echo $?)"
# 部分更新：仅改一个字段，其余保留
R=$(curl -s -X PATCH "$BASE/api/videos/settings" -H 'Content-Type: application/json' -d '{"aspectRatio":"1:1"}')
check "部分更新只改目标字段（9:16→1:1，速度仍 1.5）" "$(expect_json_field "$R" '.settings.aspectRatio=="1:1" and .settings.playbackRate==1.5'; echo $?)"
# v2 端点一致性：v1 设置写入对 v2 视图可见
check "v1 设置与 v2 Project.settings 一致" "$(curl -s "$BASE/api/projects/default" | jq -e '.settings.aspectRatio=="1:1" and .settings.playbackRate==1.5 and .settings.showInfo==false' >/dev/null 2>&1; echo $?)"
# 属性显隐独立控制：只改 showInfo，标题显隐不受牵连
R=$(curl -s -X PATCH "$BASE/api/videos/settings" -H 'Content-Type: application/json' -d '{"showInfo":true}')
check "独立更新 showInfo（标题显隐不变）" "$(expect_json_field "$R" '.settings.showInfo==true and .settings.showTitles==false'; echo $?)"

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
R=$(curl -s -X PATCH "$BASE/api/videos/settings" -H 'Content-Type: application/json' -d '{"aspectRatio":"original","showTitles":true,"showInfo":true,"loop":true,"muted":true,"playbackRate":1}')
check "测试后设置复位（original/1×/显示标题与属性）" "$(expect_json_field "$R" '.settings.aspectRatio=="original" and .settings.playbackRate==1 and .settings.showTitles==true and .settings.showInfo==true'; echo $?)"

echo "== 17. 多项目 v1 隔离（Step 8，蓝图 §8）=="
# 新建项目
R=$(curl -s -X POST "$BASE/api/projects" -H 'Content-Type: application/json' -d '{"name":"对抗测试项目"}')
PID=$(echo "$R" | jq -r '.id // empty')
[ -n "$PID" ]; check "新建项目 -> 返回 id" $?
# v1 视图读取新项目：空清单 + 默认设置
R=$(curl -s "$BASE/api/videos?project=$PID")
check "v1 视图读取新项目（count=6 空槽位 默认设置）" "$(expect_json_field "$R" '.count==6 and .slots[0].video==null and .settings.showInfo==true'; echo $?)"
# 上传到指定项目：默认项目不受影响
CODE=$(curl -s -o /tmp/pp.json -w "%{http_code}" -X POST "$BASE/api/videos/upload?project=$PID" -F "file=@/home/z/my-project/scripts/test-videos/v01-landscape.mp4" -F "slot=0")
[ "$CODE" = "200" ]; check "v1 上传到指定项目 -> 200" $?
check "新项目 slot0 有内容" "$(jq -e '.slots[0].video != null' /tmp/pp.json >/dev/null 2>&1; echo $?)"
check "默认项目不受影响（slot0 无内容）" "$(curl -s "$BASE/api/videos" | jq -e '.slots[0].video == null' >/dev/null 2>&1; echo $?)"
# v2 一致性：上传条目落在该项目的 items[0]
check "指定项目内容与 v2 items 一致" "$(curl -s "$BASE/api/projects/$PID/items" | jq -e 'length==1 and .[0].kind=="video"' >/dev/null 2>&1; echo $?)"
# 设置隔离：新项目 1:1，默认项目保持 original
curl -s -X PATCH "$BASE/api/videos/settings?project=$PID" -H 'Content-Type: application/json' -d '{"aspectRatio":"1:1"}' >/dev/null
check "项目设置隔离（新项目 1:1，默认 original）" "$(curl -s "$BASE/api/videos?project=$PID" | jq -e '.settings.aspectRatio=="1:1"' >/dev/null 2>&1 && curl -s "$BASE/api/videos" | jq -e '.settings.aspectRatio=="original"' >/dev/null 2>&1; echo $?)"
# 标题写入指定项目
curl -s -X PATCH "$BASE/api/videos?project=$PID" -H 'Content-Type: application/json' -d '{"slot":0,"title":"隔离测试"}' >/dev/null
check "标题写入指定项目" "$(curl -s "$BASE/api/videos?project=$PID" | jq -e '.slots[0].title=="隔离测试"' >/dev/null 2>&1; echo $?)"
# 非法与不存在的项目
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/videos?project=no-such-project")
[ "$CODE" = "404" ]; check "v1 读取不存在项目 -> 404" $?
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/videos?project=..%2Fevil")
[ "$CODE" = "400" ]; check "v1 非法项目 id -> 400" $?
# 清理：删除项目后 v1 视图 404；默认项目删除受保护
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$BASE/api/projects/$PID")
[ "$CODE" = "200" ]; check "删除测试项目 -> 200" $?
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/videos?project=$PID")
[ "$CODE" = "404" ]; check "删除后 v1 视图 -> 404" $?
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$BASE/api/projects/default")
[ "$CODE" = "403" ]; check "默认项目删除受保护 -> 403" $?

echo "== 18. HTML 专项扩展（Step 9 补）=="
FILES_DIR="/home/z/my-project/data/projects/default/files"
# 前置：6 位布局 + 清空（保证可重复）
curl -s -X PATCH "$BASE/api/videos/layout" -H 'Content-Type: application/json' -d '{"count":6,"rows":2,"cols":3}' >/dev/null
curl -s -X DELETE "$BASE/api/videos?all=1" >/dev/null
# 18a 超大 HTML：超过 10MB 上限必须拒绝
python3 -c "open('/tmp/big.html','w').write('<!DOCTYPE html><html><body>' + 'A'*(11*1024*1024) + '</body></html>')"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/videos/upload" -F "file=@/tmp/big.html;type=text/html" -F "slot=0")
[ "$CODE" = "400" ]; check "超大 HTML（11MB > 10MB 上限）-> 400" $?
rm -f /tmp/big.html
# 18b HTML 原位替换视频：旧视频文件被集中清理（v1 视图看不见的文件也要删）
R=$(curl -s -X POST "$BASE/api/videos/upload" -F "file=@/home/z/my-project/scripts/test-videos/v01-landscape.mp4" -F "slot=0")
VF=$(echo "$R" | jq -r '.slots[0].video.filename')
[ -f "$FILES_DIR/$VF" ]; check "前置：视频已落盘（$VF）" $?
R=$(curl -s -X POST "$BASE/api/videos/upload" -F "file=@/tmp/adv-test-page.html;type=text/html" -F "slot=0")
check "HTML 原位替换视频 -> 槽位变 html 且 video 清空" "$(expect_json_field "$R" '.slots[0].kind=="html" and .slots[0].video==null'; echo $?)"
[ ! -f "$FILES_DIR/$VF" ]; check "被替换的视频文件已从磁盘删除" $?
HF=$(echo "$R" | jq -r '.slots[0].html.filename')
# 18c HTML 替换 HTML：旧文件清理、新文件落盘
R=$(curl -s -X POST "$BASE/api/videos/upload" -F "file=@/tmp/adv-test-page.html;type=text/html" -F "slot=0")
HF2=$(echo "$R" | jq -r '.slots[0].html.filename')
[ ! -f "$FILES_DIR/$HF" ]; check "HTML 替换 HTML 后旧文件已删除" $?
[ -f "$FILES_DIR/$HF2" ]; check "新 HTML 文件已落盘（$HF2）" $?
# 18d v1↔v2 一致性：HTML 条目在 v2 items 视图的 kind 与文件名
check "v2 items 视图 kind=html 且文件名一致" "$(curl -s "$BASE/api/projects/default/items" | jq -e 'length==1 and .[0].kind=="html" and .[0].file.filename=="'$HF2'"' >/dev/null 2>&1; echo $?)"
# 18e 跨项目文件解析 + 项目删除文件清理（蓝图 §8：文件路由按 uuid 全局解析）
R=$(curl -s -X POST "$BASE/api/projects" -H 'Content-Type: application/json' -d '{"name":"HTML跨项目解析测试"}')
PID2=$(echo "$R" | jq -r '.id // empty')
[ -n "$PID2" ]; check "创建第二个项目 -> 返回 id" $?
R=$(curl -s -X POST "$BASE/api/videos/upload?project=$PID2" -F "file=@/tmp/adv-test-page.html;type=text/html" -F "slot=0")
HF3=$(echo "$R" | jq -r '.slots[0].html.filename')
[ -n "$HF3" ] && [ "$HF3" != "null" ]; check "第二个项目 HTML 上传成功（$HF3）" $?
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/files/$HF3")
[ "$CODE" = "200" ]; check "跨项目文件直链解析 -> 200（uuid 全局唯一）" $?
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$BASE/api/projects/$PID2")
[ "$CODE" = "200" ]; check "删除第二个项目 -> 200" $?
[ ! -e "/home/z/my-project/data/projects/$PID2" ]; check "项目目录已整体删除" $?
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/files/$HF3")
[ "$CODE" = "404" ]; check "项目删除后文件直链 -> 404（跨项目解析已失效）" $?
# 清理默认项目，交给 §19 前置
curl -s -X DELETE "$BASE/api/videos?all=1" >/dev/null

echo "== 19. 排序专项（Step 9 补，蓝图 §14）=="
# 前置：6 位清空，上传 3 个视频并命名 A/B/C
curl -s -X PATCH "$BASE/api/videos/layout" -H 'Content-Type: application/json' -d '{"count":6,"rows":2,"cols":3}' >/dev/null
curl -s -X DELETE "$BASE/api/videos?all=1" >/dev/null
curl -s -X POST "$BASE/api/videos/upload" -F "file=@/home/z/my-project/scripts/test-videos/v01-landscape.mp4" -F "slot=0" >/dev/null
curl -s -X PATCH "$BASE/api/videos" -H 'Content-Type: application/json' -d '{"slot":0,"title":"对比项A"}' >/dev/null
curl -s -X POST "$BASE/api/videos/upload" -F "file=@/home/z/my-project/scripts/test-videos/v02-portrait.mp4" -F "slot=1" >/dev/null
curl -s -X PATCH "$BASE/api/videos" -H 'Content-Type: application/json' -d '{"slot":1,"title":"对比项B"}' >/dev/null
curl -s -X POST "$BASE/api/videos/upload" -F "file=@/home/z/my-project/scripts/test-videos/v03-square.mp4" -F "slot=2" >/dev/null
curl -s -X PATCH "$BASE/api/videos" -H 'Content-Type: application/json' -d '{"slot":2,"title":"对比项C"}' >/dev/null
REF=$(curl -s "$BASE/api/videos")
check "前置：3 个视频就位" "$(expect_json_field "$REF" '([.slots[] | select(.video != null)] | length)==3'; echo $?)"
FILES_BEFORE=$(ls "$FILES_DIR" | sort)
# 非法 order 对抗：非数组/长度不符/越界/重复/非整数/缺失
for body in '{"order":"x"}' '{"order":[0,1]}' '{"order":[0,1,3]}' '{"order":[0,0,1]}' '{"order":[0,1.5,2]}' '{}' '{"order":[0,1,"2"]}'; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$BASE/api/videos/reorder" -H 'Content-Type: application/json' -d "$body")
  [ "$CODE" = "400" ]; check "非法排序 -> 400: $body" $?
done
# 合法反转：order 为「新位置 -> 旧位置」映射，[2,1,0] 即完全倒序
R=$(curl -s -X PATCH "$BASE/api/videos/reorder" -H 'Content-Type: application/json' -d '{"order":[2,1,0]}')
check "合法反转 -> 200 且槽 0 变为 对比项C（标题跟随内容）" "$(expect_json_field "$R" '.slots[0].title=="对比项C" and .slots[2].title=="对比项A"'; echo $?)"
# 磁盘文件集合不变（排序只改 order，不动文件）
FILES_AFTER=$(ls "$FILES_DIR" | sort)
[ "$FILES_BEFORE" = "$FILES_AFTER" ]; check "排序不增删磁盘文件" $?
# v2 一致性：order 恒紧凑 0..n-1，且按 order 排出的标题序列与 v1 视图一致
check "v2 items order 紧凑 0..n-1" "$(curl -s "$BASE/api/projects/default/items" | jq -e '[.[].order] | sort == [0,1,2]' >/dev/null 2>&1; echo $?)"
V2T=$(curl -s "$BASE/api/projects/default/items" | jq -c '[.[]] | sort_by(.order) | map(.title)')
[ "$V2T" = '["对比项C","对比项B","对比项A"]' ]; check "v2 items 顺序与 v1 视图一致（实际 $V2T）" $?
# 空项目排序：order=[] -> 200 无变化
curl -s -X DELETE "$BASE/api/videos?all=1" >/dev/null
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$BASE/api/videos/reorder" -H 'Content-Type: application/json' -d '{"order":[]}')
[ "$CODE" = "200" ]; check "空项目 order=[] -> 200 无变化" $?
# 非空项目 order 长度不符（空数组对非空清单）
curl -s -X POST "$BASE/api/videos/upload" -F "file=@/home/z/my-project/scripts/test-videos/v01-landscape.mp4" -F "slot=0" >/dev/null
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$BASE/api/videos/reorder" -H 'Content-Type: application/json' -d '{"order":[]}')
[ "$CODE" = "400" ]; check "非空清单 order=[] 长度不符 -> 400" $?
# 清理：恢复测试前的空状态（演示数据由 restore-demo-state.py 统一恢复）
curl -s -X DELETE "$BASE/api/videos?all=1" >/dev/null

# ==============================================================
# §20 图片专项（第二阶段 Step A：kind=image 全链路）
# ==============================================================
IMGDIR=$(mktemp -d)
python3 - "$IMGDIR" <<'PYEOF'
import struct, zlib, sys, os
d = sys.argv[1]
def chunk(t, b):
    c = t + b
    return struct.pack('>I', len(b)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)
ihdr = struct.pack('>IIBBBBB', 1, 1, 8, 2, 0, 0, 0)
open(os.path.join(d, 't.png'), 'wb').write(
    b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr)
    + chunk(b'IDAT', zlib.compress(b'\x00\xff\x00\x00')) + chunk(b'IEND', b''))
open(os.path.join(d, 't.svg'), 'wb').write(
    b'<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="red"/><script>alert(1)</script></svg>')
open(os.path.join(d, 'bad.txt'), 'wb').write(b'not an image')
os.system(f"dd if=/dev/urandom of={d}/big.png bs=1M count=21 2>/dev/null")
PYEOF

# 图片上传：kind=image + image 元数据
R=$(curl -s -X POST "$BASE/api/videos/upload" -F "file=@$IMGDIR/t.png;type=image/png" -F "slot=0")
check "§20 PNG 上传 -> kind=image" "$(echo "$R" | jq -e '.slots[0].kind=="image" and (.slots[0].image.filename | length > 0)' >/dev/null 2>&1; echo $?)"
# SVG 上传：image/svg+xml MIME 双判
R=$(curl -s -X POST "$BASE/api/videos/upload" -F "file=@$IMGDIR/t.svg;type=image/svg+xml" -F "slot=1")
check "§20 SVG 上传 -> kind=image（svg+xml）" "$(echo "$R" | jq -e '.slots[1].kind=="image" and .slots[1].image.mimeType=="image/svg+xml"' >/dev/null 2>&1; echo $?)"
# 非图片扩展拒绝
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/videos/upload" -F "file=@$IMGDIR/bad.txt" -F "slot=2")
[ "$CODE" = "400" ]; check "§20 非图片扩展 .txt -> 400" $?
# 超大图片拒绝（21MB > 20MB）
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/videos/upload" -F "file=@$IMGDIR/big.png;type=image/png" -F "slot=2")
[ "$CODE" = "400" ]; check "§20 超大图片 21MB -> 400" $?
# 响应头：PNG 走图片类型 + 不可变缓存
PNG_NAME=$(curl -s "$BASE/api/videos" | jq -r '.slots[0].image.filename')
H=$(curl -sI "$BASE/api/files/$PNG_NAME")
check "§20 PNG 服务 image/png + immutable" "$(echo "$H" | grep -qi '^content-type: image/png' && echo "$H" | grep -qi 'immutable'; echo $?)"
# 响应头：SVG 走 CSP 沙箱（与 HTML 同级，脚本不执行）
SVG_NAME=$(curl -s "$BASE/api/videos" | jq -r '.slots[1].image.filename')
H=$(curl -sI "$BASE/api/files/$SVG_NAME")
check "§20 SVG 服务 CSP sandbox + no-store" "$(echo "$H" | grep -qi 'content-security-policy: sandbox' && echo "$H" | grep -qi 'no-store'; echo $?)"
# 原位替换：图换图旧文件清理（磁盘文件数不变）
BEFORE_N=$(ls "$FILES_DIR" | wc -l)
curl -s -X POST "$BASE/api/videos/upload" -F "file=@$IMGDIR/t.png;type=image/png" -F "slot=0" >/dev/null
AFTER_N=$(ls "$FILES_DIR" | wc -l)
[ "$BEFORE_N" = "$AFTER_N" ]; check "§20 图换图原位替换旧文件清理（$BEFORE_N->$AFTER_N）" $?
# v2 端点图片上传：kind=image 且 order 紧凑
curl -s -X DELETE "$BASE/api/videos?all=1" >/dev/null
R=$(curl -s -X POST "$BASE/api/projects/default/items/upload" -F "file=@$IMGDIR/t.png;type=image/png" -F "title=验收图")
check "§20 v2 上传图片 kind=image" "$(echo "$R" | jq -e '.item.kind=="image" and .item.title=="验收图"' >/dev/null 2>&1; echo $?)"
# v1 清空 all=1 后磁盘无图片孤儿
curl -s -X DELETE "$BASE/api/videos?all=1" >/dev/null
[ -z "$(ls "$FILES_DIR" 2>/dev/null)" ]; check "§20 清空后磁盘无孤儿文件" $?

# ==============================================================
# §21 zip 资源包专项（第二阶段 Step B：多文件 HTML 页面）
# ==============================================================
ZIPDIR=$(mktemp -d)
python3 - "$ZIPDIR" <<'PYEOF'
import zipfile, sys, os
d = sys.argv[1]
with zipfile.ZipFile(os.path.join(d, 'good.zip'), 'w') as z:
    z.writestr('index.html', '<html><head><link rel="stylesheet" href="assets/style.css"></head><body><h1 id="t">bundle ok</h1><script src="assets/app.js"></script></body></html>')
    z.writestr('assets/style.css', 'body{background:#123}')
    z.writestr('assets/app.js', 'document.getElementById("t").textContent += " - js ran";')
    z.writestr('sub/deep/note.txt', 'deep file')
with zipfile.ZipFile(os.path.join(d, 'noentry.zip'), 'w') as z:
    z.writestr('main.html', '<html></html>')
with zipfile.ZipFile(os.path.join(d, 'slip.zip'), 'w') as z:
    z.writestr('index.html', '<html></html>')
    z.writestr('../evil.txt', 'pwned')
with zipfile.ZipFile(os.path.join(d, 'badext.zip'), 'w') as z:
    z.writestr('index.html', '<html></html>')
    z.writestr('run.sh', 'echo hi')
PYEOF

# 正常包上传：kind=html + bundle=true
R=$(curl -s -X POST "$BASE/api/videos/upload" -F "file=@$ZIPDIR/good.zip;type=application/zip" -F "slot=0")
check "§21 zip 上传 -> kind=html + bundle=true" "$(echo "$R" | jq -e '.slots[0].kind=="html" and .slots[0].bundle==true and (.slots[0].html.filename | endswith(".html"))' >/dev/null 2>&1; echo $?)"
BUNDLE=$(echo "$R" | jq -r '.slots[0].html.filename')
# 缺 index.html 入口
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/videos/upload" -F "file=@$ZIPDIR/noentry.zip;type=application/zip" -F "slot=1")
[ "$CODE" = "400" ]; check "§21 缺 index.html 入口 -> 400" $?
# zip-slip 路径穿越条目
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/videos/upload" -F "file=@$ZIPDIR/slip.zip;type=application/zip" -F "slot=1")
[ "$CODE" = "400" ]; check "§21 zip-slip(..) 条目 -> 400" $?
# 白名单外扩展
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/videos/upload" -F "file=@$ZIPDIR/badext.zip;type=application/zip" -F "slot=1")
[ "$CODE" = "400" ]; check "§21 白名单外扩展 .sh -> 400" $?
# 入口页服务：CSP 沙箱
H=$(curl -sI "$BASE/api/bundles/$BUNDLE/index.html")
check "§21 入口页 200 + CSP sandbox" "$(echo "$H" | grep -q '^HTTP/1.1 200' && echo "$H" | grep -qi 'content-security-policy: sandbox'; echo $?)"
# 缺省路径 = 入口
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/bundles/$BUNDLE")
[ "$CODE" = "200" ]; check "§21 缺省路径命中入口 index.html" $?
# 子目录资产（含深层嵌套）
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/bundles/$BUNDLE/assets/style.css"); [ "$CODE" = "200" ]; check "§21 子目录资产 css 200" $?
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/bundles/$BUNDLE/sub/deep/note.txt"); [ "$CODE" = "200" ]; check "§21 深层嵌套资产 200" $?
# 包内路径穿越拒绝
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/bundles/$BUNDLE/../../../etc/passwd")
[ "$CODE" = "404" ]; check "§21 包内路径穿越 -> 404" $?
# /api/files/ 不服务包目录（目录不作为文件）
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/files/$BUNDLE")
[ "$CODE" = "404" ]; check "§21 /api/files/ 对包目录 404" $?
# v1 写路径往返保留 bundle 标志
R=$(curl -s -X PATCH "$BASE/api/videos" -H 'Content-Type: application/json' -d '{"slot":0,"title":"打包页"}')
check "§21 PATCH 标题后 bundle 标志保留" "$(echo "$R" | jq -e '.slots[0].bundle==true and .slots[0].title=="打包页"' >/dev/null 2>&1; echo $?)"
# v2 上传 zip -> bundle 标志
R=$(curl -s -X POST "$BASE/api/projects/default/items/upload" -F "file=@$ZIPDIR/good.zip;type=application/zip" -F "title=v2包")
check "§21 v2 上传 zip bundle=true" "$(echo "$R" | jq -e '.item.bundle==true and .item.kind=="html"' >/dev/null 2>&1; echo $?)"
V2BUNDLE=$(echo "$R" | jq -r '.item.file.filename')
# 替换 zip -> 图片：包目录整体清理（断言被替换的包目录已从磁盘消失）
curl -s -X POST "$BASE/api/videos/upload" -F "file=@$IMGDIR/t.png;type=image/png" -F "slot=1" >/dev/null
[ ! -d "$FILES_DIR/$V2BUNDLE" ]; check "§21 替换包->图 被替换包目录已清理（$V2BUNDLE）" $?
# 清理：清空 + 移除临时目录
curl -s -X DELETE "$BASE/api/videos?all=1" >/dev/null
[ -z "$(ls "$FILES_DIR" 2>/dev/null)" ]; check "§21 清空后磁盘无孤儿（含包目录）" $?
rm -rf "$IMGDIR" "$ZIPDIR"

echo ""
echo "========== 汇总 =========="
echo "通过: $PASS  失败: $FAIL"
if [ "$FAIL" -gt 0 ]; then
  printf '失败项:\n'; printf '  - %s\n' "${FAILED_ITEMS[@]}"
  exit 1
else
  echo "全部通过 ✅"
fi
