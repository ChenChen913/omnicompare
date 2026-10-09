#!/usr/bin/env bash
# 专注模式全面适配端到端验证 v2（单次调用内完成 server + 素材 + 浏览器操作）
# 背景：满幅修复后视频墙与右下角两个悬浮按钮（从头循环/退出）重叠；
#       且适配须覆盖任意视频数量，不能只针对 6 个。
# 覆盖矩阵（全部断言：墙与按钮区无重叠 / 全入镜无纵向溢出 / 高利用 ≥0.85）：
#   A. 数量矩阵 12/9/8/6(2×3 与 3×2)/5/4(2×2 与 1×4)/3/2(1×2 与 2×1)/1 @1920×1080 16:9
#   B. 比例矩阵 9:16 / 1:1 @6 视频 2×3 @1920×1080
#   C. 视口矩阵 2560×1440 / 1366×768 / 矮窗 1280×600 收缩 / 回涨 1920（防「只缩不放」回归）
#      + 2560 满宽 ≥2400（防 max-w 上限回归）+ studio 退出后上限不泄漏
#   D. 控制台零错误 + 测试项目隔离（自建自删，不碰用户项目）+ default 完好性核验
set -u
cd "$(dirname "$0")/.."
BASE="http://127.0.0.1:3000"
PASS=0; FAIL=0
SHOTS=/home/z/my-project/download

ok()  { PASS=$((PASS+1)); echo "PASS  $1"; }
bad() { FAIL=$((FAIL+1)); echo "FAIL  $1"; }

# ---------- 0. server ----------
pkill -f "next dev" 2>/dev/null
pkill -f "next-server" 2>/dev/null
sleep 1
if ! curl -s -o /dev/null -w "%{http_code}" $BASE/api --max-time 2 2>/dev/null | grep -q 200; then
  npx next dev --port 3000 > /dev/null 2>&1 < /dev/null &
  SERVER_PID=$!
  OWN=1
  for i in $(seq 1 90); do
    curl -s -o /dev/null -w "%{http_code}" $BASE/api --max-time 2 2>/dev/null | grep -q 200 && break
    sleep 1
  done
else
  OWN=0
fi
cleanup_server() {
  if [ "${OWN:-0}" = "1" ]; then
    kill $SERVER_PID 2>/dev/null
    pkill -P $SERVER_PID 2>/dev/null
    pkill -f "next dev" 2>/dev/null
    pkill -f "next-server" 2>/dev/null
  fi
}
trap cleanup_server EXIT
echo "[e2e] server ready (own=$OWN)"

# ---------- 0.5 素材：ffmpeg 自包含生成 12 个 1s 小视频 ----------
TMPD=.tmp-focus
rm -rf $TMPD && mkdir -p $TMPD
for i in $(seq 0 11); do
  ffmpeg -y -f lavfi -i "testsrc2=size=320x180:rate=24:duration=1" \
    -pix_fmt yuv420p "$TMPD/v$i.mp4" > /dev/null 2>&1
done
[ -s "$TMPD/v0.mp4" ] || { echo "[e2e] ffmpeg 素材生成失败"; exit 1; }
echo "[e2e] 12 个测试视频已生成"

