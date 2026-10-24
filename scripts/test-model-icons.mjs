#!/usr/bin/env node
/**
 * 模型图标识别 / 文件名猜标题的回归测试（零依赖，node 直接跑）
 *
 *   node scripts/test-model-icons.mjs
 *
 * 覆盖：各厂商中英文名、俗称、模型系列名、全角/空格/各式横杠/标点/emoji 干扰、
 * 短别名误命中防护（metadata / sparkling / want / step30）、最高分选择、
 * 以及「文件名里只取模型名当标题」（作品名/分辨率等其余文字不得进标题）。
 */
import {
  detectModelIcon,
  decideAutoIcon,
  normalizeKey,
  modelTitleFromFileName,
  presetForIconFile,
} from '../src/lib/model-icon-rules.ts';

let passed = 0;
const failures = [];

function check(kind, input, expected, actual) {
  if (actual === expected) {
    passed++;
  } else {
    failures.push(`[${kind}] ${JSON.stringify(input)} → 期望 ${expected}，实际 ${actual}`);
  }
}

function icon(title, expected) {
  const preset = detectModelIcon(title);
  check('icon', title, expected, preset ? preset.id : null);
}

/* ---------------- 1. 正例：品牌 / 中文名 / 俗称 / 系列 ---------------- */
const positives = [
  // DeepSeek
  ['DeepSeek V3.2', 'deepseek'],
  ['deepseek-v4-pro', 'deepseek'],
  ['Deep Seek R1', 'deepseek'],
  ['ＤｅｅｐＳｅｅｋ－Ｒ１', 'deepseek'],
  ['深度求索 最新模型', 'deepseek'],
  ['大肥鱼又更新了', 'deepseek'],
  ['蓝色大肥鱼 视频对比', 'deepseek'],
  ['🐳 DeepSeek 生成', 'deepseek'],
  ['DeepSeek（深度求索）｜V4-Pro 实测', 'deepseek'],
  // ChatGPT / OpenAI
  ['ChatGPT 5.5', 'chatgpt'],
  ['CHATGPT-4o', 'chatgpt'],
  ['chat gpt 4o 图像', 'chatgpt'],
  ['GPT—6.1', 'chatgpt'],
  ['OpenAI Sora 2 视频', 'chatgpt'],
  ['DALL·E 3 出图', 'chatgpt'],
  ['gpt-image-2', 'chatgpt'],
  ['Codex 写的页面', 'chatgpt'],
  // Claude
  ['Claude Opus 5.5', 'claude'],
  ['claude-sonnet-4.6', 'claude'],
  ['克劳德 4.5', 'claude'],
  ['Anthropic 新模型', 'claude'],
  ['Claude Code 生成的网页', 'claude'],
  // Gemini / Google
  ['Gemini 3.7 Flash', 'gemini'],
  ['谷歌 Nano Banana 2.1', 'gemini'],
  ['Google Veo 3 视频', 'gemini'],
  ['Gemini—3.1—Pro—Preview', 'gemini'],
  ['Gemma 4 26B', 'gemini'],
  ['双子座 3 代', 'gemini'],
  // Qwen
  ['通义千问 3.8', 'qwen'],
  ['千问App 生成', 'qwen'],
  ['Qwen3.5-397B-A17B', 'qwen'],
  ['qwq-32b 推理', 'qwen'],
  ['阿里通义 万相 视频', 'qwen'],
  ['Qwen Coder 页面', 'qwen'],
  // Kimi
  ['Kimi K3', 'kimi'],
  ['kimi-k2.7-code', 'kimi'],
  ['月之暗面 K2.5', 'kimi'],
  ['Moonshot 新版本', 'kimi'],
  // 豆包 / 字节
  ['豆包 1.6', 'doubao'],
  ['Doubao-Seedance-2.0', 'doubao'],
  ['即梦 AI 视频', 'doubao'],
  ['字节跳动 Seedream', 'doubao'],
  ['Seed 2.0 生成', 'doubao'],
  // 混元 / 腾讯
  ['腾讯混元 3D', 'hunyuan'],
  ['混元视频 生成', 'hunyuan'],
  ['HunyuanImage 3', 'hunyuan'],
  ['Tencent HY4', 'hunyuan'],
  ['腾讯元宝 回答', 'hunyuan'],
  // 文心 / 百度
  ['文心一言 5.0', 'wenxin'],
  ['ERNIE-4.5-300B', 'wenxin'],
  ['百度 千帆 模型', 'wenxin'],
  ['文心一格 出图', 'wenxin'],
  // 小米 MiMo
  ['小米 MiMo-V2.6', 'xiaomi'],
  ['MiMo V2.5 Pro', 'xiaomi'],
  ['Xiaomi MiMo', 'xiaomi'],
  ['小米mimo 实测', 'xiaomi'],
  // 智谱 GLM
  ['智谱 GLM-5.3', 'z-ai'],
  ['ChatGLM 4', 'z-ai'],
  ['Z.ai GLM-4.6', 'z-ai'],
  ['智谱清言 生成', 'z-ai'],
  ['CodeGeeX 写的代码', 'z-ai'],
  // MiniMax
  ['MiniMax-M3', 'minimax'],
  ['海螺 AI 视频', 'minimax'],
  ['Hailuo 02', 'minimax'],
  ['稀宇科技 新模型', 'minimax'],
  // 阶跃星辰
  ['阶跃星辰 Step-5', 'stepfun'],
  ['StepFun Step-3.5', 'stepfun'],
  ['Step 3.5 Flash', 'stepfun'],
  ['跃问 生成的页面', 'stepfun'],
  // 讯飞星火
  ['讯飞星火 X1', 'spark'],
  ['科大讯飞 Spark', 'spark'],
  ['iFlytek 星火', 'spark'],
  // Mistral
  ['Mistral Large 4', 'mistral'],
  ['Mixtral 8x22B', 'mistral'],
  ['Codestral 2512', 'mistral'],
  // Meta / Llama
  ['羊驼 4', 'meta'],
  ['Meta-Llama-4', 'meta'],
  ['LLaMA 3.3 70B', 'meta'],
  ['Meta AI 出的图', 'meta'],
  // Grok
  ['Grok 4.7', 'grok'],
  ['xAI Grok', 'grok'],
  ['grok-imagine 视频', 'grok'],
];
for (const [title, id] of positives) icon(title, id);

