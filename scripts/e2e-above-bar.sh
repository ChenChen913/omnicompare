#!/usr/bin/env bash
# above 高级标题带端到端验证（单次调用内完成 server + 浏览器操作）
# 覆盖：premium bar 结构 / 头像上传 UI 全链路 / 头像自适应完整显示（object-contain、非圆形裁切）/
#       字重滑杆与快捷档 / 视觉截图 / 恢复默认
set -u
cd "$(dirname "$0")/.."
BASE="http://127.0.0.1:3000"
PASS=0; FAIL=0

ok()   { PASS=$((PASS+1)); echo "PASS  $1"; }
bad()  { FAIL=$((FAIL+1)); echo "FAIL  $1"; }

# ---------- 0.1 测试头像素材（自包含生成：脚本末尾会清理 .tmp-avatar，不能依赖外部残留文件）----------
# 200x120（5:3 宽幅）+ 四角元素：验证「按原始宽高比完整显示」——若被圆形/方形裁切，角上元素会丢
mkdir -p .tmp-avatar
python3 - <<'PY'
from PIL import Image, ImageDraw
img = Image.new('RGBA', (200, 120), (79, 70, 229, 255))
d = ImageDraw.Draw(img)
d.rounded_rectangle([8, 8, 191, 111], radius=16, outline=(255, 255, 255, 235), width=6)
d.ellipse([12, 12, 42, 42], fill=(244, 114, 182, 255))
d.ellipse([158, 78, 188, 108], fill=(250, 204, 21, 255))
img.save('.tmp-avatar/avatar-a.png')
PY
AVATAR=".tmp-avatar/avatar-a.png"

# ---------- 0. server ----------
# 先清理可能的孤儿进程（npx 被 kill 时子进程 next-server 可能存活并持旧编译产物）
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
# 结束时连同子孙进程一起收尾（防孤儿 next-server）
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

# ---------- 1. 设置 above 模式 + 大字号 + 800 字重 ----------
curl -s -X PATCH -H 'Content-Type: application/json' \
  -d '{"titlePosition":"above","titleFontSize":32,"titleWeight":800}' \
  $BASE/api/videos/settings -o /dev/null
echo "[e2e] 已设置 above / 32px / 800"

# ---------- 2. 打开页面（先关旧浏览器实例：跨 server 重启的陈旧标签页会导致 hydration 报错噪音；
#     open 后校验 URL，about:blank 竞态时重试，最多 5 次）----------
agent-browser close > /dev/null 2>&1
OPENED=0
for i in 1 2 3 4 5; do
  agent-browser open $BASE/ > /dev/null 2>&1
  sleep 2
  U=$(agent-browser get url 2>/dev/null)
  if echo "$U" | grep -q "127.0.0.1:3000"; then OPENED=1; break; fi
  echo "[e2e] open 第 ${i} 次后仍在 $U，重试..."
done
if [ "$OPENED" != "1" ]; then
  echo "[e2e] 页面未能打开"; cleanup_server; exit 1
fi
agent-browser wait --load networkidle > /dev/null 2>&1
agent-browser wait 1500 > /dev/null 2>&1

# 2.1 应用就绪轮询（dev 冷编译竞态防线）：样式表生效才算就绪。
#     判据用编号角标（bg-black/60）而非头像按钮——头像有图态无 ring，残留图标会让
#     轮询永远失败；角标在任意图标状态下都存在且依赖样式表。
#     轮询超时则整页重开再试（next build 覆盖 .next 后 dev 冷启动可能 >30s，
#     半加载页面上断言全是假失败：尺寸漂移、Radix 未水合菜单点不开）
READY=0
for ATTEMPT in 1 2 3; do
  for i in $(seq 1 25); do
    V=$(agent-browser eval "(() => {
      const a = document.querySelector('article');
      const badge = document.querySelector('article [data-above-title-bar] span.rounded-md');
      if (!a || !badge) return 'no';
      const bg = getComputedStyle(badge).backgroundColor;
      const ok = getComputedStyle(a).borderRadius !== '0px' && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent';
      return ok ? 'ready' : 'no';
    })()" 2>/dev/null | tr -d '"' | tr -d '\\')
    if [ "$V" = "ready" ]; then READY=1; break; fi
    sleep 1
  done
  [ "$READY" = "1" ] && break
  echo "[e2e] 就绪轮询超时（第 ${ATTEMPT} 轮），重开页面重试…"
  agent-browser errors 2>/dev/null | head -3
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

