/**
 * 模型图标识别规则（纯函数，客户端与服务端共用；不依赖任何 Node API）
 *
 * 目标：标题里写了「DeepSeek V3.2」「小米 MiMo-V2.6」「大肥鱼」「Ｑｗｅｎ３」……
 * 都能认出是哪家的模型，供卡片图标自动填充（见 /api/videos 的 PATCH 与
 * /api/videos/icon/auto）。图库在 public/model-icons/[id].png。
 *
 * 匹配分两步：
 * 1. normalizeKey()：NFKC 归一（全角→半角）+ 小写 + 只保留字母/数字/汉字。
 *    于是大小写、空格、短横线（- ‐ ‑ ‒ – — ― −）、下划线、点号、斜杠、括号、
 *    逗号顿号引号、emoji、零宽字符等干扰全部消失——
 *    「Deep Seek」「deep-seek」「ＤｅｅｐＳｅｅｋ」「Deep·Seek」「🐳DeepSeek」→ deepseek。
 * 2. 在归一化文本里找别名；短而常见的别名（meta / spark / wan / hy3 …）加词边界，
 *    避免 metadata、sparkling、want 之类误命中。
 *
 * 命中多个规则时取「命中别名最长」的那个（更具体），长度相同取靠前的，
 * 再相同取标题里更早出现的——结果稳定可预测。
 */

/** 图标管理模式：auto = 系统按标题维护；manual = 用户手动上传；off = 用户手动移除后不再自动填 */
export type IconMode = 'auto' | 'manual' | 'off';

/** 自动匹配只需要图上这几个字段（结构化类型，避免依赖 types.ts） */
export interface IconSlotState {
  icon?: { filename: string } | null;
  iconMode?: IconMode;
  iconPreset?: string;
  title?: string;
}

export interface ModelIconPreset {
  /** 同时也是 public/model-icons/[id].png 的文件名 */
  id: string;
  /** 展示名（toast / 无障碍文案） */
  label: string;
  /** 品牌、公司、产品线、中文名、常见俗名；大小写/空格/标点不敏感 */
  aliases: readonly string[];
  /** 需要词边界的短别名（防止 metadata / sparkling / want 等误判） */
  strictAliases?: readonly string[];
}

/**
 * 图标 → 关键词表。
 * 版本号无需逐个列举：品牌名本身是别名，常见的系列名/代号/中文俗称/公司名一并收录。
 * 想加模型：在数组里加一条，把图标以同名 PNG 丢进 public/model-icons/ 即可。
 */
