#!/usr/bin/env bash
# 自动适配视口（autoFit）API 测试
# 覆盖：视图回读携带字段、v1/v2 合法更新与回显、非法值 400、非布尔类型 400、v1/v2 一致性
# 结束时恢复默认（autoFit=true），不污染演示数据

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

echo "=== A. 视图回读携带 autoFit ==="
R=$(req GET /api/videos)
BODY=$(echo "$R" | head -n -1); CODE=$(echo "$R" | tail -n 1)
check "GET /api/videos 200" 200 "$CODE" '"count"' "$BODY"
check "回读携带 autoFit" 0 0 '"autoFit":(true|false)' "$BODY"

echo "=== B. v1 合法更新与回显 ==="
R=$(req PATCH /api/videos/settings '{"autoFit":false}')
BODY=$(echo "$R" | head -n -1); CODE=$(echo "$R" | tail -n 1)
check "PATCH autoFit=false" 200 "$CODE" '"autoFit":false' "$BODY"
R=$(req PATCH /api/videos/settings '{"autoFit":true}')
BODY=$(echo "$R" | head -n -1); CODE=$(echo "$R" | tail -n 1)
check "PATCH autoFit=true" 200 "$CODE" '"autoFit":true' "$BODY"
# 与其他字段混传（单请求多字段）
R=$(req PATCH /api/videos/settings '{"autoFit":false,"wallScale":50}')
BODY=$(echo "$R" | head -n -1); CODE=$(echo "$R" | tail -n 1)
# 视图字段顺序：wallScale/htmlScale 在 autoFit 之前
check "PATCH autoFit+wallScale 混传" 200 "$CODE" '"wallScale":50.*"autoFit":false' "$BODY"
R=$(req PATCH /api/videos/settings '{"autoFit":true,"wallScale":100}')
BODY=$(echo "$R" | head -n -1); CODE=$(echo "$R" | tail -n 1)
check "混传恢复默认" 200 "$CODE" '"wallScale":100.*"autoFit":true' "$BODY"

echo "=== C. v1 非法值 400 ==="
for v in '"yes"' '1' '0' 'null' '"true"'; do
  R=$(req PATCH /api/videos/settings "{\"autoFit\":$v}")
  CODE=$(echo "$R" | tail -n 1)
  check "PATCH autoFit=$v -> 400" 400 "$CODE" '自动适配' "$(echo "$R" | head -n -1)"
done

echo "=== D. v2 路由一致性与回显 ==="
PID="default"  # v1 默认项目在 v2 store 中同 id，保证 v1/v2 操作同一项目
R=$(req PATCH "/api/projects/$PID/settings" '{"autoFit":false}')
BODY=$(echo "$R" | head -n -1); CODE=$(echo "$R" | tail -n 1)
check "v2 PATCH autoFit=false" 200 "$CODE" '"autoFit":false' "$BODY"
R=$(req GET /api/videos)
check "v1 回读同步 false" 200 "$(echo "$R" | tail -n 1)" '"autoFit":false' "$(echo "$R" | head -n -1)"
for v in '"yes"' '123'; do
  R=$(req PATCH "/api/projects/$PID/settings" "{\"autoFit\":$v}")
  CODE=$(echo "$R" | tail -n 1)
  check "v2 PATCH autoFit=$v -> 400" 400 "$CODE" '自动适配' "$(echo "$R" | head -n -1)"
done
R=$(req PATCH "/api/projects/$PID/settings" '{"autoFit":true}')
BODY=$(echo "$R" | head -n -1); CODE=$(echo "$R" | tail -n 1)
check "v2 恢复默认 true" 200 "$CODE" '"autoFit":true' "$BODY"

echo "=== E. 收尾：确认默认态 ==="
R=$(req GET /api/videos)
BODY=$(echo "$R" | head -n -1); CODE=$(echo "$R" | tail -n 1)
check "最终 autoFit=true" 200 "$CODE" '"autoFit":true' "$BODY"

echo ""
echo "通过 $PASS / $((PASS+FAIL))"
[ "$FAIL" -eq 0 ] || exit 1
