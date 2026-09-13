#!/usr/bin/env node
/**
 * 把 .next/static 与 public 拷进 .next/standalone —— standalone 产物能跑起来的必需步骤。
 *
 * 背景：原来的 npm build 脚本写作 `next build && cp -r .next/static .next/standalone/.next/ && cp -r public .next/standalone/`。
 * Windows 上 cp 要么不存在、要么是不支持 -r 的版本，于是 next build 成功之后这一步失败：
 * 产物看着"构建完成"，启动后首页返回 200，但 /_next/static/** 全部 404 —— 浏览器里是一片空白。
 * 这种静默失败最难排查，所以本脚本在拷完后会做一次自检，缺文件直接非零退出。
 */
import { cp, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const standalone = join(root, '.next', 'standalone');

async function exists(target) {
  try {
    await access(target, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

if (!(await exists(standalone))) {
  console.error('缺少 .next/standalone —— 请确认 next.config.ts 中的 output: "standalone" 且 next build 已成功');
  process.exit(1);
}

const jobs = [
  { from: join(root, '.next', 'static'), to: join(standalone, '.next', 'static') },
  { from: join(root, 'public'), to: join(standalone, 'public') },
];

for (const { from, to } of jobs) {
  if (!(await exists(from))) {
    console.error(`缺少源目录：${relative(root, from)}`);
    process.exit(1);
  }
  await cp(from, to, { recursive: true });
  console.log(`  ✓ ${relative(root, to)}`);
}

// 自检：static 是页面 JS/CSS/字体的唯一来源，缺了就是"200 的空白站"
const staticDir = join(standalone, '.next', 'static');
if (!(await exists(staticDir))) {
  console.error('构建自检失败：.next/standalone/.next/static 未生成');
  process.exit(1);
}

console.log('standalone 产物就绪（.next/static 与 public 已就位）');