# ---------- 1. 专属测试项目（幂等清理历史孤儿；不碰用户项目）----------
for OLD in $(curl -s $BASE/api/projects | python3 -c "
import json,sys
for p in json.load(sys.stdin):
    if p.get('name') == 'e2e-focus-fill': print(p['id'])
" 2>/dev/null); do
  curl -s -X DELETE "$BASE/api/projects/$OLD" -o /dev/null
done
EID=$(curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"name":"e2e-focus-fill"}' $BASE/api/projects \
  | python3 -c "import json,sys; print(json.load(sys.stdin).get('id',''))" 2>/dev/null)
[ -n "$EID" ] || { echo "[e2e] 测试项目创建失败"; exit 1; }
echo "[e2e] 测试项目 $EID"

# ---------- 2. 先扩位到 12 再上传（单次上传严格校验 slot < slotCount，
#     不先扩位则 slot≥1 全部 400）+ 设置 16:9 / autoFit ----------
curl -s -X PATCH -H 'Content-Type: application/json' \
  -d '{"count":12,"rows":3,"cols":4}' \
  "$BASE/api/videos/layout?project=$EID" -o /dev/null
for i in $(seq 0 11); do
  curl -s -X POST -F "file=@$TMPD/v$i.mp4;type=video/mp4" -F "slot=$i" \
    "$BASE/api/videos/upload?project=$EID" -o /dev/null
done
curl -s -X PATCH -H 'Content-Type: application/json' \
  -d '{"aspectRatio":"16:9","autoFit":true,"showTitles":true,"showInfo":true}' \
  "$BASE/api/videos/settings?project=$EID" -o /dev/null
N=$(curl -s "$BASE/api/videos?project=$EID" | python3 -c "
import json,sys
m = json.load(sys.stdin)
print(sum(1 for s in m['slots'] if s.get('video') or s.get('html') or s.get('image')))" 2>/dev/null)
echo "[e2e] 已上传 $N/12 个视频"
[ "$N" = "12" ] && ok "12 个测试视频全部上传成功" || bad "测试视频上传 ($N/12)"

# ---------- 3. 打开页面 + localStorage 切到测试项目 ----------
agent-browser close > /dev/null 2>&1
OPENED=0
for i in 1 2 3 4 5; do
  agent-browser open $BASE/ > /dev/null 2>&1
  sleep 2
  U=$(agent-browser get url 2>/dev/null)
  if echo "$U" | grep -q "127.0.0.1:3000"; then OPENED=1; break; fi
done
[ "$OPENED" = "1" ] || { echo "[e2e] 页面未能打开"; exit 1; }
agent-browser wait --load networkidle > /dev/null 2>&1
agent-browser wait 1500 > /dev/null 2>&1
agent-browser eval "localStorage.setItem('omnicompare:project', '$EID'); localStorage.setItem('omnicompare:mode', 'studio'); 'set'" > /dev/null 2>&1
agent-browser reload > /dev/null 2>&1
agent-browser wait --load networkidle > /dev/null 2>&1
agent-browser wait 2000 > /dev/null 2>&1

# ---------- 通用工具 ----------
# 应用就绪轮询（dev 冷编译竞态防线）：卡片数到位 + 顶栏专注按钮在
wait_ready() {
  local WANT=$1
  for ATTEMPT in 1 2 3; do
    for i in $(seq 1 25); do
      V=$(agent-browser eval "(() => {
        const cards = document.querySelectorAll('article').length;
        const btn = document.querySelector('button[aria-label=\"进入专注模式\"]');
        return (cards === $WANT && btn) ? 'ready' : 'no';
      })()" 2>/dev/null | tr -d '"\\')
      [ "$V" = "ready" ] && return 0
      sleep 1
    done
    agent-browser reload > /dev/null 2>&1
    agent-browser wait --load networkidle > /dev/null 2>&1
    agent-browser wait 2000 > /dev/null 2>&1
  done
  return 1
}
# autoFit 收敛等待：初始 1.2s 让 resize/RO 落地，随后连续两次读数一致
wait_settle() {
  sleep 1.2
  for i in $(seq 1 12); do
    W1=$(agent-browser eval "Math.round(document.querySelector('main .grid').getBoundingClientRect().width)" 2>/dev/null | tr -d '"\\')
    sleep 0.5
    W2=$(agent-browser eval "Math.round(document.querySelector('main .grid').getBoundingClientRect().width)" 2>/dev/null | tr -d '"\\')
    [ -n "$W1" ] && [ "$W1" = "$W2" ] && [ "$W1" -gt 0 ] 2>/dev/null && return 0
  done
  return 0
}
enter_focus() { agent-browser eval "document.querySelector('button[aria-label=\"进入专注模式\"]').click(); 'ok'" > /dev/null 2>&1; }
exit_focus()  { agent-browser eval "document.querySelector('button[aria-label=\"退出专注模式\"]').click(); 'ok'" > /dev/null 2>&1; }

# 采集专注态几何（含按钮区重叠判定与利用率）
# 返回字段：cards/overlap/gapR/gapB/wallW/wallH/utilW/utilH/vOverflow/fullyVisible
probe() {
  agent-browser eval "(() => {
    const wall = document.querySelector('main .grid');
    const zone = document.querySelector('[data-focus-buttons]');
    const main = document.querySelector('main');
    const exitBtn = document.querySelector('button[aria-label=\"退出专注模式\"]');
    if (!wall || !zone || !main || !exitBtn) return JSON.stringify({ error: 'missing' });
    const wr = wall.getBoundingClientRect();
    const zr = zone.getBoundingClientRect();
    const mr = main.getBoundingClientRect();
    const ms = getComputedStyle(main);
    const padT = parseFloat(ms.paddingTop)||0, padB = parseFloat(ms.paddingBottom)||0;
    const padL = parseFloat(ms.paddingLeft)||0, padR = parseFloat(ms.paddingRight)||0;
    const innerW = mr.width - padL - padR, innerH = mr.height - padT - padB;
    const M = 8;
    const overlap = wr.right > zr.left - M && wr.left < zr.right + M && wr.bottom > zr.top - M && wr.top < zr.bottom + M;
    return JSON.stringify({
      cards: document.querySelectorAll('article').length,
      overlap,
      gapR: Math.round(zr.left - wr.right), gapB: Math.round(zr.top - wr.bottom),
      wallW: Math.round(wr.width), wallH: Math.round(wr.height),
      utilW: +(wr.width / innerW).toFixed(3), utilH: +(wr.height / innerH).toFixed(3),
      vOverflow: document.documentElement.scrollHeight - innerHeight,
      fullyVisible: wr.bottom <= innerHeight && wr.top >= 0
    });
  })()" 2>/dev/null | sed 's/\\//g'
}
parse() { echo "$1" | grep -o "\"$2\":[^,}]*" | cut -d: -f2- | tr -d '"'; }