/* ---------------- 1b. 大小写：别名表统一小写只是书写约定，匹配前两侧一起归一化 ---------------- */
const caseInsensitive = [
  ['DEEPSEEK V3.2', 'deepseek'],
  ['dEePsEeK', 'deepseek'],
  ['ＤＥＥＰＳＥＥＫ－Ｒ１', 'deepseek'],
  ['CHATGPT-5', 'chatgpt'],
  ['QwEn3.5-Max', 'qwen'],
  ['MIMO', 'xiaomi'],
  ['小米 MIMO', 'xiaomi'],
  ['GLM—4.6', 'z-ai'],
  ['ANTHROPIC', 'claude'],
  ['ＳＯＲＡ', 'chatgpt'],
  ['GROK 4.7', 'grok'],
  ['NANO BANANA', 'gemini'],
  ['MISTRAL LARGE', 'mistral'],
  ['KIMI K3', 'kimi'],
  ['DOUBAO-SEEDANCE', 'doubao'],
  ['HUNYUAN 3D', 'hunyuan'],
];
for (const [title, id] of caseInsensitive) icon(title, id);

/* ---------------- 2. 反例：不该命中 ---------------- */
const negatives = [
  'metadata 清理脚本',
  'sparkling water 广告',
  'want to buy 一个模型',
  'step by step 教程',
  'step 30 的中间结果',
  'step30 日志',
  '我的实验记录 Day 3',
  'logo 1 号方案',
  'Notepad++ 截图',
  'seeding 数据',
  '光与影的对话',
  'Hello World',
  '20251022',
  '1.2.3 版本对比',
  '',
  '   ',
  '【1080p】未命名',
];
for (const title of negatives) icon(title, null);

