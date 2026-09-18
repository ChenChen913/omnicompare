#!/usr/bin/env node
/**
 * 把一段演示视频（MP4）转换成能直接放进 GitHub README 的素材。
 *
 * 为什么需要转换：GitHub 的 Markdown 渲染器会**直接删除** `<video>`、`<source>`、
 * `<iframe>` 标签（实测：提交这些标签后渲染结果里它们是空的），所以 README 里
 * 没有任何办法内嵌播放 MP4。能在 README 里"自己动"的只有图片格式：
 *   - GIF  ：所有浏览器都动，兼容性最好，代价是文件大；
 *   - 动画 WebP：同画质下体积通常只有 GIF 的 1/3 ~ 1/5，但老 Safari 不认。
 * 因此本脚本同时产出 GIF（默认引用它，保证人人看得见）与 WebP（想省流量时可换），
 * 外加一张封面 PNG 和一份可以直接贴进 README 的片段。
 *
 * 用法：
 *   node scripts/make-demo-media.mjs <输入.mp4> [选项]
 *
 * 选项（都有合理默认值，通常一个都不用写）：
 *   --out-dir <目录>   输出目录，默认 docs
 *   --name <名字>      输出文件名前缀，默认 demo
 *   --width <像素>     目标宽度，默认 900（GitHub 正文宽度约 830px，再宽也不会更大）
 *   --fps <帧率>       默认 12（屏幕录制 10~15 帧足够，再高只是徒增体积）
 *   --max-mb <数值>    GIF 体积上限，默认 8；超了自动降规格重试
 *   --poster-at <秒>   封面取第几秒，默认取中点
 *   --keep-mp4         同时把 MP4 复制进输出目录（用于"看原片"链接）
 *   --no-webp          不生成动画 WebP
 *   --no-poster        不生成封面 PNG
 *
 * 依赖：ffmpeg / ffprobe。优先用 FFMPEG / FFPROBE 环境变量，否则找 PATH。
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, statSync, existsSync, rmSync } from 'node:fs';
import { join, basename, relative, resolve } from 'node:path';

/* ------------------------------- 参数解析 ------------------------------- */

const argv = process.argv.slice(2);
if (argv.length === 0 || argv.includes('-h') || argv.includes('--help')) {
  console.log(`用法: node scripts/make-demo-media.mjs <输入.mp4> [--out-dir docs] [--name demo]
       [--width 900] [--fps 12] [--max-mb 8] [--poster-at 3] [--keep-mp4]`);
  process.exit(argv.length === 0 ? 2 : 0);
}

const input = resolve(argv[0]);
const opt = { 'out-dir': 'docs', name: 'demo', width: '900', fps: '12', 'max-mb': '8', 'poster-at': '' };
let keepMp4 = false;
let noWebp = false;
let noPoster = false;
for (let i = 1; i < argv.length; i += 1) {
  const a = argv[i];
  if (a === '--keep-mp4') { keepMp4 = true; continue; }
  if (a === '--no-webp') { noWebp = true; continue; }
  if (a === '--no-poster') { noPoster = true; continue; }
  const key = a.replace(/^--/, '');
  if (!(key in opt)) { console.error(`未知选项：${a}`); process.exit(2); }
  opt[key] = argv[++i];
}

const outDir = resolve(opt['out-dir']);
const name = opt.name;
const maxBytes = Number(opt['max-mb']) * 1024 * 1024;

if (!existsSync(input)) {
  console.error(`找不到输入文件：${input}`);
  process.exit(1);
}

/* ------------------------------- 工具定位 ------------------------------- */

function which(envVar, bin) {
  if (process.env[envVar]) return process.env[envVar];
  // 不加 shell：ffmpeg/ffprobe 是 .exe，Node 能直接按 PATH 解析；
  // 加 shell 会触发 DEP0190（参数不再转义），也更容易被路径里的空格坑到。
  const probe = spawnSync(bin, ['-version'], { encoding: 'utf8' });
  if (probe.status === 0) return bin;
  return null;
}
const FFMPEG = which('FFMPEG', 'ffmpeg');
const FFPROBE = which('FFPROBE', 'ffprobe');
if (!FFMPEG || !FFPROBE) {
  console.error('未找到 ffmpeg / ffprobe。请安装后加入 PATH，或设置 FFMPEG / FFPROBE 环境变量指向可执行文件。');
  process.exit(1);
}