# 布局 + 重载 + 进专注 + 采集 + 四项断言 + 可选截图
# 参数：COUNT ROWS COLS LABEL [SHOT]
run_case() {
  local COUNT=$1 ROWS=$2 COLS=$3 LABEL=$4 SHOT=$5
  curl -s -X PATCH -H 'Content-Type: application/json' \
    -d "{\"count\":$COUNT,\"rows\":$ROWS,\"cols\":$COLS}" \
    "$BASE/api/videos/layout?project=$EID" -o /dev/null
  # 模式规范化：应用会持久化 UI 偏好（含专注态）到 localStorage，上一用例
  # 结束时留在 focus → 刷新后直接以专注态启动（无「进入专注模式」按钮，
  # 就绪轮询假失败）——刷新前写回 studio 保证以工作台态启动
  agent-browser eval "localStorage.setItem('omnicompare:mode', 'studio'); 'ok'" > /dev/null 2>&1
  agent-browser reload > /dev/null 2>&1
  agent-browser wait --load networkidle > /dev/null 2>&1
  agent-browser wait 1200 > /dev/null 2>&1
  wait_ready "$COUNT" || bad "[$LABEL] 应用就绪"
  agent-browser set viewport 1920 1080 > /dev/null 2>&1
  enter_focus
  wait_settle
  local R; R=$(probe)
  local CARDS OV VIS VO UW UH
  CARDS=$(parse "$R" cards); OV=$(parse "$R" overlap)
  VIS=$(parse "$R" fullyVisible); VO=$(parse "$R" vOverflow)
  UW=$(parse "$R" utilW); UH=$(parse "$R" utilH)
  echo "  [$LABEL] $R"
  [ "$CARDS" = "$COUNT" ] && ok "[$LABEL] 卡片数 $COUNT" || bad "[$LABEL] 卡片数 ($CARDS≠$COUNT)"
  [ "$OV" = "false" ] && ok "[$LABEL] 墙与按钮区无重叠" || bad "[$LABEL] 墙与按钮区无重叠 ($R)"
  { [ "$VIS" = "true" ] && [ "$VO" = "0" ]; } && ok "[$LABEL] 全入镜无纵向溢出" || bad "[$LABEL] 全入镜 ($R)"
  if [ -n "$UW" ] && awk "BEGIN{exit !($UW >= 0.85 || $UH >= 0.85)}" 2>/dev/null; then
    ok "[$LABEL] 高利用（utilW=$UW utilH=$UH）"
  else
    bad "[$LABEL] 高利用 (utilW=$UW utilH=$UH)"
  fi
  [ -n "$SHOT" ] && agent-browser screenshot "$SHOTS/$SHOT.png" > /dev/null 2>&1
}

