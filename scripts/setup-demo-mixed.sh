#!/usr/bin/env bash
# 组装 Step 5 浏览器端到端演示状态：4 视频 + 2 HTML（模拟 AI 模型输出对比）
set -e
BASE="http://localhost:3000"
F=/home/z/my-project/scripts/test-videos

cat > /tmp/demo-model-a.html <<'EOF'
<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><style>
body{margin:0;font-family:system-ui,sans-serif;background:linear-gradient(135deg,#0f172a,#1e293b);color:#e2e8f0;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh}
h1{font-size:26px;margin:0 0 8px;color:#7dd3fc}
p{margin:0;font-size:14px;color:#94a3b8}
.bar{width:120px;height:6px;border-radius:3px;background:#334155;margin-top:18px;overflow:hidden}
.bar i{display:block;height:100%;width:40%;background:#38bdf8;border-radius:3px;animation:slide 1.6s ease-in-out infinite alternate}
@keyframes slide{to{transform:translateX(180px)}}
</style></head>
<body><h1>模型 A · 生成结果</h1><p>GPT-Visual v3 · 流式输出演示</p><div class="bar"><i></i></div>
<script>document.body.setAttribute('data-js','ok');try{void parent.document}catch(e){document.body.setAttribute('data-sandbox','blocked')}</script></body></html>
EOF

cat > /tmp/demo-model-b.html <<'EOF'
<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><style>
body{margin:0;font-family:system-ui,sans-serif;background:linear-gradient(135deg,#1a0b2e,#2e1065);color:#f1f5f9;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh}
h1{font-size:26px;margin:0 0 8px;color:#d8b4fe}
p{margin:0;font-size:14px;color:#a78bfa}
.ring{width:34px;height:34px;border:3px solid #4c1d95;border-top-color:#c084fc;border-radius:50%;margin-top:18px;animation:spin 1.2s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
</style></head>
<body><h1>模型 B · 生成结果</h1><p>Claude-Render v2 · 动画演示</p><div class="ring"></div>
<script>document.body.setAttribute('data-js','ok');try{void parent.document}catch(e){document.body.setAttribute('data-sandbox','blocked')}</script></body></html>
EOF

# 恢复 6 位 2×3 并清空，再依次铺 4 视频 + 2 HTML（追加语义自然落在 slot 4/5）
curl -s -X PATCH "$BASE/api/videos/layout" -H 'Content-Type: application/json' -d '{"count":6,"rows":2,"cols":3}' >/dev/null
curl -s -X DELETE "$BASE/api/videos?all=1" >/dev/null
for pair in "0 v01-landscape.mp4" "1 v02-portrait.mp4" "2 v03-square.mp4" "3 v04-ultrawide.mp4"; do
  set -- $pair
  curl -s -X POST "$BASE/api/videos/upload" -F "file=@$F/$2" -F "slot=$1" >/dev/null
done
curl -s -X PATCH "$BASE/api/videos" -H 'Content-Type: application/json' -d '{"slot":0,"title":"示例视频 1"}' >/dev/null
curl -s -X PATCH "$BASE/api/videos" -H 'Content-Type: application/json' -d '{"slot":1,"title":"示例视频 2"}' >/dev/null
curl -s -X PATCH "$BASE/api/videos" -H 'Content-Type: application/json' -d '{"slot":2,"title":"示例视频 3"}' >/dev/null
curl -s -X PATCH "$BASE/api/videos" -H 'Content-Type: application/json' -d '{"slot":3,"title":"示例视频 4"}' >/dev/null
curl -s -X POST "$BASE/api/videos/upload" -F "file=@/tmp/demo-model-a.html;type=text/html" -F "slot=4" >/dev/null
curl -s -X POST "$BASE/api/videos/upload" -F "file=@/tmp/demo-model-b.html;type=text/html" -F "slot=5" >/dev/null
curl -s -X PATCH "$BASE/api/videos" -H 'Content-Type: application/json' -d '{"slot":4,"title":"HTML 页面 · 模型 A"}' >/dev/null
curl -s -X PATCH "$BASE/api/videos" -H 'Content-Type: application/json' -d '{"slot":5,"title":"HTML 页面 · 模型 B"}' >/dev/null
echo "状态就绪："
curl -s "$BASE/api/videos" | jq -r '.slots[] | "\(.index+1): \(if .kind=="html" then "HTML " + .html.originalName else (if .video then "视频 " + .video.originalName else "空" end) end) | \(.title)"'
echo "磁盘文件数: $(ls /home/z/my-project/data/projects/default/files/ | wc -l)"
