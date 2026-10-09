#!/usr/bin/env bash
# 单次调用内完成：启动 dev server → 等就绪 → 运行指定测试脚本 → 关闭 server
# 用法：bash scripts/run-tests-once.sh <test-script.sh> [更多脚本...]
set -u
cd "$(dirname "$0")/.."

# 若已有实例在跑则直接复用
if curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/api --max-time 2 2>/dev/null | grep -q 200; then
  echo "[run-tests] 复用已运行的 dev server"
  OWN_SERVER=0
else
  echo "[run-tests] 启动 dev server..."
  npx next dev --port 3000 > /dev/null 2>&1 < /dev/null &
  SERVER_PID=$!
  OWN_SERVER=1
  READY=0
  for i in $(seq 1 90); do
    CODE=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/api --max-time 2 2>/dev/null)
    if [ "$CODE" = "200" ]; then READY=1; break; fi
    sleep 1
  done
  if [ "$READY" != "1" ]; then
    echo "[run-tests] dev server 未能就绪"
    kill $SERVER_PID 2>/dev/null
    exit 1
  fi
  echo "[run-tests] dev server 就绪（约 ${i}s）"
fi

RC=0
for t in "$@"; do
  echo
  echo "########################################"
  echo "# 运行 $t"
  echo "########################################"
  bash "$t"
  TRC=$?
  if [ "$TRC" -ne 0 ]; then RC=1; echo "!! $t 存在失败项（exit=$TRC）"; fi
done

if [ "$OWN_SERVER" = "1" ]; then
  kill $SERVER_PID 2>/dev/null
  echo
  echo "[run-tests] 已关闭本次启动的 dev server"
fi
exit $RC
