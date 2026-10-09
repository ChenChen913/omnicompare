/**
 * settings 字段规格表：v1/v2 settings 路由、存储归一化共用的唯一判据。
 *
 * 此前同一批字段的校验散落在四处手写（projects/[id]/settings、videos/settings、
 * project-store.normalizeSettings、video-store.normalizeManifestSettings），
 * 新增字段要同步改四份，且已出现语义分叉（同一字段越界时读路径回落默认、
 * v1 写回路径钳制到边界、个别字段非法时一个回落一个保持原值）。
 * 本模块把每个字段的判据收敛为一行规格，三种消费模式全部由规格表驱动：
 *
 * - parseSettingsPatch（strict）   路由 PATCH 校验：非法值直接给出 400 错误消息
 * - normalizeSettingsFields（lenient）            磁盘清单读路径：非法回落默认，越界数值钳制到边界
 * - normalizeSettingsFieldsPartial（lenient-partial） v1 视图写回路径：仅处理携带的字段，
 *   未携带的不在输出中（调用方浅合并后保持项目原值），非法值回落默认
 *
 * 纯模块（不含任何 Node/浏览器 API），前后端均可导入。
 */
import {
  ASPECT_RATIOS,
  BYLINE_MAX,
  CUSTOM_RATIO_MAX,
  LETTERBOX_FILLS,
  PLAYBACK_RATES,
  ProjectSettings,
  PROMPT_MAX,
  SCALE_STEPS,
  TITLE_ALIGNS,
  TITLE_FONT_MAX,
  TITLE_FONT_MIN,
  TITLE_POSITIONS,
  TITLE_WEIGHT_LEGACY,
  TITLE_WEIGHT_MAX,
  TITLE_WEIGHT_MIN,
  TITLE_WEIGHT_STEP,
  WATERMARK_COLORS,
  WATERMARK_FAMILIES,
  WATERMARK_FONT_MAX,
  WATERMARK_FONT_MIN,
  WATERMARK_MAX,
  WATERMARK_OPACITY_MAX,
  WATERMARK_OPACITY_MIN,
  WATERMARK_SPEEDS,
  defaultSettings,
  parseCustomRatio,
} from './types';

/* ============================== 字段规格 ============================== */

/** 标题颜色合法值：'default' 哨兵 + 色板白名单（与 parseTitleColor 同源） */
const TITLE_COLOR_VALUES = [
  'default',
  '#ffffff', '#000000', '#facc15', '#f87171', '#fb923c',
  '#4ade80', '#22d3ee', '#a78bfa', '#f472b6',
] as const;

type FieldSpec =
  | { key: keyof ProjectSettings; label: string; kind: 'bool' }
  | { key: keyof ProjectSettings; label: string; kind: 'enum'; values: readonly string[] }
  | { key: keyof ProjectSettings; label: string; kind: 'numEnum'; values: readonly number[] }
  | {
      key: keyof ProjectSettings;
      label: string;
      kind: 'numRange';
      min: number;
      max: number;
      /** 落库前取整（音量/字号/不透明度等整数语义字段） */
      round?: boolean;
    }
  | { key: keyof ProjectSettings; label: string; kind: 'scale' }
  | { key: keyof ProjectSettings; label: string; kind: 'strTrunc'; maxLen: number }
  | {
      /** 字重数值范围（100-900 步进 100）：接受旧枚举字符串（normal/medium/bold）并迁移为对应数值 */
      key: keyof ProjectSettings;
      label: string;
      kind: 'weightRange';
      min: number;
      max: number;
      step: number;
      legacyMap: Readonly<Record<string, number>>;
    };

type NumRangeSpec = Extract<FieldSpec, { kind: 'numRange' }>;
type ScaleSpec = Extract<FieldSpec, { kind: 'scale' }>;

/**
 * 全部可 PATCH 字段规格。bgm 文件元数据除外——仅由 /api/videos/bgm 路由变更，
 * 不属于校验漂移点。defaultSettings() 是默认值与回落值的唯一来源，
 * 规格表只描述"什么是合法值"。
 */