# ---------- 4. Phase A：数量矩阵（降序，缩减只删本测试项目的视频）----------
echo "[e2e] Phase A 数量矩阵 @1920×1080 16:9"
run_case 12 3 4 "N12"   focus-N12
run_case 9  3 3 "N9"    focus-N9
run_case 8  2 4 "N8"    ""
run_case 6  2 3 "N6-23" focus-N6-23
run_case 6  3 2 "N6-32" focus-N6-32
run_case 5  2 3 "N5"    ""
run_case 4  2 2 "N4-22" ""
run_case 4  1 4 "N4-14" ""
run_case 3  1 3 "N3"    ""
run_case 2  1 2 "N2-12" ""
run_case 2  2 1 "N2-21" ""
run_case 1  1 1 "N1"    focus-N1

# ---------- 5. Phase B：比例矩阵（先扩回 6 位再补传，2×3）----------
echo "[e2e] Phase B 比例矩阵 @6 视频 2×3 @1920×1080"
curl -s -X PATCH -H 'Content-Type: application/json' \
  -d '{"count":6,"rows":2,"cols":3}' \
  "$BASE/api/videos/layout?project=$EID" -o /dev/null
for i in $(seq 1 5); do
  curl -s -X POST -F "file=@$TMPD/v$i.mp4;type=video/mp4" -F "slot=$i" \
    "$BASE/api/videos/upload?project=$EID" -o /dev/null
done
run_case 6 2 3 "A916-pre" ""
curl -s -X PATCH -H 'Content-Type: application/json' \
  -d '{"aspectRatio":"9:16"}' "$BASE/api/videos/settings?project=$EID" -o /dev/null
run_case 6 2 3 "A916" focus-A916
curl -s -X PATCH -H 'Content-Type: application/json' \
  -d '{"aspectRatio":"1:1"}' "$BASE/api/videos/settings?project=$EID" -o /dev/null
run_case 6 2 3 "A11" focus-A11
curl -s -X PATCH -H 'Content-Type: application/json' \
  -d '{"aspectRatio":"16:9"}' "$BASE/api/videos/settings?project=$EID" -o /dev/null
run_case 6 2 3 "C16x9" ""

# ---------- 6. Phase C：视口矩阵（16:9 6×2×3，resize 触发 RO 无需重载）----------
echo "[e2e] Phase C 视口矩阵"
agent-browser set viewport 2560 1440 > /dev/null 2>&1
wait_settle
R=$(probe); echo "  [V2560] $R"
W=$(parse "$R" wallW); OV=$(parse "$R" overlap); VO=$(parse "$R" vOverflow)
[ -n "$W" ] && [ "$W" -ge 2400 ] 2>/dev/null && ok "2560 满宽 ≥2400（max-w 上限无回归）" || bad "2560 满宽 (wallW=$W)"
[ "$OV" = "false" ] && ok "2560 无重叠" || bad "2560 无重叠 ($R)"
[ "$VO" = "0" ] && ok "2560 全入镜" || bad "2560 全入镜 ($R)"
agent-browser screenshot "$SHOTS/focus-V2560.png" > /dev/null 2>&1