export const MODEL_ICONS: readonly ModelIconPreset[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    aliases: [
      'deepseek', 'deep seek', '深度求索',
      // 中文社区俗称（蓝鲸 logo 被叫成「大肥鱼」「小鲸鱼」）
      '大肥鱼', '蓝色大肥鱼', '肥鱼', '鲸鱼', '小鲸鱼', '蓝鲸',
    ],
  },
  {
    id: 'chatgpt',
    label: 'ChatGPT',
    aliases: [
      'chatgpt', 'chat gpt', 'gpt', 'openai', 'open ai',
      // 产品线：视频/图片/代码
      'sora', 'sora2', 'dall-e', 'dall e', 'dalle', 'gpt image', 'gptimage', 'codex',
    ],
  },
  {
    id: 'claude',
    label: 'Claude',
    aliases: [
      'claude', 'anthropic', '克劳德', 'claude code', 'claudecode',
      // 档位名（Opus / Sonnet / Haiku）在标题里几乎是 Claude 专用
      'opus', 'sonnet', 'haiku',
    ],
  },
  {
    id: 'gemini',
    label: 'Gemini',
    aliases: [
      'gemini', 'google', '谷歌', 'google gemini', '双子座', '双子星',
      // 图片/视频产品线与中文昵称
      'nano banana', 'nanobanana', '纳米香蕉', 'imagen', 'veo', 'lyria',
      // 开源线与研究机构
      'gemma', 'deepmind', 'bard',
    ],
  },
  {
    id: 'qwen',
    label: '通义千问',
    aliases: [
      'qwen', 'qwen chat', 'qwenchat', 'qwq', 'qvq',
      '通义', '千问', '通义千问', '阿里千问', '阿里通义', '通义万相', '万相', '通义灵码', 'alibaba',
    ],
    // wan：万相的开源名，裸词容易撞 want / swan
    strictAliases: ['wan'],
  },
  {
    id: 'kimi',
    label: 'Kimi',
    aliases: [
      'kimi', 'kimi chat', 'kimichat', 'kimi k2', 'kimi k3',
      'moonshot', 'moon shot', '月之暗面', '月暗',
    ],
  },
  {
    id: 'doubao',
    label: '豆包',
    aliases: [
      'doubao', '豆包', '豆包大模型', '豆包视频',
      // 公司名与云平台
      'bytedance', 'byte dance', '字节跳动', 'volcengine', '火山引擎', '火山方舟',
      // 图片/视频生成产品线
      'seedream', 'seedance', 'seededit', 'jimeng', '即梦', 'dreamina',
    ],
    // seed：单独出现多半是英文「种子」，只在独立成词时才算
    strictAliases: ['seed'],
  },
  {
    id: 'hunyuan',
    label: '腾讯混元',
    aliases: [
      'hunyuan', '混元', '腾讯混元', 'tencent', '腾讯',
      '元宝', '腾讯元宝', 'hunyuanvideo', 'hunyuanimage', '混元视频', '混元3d',
    ],
    // 2026 起混元主线模型以 HY3 / HY4 命名，短别名必须卡边界（防 hy30 之类）
    strictAliases: ['hy3', 'hy4'],
  },
  {
    id: 'wenxin',
    label: '文心一言',
    aliases: [
      'wenxin', '文心', '文心一言', '文心大模型', '文心一格', '文心快码',
      'ernie', 'ernie bot', 'erniebot', '百度', 'baidu', '千帆', 'qianfan',
    ],
  },
  {
    id: 'xiaomi',
    label: '小米 MiMo',
    aliases: [
      'xiaomi', '小米', 'mimo', 'mi mo', '小米 mimo', '小米mimo', '小米大模型', 'mimo v2',
    ],
  },
  {
    id: 'z-ai',
    label: '智谱 GLM',
    aliases: [
      'glm', 'chatglm', '智谱', '智谱ai', 'zhipu', 'z.ai', 'zai', '清言', '智谱清言',
      'cogvlm', 'cogview', 'codegeex', 'autoglm', '北京智谱',
    ],
  },
  {
    id: 'minimax',
    label: 'MiniMax',
    aliases: [
      'minimax', 'mini max', '海螺', '海螺ai', 'hailuo', '稀宇', '稀宇科技', 'abab',
      'minimax m1', 'minimax m2', 'minimax m3', '海螺视频',
    ],
  },
  {
    id: 'stepfun',
    label: '阶跃星辰',
    aliases: [
      'stepfun', 'step fun', '阶跃', '阶跃星辰', '跃问', 'nextstep',
      'stepvideo', 'stepaudio',
      // 模型名 Step-1 / 2 / 3 / 3.5 / 5：数字结尾，匹配器自带数字边界（step3 不会命中 step30）
      'step1', 'step2', 'step3', 'step35', 'step5',
    ],
  },
  {
    id: 'spark',
    label: '讯飞星火',
    aliases: [
      '星火', '讯飞', '讯飞星火', '科大讯飞', '星火x1', 'xinghuo', 'iflytek', 'i flytek',
    ],
    strictAliases: ['spark'],
  },
  {
    id: 'mistral',
    label: 'Mistral',
    aliases: [
      'mistral', 'mixtral', 'codestral', 'pixtral', 'devstral', 'magistral', 'voxtral',
      'ministral', 'mathstral', 'lechat', 'le chat', '米斯特拉尔',
    ],
  },
  {
    id: 'meta',
    label: 'Meta Llama',
    aliases: [
      'llama', 'meta llama', 'metallama', '羊驼', '小羊驼', 'meta ai', 'metaai',
    ],
    strictAliases: ['meta'],
  },
  {
    id: 'grok',
    label: 'Grok',
    aliases: ['grok', 'grok imagine', 'grokimage', 'xai', 'x.ai'],
  },
];

