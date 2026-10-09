#!/usr/bin/env bash
# 单次调用内完成：启动 dev server → 等就绪 → 运行 node 回归测试 → 关闭 server
set -u
cd "$(dirname "$0")/.."

if curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/api --max-time 2 2>/dev/null | grep -q 200; then
  echo "[node-tests] 复用已运行的 dev server"
  node scripts/api-regression-test.mjs
  exit $?
fi

npx next dev --port 3000 > /dev/null 2>&1 < /dev/null &
SERVER_PID=$!
READY=0
for i in $(seq 1 90); do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/api --max-time 2 2>/dev/null)
  if [ "$CODE" = "200" ]; then READY=1; break; fi
  sleep 1
done
if [ "$READY" != "1" ]; then
  echo "[node-tests] dev server 未能就绪"
  kill $SERVER_PID 2>/dev/null
  exit 1
fi
node scripts/api-regression-test.mjs
RC=$?
kill $SERVER_PID 2>/dev/null
exit $RC