# ---------- 3. premium bar 结构断言（eval 返回 JSON-in-string，先去转义再匹配）----------
RAW=$(agent-browser eval "(() => {
  const card = document.querySelector('article');
  const bar = card.querySelector('[data-above-title-bar]');
  const ta = card.querySelector('textarea');
  const barTa = bar ? bar.querySelector('textarea') : null;
  const avatarBtn = bar ? bar.querySelector('button[aria-label*=\"图标\"]') : null;
  const abs = avatarBtn ? getComputedStyle(avatarBtn) : null;
  const bst = bar ? getComputedStyle(bar) : null;
  const inlineBadge = bar ? bar.querySelector('span.rounded-md') : null;
  const absBadge = card.querySelector('span.absolute.left-2\\\\.5');
  const content = card.querySelector('div[style*=\"aspect-ratio\"]');
  const st = ta ? getComputedStyle(ta) : null;
  const barRect = bar ? bar.getBoundingClientRect() : null;
  const cardRect = card ? card.getBoundingClientRect() : null;
  const cRect = content ? content.getBoundingClientRect() : null;
  return JSON.stringify({
    barExists: !!bar,
    textareaInBar: !!barTa,
    avatarPlaceholder: !!avatarBtn,
    avatarSize: avatarBtn ? avatarBtn.getBoundingClientRect().width : null,
    placeholderFramed: abs ? abs.boxShadow !== 'none' : null,
    barNoFrame: bst ? ((bst.borderStyle === 'none' || parseFloat(bst.borderTopWidth) === 0) && (bst.backgroundColor === 'rgba(0, 0, 0, 0)' || bst.backgroundColor === 'transparent')) : null,
    barFlushLeft: barRect && cardRect ? (barRect.left - cardRect.left) <= 8 : null,
    barFlushTop: barRect && cardRect ? (barRect.top - cardRect.top) <= 8 : null,
    gapTight: barRect && cRect ? (cRect.top - barRect.bottom) <= 12 : null,
    inlineBadgeInBar: !!inlineBadge,
    noAbsBadge: !absBadge,
    fontWeight: st ? st.fontWeight : null,
    fontSize: st ? st.fontSize : null,
    barAboveContent: barRect && cRect ? barRect.bottom <= cRect.top : null,
  });
})()" 2>/dev/null)
R=$(echo "$RAW" | sed 's/\\//g')
echo "  $R"
echo "$R" | grep -q '"barExists":true'          && ok "above 标题行存在"                 || bad "above 标题行存在"
echo "$R" | grep -q '"textareaInBar":true'       && ok "标题输入框在行内"               || bad "标题输入框在行内"
echo "$R" | grep -q '"barNoFrame":true'          && ok "标题行零边框（融入卡片背景）"     || bad "标题行零边框 ($R)"
echo "$R" | grep -q '"barFlushLeft":true'        && ok "左缘贴边（≤8px 微边距）"         || bad "左缘贴边 ($R)"
echo "$R" | grep -q '"barFlushTop":true'         && ok "顶缘贴边（≤8px 微边距）"         || bad "顶缘贴边 ($R)"
echo "$R" | grep -q '"gapTight":true'            && ok "与内容区间距紧凑（≤12px）"       || bad "与内容区间距紧凑 ($R)"
echo "$R" | grep -q '"avatarPlaceholder":true'  && ok "头像占位按钮存在"               || bad "头像占位按钮存在"
echo "$R" | grep -q '"avatarSize":48'           && ok "头像占位 48px（自适应下限）"      || bad "头像占位 48px ($R)"
echo "$R" | grep -q '"placeholderFramed":true'  && ok "占位态保留可点击边框"             || bad "占位态保留可点击边框 ($R)"
echo "$R" | grep -q '"inlineBadgeInBar":true'   && ok "编号角标内联在带内"             || bad "编号角标内联在带内"
echo "$R" | grep -q '"noAbsBadge":true'         && ok "绝对定位角标已隐藏"             || bad "绝对定位角标已隐藏"
echo "$R" | grep -q '"fontWeight":"800"'        && ok "字重 800 生效"                  || bad "字重 800 生效 ($R)"
echo "$R" | grep -q '"fontSize":"32px"'         && ok "字号 32px 生效"                 || bad "字号 32px 生效 ($R)"
echo "$R" | grep -q '"barAboveContent":true'    && ok "标题行位于内容上方"             || bad "标题行位于内容上方"

