#!/bin/bash
# 验证「弹层开合时 body 被注入 margin-right=滚动条宽度」的复现与修复效果。
# 用法: bash scripts/test-shrink.sh
# 原理: 无头浏览器为 overlay 滚动条(不占布局宽度, gap=0)无法复现用户环境;
#       通过 defineProperty 将 window.innerWidth 桩化为 clientWidth+17,
#       react-remove-scroll-bar 的 getGapWidth() 读 innerWidth-clientWidth 即得 17,
#       等价于用户机器上经典滚动条占据 17px 宽度的真实场景。
set -e
AB="agent-browser"

$AB open http://localhost:3000
$AB set viewport 1440 900
$AB wait --load networkidle
sleep 1.5

echo ""
echo "=== [0] 自然 gap（无桩, 预期 overlay 滚动条 gap=0）==="
$AB eval "JSON.stringify({innerW: window.innerWidth, clientW: document.documentElement.clientWidth, naturalGap: window.innerWidth - document.documentElement.clientWidth, bodyMR: getComputedStyle(document.body).marginRight, locked: document.body.hasAttribute('data-scroll-locked')})"

echo ""
echo "=== [1] 打桩 innerWidth = clientWidth + 17（模拟经典滚动条环境）==="
$AB eval "Object.defineProperty(window, 'innerWidth', {configurable: true, get: () => document.documentElement.clientWidth + 17}); JSON.stringify({simGap: window.innerWidth - document.documentElement.clientWidth})"

echo ""
echo "=== [2] 基线（菜单关闭）==="
$AB eval "JSON.stringify({bodyMR: getComputedStyle(document.body).marginRight, locked: document.body.hasAttribute('data-scroll-locked'), headerInnerW: Math.round(document.querySelector('header > div').getBoundingClientRect().width), mainW: Math.round(document.querySelector('main').getBoundingClientRect().width)})"

echo ""
echo "=== [3] 打开项目切换器下拉（Radix modal -> RemoveScroll）==="
$AB find first "button[title='切换项目']" click
sleep 0.8
$AB eval "JSON.stringify({bodyMR: getComputedStyle(document.body).marginRight, locked: document.body.hasAttribute('data-scroll-locked'), headerInnerW: Math.round(document.querySelector('header > div').getBoundingClientRect().width), mainW: Math.round(document.querySelector('main').getBoundingClientRect().width), injected: ([...document.querySelectorAll('style')].map(s=>s.textContent).join('').match(/body\\[data-scroll-locked\\][^}]*margin-right[^}]*\\}/g)||[]).slice(0,1)})"

echo ""
echo "=== [4] 关闭下拉（Esc）==="
$AB press Escape
sleep 0.8
$AB eval "JSON.stringify({bodyMR: getComputedStyle(document.body).marginRight, locked: document.body.hasAttribute('data-scroll-locked'), headerInnerW: Math.round(document.querySelector('header > div').getBoundingClientRect().width), mainW: Math.round(document.querySelector('main').getBoundingClientRect().width)})"

echo ""
echo "=== [5] 打开「使用须知」Dialog（另一类 modal 弹层, 应同样零位移）==="
$AB find first "button[title='使用须知']" click 2>/dev/null || $AB find first "button[aria-label='使用须知']" click
sleep 0.8
$AB eval "JSON.stringify({bodyMR: getComputedStyle(document.body).marginRight, locked: document.body.hasAttribute('data-scroll-locked'), headerInnerW: Math.round(document.querySelector('header > div').getBoundingClientRect().width), mainW: Math.round(document.querySelector('main').getBoundingClientRect().width)})"
$AB press Escape
sleep 0.5
$AB eval "JSON.stringify({afterDialogClose_bodyMR: getComputedStyle(document.body).marginRight, locked: document.body.hasAttribute('data-scroll-locked')})"
echo ""
echo "done"
