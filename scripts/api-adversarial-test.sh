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
curl -s -X POST "$BASE/api/videos/upload" -F "file=@/home/z/my-project/scripts/test-videos/v03-square.mp4" -F "slot=1" >/dev/null &
curl -s -X POST "$BASE/api/videos/upload" -F "file=@/home/z/my-project/scripts/test-videos/v04-ultrawide.mp4" -F "slot=2" >/dev/null &
curl -s -X POST "$BASE/api/videos/upload" -F "file=@/home/z/my-project/scripts/test-videos/v05-tiny.mp4" -F "slot=3" -o /tmp/concurrent-resp.json >/dev/null &
wait
check "3 路并发上传全部成功（清单可读）" "$(curl -s "$BASE/api/videos" | jq -e '.slots[1].video and .slots[2].video and .slots[3].video' >/dev/null; echo $?)"
AFTER_N=$(ls /home/z/my-project/data/projects/default/files/ | wc -l)
REF_N=$(curl -s "$BASE/api/videos" | jq '[.slots[].video | select(. != null)] | length')
[ "$AFTER_N" -eq "$REF_N" ]; check "并发后磁盘文件数与清单 1:1（磁盘 $AFTER_N / 引用 $REF_N）" $?

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

echo ""
echo "========== 汇总 =========="
echo "通过: $PASS  失败: $FAIL"
if [ "$FAIL" -gt 0 ]; then
  printf '失败项:\n'; printf '  - %s\n' "${FAILED_ITEMS[@]}"
  exit 1
else
  echo "全部通过 ✅"
fi