/** 跑一条命令，失败即抛出（把 stderr 尾巴带出来，便于定位） */
function run(bin, args, label) {
  const r = spawnSync(bin, args, { encoding: 'buffer', maxBuffer: 1 << 28, shell: false });
  if (r.status !== 0) {
    const err = (r.stderr ?? Buffer.alloc(0)).toString('utf8').trim().split('\n').slice(-6).join('\n');
    throw new Error(`${label} 失败（exit ${r.status}）\n${err}`);
  }
  return r;
}

const mb = (n) => `${(n / 1048576).toFixed(2)} MB`;
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;

/* ------------------------------- 探测输入 ------------------------------- */

const probe = run(
  FFPROBE,
  ['-v', 'error', '-select_streams', 'v:0', '-show_entries',
   'stream=width,height,r_frame_rate,duration:format=duration', '-of', 'json', input],
  'ffprobe 探测',
).stdout.toString('utf8');
const info = JSON.parse(probe);
const vs = info.streams?.[0] ?? {};
const duration = Number(vs.duration ?? info.format?.duration ?? 0);
const srcW = Number(vs.width ?? 0);
const srcH = Number(vs.height ?? 0);

if (!duration || !srcW) {
  console.error('无法读取视频信息，请确认输入是有效的视频文件。');
  process.exit(1);
}

console.log('输入：');
console.log(`  ${basename(input)}`);
console.log(`  ${srcW}×${srcH}  时长 ${duration.toFixed(2)}s  ${mb(statSync(input).size)}`);

mkdirSync(outDir, { recursive: true });

/* --------------------------- GIF：两遍调色板法 --------------------------- */

// 直接用 ffmpeg 默认调色板生成的 GIF 会有明显色带与噪点；两遍法（palettegen →
// paletteuse）先为这段视频统计出 256 色最优调色板再套用，是画质/体积性价比最高的做法。
// stats_mode=diff 让统计偏向"变化的区域"，对屏幕录制（大片静态 UI + 局部动）尤其有效。
function buildGif(width, fps) {
  const stats = join(outDir, `.${name}-palette.png`);
  const gif = join(outDir, `${name}.gif`);
  const vf = `fps=${fps},scale=${width}:-2:flags=lanczos`;

  run(FFMPEG, ['-y', '-v', 'error', '-i', input, '-vf', `${vf},palettegen=stats_mode=diff`, stats], 'GIF 调色板生成');
  run(FFMPEG, [
    '-y', '-v', 'error', '-i', input, '-i', stats,
    '-lavfi', `${vf}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`,
    '-loop', '0', gif,
  ], 'GIF 编码');
  rmSync(stats, { force: true });
  return statSync(gif).size;
}

let width = Number(opt.width);
let fps = Number(opt.fps);
console.log('\nGIF 生成：');
let gifSize = 0;
for (let attempt = 1; attempt <= 5; attempt += 1) {
  gifSize = buildGif(width, fps);
  const ok = gifSize <= maxBytes;
  console.log(`  第 ${attempt} 次  ${width}px / ${fps}fps  →  ${mb(gifSize)}${ok ? '  ✅' : `  ✗ 超出 ${opt['max-mb']}MB 上限`}`);
  if (ok) break;
  // 超限就按"先降帧率、再降分辨率"的顺序收紧：降帧率对观感的损失更小
  if (fps > 10) fps -= 2;
  else width = Math.round(width * 0.8);
  if (width < 400) { console.log('  已降到 400px 以下仍超限，请改用更短的片段或提高 --max-mb'); break; }
}
if (gifSize > maxBytes) {
  console.log(`  ⚠️ 最终 ${mb(gifSize)} 仍超过上限，README 里加载会偏慢，建议剪短一点或接受 WebP 方案。`);
}