const SPECS: readonly FieldSpec[] = [
  { key: 'aspectRatio', label: '比例', kind: 'enum', values: ASPECT_RATIOS },
  { key: 'showTitles', label: '标题显隐', kind: 'bool' },
  { key: 'showInfo', label: '属性信息显隐', kind: 'bool' },
  { key: 'showIndex', label: '编号显隐', kind: 'bool' },
  { key: 'loop', label: '循环开关', kind: 'bool' },
  { key: 'muted', label: '静音开关', kind: 'bool' },
  { key: 'playbackRate', label: '播放速度', kind: 'numEnum', values: PLAYBACK_RATES },
  { key: 'letterboxFill', label: '留白填充', kind: 'enum', values: LETTERBOX_FILLS },
  { key: 'wallScale', label: '整体大小', kind: 'scale' },
  { key: 'htmlScale', label: '页面缩放', kind: 'scale' },
  { key: 'autoFit', label: '自动适配', kind: 'bool' },
  { key: 'titleAlign', label: '标题对齐', kind: 'enum', values: TITLE_ALIGNS },
  { key: 'titleFontSize', label: '标题字号', kind: 'numRange', min: TITLE_FONT_MIN, max: TITLE_FONT_MAX },
  { key: 'titlePosition', label: '标题位置', kind: 'enum', values: TITLE_POSITIONS },
  {
    key: 'titleWeight',
    label: '标题字重',
    kind: 'weightRange',
    min: TITLE_WEIGHT_MIN,
    max: TITLE_WEIGHT_MAX,
    step: TITLE_WEIGHT_STEP,
    legacyMap: TITLE_WEIGHT_LEGACY,
  },
  { key: 'titleColor', label: '标题颜色', kind: 'enum', values: TITLE_COLOR_VALUES },
  { key: 'bgmVolume', label: '背景音乐音量', kind: 'numRange', min: 0, max: 100, round: true },
  { key: 'promptText', label: '提示词', kind: 'strTrunc', maxLen: PROMPT_MAX },
  { key: 'showPrompt', label: '提示词显隐', kind: 'bool' },
  { key: 'bylineText', label: '署名', kind: 'strTrunc', maxLen: BYLINE_MAX },
  { key: 'showByline', label: '署名显隐', kind: 'bool' },
  { key: 'showWatermark', label: '水印显隐', kind: 'bool' },
  { key: 'watermarkText', label: '水印文字', kind: 'strTrunc', maxLen: WATERMARK_MAX },
  { key: 'watermarkFontSize', label: '水印字号', kind: 'numRange', min: WATERMARK_FONT_MIN, max: WATERMARK_FONT_MAX, round: true },
  { key: 'watermarkFontFamily', label: '水印字体形式', kind: 'enum', values: WATERMARK_FAMILIES },
  { key: 'watermarkColor', label: '水印颜色', kind: 'enum', values: WATERMARK_COLORS },
  { key: 'watermarkSpeed', label: '水印巡游速度', kind: 'enum', values: WATERMARK_SPEEDS },
  { key: 'lockControls', label: '锁定控件', kind: 'bool' },
  { key: 'watermarkFontWeight', label: '水印字重', kind: 'enum', values: ['normal', 'bold'] },
  { key: 'watermarkOpacity', label: '水印不透明度', kind: 'numRange', min: WATERMARK_OPACITY_MIN, max: WATERMARK_OPACITY_MAX, round: true },
];

/* ============================== 单字段判据 ============================== */

type StrictResult = { ok: true; value: unknown } | { ok: false; error: string };
type LenientResult = { ok: true; value: unknown } | { ok: false };

/**
 * strict 判据（路由 PATCH）：非法值直接给出 400 错误消息。
 * 行为对齐收口前的两套路由：bool 必须 typeof boolean；enum 必须 string 且在白名单；
 * numEnum 必须 number 且在白名单；numRange/scale 接受 number 或可转数字的字符串
 * （'50' 兼容旧客户端），但 null/true/'' 等经 Number() 会静默变 0/1/0 的怪值一律
 * 拒绝（收口前两版共有的宽松点，一并收紧）；strTrunc 必须字符串（截断到上限）。
 */
