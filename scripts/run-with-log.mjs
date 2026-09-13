#!/usr/bin/env node
/**
 * 跨平台「终端 + 日志文件」双写运行器。
 *
 * 背景一：原来的 npm 脚本写作 `next dev -p 3000 2>&1 | tee dev.log`，
 * 这是 Unix 专有写法 —— Windows 上 tee 不存在（或被 cmd 的同名内建抢占），
 * 结果是服务能起来但 dev.log 恒为 0 字节，文档承诺的日志落盘形同虚设。
 *
 * 背景二：Windows 下 `next` 是 node_modules/.bin/next.cmd 包装，不经 shell 无法 spawn；
 * 而 `shell: true` 会触发 DEP0190（子进程参数只做拼接、不做转义）。这里改为用 node
 * 直接执行 next 的 JS 入口，彻底绕开 shell，既不告警也不丢参数。
 *
 * 背景三：端口被占用时 Next 只会抛一段 EADDRINUSE 堆栈，用户看不出"是谁占的、该怎么办"。
 * `--port` 会在启动前预检端口并给出可执行的处置建议。
 *
 * 用法：
 *   node scripts/run-with-log.mjs <日志文件> [--env KEY=VALUE ...] [--port N] -- <命令> [参数...]
 *
 * `--port N` 的行为：
 *   - 端口实际取值 = 环境变量 PORT（若设置）> N
 *   - 启动前预检；被占用则打印占用进程与三种处置方式后退出 1
 *   - 以 PORT=<实际端口> 传给子进程。注意 Next 的语义：用 `-p` 显式指定端口时它
 *     不会自动换端口，用 PORT 环境变量则绑定该端口且同样不重试 —— 我们两者都不用
 *     "default"，就是为了让"文档写 3000、实际就是 3000"成立，端口漂移比报错更难排查。
 *
 * 退出码透传子进程退出码；被信号终止时以 1 退出。
 */
import { spawn, execFileSync } from 'node:child_process';
import { createWriteStream, mkdirSync, existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';

/* ------------------------------- 参数解析 ------------------------------- */

const argv = process.argv.slice(2);
const separator = argv.indexOf('--');
if (separator <= 0) {
  console.error('用法: node scripts/run-with-log.mjs <日志文件> [--env K=V ...] [--port N] -- <命令> [参数...]');
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
let port = null;
for (let i = 0; i < options.length; i += 1) {
  const key = options[i];
  if (key === '--env') {
    const pair = options[i + 1] ?? '';
    const eq = pair.indexOf('=');
    if (eq <= 0) {
      console.error(`--env 需要 KEY=VALUE 形式，收到：${pair}`);
      process.exit(2);
    }
    env[pair.slice(0, eq)] = pair.slice(eq + 1);
    i += 1;
    continue;
  }
  if (key === '--port') {
    const value = Number(options[i + 1]);
    if (!Number.isInteger(value) || value < 1 || value > 65535) {
      console.error(`--port 需要 1-65535 的整数，收到：${options[i + 1]}`);
      process.exit(2);
    }
    port = value;
    i += 1;
    continue;
  }
  console.error(`未知参数：${key}`);
  process.exit(2);
}

/* ------------------------------ 端口预检 ------------------------------ */

/** 能 bind 上就是空闲；EADDRINUSE 就是被占 */
function probePort(p) {
  return new Promise((resolve) => {
    const server = createServer();
    server.unref();
    server.once('error', (err) => resolve(err.code === 'EADDRINUSE' ? 'busy' : 'free'));
    server.once('listening', () => server.close(() => resolve('free')));
    server.listen(p);
  });
}

/** 尽力找出占用者 PID；查不到就返回 null（不影响主流程） */
function findPortOwner(p) {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('netstat', ['-ano'], { encoding: 'utf8', windowsHide: true });
      const line = out
        .split('\n')
        .find((l) => /LISTENING/i.test(l) && new RegExp(`[:.]${p}\\s`).test(l));
      const pid = line?.trim().split(/\s+/).pop();
      return pid && pid !== '0' ? pid : null;
    }
    const out = execFileSync('lsof', ['-ti', `:${p}`], { encoding: 'utf8' });
    return out.trim().split('\n')[0] || null;
  } catch {
    return null;
  }
}

