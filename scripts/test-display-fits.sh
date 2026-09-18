#!/usr/bin/env bash
# 显示适配三字段 API 测试：letterboxFill（base/blur/cover）+ wallScale + htmlScale
# 覆盖：默认值兜底、合法更新（含 cover 新档）、档位边界、非法值 400、v2 路由一致性、回读
# 结束时恢复默认（base/100/100），不污染演示数据

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

echo "=== A. 默认值兜底 ==="
R=$(req GET /api/videos)
BODY=$(echo "$R" | head -n -1); CODE=$(echo "$R" | tail -n 1)
check "GET /api/videos 200" 200 "$CODE" '"count"' "$BODY"
check "回读携带 wallScale" 0 0 '"wallScale":' "$BODY"
check "回读携带 htmlScale" 0 0 '"htmlScale":' "$BODY"
check "回读携带 letterboxFill" 0 0 '"letterboxFill":' "$BODY"

echo "=== B. letterboxFill 合法值（含新档 cover） ==="
for v in base blur cover; do
  R=$(req PATCH /api/videos/settings "{\"letterboxFill\":\"$v\"}")
  BODY=$(echo "$R" | head -n -1); CODE=$(echo "$R" | tail -n 1)
  check "PATCH letterboxFill=$v" 200 "$CODE" "\"letterboxFill\":\"$v\"" "$BODY"
done

echo "=== C. letterboxFill 非法值 400 ==="
for v in '"fit"' '"stretch"' '""' '123' 'null'; do
  R=$(req PATCH /api/videos/settings "{\"letterboxFill\":$v}")
  CODE=$(echo "$R" | tail -n 1)
  check "PATCH letterboxFill=$v -> 400" 400 "$CODE" '留白填充' "$(echo "$R" | head -n -1)"
done

echo "=== D. wallScale / htmlScale 合法档位 ==="
for v in 100 75 66 50 33; do
  R=$(req PATCH /api/videos/settings "{\"wallScale\":$v}")
  BODY=$(echo "$R" | head -n -1); CODE=$(echo "$R" | tail -n 1)
  check "PATCH wallScale=$v" 200 "$CODE" "\"wallScale\":$v" "$BODY"
  R=$(req PATCH /api/videos/settings "{\"htmlScale\":$v}")
  BODY=$(echo "$R" | head -n -1); CODE=$(echo "$R" | tail -n 1)
  check "PATCH htmlScale=$v" 200 "$CODE" "\"htmlScale\":$v" "$BODY"
done

echo "=== E. wallScale / htmlScale 非法值 400（白名单外一律拒绝） ==="
for v in 99 80 67 51 34 0 -50 '"abc"' 'null' '100.5'; do
  R=$(req PATCH /api/videos/settings "{\"wallScale\":$v}")
  CODE=$(echo "$R" | tail -n 1)
  check "PATCH wallScale=$v -> 400" 400 "$CODE" '整体大小' "$(echo "$R" | head -n -1)"
  R=$(req PATCH /api/videos/settings "{\"htmlScale\":$v}")
  CODE=$(echo "$R" | tail -n 1)
  check "PATCH htmlScale=$v -> 400" 400 "$CODE" '页面缩放' "$(echo "$R" | head -n -1)"
done

echo "=== F. 三字段同发 + v2 路由一致性 ==="
R=$(req PATCH /api/videos/settings '{"letterboxFill":"cover","wallScale":50,"htmlScale":75}')
BODY=$(echo "$R" | head -n -1); CODE=$(echo "$R" | tail -n 1)
check "PATCH 三字段同发" 200 "$CODE" '"letterboxFill":"cover".*"wallScale":50.*"htmlScale":75' "$BODY"

PID=$(echo "$BODY" | grep -oE '"projectId":"[^"]+"' | head -1 | cut -d'"' -f4)
if [ -z "$PID" ]; then PID=$(echo "$BODY" | python3 -c "import sys,json;print(json.load(sys.stdin).get('projectId','default'))" 2>/dev/null); fi
if [ -z "$PID" ]; then PID="default"; fi

R=$(req PATCH "/api/projects/$PID/settings" '{"letterboxFill":"blur","wallScale":33,"htmlScale":66}')
BODY2=$(echo "$R" | head -n -1); CODE=$(echo "$R" | tail -n 1)
check "v2 PATCH 同标准" 200 "$CODE" '"letterboxFill":"blur"' "$BODY2"

R=$(req GET /api/videos)
BODY3=$(echo "$R" | head -n -1); CODE=$(echo "$R" | tail -n 1)
check "v1 回读同步（v2 写入生效）" 200 "$CODE" '"letterboxFill":"blur".*"wallScale":33.*"htmlScale":66' "$BODY3"

echo "=== G. 恢复默认（不污染演示数据） ==="
R=$(req PATCH /api/videos/settings '{"letterboxFill":"base","wallScale":100,"htmlScale":100}')
BODY=$(echo "$R" | head -n -1); CODE=$(echo "$R" | tail -n 1)
check "恢复 base/100/100" 200 "$CODE" '"letterboxFill":"base".*"wallScale":100.*"htmlScale":100' "$BODY"

echo ""
echo "结果：PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