agent-browser set viewport 1366 768 > /dev/null 2>&1
wait_settle
R=$(probe); echo "  [V1366] $R"
OV=$(parse "$R" overlap); VO=$(parse "$R" vOverflow)
[ "$OV" = "false" ] && ok "1366 无重叠" || bad "1366 无重叠 ($R)"
[ "$VO" = "0" ] && ok "1366 全入镜" || bad "1366 全入镜 ($R)"

agent-browser set viewport 1280 600 > /dev/null 2>&1
wait_settle
R=$(probe); echo "  [V1280x600] $R"
OV=$(parse "$R" overlap); VO=$(parse "$R" vOverflow); UW=$(parse "$R" utilW); SW=$(parse "$R" wallW)
[ "$OV" = "false" ] && ok "矮窗无重叠" || bad "矮窗无重叠 ($R)"
[ "$VO" = "0" ] && ok "矮窗恰好同屏" || bad "矮窗恰好同屏 ($R)"
[ -n "$UW" ] && awk "BEGIN{exit !($UW < 1.0)}" && ok "矮窗收缩生效（utilW<1）" || bad "矮窗收缩 (utilW=$UW)"
agent-browser screenshot "$SHOTS/focus-V1280x600.png" > /dev/null 2>&1

agent-browser set viewport 1920 1080 > /dev/null 2>&1
wait_settle
R=$(probe); echo "  [V1920-regrow] $R"
W=$(parse "$R" wallW); OV=$(parse "$R" overlap)
[ -n "$W" ] && [ -n "$SW" ] && [ "$W" -gt "$SW" ] 2>/dev/null \
  && ok "resize 回涨（$SW → $W，无「只缩不放」回归）" || bad "resize 回涨 ($SW → $W)"
[ "$OV" = "false" ] && ok "回涨后无重叠" || bad "回涨后无重叠 ($R)"

# ---------- 7. studio 上限不泄漏（2560 退出专注）----------
agent-browser set viewport 2560 1440 > /dev/null 2>&1
exit_focus
agent-browser wait 1500 > /dev/null 2>&1
R=$(agent-browser eval "(() => {
  const main = document.querySelector('main');
  return JSON.stringify({ mainW: Math.round(main.getBoundingClientRect().width), vp: innerWidth });
})()" 2>/dev/null | sed 's/\\//g')
MW=$(parse "$R" mainW)
echo "  [studio] $R"
[ -n "$MW" ] && [ "$MW" -le 1850 ] 2>/dev/null && ok "studio 主区仍受 max-w 约束（无满幅泄漏）" || bad "studio 主区 max-w (mainW=$MW)"

# ---------- 8. 浏览器控制台零错误 ----------
ERRS=$(agent-browser errors 2>/dev/null | rg -c "error|Error" || echo 0)
[ "$ERRS" = "0" ] && ok "浏览器零控制台错误" || bad "浏览器控制台错误 ($ERRS)"

# ---------- 9. 清理：还原 default + 删测试项目 + 完好性核验 ----------
agent-browser eval "localStorage.setItem('omnicompare:project', 'default'); localStorage.setItem('omnicompare:mode', 'studio'); 'set'" > /dev/null 2>&1
agent-browser close > /dev/null 2>&1
curl -s -X DELETE "$BASE/api/projects/$EID" -o /dev/null
R=$(curl -s "$BASE/api/videos" | python3 -c "
import json,sys
m = json.load(sys.stdin)
filled = sum(1 for s in m['slots'] if s.get('video') or s.get('html') or s.get('image'))
print(f\"{len(m['slots'])}:{filled}\")" 2>/dev/null)
[ "$R" = "2:2" ] && ok "default 项目完好（2 位 2 内容，零污染）" || bad "default 项目完好 ($R)"
rm -rf $TMPD
if [ "${OWN:-0}" = "1" ]; then kill $SERVER_PID 2>/dev/null; fi

echo
echo "================================"
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
