#!/usr/bin/env bash
# 标题格式（titleAlign/titleFontSize）设置 API 测试
# 覆盖：默认值兜底、合法更新、非法值 400、边界值、v2 路由一致性、持久化回读
# 结束时恢复默认（center/16），不污染演示数据

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

echo "=== A. 默认值兜底（旧数据无新字段 → 回落 center/16） ==="
R=$(req GET /api/videos)
BODY=$(echo "$R" | head -n -1); CODE=$(echo "$R" | tail -n 1)
check "GET /api/videos 200" 200 "$CODE" '"count"' "$BODY"
check "默认 titleAlign=center" 0 0 'center' "$BODY"
check "默认 titleFontSize=16" 0 0 '"titleFontSize":16' "$BODY"

echo "=== B. 合法更新 ==="
R=$(req PATCH /api/videos/settings '{"titleAlign":"left"}')
BODY=$(echo "$R" | head -n -1); CODE=$(echo "$R" | tail -n 1)
check "PATCH titleAlign=left" 200 "$CODE" '"titleAlign":"left"' "$BODY"

R=$(req PATCH /api/videos/settings '{"titleFontSize":20}')
BODY=$(echo "$R" | head -n -1); CODE=$(echo "$R" | tail -n 1)
check "PATCH titleFontSize=20" 200 "$CODE" '"titleFontSize":20' "$BODY"

R=$(req PATCH /api/videos/settings '{"titleAlign":"right","titleFontSize":24}')
BODY=$(echo "$R" | head -n -1); CODE=$(echo "$R" | tail -n 1)
check "PATCH 两字段同发" 200 "$CODE" '"titleAlign":"right".*"titleFontSize":24' "$BODY"

echo "=== C. 边界值（上限 60：用户反馈 28 不够用） ==="
for v in 12 60; do
  R=$(req PATCH /api/videos/settings "{\"titleFontSize\":$v}")
  CODE=$(echo "$R" | tail -n 1)
  check "PATCH 字号边界 $v" 200 "$CODE" '"titleFontSize":'$v "$(echo "$R" | head -n -1)"
done

echo "=== D. 非法值 400 ==="
declare -a CASES=(
  '{"titleFontSize":11}'          '{"titleFontSize":61}'
  '{"titleFontSize":"abc"}'       '{"titleFontSize":null}'
  '{"titleAlign":"middle"}'       '{"titleAlign":123}'
  '{"titleAlign":""}'
)
for b in "${CASES[@]}"; do
  R=$(req PATCH /api/videos/settings "$b")
  CODE=$(echo "$R" | tail -n 1)
  check "PATCH 非法 $b → 400" 400 "$CODE" 'error|需为' "$(echo "$R" | head -n -1)"
done

echo "=== E. 非法更新不落盘（GET 回读仍为最后一次合法值） ==="
R=$(req GET /api/videos)
BODY=$(echo "$R" | head -n -1)
check "回读 titleAlign=right" 0 0 '"titleAlign":"right"' "$BODY"
check "回读 titleFontSize=60" 0 0 '"titleFontSize":60' "$BODY"

echo "=== F. 标题位置/粗细/颜色（overlay 模式三件套） ==="
R=$(req PATCH /api/videos/settings '{"titlePosition":"overlay","titleWeight":"bold","titleColor":"#facc15"}')
BODY=$(echo "$R" | head -n -1); CODE=$(echo "$R" | tail -n 1)
check "PATCH 位置/粗细/颜色同发" 200 "$CODE" '"titlePosition":"overlay".*"titleWeight":"bold".*"titleColor":"#facc15"' "$BODY"
R=$(req PATCH /api/videos/settings '{"titlePosition":"below","titleWeight":"normal","titleColor":"default"}')
BODY=$(echo "$R" | head -n -1); CODE=$(echo "$R" | tail -n 1)
check "PATCH 回 below/normal/default" 200 "$CODE" '"titlePosition":"below".*"titleWeight":"normal".*"titleColor":"default"' "$BODY"
declare -a CASES2=(
  '{"titlePosition":"top"}'        '{"titlePosition":123}'
  '{"titleWeight":"heavy"}'        '{"titleWeight":700}'
  '{"titleColor":"#fff"}'          '{"titleColor":"javascript:alert(1)"}'
  '{"titleColor":"#GGGGGG"}'       '{"titleColor":null}'
)
for b in "${CASES2[@]}"; do
  R=$(req PATCH /api/videos/settings "$b")
  CODE=$(echo "$R" | tail -n 1)
  check "PATCH 非法 $b → 400" 400 "$CODE" 'error|需为' "$(echo "$R" | head -n -1)"
done

echo "=== F2. 位置编号显隐（showIndex，全局同步存项目 settings） ==="
R=$(req PATCH /api/videos/settings '{"showIndex":false}')
BODY=$(echo "$R" | head -n -1); CODE=$(echo "$R" | tail -n 1)
check "PATCH showIndex=false" 200 "$CODE" '"showIndex":false' "$BODY"
R=$(req PATCH /api/videos/settings '{"showIndex":"yes"}')
CODE=$(echo "$R" | tail -n 1)
check "PATCH showIndex 非法 → 400" 400 "$CODE" 'showIndex' "$(echo "$R" | head -n -1)"
R=$(req PATCH /api/projects/default/settings '{"showIndex":false}')
BODY=$(echo "$R" | head -n -1); CODE=$(echo "$R" | tail -n 1)
check "v2 showIndex 一致" 200 "$CODE" '"showIndex":false' "$BODY"
R=$(req GET /api/videos)
BODY=$(echo "$R" | head -n -1)
check "GET 回读 showIndex=false" 0 0 '"showIndex":false' "$BODY"
R=$(req PATCH /api/videos/settings '{"showIndex":true}')
BODY=$(echo "$R" | head -n -1); CODE=$(echo "$R" | tail -n 1)
check "恢复 showIndex=true" 200 "$CODE" '"showIndex":true' "$BODY"

echo "=== G. v2 路由一致性 ==="
R=$(req PATCH /api/projects/default/settings '{"titleAlign":"center","titleFontSize":18}')
BODY=$(echo "$R" | head -n -1); CODE=$(echo "$R" | tail -n 1)
check "v2 PATCH 合法" 200 "$CODE" '"titleAlign":"center".*"titleFontSize":18' "$BODY"
R=$(req PATCH /api/projects/default/settings '{"titleFontSize":99}')
CODE=$(echo "$R" | tail -n 1)
check "v2 PATCH 非法 → 400" 400 "$CODE" '标题字号' "$(echo "$R" | head -n -1)"
R=$(req PATCH /api/projects/default/settings '{"titleAlign":"top"}')
CODE=$(echo "$R" | tail -n 1)
check "v2 PATCH 非法对齐 → 400" 400 "$CODE" '标题对齐' "$(echo "$R" | head -n -1)"

echo "=== H. 恢复默认（center/16，不污染演示状态） ==="
R=$(req PATCH /api/videos/settings '{"titleAlign":"center","titleFontSize":16}')
BODY=$(echo "$R" | head -n -1); CODE=$(echo "$R" | tail -n 1)
check "恢复默认" 200 "$CODE" '"titleAlign":"center".*"titleFontSize":16' "$BODY"

echo
echo "================================"
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
