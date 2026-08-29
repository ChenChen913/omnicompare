#!/usr/bin/env bash
# 精确复现 api-adversarial-test.sh 第 7 节的三路并发形态，抓取每路响应
BASE="http://localhost:3000"
F=/home/z/my-project/scripts/test-videos

# 前置：恢复 6 位、清空、铺一个 slot0（模拟第 6 节结束态）
curl -s -X PATCH "$BASE/api/videos/layout" -H 'Content-Type: application/json' -d '{"count":6,"rows":2,"cols":3}' >/dev/null
curl -s -X DELETE "$BASE/api/videos?all=1" >/dev/null
curl -s -X POST "$BASE/api/videos/upload" -F "file=@$F/v02-portrait.mp4" -F "slot=0" -o /tmp/cc_r0.json
echo "setup: $(jq -r '[.slots[] | (.video.filename // "-")] | join(",")' /tmp/cc_r0.json)"

curl -s -w "A:%{http_code}\n" -X POST "$BASE/api/videos/upload" -F "file=@$F/v03-square.mp4" -F "slot=1" -o /tmp/cc_rA.json &
curl -s -w "B:%{http_code}\n" -X POST "$BASE/api/videos/upload" -F "file=@$F/v04-ultrawide.mp4" -F "slot=2" -o /tmp/cc_rB.json &
curl -s -w "C:%{http_code}\n" -X POST "$BASE/api/videos/upload" -F "file=@$F/v05-tiny.mp4" -F "slot=3" -o /tmp/cc_rC.json &
wait
for f in rA rB rC; do
  echo "== $f items: $(jq -r '[.slots[] | (.video.filename // "-")] | join(",")' /tmp/cc_$f.json 2>/dev/null || echo 'NOT-JSON')"
done
echo "== FINAL: $(curl -s $BASE/api/videos | jq -r '[.slots[] | (.video.filename // "-")] | join(",")')"
echo "== disk: $(ls /home/z/my-project/data/projects/default/files/ | wc -l)"