function checkStrict(spec: FieldSpec, raw: unknown): StrictResult {
  switch (spec.kind) {
    case 'bool':
      if (typeof raw !== 'boolean') return { ok: false, error: `${spec.label}需为布尔值` };
      return { ok: true, value: raw };
    case 'enum':
      if (typeof raw !== 'string' || !spec.values.includes(raw)) {
        return { ok: false, error: `${spec.label}取值需为 ${spec.values.join(' / ')}` };
      }
      return { ok: true, value: raw };
    case 'numEnum':
      if (typeof raw !== 'number' || !spec.values.includes(raw)) {
        return { ok: false, error: `${spec.label}仅支持 ${spec.values.join(' / ')}` };
      }
      return { ok: true, value: raw };
    case 'numRange':
    case 'scale': {
      if (typeof raw !== 'number' && typeof raw !== 'string') {
        return numStrictError(spec);
      }
      if (typeof raw === 'string' && raw.trim() === '') {
        return numStrictError(spec);
      }
      const v = Number(raw);
      if (spec.kind === 'scale') {
        if (!Number.isFinite(v) || !(SCALE_STEPS as readonly number[]).includes(v)) {
          return { ok: false, error: `${spec.label}需为 ${SCALE_STEPS.join(' / ')} 之一` };
        }
        return { ok: true, value: v };
      }
      if (!Number.isFinite(v) || v < spec.min || v > spec.max) {
        return numStrictError(spec);
      }
      return { ok: true, value: spec.round ? Math.round(v) : v };
    }
    case 'strTrunc':
      if (typeof raw !== 'string') return { ok: false, error: `${spec.label}需为字符串` };
      return { ok: true, value: raw.slice(0, spec.maxLen) };
    case 'weightRange': {
      // 旧枚举字符串（normal/medium/bold）→ 迁移为对应数值，兼容存量客户端
      const legacy = typeof raw === 'string' ? spec.legacyMap[raw] : undefined;
      if (legacy !== undefined) return { ok: true, value: legacy };
      const v = Number(raw);
      if (typeof raw !== 'number' && typeof raw !== 'string') {
        return { ok: false, error: `${spec.label}需为 ${spec.min}-${spec.max} 之间的字重值` };
      }
      if (!Number.isFinite(v) || v < spec.min || v > spec.max) {
        return { ok: false, error: `${spec.label}需为 ${spec.min}-${spec.max} 之间的字重值` };
      }
      // 吸附到步进档（如 750→800）：合法字体重量恒为 100 的整数倍
      return { ok: true, value: Math.round(v / spec.step) * spec.step };
    }
  }
}

function numStrictError(spec: NumRangeSpec | ScaleSpec): { ok: false; error: string } {
  if (spec.kind === 'scale') {
    return { ok: false, error: `${spec.label}需为 ${SCALE_STEPS.join(' / ')} 之一` };
  }
  return { ok: false, error: `${spec.label}需为 ${spec.min}-${spec.max} 之间的数字` };
}

/**
 * lenient 判据（磁盘归一化 / v1 视图写回）：非法值一律视为"未提供"，
 * 由调用方回落默认或保持原值；数值越界统一钳制到边界（保留用户意图的近似值，
 * 与收口前 v1 写回路径对水印字号/不透明度的处理一致；收口前读路径对这些字段
 * 回落默认，属无意识的实现分叉，收口后统一为钳制）。
 */
function checkLenient(spec: FieldSpec, raw: unknown): LenientResult {
  switch (spec.kind) {
    case 'bool':
      return typeof raw === 'boolean' ? { ok: true, value: raw } : { ok: false };
    case 'enum':
      return typeof raw === 'string' && spec.values.includes(raw)
        ? { ok: true, value: raw }
        : { ok: false };
    case 'numEnum': {
      const v = Number(raw);
      return Number.isFinite(v) && spec.values.includes(v) ? { ok: true, value: v } : { ok: false };
    }
    case 'numRange': {
      const v = Number(raw);
      if (!Number.isFinite(v)) return { ok: false };
      const clamped = Math.min(spec.max, Math.max(spec.min, v));
      return { ok: true, value: spec.round ? Math.round(clamped) : clamped };
    }
    case 'scale': {
      const v = Number(raw);
      return Number.isFinite(v) && (SCALE_STEPS as readonly number[]).includes(v)
        ? { ok: true, value: v }
        : { ok: false };
    }
    case 'strTrunc':
      return typeof raw === 'string'
        ? { ok: true, value: raw.slice(0, spec.maxLen) }
        : { ok: false };
    case 'weightRange': {
      // 存量清单读到旧枚举字符串 → 迁移为数值；越界钳到边界；非 100 倍数吸附到档位
      const legacy = typeof raw === 'string' ? spec.legacyMap[raw] : undefined;
      if (legacy !== undefined) return { ok: true, value: legacy };
      const v = Number(raw);
      if (!Number.isFinite(v)) return { ok: false };
      const clamped = Math.min(spec.max, Math.max(spec.min, v));
      return { ok: true, value: Math.round(clamped / spec.step) * spec.step };
    }
  }
}

