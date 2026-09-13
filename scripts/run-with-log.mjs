#!/usr/bin/env node
/**
 * 跨平台「终端 + 日志文件」双写运行器。
 *
 * 背景：原来的 npm 脚本写作 `next dev -p 3000 2>&1 | tee dev.log`，
 * 这是 Unix 专有写法 —— Windows 上 tee 不存在（或被 cmd 的同名内建抢占），
 * 结果是服务能起来但 dev.log 恒为 0 字节，文档承诺的日志落盘形同虚设。
 *
 * 用法：
 *   node scripts/run-with-log.mjs <日志文件> [--env KEY=VALUE ...] -- <命令> [参数...]
 *
 * 退出码透传子进程退出码；被信号终止时以 1 退出。
 */
import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const argv = process.argv.slice(2);
const separator = argv.indexOf('--');
if (separator <= 0) {
  console.error('用法: node scripts/run-with-log.mjs <日志文件> [--env K=V ...] -- <命令> [参数...]');
  process.exit(2);
}

const logFile = argv[0];
const options = argv.slice(1, separator);
const [command, ...args] = argv.slice(separator + 1);
if (!command) {
  console.error('缺少要执行的命令');
  process.exit(2);
}

const env = { ...process.env };
for (let i = 0; i < options.length; i += 1) {
  if (options[i] !== '--env') {
    console.error(`未知参数：${options[i]}`);
    process.exit(2);
  }
  const pair = options[i + 1] ?? '';
  const eq = pair.indexOf('=');
  if (eq <= 0) {
    console.error(`--env 需要 KEY=VALUE 形式，收到：${pair}`);
    process.exit(2);
  }
  env[pair.slice(0, eq)] = pair.slice(eq + 1);
  i += 1;
}

const logDir = dirname(logFile);
if (logDir && logDir !== '.') mkdirSync(logDir, { recursive: true });
const log = createWriteStream(logFile, { flags: 'w' });

const child = spawn(command, args, {
  stdio: ['inherit', 'pipe', 'pipe'],
  env,
  // Windows 下 next/node 等 bin 是 .cmd 包装，需要 shell 才能解析
  shell: process.platform === 'win32',
});

/** 同一份输出同时进终端与日志文件 */
function tee(stream, sink) {
  stream.on('data', (chunk) => {
    sink.write(chunk);
    log.write(chunk);
  });
}
tee(child.stdout, process.stdout);
tee(child.stderr, process.stderr);

let finished = false;
function finish(code) {
  if (finished) return;
  finished = true;
  log.end(() => process.exit(code));
}

child.on('exit', (code, signal) => finish(signal ? 1 : (code ?? 0)));
child.on('error', (err) => {
  console.error(`无法启动 ${command}: ${err.message}`);
  finish(1);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