# ---------- 4. 头像菜单（上传/替换/移除选项存在；首轮点击偶发竞态未展开时重试）----------
AV_REF=$(agent-browser snapshot -i 2>/dev/null | grep "的图标" | grep -o 'ref=e[0-9]*' | cut -d= -f2 | head -1)
echo "  头像按钮 ref: $AV_REF"
S=0
for ATTEMPT in 1 2 3; do
  agent-browser click "@$AV_REF" > /dev/null 2>&1
  agent-browser wait 1200 > /dev/null 2>&1
  S=$(agent-browser snapshot -i 2>/dev/null | grep -c "上传图标")
  [ "$S" -ge 1 ] && break
  echo "[e2e] 头像菜单未展开（第 ${ATTEMPT} 次），重试…"
  agent-browser press Escape > /dev/null 2>&1
  agent-browser wait 400 > /dev/null 2>&1
done
[ "$S" -ge 1 ] && ok "头像菜单含「上传图标」" || bad "头像菜单含「上传图标」"
agent-browser press Escape > /dev/null 2>&1
agent-browser wait 300 > /dev/null 2>&1

# ---------- 5. 通过 UI 上传头像（页面内 DataTransfer 模拟用户选文件：agent-browser upload
#     对 hidden input 不可靠，改用与 Playwright setInputFiles 同机制的 DOM 注入）----------
AV_B64=$(base64 -w0 "$AVATAR")
R=$(agent-browser eval "(async () => {
  const inputs = document.querySelectorAll('article input[type=file]');
  const iconInput = Array.from(inputs).find((el) => el.accept.startsWith('image/png'));
  if (!iconInput) return JSON.stringify({ error: 'no-icon-input' });
  const blob = await (await fetch('data:image/png;base64,$AV_B64')).blob();
  const file = new File([blob], 'avatar-e2e.png', { type: 'image/png' });
  const dt = new DataTransfer();
  dt.items.add(file);
  iconInput.files = dt.files;
  iconInput.dispatchEvent(new Event('change', { bubbles: true }));
  return JSON.stringify({ set: true });
})()" 2>/dev/null)
echo "  set: $R"
agent-browser wait 2500 > /dev/null 2>&1
R=$(agent-browser eval "(() => {
  const img = document.querySelector('article [data-above-title-bar] button img');
  const btn = img ? img.closest('button') : null;
  const st = img ? getComputedStyle(img) : null;
  const bst = btn ? getComputedStyle(btn) : null;
  const r = img ? img.getBoundingClientRect() : null;
  return JSON.stringify({ iconImg: !!img, src: img ? img.src : null, w: r ? r.width : null,
    h: r ? r.height : null, fit: st ? st.objectFit : null, radius: bst ? bst.borderRadius : null,
    isCircle: bst ? (bst.borderRadius === '9999px' || bst.borderRadius === '50%') : null,
    noShadow: bst ? bst.boxShadow : null,
    noBg: bst ? bst.backgroundColor : null,
    noFrame: bst ? (bst.boxShadow === 'none' && (bst.backgroundColor === 'rgba(0, 0, 0, 0)' || bst.backgroundColor === 'transparent')) : null });
})()" 2>/dev/null | sed 's/\\//g')
echo "  $R"
echo "$R" | grep -q '"iconImg":true'       && ok "头像图片已渲染（UI 上传链路通）"   || bad "头像图片已渲染 ($R)"
echo "$R" | grep -q '/api/files/'         && ok "头像 src 指向 /api/files"           || bad "头像 src 指向 /api/files"
echo "$R" | grep -q '"fit":"contain"'    && ok "object-contain 完整显示不裁切"     || bad "object-contain 完整显示 ($R)"
echo "$R" | grep -q '"isCircle":false'   && ok "非圆形裁切（无圆形约束）"           || bad "非圆形裁切 ($R)"
echo "$R" | grep -q '"noShadow":"none"' && ok "无阴影环/描边（零线条包围）"       || bad "无阴影环/描边 ($R)"
echo "$R" | grep -q '"noFrame":true'    && ok "有图态零边框（无描边+透明底）"     || bad "有图态零边框 ($R)"
# 宽高比断言：素材 200x120（5:3 ≈ 1.667），渲染应保持原始比例（高度 48、宽度 ≈ 80）
IMG_W=$(echo "$R" | grep -o '"w":[0-9.]*' | cut -d: -f2)
IMG_H=$(echo "$R" | grep -o '"h":[0-9.]*' | cut -d: -f2)
if awk "BEGIN{exit !($IMG_W>0 && $IMG_H>0)}" 2>/dev/null; then
  awk "BEGIN{exit !($IMG_H>=46 && $IMG_H<=50)}" && ok "头像高度 48px（随字号自适应）" || bad "头像高度 48px (h=$IMG_H)"
  awk "BEGIN{exit !($IMG_W/$IMG_H>=1.55 && $IMG_W/$IMG_H<=1.80)}" && ok "宽幅图标按 5:3 原始比例伸展" || bad "宽幅图标按原始比例伸展 (w=$IMG_W h=$IMG_H)"
