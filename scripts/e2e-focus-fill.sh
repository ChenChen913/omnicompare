#!/usr/bin/env bash
# 专注模式满幅与 autoFit 回涨端到端验证（单次调用内完成 server + 浏览器操作）
# 背景（用户实测 2026-10-09）：6 视频 2×3 在专注模式「聚在中间没有展开」。两个根因——
#   A. 主区容器 max-w-[1800px] 在专注模式未解除：大屏（>1850px）墙被卡在 1752px 居中留大边
#   B. autoFit 求解器「只缩不放」：视口变小收缩后，再放大视口墙永久卡死在旧收缩值
# 覆盖：满幅断言（1920 / 2560 大屏）/ 恰好同屏（无纵向溢出）/ 矮窗收缩仍然生效 /
#       resize 回涨（旧版卡死处）/ studio 容器上限不受影响 / 控制台零错误 / 恢复默认布局
set -u
cd "$(dirname "$0")/.."
BASE="http://127.0.0.1:3000"
PASS=0; FAIL=0

ok()   { PASS=$((PASS+1)); echo "PASS  $1"; }
bad()  { FAIL=$((FAIL+1)); echo "FAIL  $1"; }

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

# ---------- 1. 还原被测项目的原始终态并布置用户场景：6 内容位 2×3（当前项目视频少于 6 也成立——
#     空位卡片渲染同尺寸 aspect 盒，墙几何与实卡一致）----------
curl -s -X PATCH -H 'Content-Type: application/json' \
  -d '{"count":2,"rows":1,"cols":2}' $BASE/api/videos/layout -o /dev/null
curl -s -X PATCH -H 'Content-Type: application/json' \
  -d '{"count":6,"rows":2,"cols":3}' $BASE/api/videos/layout -o /dev/null
curl -s -X PATCH -H 'Content-Type: application/json' \
  -d '{"autoFit":true}' $BASE/api/videos/settings -o /dev/null
echo "[e2e] 已布置 6 位 2×3 + autoFit"

# ---------- 2. 打开页面（关旧实例防跨重启陈旧标签；open 后校验 URL，最多 5 次）----------
agent-browser close > /dev/null 2>&1
OPENED=0
for i in 1 2 3 4 5; do
  agent-browser open $BASE/ > /dev/null 2>&1
  sleep 2
  U=$(agent-browser get url 2>/dev/null)
  if echo "$U" | grep -q "127.0.0.1:3000"; then OPENED=1; break; fi
done
if [ "$OPENED" != "1" ]; then
  echo "[e2e] 页面未能打开"; cleanup_server; exit 1
fi
agent-browser wait --load networkidle > /dev/null 2>&1
agent-browser wait 1500 > /dev/null 2>&1

# 2.1 就绪轮询（dev 冷编译竞态防线）：网格 + 6 张卡片 + 专注按钮都在才算就绪；
#     超时整页重开再试三轮（next build 覆盖 .next 后 dev 冷启动可能 >30s）
READY=0
for ATTEMPT in 1 2 3; do
  for i in $(seq 1 25); do
    V=$(agent-browser eval "(() => {
      const grid = document.querySelector('main .grid');
      const cards = document.querySelectorAll('article');
      const btn = document.querySelector('button[aria-label=\"进入专注模式\"]');
      return (grid && cards.length >= 6 && btn) ? 'ready' : 'no';
    })()" 2>/dev/null | tr -d '"' | tr -d '\\')
    if [ "$V" = "ready" ]; then READY=1; break; fi
    sleep 1
  done
  [ "$READY" = "1" ] && break
  echo "[e2e] 就绪轮询超时（第 ${ATTEMPT} 轮），重开页面重试…"
  agent-browser close > /dev/null 2>&1
  agent-browser open $BASE/ > /dev/null 2>&1
  sleep 2
  agent-browser wait --load networkidle > /dev/null 2>&1
  agent-browser wait 1500 > /dev/null 2>&1
done
if [ "$READY" != "1" ]; then
  echo "[e2e] 三轮重开后仍未就绪，继续执行（后续断言预计失败）"
fi
echo "[e2e] app ready=$READY"