/** 只保留字母/数字/汉字，统一小写：所有标点、空格、符号、全角形式在此被抹平 */
export function normalizeKey(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

const ASCII_LETTER = /[a-z]/;
const DIGIT = /[0-9]/;

/**
 * 词边界判定（仅在 strict 别名上启用）：
 * - 左右两侧紧邻英文字母 → 视为更长单词的一部分，拒绝（metadata / sparkling / chatgpt 之于 gpt）；
 * - 别名以数字结尾时，右侧紧邻数字也拒绝（step3 之于 step30）。
 * 汉字与数字相邻不算越界：这样「Meta发布」「Gemini3」之类照常命中。
 */
function boundaryOk(hay: string, index: number, needle: string, strict: boolean): boolean {
  const left = index > 0 ? hay[index - 1] : '';
  const right = index + needle.length < hay.length ? hay[index + needle.length] : '';
  // 数字边界对所有别名生效：step3 不能命中 step30，hy3 不能命中 hy30
  if (DIGIT.test(needle[needle.length - 1]) && right && DIGIT.test(right)) return false;
  if (!strict) return true;
  if (left && ASCII_LETTER.test(left)) return false;
  if (right && ASCII_LETTER.test(right)) return false;
  return true;
}

function findIndex(hay: string, needle: string, strict: boolean): number {
  let from = 0;
  while (from <= hay.length - needle.length) {
    const index = hay.indexOf(needle, from);
    if (index < 0) return -1;
    if (boundaryOk(hay, index, needle, strict)) return index;
    from = index + 1;
  }
  return -1;
}

export interface ModelIconMatch {
  preset: ModelIconPreset;
  /** 命中的原始别名（调试/单测用） */
  alias: string;
  /** 在归一化文本中的位置 */
  index: number;
}

/** 在标题里找最匹配的模型图标；没有命中返回 null */
export function detectModelIconMatch(title: string): ModelIconMatch | null {
  const hay = normalizeKey(title);
  if (!hay) return null;

  let best: { preset: ModelIconPreset; alias: string; index: number; score: number } | null = null;
  for (const preset of MODEL_ICONS) {
    const candidates: { text: string; strict: boolean }[] = [
      ...preset.aliases.map((text) => ({ text, strict: false })),
      ...(preset.strictAliases ?? []).map((text) => ({ text, strict: true })),
    ];
    for (const candidate of candidates) {
      const needle = normalizeKey(candidate.text);
      if (!needle) continue;
      const index = findIndex(hay, needle, candidate.strict);
      if (index < 0) continue;
      const score = needle.length;
      if (
        !best ||
        score > best.score ||
        (score === best.score && index < best.index)
      ) {
        best = { preset, alias: candidate.text, index, score };
      }
    }
  }
  return best ? { preset: best.preset, alias: best.alias, index: best.index } : null;
}

/** 便捷版：只关心命中了哪个图标 */
export function detectModelIcon(title: string): ModelIconPreset | null {
  return detectModelIconMatch(title)?.preset ?? null;
}

/**
 * 是否应该（重新）自动填充图标：
 * - 用户手动上传过（manual）或手动移除过（off）→ 永不自动改；
 * - 没有图 → 命中就填；
 * - 已有「自动图」且标题换成了另一家 → 换成新图；
 * - 老数据有图但没有模式标记 → 视为手动，不动（保守，避免覆盖历史人工设置）。
 */
export function decideAutoIcon(slot: IconSlotState, title: string): ModelIconPreset | null {
  const text = title.trim();
  if (!text) return null;
  if (slot.iconMode === 'manual' || slot.iconMode === 'off') return null;
  const preset = detectModelIcon(text);
  if (!preset) return null;
  if (!slot.icon) return preset;
  if (slot.iconMode === 'auto' && slot.iconPreset !== preset.id) return preset;
  return null;
}

/** 按 id 找图标（id 同时是图库文件名） */
export function presetById(id: string | undefined | null): ModelIconPreset | null {
  if (!id) return null;
  return MODEL_ICONS.find((preset) => preset.id === id) ?? null;
}

/** 自动填充的图标文件以「[id].png」作为 originalName，据此反查展示名 */
export function presetForIconFile(originalName: string | undefined | null): ModelIconPreset | null {
  if (!originalName) return null;
  const match = /^([a-z0-9-]+)\.png$/i.exec(originalName);
  return match ? presetById(match[1]) : null;
}