/* ---------------- 3. 归一化：标点/空格/全角一律抹平 ---------------- */
const same = [
  ['DeepSeek', 'ＤｅｅｐＳｅｅｋ'],
  ['deep seek', 'deep-seek'],
  ['deep_seek', 'deep·seek'],
  ['Qwen3.5', 'Ｑｗｅｎ３．５'],
  ['小米 MiMo', '小米·MiMo'],
  ['Meta Llama', 'meta—llama'],
  ['Step-3.5', 'Ｓｔｅｐ－３．５'],
];
for (const [a, b] of same) check('normalize', `${a} vs ${b}`, normalizeKey(a), normalizeKey(b));

/* ---------------- 4. 选择规则：最长别名优先 ---------------- */
icon('Kimi 对比 DeepSeek', 'deepseek');
icon('DeepSeek 生成的页面，用 Qwen 复刻', 'deepseek');
icon('小米 MiMo 与 通义千问 对比', 'xiaomi'); // 同长度（4）时取标题里更早出现的

/* ---------------- 5. 自动填充状态机 ---------------- */
const baseSlot = { icon: null };
check('decide', '无图+命中', 'deepseek', decideAutoIcon(baseSlot, 'DeepSeek V3')?.id ?? null);
check('decide', '无图+未命中', null, decideAutoIcon(baseSlot, '随便写写')?.id ?? null);
check('decide', 'manual 永不改', null, decideAutoIcon({ icon: { filename: 'a.png' }, iconMode: 'manual' }, 'DeepSeek')?.id ?? null);
check('decide', 'off 永不改', null, decideAutoIcon({ icon: null, iconMode: 'off' }, 'DeepSeek')?.id ?? null);
check(
  'decide',
  '自动图换模型',
  'claude',
  decideAutoIcon({ icon: { filename: 'a.png' }, iconMode: 'auto', iconPreset: 'deepseek' }, 'Claude 5')?.id ?? null,
);
check(
  'decide',
  '自动图同模型不重复',
  null,
  decideAutoIcon({ icon: { filename: 'a.png' }, iconMode: 'auto', iconPreset: 'deepseek' }, 'DeepSeek V4')?.id ?? null,
);
check(
  'decide',
  '老数据有图无标记=手动',
  null,
  decideAutoIcon({ icon: { filename: 'a.png' } }, 'Claude 5')?.id ?? null,
);

/* ---------------- 6. 图标文件反查 ---------------- */
check('presetForIconFile', 'deepseek.png', 'deepseek', presetForIconFile('deepseek.png')?.id ?? null);
check('presetForIconFile', 'nope.png', null, presetForIconFile('nope.png')?.id ?? null);

/* ---------------- 7. 文件名 → 标题：只取模型名，其余文字不进标题 ---------------- */
const titleCases = [
  ['Kimi飞机发动机.mp4', 'Kimi'],
  ['Kimi飞机发动机_1080p.mp4', 'Kimi'],
  ['DeepSeek-V3.2-Exp_1080p.mp4', 'DeepSeek'],
  ['【即梦】豆包视频.mp4', '豆包'],
  ['小米的MiMo飞机发动机.mov', '小米 MiMo'],
  ['qwen3.5-demo (1).html', '通义千问'],
  ['Spark.mp4', '讯飞星火'],       // 扩展名先剥掉，strict 别名才不会被吃进单词中间
  ['Meta.mp4', 'Meta Llama'],
  ['Seedance 2.0 宣传片.mp4', '豆包'],
  // 认不出来 → 保持空标题，绝不把整串文件名塞进标题
  ['飞机发动机演示.mp4', null],
  ['lv_0_20251022163000.mp4', null],
  ['VID_20251022_163000.mp4', null],
  ['IMG_1234.png', null],
  ['Screenshot 2025-10-22.png', null],
  ['a3f9c2e1b7d84f60a1b2c3d4e5f60718.mp4', null],
  ['video.mp4', null],
  ['未命名.mp4', null],
  ['20251022.mp4', null],
  ['x.mp4', null],
];
for (const [name, expected] of titleCases) {
  check('modelTitle', name, expected, modelTitleFromFileName(name));
}

/* ---------------- 输出 ---------------- */
console.log(`\n通过 ${passed} 项`);
if (failures.length > 0) {
  console.error(`失败 ${failures.length} 项：`);
  for (const line of failures) console.error('  ' + line);
  process.exit(1);
}
console.log('全部通过 ✅');