# 等待 autoFit 求解器收敛（rAF 多轮迭代）：初始 1s 让 resize/RO 先落地，
# 再连续两次读数一致或 6s 超时
wait_settle() {
  sleep 1
  for i in $(seq 1 12); do
    W1=$(agent-browser eval "Math.round(document.querySelector('main .grid').getBoundingClientRect().width)" 2>/dev/null | tr -d '"\\')
    sleep 0.5
    W2=$(agent-browser eval "Math.round(document.querySelector('main .grid').getBoundingClientRect().width)" 2>/dev/null | tr -d '"\\')
    [ -n "$W1" ] && [ "$W1" = "$W2" ] && [ "$W1" -gt 0 ] 2>/dev/null && return 0
  done
  return 0
}

# 采集墙体几何（视口宽/主区宽/墙宽高/左右边距/纵向溢出/满宽标记）
probe() {
  agent-browser eval "(() => {
    const wall = document.querySelector('main .grid');
    const main = document.querySelector('main');
    if (!wall || !main) return JSON.stringify({ error: 'no-wall' });
    const wr = wall.getBoundingClientRect();
    const mr = main.getBoundingClientRect();
    const ms = getComputedStyle(main);
    const inner = mr.width - (parseFloat(ms.paddingLeft)||0) - (parseFloat(ms.paddingRight)||0);
    return JSON.stringify({
      vp: innerWidth, vpH: innerHeight,
      mainW: Math.round(mr.width),
      wallW: Math.round(wr.width), wallH: Math.round(wr.height),
      leftGap: Math.round(wr.left - mr.left), rightGap: Math.round(mr.right - wr.right),
      fillRatio: inner > 0 ? +(wr.width / inner).toFixed(3) : null,
      styleW: wall.style.width || '(none)',
      vOverflow: document.documentElement.scrollHeight - innerHeight,
      bottomInView: wr.bottom <= innerHeight
    });
  })()" 2>/dev/null | sed 's/\\//g'
}

enter_focus() {
  agent-browser eval "document.querySelector('button[aria-label=\"进入专注模式\"]').click(); 'ok'" > /dev/null 2>&1
}
exit_focus() {
  agent-browser eval "document.querySelector('button[aria-label=\"退出专注模式\"]').click(); 'ok'" > /dev/null 2>&1
}

# ---------- 3. 1920×1080 常见全屏：进入专注 → 墙满幅 + 全入镜 ----------
agent-browser set viewport 1920 1080 > /dev/null 2>&1
enter_focus; wait_settle
R=$(probe); echo "  1920 focus: $R"
FR=$(echo "$R" | grep -o '"fillRatio":[0-9.]*' | cut -d: -f2)
[ -n "$FR" ] && awk "BEGIN{exit !($FR >= 0.95)}" && ok "1920 满幅（墙 ≥95% 主区宽）" || bad "1920 满幅 (fillRatio=$FR)"
L=$(echo "$R" | grep -o '"leftGap":[0-9-]*' | cut -d: -f2)
[ -n "$L" ] && [ "$L" -le 24 ] 2>/dev/null && ok "1920 左侧无大空白（≤24px）" || bad "1920 左侧无大空白 (leftGap=$L)"
echo "$R" | grep -q '"vOverflow":0' && ok "1920 恰好同屏（无纵向溢出）" || bad "1920 恰好同屏 ($R)"
echo "$R" | grep -q '"bottomInView":true' && ok "1920 墙底全入镜" || bad "1920 墙底全入镜 ($R)"

# ---------- 4. 2560×1440 大屏（用户复现场景）：满幅不被 1800 上限卡住 ----------
agent-browser set viewport 2560 1440 > /dev/null 2>&1
wait_settle
R=$(probe); echo "  2560 focus: $R"
W=$(echo "$R" | grep -o '"wallW":[0-9]*' | cut -d: -f2)
[ -n "$W" ] && [ "$W" -ge 2400 ] 2>/dev/null && ok "2560 墙宽 ≥2400（解除 1800 上限）" || bad "2560 墙宽 ≥2400 (wallW=$W)"
L=$(echo "$R" | grep -o '"leftGap":[0-9-]*' | cut -d: -f2)
[ -n "$L" ] && [ "$L" -le 24 ] 2>/dev/null && ok "2560 左侧无大空白（≤24px）" || bad "2560 左侧无大空白 (leftGap=$L)"
echo "$R" | grep -q '"vOverflow":0' && ok "2560 恰好同屏（无纵向溢出）" || bad "2560 恰好同屏 ($R)"