if (port !== null) {
  // 环境变量 PORT 可以覆盖脚本默认值，但**必须说出来**。
  // 真实教训：本机 shell 里恰好有别的工具设的 PORT=3080，脚本若默默照用，
  // 就会出现"文档写 3000、实际起在 3080"的静默漂移 —— 这比直接报错难查得多。
  const fromEnv = Number(env.PORT) > 0 ? Number(env.PORT) : null;
  const resolved = fromEnv ?? port;
  if (fromEnv !== null && fromEnv !== port) {
    console.error(`ℹ 端口取自环境变量 PORT=${fromEnv}（本脚本默认 ${port}）。不想要这个覆盖就 unset PORT。`);
  }

  if (await probePort(resolved) === 'busy') {
    const owner = findPortOwner(resolved);
    const win = process.platform === 'win32';
    console.error('');
    console.error(`✗ 端口 ${resolved} 已被占用，服务没能启动。`);
    console.error(owner ? `  占用它的进程 PID：${owner}` : '  （没能查出占用进程，可用下面的命令自查）');
    console.error('');
    console.error('  三种处置方式：');
    if (owner) {
      console.error('    1) 关掉它（多半是上一次没关干净的开发服务器）：');
      console.error(win ? `         taskkill /PID ${owner} /F` : `         kill ${owner}`);
    } else {
      console.error('    1) 找出并关掉占用它的进程');
    }
    console.error('    2) 换个端口启动：');
    console.error(win ? `         set PORT=${resolved + 1} && bun run dev` : `         PORT=${resolved + 1} bun run dev`);
    console.error('    3) 查看占用情况：');
    console.error(win ? `         netstat -ano | findstr :${resolved}` : `         lsof -i :${resolved}`);
    console.error('');
    process.exit(1);
  }
  env.PORT = String(resolved);

  // next dev 用 .next/dev/lock 做单实例保护。端口不同（例如上面被 PORT 覆盖过）时
  // 端口检查拦不住同一个项目里的另一个实例，报出来的是 Next 那句不太好懂的锁冲突。
  // 这里提前给一句人话，避免用户卡在 "Unable to acquire lock"。
  if (command === 'next' && args[0] === 'dev' && existsSync(join(process.cwd(), '.next', 'dev', 'lock'))) {
    console.error('ℹ 检测到 .next/dev/lock —— 可能已有另一个 dev 实例在跑这个项目（或上次异常退出留下的锁）。');
    console.error('  若稍后报 "Unable to acquire lock"，先关掉旧实例；确认没有旧实例时可删除该文件后重试。');
  }
}

/* ---------------------------- 命令解析（避开 shell） ---------------------------- */

/**
 * Windows 上 npm 包的 bin 是 .cmd 包装，spawn 必须经 shell。
 * 与其用 shell:true（触发 DEP0190），不如直接用 node 跑它背后的 JS 入口。
 * 目前只有 next 这一种情况，其余命令（如 node 自身）本来就能直接 spawn。
 */
function resolveCommand(cmd, cmdArgs) {
  if (process.platform !== 'win32' || cmd !== 'next') {
    return { file: cmd, args: cmdArgs, shell: false };
  }
  const entry = join(process.cwd(), 'node_modules', 'next', 'dist', 'bin', 'next');
  if (existsSync(entry)) {
    return { file: process.execPath, args: [entry, ...cmdArgs], shell: false };
  }
  // 兜底：结构不认识时退回 shell（会带 DEP0190 告警，但至少能跑）
  return { file: cmd, args: cmdArgs, shell: true };
}

const resolved = resolveCommand(command, args);

/* -------------------------------- 启动 -------------------------------- */

const logDir = dirname(logFile);
if (logDir && logDir !== '.') mkdirSync(logDir, { recursive: true });
const log = createWriteStream(logFile, { flags: 'w' });

const child = spawn(resolved.file, resolved.args, {
  stdio: ['inherit', 'pipe', 'pipe'],
  env,
  shell: resolved.shell,
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
  const win = process.platform === 'win32';
  console.error(`\n✗ 无法启动 ${command}：${err.message}`);
  if (err.code === 'ENOENT') {
    console.error(win ? '  多半是依赖没装：先跑 bun install' : '  command not found —— 先跑 bun install 确认依赖已装');
  } else if (err.code === 'EINVAL' && win) {
    console.error('  Windows 下 .cmd 包装需要经 shell 执行；请确认命令是 node 可直接运行的可执行文件。');
  }
  finish(1);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