else
  bad "头像尺寸读取失败 (w=$IMG_W h=$IMG_H)"
fi
ICON_URL=$(echo "$R" | grep -o 'src":"[^"]*' | cut -d'"' -f3)

# ---------- 6. 字重滑杆 + 快捷档（菜单 UI）----------
agent-browser find role button click --name "标题设置" > /dev/null 2>&1
agent-browser wait 600 > /dev/null 2>&1
WREF=$(agent-browser snapshot -i 2>/dev/null | grep "标题粗细" | head -1 | grep -o 'ref=e[0-9]*' | cut -d= -f2)
echo "  粗细子菜单 ref: $WREF"
agent-browser click "@$WREF" > /dev/null 2>&1
agent-browser wait 700 > /dev/null 2>&1
R=$(agent-browser eval "(() => {
  const slider = document.querySelector('input[type=range][aria-label=\"标题字重\"]');
  const presets = Array.from(document.querySelectorAll('button[aria-pressed]'))
    .filter((b) => ['细体','常规','中等','粗体','黑体'].includes(b.textContent.trim()));
  return JSON.stringify({ slider: !!slider, min: slider ? slider.min : null, max: slider ? slider.max : null,
    step: slider ? slider.step : null, val: slider ? slider.value : null, presetCount: presets.length });
})()" 2>/dev/null | sed 's/\\//g')
echo "  $R"
echo "$R" | grep -q '"slider":true'        && ok "字重滑杆存在"          || bad "字重滑杆存在"
echo "$R" | grep -q '"min":"100"'          && ok "滑杆下限 100"          || bad "滑杆下限 100"
echo "$R" | grep -q '"max":"900"'          && ok "滑杆上限 900"          || bad "滑杆上限 900"
echo "$R" | grep -q '"step":"100"'         && ok "滑杆步进 100"          || bad "滑杆步进 100"
echo "$R" | grep -q '"val":"800"'          && ok "滑杆当前值 800"        || bad "滑杆当前值 800"
echo "$R" | grep -q '"presetCount":5'      && ok "五个快捷档"            || bad "五个快捷档 ($R)"

# 点击「黑体」快捷档 → 断言 900 生效（eval 返回带引号的字符串，先归一化）
agent-browser find text "黑体" click > /dev/null 2>&1
agent-browser wait 1500 > /dev/null 2>&1
R=$(agent-browser eval "document.querySelector('article textarea') ? getComputedStyle(document.querySelector('article textarea')).fontWeight : null" 2>/dev/null | sed 's/\\//g')
echo "$R" | grep -q '"900"' && ok "点击快捷档「黑体」→ 字重 900" || bad "快捷档字重 900 ($R)"

# ---------- 7. 视觉截图（above + 头像 + 900 字重）----------
mkdir -p /home/z/my-project/download
agent-browser screenshot /home/z/my-project/download/above-premium-bar.png > /dev/null 2>&1
echo "[e2e] 截图已保存 download/above-premium-bar.png"

# ---------- 8. 浏览器控制台零错误 ----------
ERRS=$(agent-browser errors 2>/dev/null | rg -c "error|Error" || echo 0)
[ "$ERRS" = "0" ] && ok "浏览器零控制台错误" || bad "浏览器控制台错误 ($ERRS)"

# ---------- 9. 恢复默认 + 关闭 ----------
# 清全部槽位图标（DELETE 幂等，无图标/越界槽位安全返回）：防御历史残留
# （旧版只清 slot=0，曾漏掉其它槽位的测试图标；越界 slot 返 400，输出忽略即可）
for SLOT_I in $(seq 0 11); do
  curl -s -X DELETE "$BASE/api/videos/icon?slot=$SLOT_I" -o /dev/null
done
curl -s -X PATCH -H 'Content-Type: application/json' \
  -d '{"titlePosition":"below","titleFontSize":16,"titleWeight":400}' \
  $BASE/api/videos/settings -o /dev/null
agent-browser close > /dev/null 2>&1
if [ "${OWN:-0}" = "1" ]; then kill $SERVER_PID 2>/dev/null; fi
rm -rf .tmp-avatar

echo
echo "================================"
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