/* ============================== 对外接口 ============================== */

export interface SettingsPatchResult {
  /** 已通过校验的字段集合（可直接浅合并进现有 settings） */
  patch: Partial<ProjectSettings>;
  /** customRatio=null 的"显式清除"标记（undefined 与"清除"在 patch 中无法区分） */
  clearCustomRatio: boolean;
}

/**
 * 路由 PATCH body → 严格校验的 settings 补丁。
 * 只处理 body 中出现的字段，首个非法字段立即报错；
 * 未携带任何已知字段时返回错误（空 patch 不产生写盘）。
 */
export function parseSettingsPatch(
  body: Record<string, unknown>,
): SettingsPatchResult | { error: string } {
  const patch: Partial<ProjectSettings> = {};
  let clearCustomRatio = false;

  for (const spec of SPECS) {
    if (body[spec.key] === undefined) continue;
    const r = checkStrict(spec, body[spec.key]);
    if (!r.ok) return { error: r.error };
    (patch as Record<string, unknown>)[spec.key] = r.value;
  }

  // customRatio：null = 显式清除；对象 = parseCustomRatio 校验；未携带 = 不动
  if (body.customRatio !== undefined) {
    if (body.customRatio === null) {
      clearCustomRatio = true;
    } else {
      const parsed = parseCustomRatio(body.customRatio);
      if (!parsed) {
        return { error: `自定义比例需为 0-${CUSTOM_RATIO_MAX} 之间的正数宽高` };
      }
      patch.customRatio = parsed;
    }
  }

  if (Object.keys(patch).length === 0 && !clearCustomRatio) {
    return { error: '至少提供一个待更新字段' };
  }
  return { patch, clearCustomRatio };
}

/**
 * 磁盘清单 settings → 全量归一化（读路径）。
 * 任何字段缺失/非法回落默认值；customRatio 合法对象才携带。
 * bgm 文件元数据由调用方另行处理（不是 PATCH 可写字段，规格表不涉及）。
 */
export function normalizeSettingsFields(raw: unknown): Omit<ProjectSettings, 'bgm'> {
  const base = defaultSettings() as unknown as Record<string, unknown>;
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out: Record<string, unknown> = {};
  for (const spec of SPECS) {
    const result = checkLenient(spec, r[spec.key]);
    out[spec.key] = result.ok ? result.value : base[spec.key];
  }
  const parsed = parseCustomRatio(r.customRatio);
  if (parsed) out.customRatio = parsed;
  return out as Omit<ProjectSettings, 'bgm'>;
}

/**
 * v1 视图 settings → 部分归一化（写回路径）。
 * 仅处理携带的字段（undefined = 未携带），非法值回落默认；
 * 未携带字段不在输出中，调用方浅合并后保持项目原值。
 * customRatio=null 输出 undefined 占位（调用方删键）；bgm 不在受理范围。
 *
 * 与收口前实现的声明性差异：旧版对 ManifestSettings 的 7 个非可选字段
 * （aspectRatio/showTitles/showInfo/loop/muted/playbackRate/letterboxFill）
 * 无条件处理（缺失 → 重置默认）；本版统一为「缺失 → 保持原值」——
 * 保持原值比重置默认更安全（不丢用户设置），且当前全部调用方
 * （writeManifest）只接收 readManifest 的全字段视图，行为不可见。
 */
export function normalizeSettingsFieldsPartial(
  s: Record<string, unknown>,
): Partial<ProjectSettings> {
  const base = defaultSettings() as unknown as Record<string, unknown>;
  const out: Partial<ProjectSettings> = {};
  for (const spec of SPECS) {
    if (s[spec.key] === undefined) continue;
    const result = checkLenient(spec, s[spec.key]);
    (out as Record<string, unknown>)[spec.key] = result.ok ? result.value : base[spec.key];
  }
  if (s.customRatio === null) out.customRatio = undefined;
  else if (s.customRatio !== undefined) {
    const parsed = parseCustomRatio(s.customRatio);
    if (parsed) out.customRatio = parsed;
  }
  return out;
}