# ---------- 5. 矮窗 1280×600：高度溢出 → 收缩到恰好同屏（收缩行为保持）----------
agent-browser set viewport 1280 600 > /dev/null 2>&1
wait_settle
R=$(probe); echo "  1280x600 focus: $R"
FR=$(echo "$R" | grep -o '"fillRatio":[0-9.]*' | cut -d: -f2)
[ -n "$FR" ] && awk "BEGIN{exit !($FR < 1.0)}" && ok "矮窗收缩生效（fillRatio<1，autoFit 求解）" || bad "矮窗收缩生效 (fillRatio=$FR)"
echo "$R" | grep -q '"vOverflow":0' && ok "矮窗恰好同屏（无纵向溢出）" || bad "矮窗恰好同屏 ($R)"
SHRUNK_W=$(echo "$R" | grep -o '"wallW":[0-9]*' | cut -d: -f2)
SHRUNK_H=$(echo "$R" | grep -o '"wallH":[0-9]*' | cut -d: -f2)

# ---------- 6. resize 回涨（旧版「只缩不放」卡死处）：矮窗 → 大屏，墙必须长回满幅 ----------
agent-browser set viewport 2560 1440 > /dev/null 2>&1
wait_settle
R=$(probe); echo "  regrow 2560 focus: $R"
W=$(echo "$R" | grep -o '"wallW":[0-9]*' | cut -d: -f2)
[ -n "$W" ] && [ "$W" -ge 2400 ] 2>/dev/null && ok "resize 回涨：墙长回 ≥2400（不再卡死在 $SHRUNK_W）" || bad "resize 回涨 (wallW=$W, 收缩态=$SHRUNK_W)"
H=$(echo "$R" | grep -o '"wallH":[0-9]*' | cut -d: -f2)
[ -n "$H" ] && [ "$H" -gt "$SHRUNK_H" ] 2>/dev/null && ok "回涨后墙高随之放大（$SHRUNK_H → $H）" || bad "回涨后墙高放大 ($SHRUNK_H → $H)"

# ---------- 7. 退出专注 → studio 容器上限不受影响（max-w 未泄漏到工作台）----------
exit_focus
agent-browser wait 1500 > /dev/null 2>&1
R=$(agent-browser eval "(() => {
  const main = document.querySelector('main');
  const wall = document.querySelector('main .grid');
  const mr = main.getBoundingClientRect();
  const wr = wall ? wall.getBoundingClientRect() : null;
  return JSON.stringify({ mainW: Math.round(mr.width), wallW: wr ? Math.round(wr.width) : null, vp: innerWidth });
})()" 2>/dev/null | sed 's/\\//g')
echo "  studio 2560: $R"
MW=$(echo "$R" | grep -o '"mainW":[0-9]*' | cut -d: -f2)
[ -n "$MW" ] && [ "$MW" -le 1850 ] 2>/dev/null && ok "studio 主区仍受 max-w 约束（≤1850，无满幅泄漏）" || bad "studio 主区 max-w (mainW=$MW)"

# ---------- 8. 视觉截图（修复后大屏专注满幅）----------
mkdir -p /home/z/my-project/download
enter_focus; agent-browser wait 1200 > /dev/null 2>&1
agent-browser set viewport 1920 1080 > /dev/null 2>&1
wait_settle
agent-browser screenshot /home/z/my-project/download/focus-fill-fixed.png > /dev/null 2>&1
echo "[e2e] 截图已保存 download/focus-fill-fixed.png"

# ---------- 9. 浏览器控制台零错误 ----------
ERRS=$(agent-browser errors 2>/dev/null | rg -c "error|Error" || echo 0)
[ "$ERRS" = "0" ] && ok "浏览器零控制台错误" || bad "浏览器控制台错误 ($ERRS)"

# ---------- 10. 恢复默认布局 + 关闭 ----------
exit_focus
agent-browser wait 800 > /dev/null 2>&1
curl -s -X PATCH -H 'Content-Type: application/json' \
  -d '{"count":2,"rows":1,"cols":2}' $BASE/api/videos/layout -o /dev/null
agent-browser close > /dev/null 2>&1
if [ "${OWN:-0}" = "1" ]; then kill $SERVER_PID 2>/dev/null; fi

echo
echo "================================"
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
