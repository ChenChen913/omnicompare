#!/usr/bin/env bash
# Step 3 v2 API 冒烟 + 对抗测试（对接 http://localhost:3000）
set -u
BASE="http://localhost:3000"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok: $1"; }
bad()  { FAIL=$((FAIL+1)); echo "FAIL: $1"; }
check(){ # $1=描述 $2=期望 $3=实际
  if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (期望 $2 实得 $3)"; fi
}

echo "== 项目集合 =="
code=$(curl -s -o /tmp/p_list.json -w "%{http_code}" "$BASE/api/projects")
check "GET /api/projects 200" 200 "$code"
NEW_ID=$(python3 -c "import json;ps=json.load(open('/tmp/p_list.json'));print(next(p['id'] for p in ps if p['id']=='default'))" 2>/dev/null)
check "列表含 default 项目" "default" "$NEW_ID"

code=$(curl -s -o /tmp/p_new.json -w "%{http_code}" -X POST -H 'Content-Type: application/json' -d '{"name":"冒烟测试项目"}' "$BASE/api/projects")
check "POST 新建项目 201" 201 "$code"
PID=$(python3 -c "import json;print(json.load(open('/tmp/p_new.json'))['id'])")

code=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H 'Content-Type: application/json' -d '{"name":""}' "$BASE/api/projects")
check "POST 空名回落默认名仍 201" 201 "$code"
JUNK_ID=$(curl -s -X POST -H 'Content-Type: application/json' -d '{"name":"待删"}' "$BASE/api/projects" | python3 -c "import json,sys;print(json.load(sys.stdin)['id'])")

echo "== 单项目 =="
code=$(curl -s -o /tmp/p_one.json -w "%{http_code}" "$BASE/api/projects/$PID")
check "GET 项目详情 200" 200 "$code"
code=$(curl -s -o /tmp/p_patch.json -w "%{http_code}" -X PATCH -H 'Content-Type: application/json' -d '{"name":"改名项目","status":"draft"}' "$BASE/api/projects/$PID")
check "PATCH 改名+状态 200" 200 "$code"
st=$(python3 -c "import json;p=json.load(open('/tmp/p_patch.json'));print(p['name'],p['status'])")
check "PATCH 生效" "改名项目 draft" "$st"
code=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH -H 'Content-Type: application/json' -d '{"status":"不存在"}' "$BASE/api/projects/$PID")
check "PATCH 非法状态 400" 400 "$code"
code=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/projects/..%2f..%2fetc")
check "路径穿越 id 400/404" 400 "$code"
code=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$BASE/api/projects/default")
check "DELETE 默认项目 403" 403 "$code"

echo "== 条目上传 =="
printf '<!DOCTYPE html><html><body><h1>测试页</h1><script>console.log(1)</script></body></html>' > /tmp/t.html
code=$(curl -s -o /tmp/up.json -w "%{http_code}" -F "file=@/tmp/t.html;type=text/html" -F "title=测试HTML" "$BASE/api/projects/$PID/items/upload")
check "上传 HTML 201" 201 "$code"
HID=$(python3 -c "import json;print(json.load(open('/tmp/up.json'))['item']['id'])")
kind=$(python3 -c "import json;print(json.load(open('/tmp/up.json'))['item']['kind'])")
check "kind 判别 html" "html" "$kind"

# 生成一个最小 mp4（复用现有测试视频）
TESTVID=$(ls "$HOME/my-project/data/projects/default/files/" 2>/dev/null | head -1)
if [ -z "$TESTVID" ]; then TESTVID=$(ls /home/z/my-project/data/projects/default/files/ | head -1); fi
curl -s -o /tmp/t.mp4 "http://localhost:3000/api/files/$TESTVID"
code=$(curl -s -o /tmp/up2.json -w "%{http_code}" -F "file=@/tmp/t.mp4;type=video/mp4" -F "title=测试视频" "$BASE/api/projects/$PID/items/upload")
check "上传视频 201" 201 "$code"
VID=$(python3 -c "import json;print(json.load(open('/tmp/up2.json'))['item']['id'])")
code=$(curl -s -o /dev/null -w "%{http_code}" -F "file=@/tmp/t.mp4;filename=../../evil.mp4" "$BASE/api/projects/$PID/items/upload")
check "路径穿越文件名仍 201（服务端重命名为 uuid）" 201 "$code"
echo "dummy" > /tmp/t.txt
code=$(curl -s -o /dev/null -w "%{http_code}" -F "file=@/tmp/t.txt;type=text/plain" "$BASE/api/projects/$PID/items/upload")
check "上传 txt 400" 400 "$code"