/* ----------------------------- 动画 WebP ----------------------------- */

let webpSize = 0;
if (!noWebp) {
  const webp = join(outDir, `${name}.webp`);
  run(FFMPEG, [
    '-y', '-v', 'error', '-i', input,
    '-vf', `fps=${fps},scale=${width}:-2:flags=lanczos`,
    '-c:v', 'libwebp_anim', '-loop', '0', '-q:v', '72', '-compression_level', '6', webp,
  ], 'WebP 编码');
  webpSize = statSync(webp).size;
}

/* -------------------------------- 封面 -------------------------------- */

let posterSize = 0;
if (!noPoster) {
  const posterAt = opt['poster-at'] !== '' ? Number(opt['poster-at']) : duration / 2;
  const poster = join(outDir, `${name}-poster.png`);
  run(FFMPEG, [
    '-y', '-v', 'error', '-ss', String(posterAt), '-i', input, '-frames:v', '1',
    '-vf', `scale=${width}:-2:flags=lanczos`, poster,
  ], '封面截取');
  posterSize = statSync(poster).size;
}

/* ------------------------------ 可选 MP4 ------------------------------ */

let mp4Name = null;
if (keepMp4) {
  // 原片按需重编码成体积可控的 H.264，避免把几十上百 MB 的录制原文件塞进仓库。
  // 音轨保留（AAC 128k）：演示视频的核心卖点就是背景音乐，静音版无法展示。
  mp4Name = `${name}.mp4`;
  run(FFMPEG, [
    '-y', '-v', 'error', '-i', input,
    '-vf', `scale=${width}:-2:flags=lanczos`,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '26', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k',
    '-movflags', '+faststart', join(outDir, mp4Name),
  ], 'MP4 压缩');
}

/* ------------------------------- 结果汇总 ------------------------------- */

const rel = (f) => {
  // README 片段必须用相对仓库根的路径，否则贴进去就是本机绝对路径
  const abs = join(outDir, f);
  const r = relative(process.cwd(), abs);
  return (r.startsWith('..') ? abs : r).replace(/\\/g, '/');
};
console.log('\n产出：');
console.log(`  ${rel(`${name}.gif`).padEnd(28)} ${mb(gifSize).padStart(9)}   ← README 默认引用它`);
if (webpSize) {
  console.log(`  ${rel(`${name}.webp`).padEnd(28)} ${mb(webpSize).padStart(9)}   （GIF 的 ${(gifSize / webpSize).toFixed(1)} 分之 1 大小）`);
}
if (posterSize) {
  console.log(`  ${rel(`${name}-poster.png`).padEnd(28)} ${kb(posterSize).padStart(9)}   封面`);
}
if (mp4Name) console.log(`  ${rel(mp4Name).padEnd(28)} ${mb(statSync(join(outDir, mp4Name)).size).padStart(9)}   （原片链接用）`);

console.log('\n把下面这段贴进 README（放在一句话描述之后效果最好）：\n');
console.log('```markdown');
if (mp4Name) {
  console.log(`[![OmniCompare 演示](${rel(`${name}.gif`)})](${rel(mp4Name)})`);
  console.log('');
  console.log(`> 点图看完整视频（有声） · 上面是 ${Math.round(duration)} 秒无声循环预览`);
} else {
  console.log(`![OmniCompare 演示](${rel(`${name}.gif`)})`);
}
console.log('```');

if (gifSize > 5 * 1024 * 1024) {
  console.log('\n提示：GIF 超过 5MB 时首屏加载会明显变慢。可以考虑：');
  console.log('  · 剪短到 5~6 秒（只留最有代表性的操作）');
  console.log('  · 换用 WebP 引用（体积更小，但老 Safari 不显示动画）');
  console.log('  · 把 GIF 放到 GitHub Release 资产里，仓库本身不留大文件');
}