echo "== 文件安全响应头 =="
HDRS=$(curl -s -D - -o /dev/null "$BASE/api/projects/$PID/items" >/dev/null 2>&1; curl -s -D - -o /dev/null "$BASE/api/files/$(python3 -c "import json;p=json.load(open('/tmp/up.json'));print(p['item']['file']['filename'])")")
echo "$HDRS" | rg -qi "content-security-policy: sandbox allow-scripts" && ok "HTML CSP sandbox allow-scripts" || bad "HTML CSP 缺失"
echo "$HDRS" | rg -qi "x-content-type-options: nosniff" && ok "HTML nosniff" || bad "HTML nosniff 缺失"
echo "$HDRS" | rg -qi "cache-control: no-store" && ok "HTML no-store" || bad "HTML no-store 缺失"
VHDRS=$(curl -s -D - -o /dev/null "$BASE/api/files/$TESTVID")
echo "$VHDRS" | rg -qi "accept-ranges: bytes" && ok "视频 Accept-Ranges" || bad "视频 Accept-Ranges 缺失"
code=$(curl -s -o /dev/null -w "%{http_code}" -H "Range: bytes=999999999-" "$BASE/api/files/$TESTVID")
check "越界 Range 416" 416 "$code"

echo "== 条目 PATCH/DELETE =="
code=$(curl -s -o /tmp/it.json -w "%{http_code}" -X PATCH -H 'Content-Type: application/json' -d '{"title":"改名条目","aspectRatio":"1:1"}' "$BASE/api/projects/$PID/items/$VID")
check "PATCH 条目标题+比例 200" 200 "$code"
code=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH -H 'Content-Type: application/json' -d '{"aspectRatio":"49:1"}' "$BASE/api/projects/$PID/items/$VID")
check "PATCH 非法比例 400" 400 "$code"
code=$(curl -s -o /tmp/ord.json -w "%{http_code}" -X PATCH -H 'Content-Type: application/json' -d '{"order":0}' "$BASE/api/projects/$PID/items/$VID")
check "PATCH 条目排序 200" 200 "$code"
ord=$(python3 -c "import json;print(json.load(open('/tmp/ord.json'))['item']['order'])")
check "排序生效 order=0" "0" "$ord"
code=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH -H 'Content-Type: application/json' -d '{"order":99}' "$BASE/api/projects/$PID/items/$VID")
check "PATCH 越界排序 400" 400 "$code"
code=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH -H 'Content-Type: application/json' -d '{"title":"x"}' "$BASE/api/projects/$PID/items/不存在的id")
check "PATCH 不存在条目 404" 404 "$code"

echo "== 布局与设置 =="
code=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH -H 'Content-Type: application/json' -d '{"mode":"auto"}' "$BASE/api/projects/$PID/layout")
check "PATCH 布局 auto 200" 200 "$code"
code=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH -H 'Content-Type: application/json' -d '{"rows":1,"cols":1}' "$BASE/api/projects/$PID/layout")
check "PATCH 容量不足矩阵 400" 400 "$code"
code=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH -H 'Content-Type: application/json' -d '{"rows":2,"cols":3}' "$BASE/api/projects/$PID/layout")
check "PATCH 合法矩阵(2x3 容量6) 200" 200 "$code"
code=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH -H 'Content-Type: application/json' -d '{"aspectRatio":"9:16","playbackRate":1.5}' "$BASE/api/projects/$PID/settings")
check "PATCH 设置 200" 200 "$code"
code=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH -H 'Content-Type: application/json' -d '{"playbackRate":3}' "$BASE/api/projects/$PID/settings")
check "PATCH 非法速度 400" 400 "$code"

echo "== 清理与一致性 =="
code=$(curl -s -o /tmp/del.json -w "%{http_code}" -X DELETE "$BASE/api/projects/$PID/items/$HID")
check "DELETE 条目 200" 200 "$code"
n=$(python3 -c "import json;print(len(json.load(open('/tmp/del.json'))['items']))")
code2=$(curl -s "$BASE/api/projects/$PID/items" | python3 -c "import json,sys;print(len(json.load(sys.stdin)))")
check "删除后条目数一致" "$n" "$code2"
code=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$BASE/api/projects/$PID")
check "DELETE 非默认项目 200" 200 "$code"
ls /home/z/my-project/data/projects/ | rg -q "^$PID$" && bad "项目目录已删除" || ok "项目目录已删除"

echo "== v1 兼容回归 =="
code=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/videos")
check "GET /api/videos 200" 200 "$code"
code=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH -H 'Content-Type: application/json' -d '{"slot":0,"title":"示例视频 1"}' "$BASE/api/videos")
check "v1 PATCH 标题 200" 200 "$code"
code=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH -H 'Content-Type: application/json' -d '{"slot":99,"title":"x"}' "$BASE/api/videos")
check "v1 越界 slot 400" 400 "$code"

echo ""
echo "结果: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = "0" ]
