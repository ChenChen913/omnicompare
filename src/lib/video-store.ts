/**
 * v1 兼容门面：视频墙旧 API（/api/videos*）仍以 slot 位置语义工作，
 * 内部全部委托 schema v2 的 project-store（默认项目）。
 *
 * v1 语义映射（v1 slot i ↔ v2 order i，items 恒为紧凑 0..n-1）：
 * - GET slots[i]        → items[i]（越界即空位）
 * - 上传到 slot i       → i < items.length 替换 items[i]；否则追加到末尾
 * - 删除 slot i         → 删除 items[i]，其后条目前移（紧凑序，不再留空洞）
 * - 缩减 count          → order >= count 的条目连同文件删除
 */
import { randomUUID } from 'crypto';
import {
  ASPECT_RATIOS,
  BYLINE_MAX,
  ContentItem,
  ContentKind,
  DEFAULT_PROJECT_ID,
  FileMeta,
  Layout,
  Manifest,
  ManifestSettings,
  PLAYBACK_RATES,
  ProjectSettings,
  PROMPT_MAX,
  Slot,
  SLOT_MAX,
  TITLE_ALIGNS,
  TITLE_POSITIONS,
  TITLE_WEIGHTS,
  LETTERBOX_FILLS,
  WATERMARK_FAMILIES,
  WATERMARK_COLORS,
  WATERMARK_FONT_MAX,
  WATERMARK_FONT_MIN,
  WATERMARK_MAX,
  WATERMARK_OPACITY_MAX,
  WATERMARK_OPACITY_MIN,
  WATERMARK_SPEEDS,
  WatermarkColor,
  WatermarkFamily,
  WatermarkSpeed,
  autoLayoutFor,
  defaultSettings,
  parseCustomRatio,
  parseScaleOption,
  parseTitleColor,
  parseTitleFontSize,
} from './types';
import {
  deleteFile,
  ensureDefaultProject,
  readProject,
  reindexItems,
  saveFile,
  toSlots,
  withProjectLock,
  writeProject,
} from './project-store';

export { isValidLayout, isSafeFilename, projectExists, validateUploadFile } from './project-store';

/**
 * 清单「读-改-写」互斥锁：单进程内将临界区串行化，
 * 防止并发请求互相覆盖（lost update）产生丢失的清单条目与磁盘孤儿文件。
 * Step 8 起按项目维度加锁（projectId 由路由层解析后传入）。
 */
export function withManifestLock<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
  return withProjectLock(projectId, fn);
}

/** 读取项目的 v1 视图清单（缺省为默认项目，兼容旧调用） */
export async function readManifest(projectId: string = DEFAULT_PROJECT_ID): Promise<Manifest> {
  await ensureDefaultProject();
  const project = await readProject(projectId);
  // v2 layout='auto' → 视图返回按 slotCount 计算的近方形矩阵 + layoutMode 标记；
  // 旧客户端忽略 layoutMode 字段，拿到的是仍然有效的显式矩阵（向后兼容）
  const st = project.settings;
  return {
    count: project.slotCount,
    layout:
      project.layout === 'auto' ? autoLayoutFor(project.slotCount) : project.layout,
    layoutMode: project.layout === 'auto' ? 'auto' : 'manual',
    slots: toSlots(project),
    settings: {
      aspectRatio: st.aspectRatio,
      customRatio: st.customRatio,
      showTitles: st.showTitles,
      showInfo: st.showInfo,
      // 位置编号显隐：视图携带才能在 PATCH 响应中回显
      showIndex: st.showIndex,
      loop: st.loop,
      muted: st.muted,
      playbackRate: st.playbackRate,
      letterboxFill: st.letterboxFill,
      // 缩放档位（整墙/网页页面）：视图携带才能在 PATCH 响应中回显
      wallScale: st.wallScale,
      htmlScale: st.htmlScale,
      // 自动适配视口：视图携带才能在 PATCH 响应中回显
      autoFit: st.autoFit,
      // 标题格式（全局同步）：视图携带才能在 PATCH 响应中回显
      titleAlign: st.titleAlign,
      titleFontSize: st.titleFontSize,
      titlePosition: st.titlePosition,
      titleWeight: st.titleWeight,
      titleColor: st.titleColor,
      // 背景音乐（文件元数据 + 音量）：视图携带才能在客户端回显与播放
      bgm: st.bgm,
      bgmVolume: st.bgmVolume,
      // 提示词与署名（文本 + 显隐）：视图携带才能在 PATCH 响应中回显
      promptText: st.promptText,
      showPrompt: st.showPrompt,
      bylineText: st.bylineText,
      showByline: st.showByline,
      // 水印（显隐 + 外观全量）：视图携带才能在客户端回显
      showWatermark: st.showWatermark,
      watermarkText: st.watermarkText,
      watermarkFontSize: st.watermarkFontSize,
      watermarkFontFamily: st.watermarkFontFamily,
      watermarkColor: st.watermarkColor,
      watermarkSpeed: st.watermarkSpeed,
      watermarkFontWeight: st.watermarkFontWeight,
      watermarkOpacity: st.watermarkOpacity,
    },
  };
}

/**
 * 写清单：body 为 v1 视图（readManifest 的产物），按 slots 差量写回 items。
 * Step 5 起视图携带 kind/html 扩展字段，HTML 条目在 v1 写路径中原样保留；
 * 兼容未携带扩展字段的旧客户端（仅有 video 字段的槽位照常落为视频条目）。
 *
 * `allowTruncate`（默认 false）声明"本次写入的语义就是减少内容"：
 * - false（绝大多数写路径）：v1 视图只能寻址前 `count` 个位置，范围外的条目
 *   （历史 v2 写入或手改清单遗留）一律**保留**，绝不因为"视图里看不见"就当作已删除
 *   清理掉 —— 静默删用户文件比留下不可见条目严重得多；
 * - true（缩减窗格数 / 清空全部）：范围外条目确实要被移除，文件由下方集中清理删除。
 */
export async function writeManifest(
  manifest: Manifest,
  projectId: string = DEFAULT_PROJECT_ID,
  options: { allowTruncate?: boolean } = {},
): Promise<void> {
  const project = await readProject(projectId);
  const previousItems = project.items;
  const previousFiles = new Set(previousItems.map((it) => it.file.filename));

  project.slotCount = manifest.count;
  // Step 6 起 v1 视图支持 auto 模式：layoutMode='auto' 时存 'auto'，
  // 矩阵由读取方按 slotCount 现算；manual 时存显式行列（原行为）
  project.layout = manifest.layoutMode === 'auto' ? 'auto' : manifest.layout;
  // Step 7：视图携带设置时写回（仅接受合法值，防御旧/异常客户端）
  if (manifest.settings) {
    const patch = normalizeManifestSettings(manifest.settings);
    project.settings = { ...project.settings, ...patch };
    // 显式清除自定义比例时删掉键，避免留下 undefined 占位
    if ('customRatio' in patch && patch.customRatio === undefined) {
      delete project.settings.customRatio;
    }
  }

  const now = new Date().toISOString();
  const items: ContentItem[] = [];
  manifest.slots.forEach((slot: Slot, order: number) => {
    const existing = project.items[order];
    const base = {
      id: existing?.id ?? randomUUID(),
      title: slot.title,
      order,
      aspectRatio: slot.aspectRatio !== undefined ? slot.aspectRatio ?? null : existing?.aspectRatio ?? null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    if (slot.kind === 'html' && slot.html) {
      // HTML 条目：保留原有加载状态（status 由客户端渲染时本地流转）；
      // Step B：bundle 标志优先取视图，缺失时沿用已有条目的标志（防旧客户端丢失标志导致包目录失联）
      const bundle = slot.bundle === true || (existing && existing.kind === 'html' && existing.bundle === true);
      items.push({
        ...base,
        kind: 'html',
        file: slot.html,
        status: existing && existing.kind === 'html' ? existing.status : 'ready',
        ...(bundle ? { bundle: true } : {}),
      });
    } else if (slot.kind === 'image' && slot.image) {
      // 图片条目（第二阶段 Step A）：与视频同为静态文件，无播放语义
      items.push({ ...base, kind: 'image', file: slot.image });
    } else if (slot.video && slot.kind !== 'html') {
      items.push({ ...base, kind: 'video', file: slot.video });
    }
    // 其余（video 与 html 均为空）= 空位：不生成条目，紧凑序由下方重排保证
  });
  project.items = items
    // 紧凑序不变量：删除/替换后重排为 0..n-1（空洞在写入时即消除，蓝图 §19.4）
    .map((it, i) => (it.order === i ? it : { ...it, order: i }));

  // 视图寻址范围外的条目：默认保留（见函数头说明），只有显式 allowTruncate 才随之下线
  if (!options.allowTruncate) {
    const visibleIds = new Set(project.items.map((it) => it.id));
    const preserved = previousItems.filter(
      (it) => it.order >= manifest.count && !visibleIds.has(it.id),
    );
    if (preserved.length > 0) {
      project.items = reindexItems([...project.items, ...preserved]);
      project.slotCount = Math.max(project.slotCount, Math.min(project.items.length, SLOT_MAX));
    }
  }

  // 集中式孤儿清理：被移除/被替换条目的文件统一在此删除（含 v1 视图 video=null 看不见的
  // HTML 文件），保证任意 v1 写路径（上传替换/删除/清空/缩容/改标题）后清单与磁盘 1:1
  const keptFiles = new Set(project.items.map((it) => it.file.filename));
  const removed = [...previousFiles].filter((f) => !keptFiles.has(f));

  project.updatedAt = now;
  await writeProject(project);

  // 清单落盘后再删文件（与 v2 端点同序）：即便删除失败也不产生死链
  if (removed.length > 0) {
    await Promise.all(removed.map((f) => deleteFile(projectId, f)));
  }
}

/**
 * v1 视图设置 -> ProjectSettings 字段校验：仅接受合法值，其余回落默认值。
 * 返回 Partial：未携带的字段（如旧客户端的 customRatio）保持项目原值不动。
 */
function normalizeManifestSettings(s: ManifestSettings): Partial<ProjectSettings> {
  const base = defaultSettings();
  const out: Partial<ProjectSettings> = {
    aspectRatio: (ASPECT_RATIOS as readonly string[]).includes(s.aspectRatio)
      ? s.aspectRatio
      : base.aspectRatio,
    showTitles: typeof s.showTitles === 'boolean' ? s.showTitles : base.showTitles,
    showInfo: typeof s.showInfo === 'boolean' ? s.showInfo : base.showInfo,
    loop: typeof s.loop === 'boolean' ? s.loop : base.loop,
    muted: typeof s.muted === 'boolean' ? s.muted : base.muted,
    playbackRate:
      typeof s.playbackRate === 'number' &&
      (PLAYBACK_RATES as readonly number[]).includes(s.playbackRate)
        ? s.playbackRate
        : base.playbackRate,
    letterboxFill: (LETTERBOX_FILLS as readonly string[]).includes(s.letterboxFill)
      ? s.letterboxFill
      : base.letterboxFill,
  };
  // customRatio：null = 显式清除；合法对象 = 写入；未携带/非法 = 保持原值
  if (s.customRatio === null) out.customRatio = undefined;
  else if (s.customRatio !== undefined) {
    const parsed = parseCustomRatio(s.customRatio);
    if (parsed) out.customRatio = parsed;
  }
  // 标题格式（全局同步）：旧客户端不携带时保持原值；携带非法值时回落默认
  if (s.titleAlign !== undefined) {
    out.titleAlign = (TITLE_ALIGNS as readonly string[]).includes(s.titleAlign)
      ? s.titleAlign
      : base.titleAlign;
  }
  if (s.titleFontSize !== undefined) {
    const size = parseTitleFontSize(s.titleFontSize);
    if (size !== null) out.titleFontSize = size;
  }
  if (s.titlePosition !== undefined) {
    out.titlePosition = (TITLE_POSITIONS as readonly string[]).includes(s.titlePosition)
      ? s.titlePosition
      : base.titlePosition;
  }
  if (s.titleWeight !== undefined) {
    out.titleWeight = (TITLE_WEIGHTS as readonly string[]).includes(s.titleWeight)
      ? s.titleWeight
      : base.titleWeight;
  }
  if (s.titleColor !== undefined) {
    const color = parseTitleColor(s.titleColor);
    if (color !== null) out.titleColor = color;
  }
  if (s.wallScale !== undefined) {
    // 缩放档位（整墙/网页页面）：旧客户端不携带时保持原值；携带非法值时回落默认
    const scale = parseScaleOption(s.wallScale);
    if (scale !== null) out.wallScale = scale;
  }
  if (s.htmlScale !== undefined) {
    const scale = parseScaleOption(s.htmlScale);
    if (scale !== null) out.htmlScale = scale;
  }
  if (s.autoFit !== undefined) {
    // 自动适配视口：旧客户端不携带时保持原值；携带非法值时回落默认
    if (typeof s.autoFit === 'boolean') out.autoFit = s.autoFit;
    else out.autoFit = base.autoFit;
  }
  if (s.showIndex !== undefined) {
    // 位置编号显隐：旧客户端不携带时保持原值；携带非法值时回落默认（显示）
    if (typeof s.showIndex === 'boolean') out.showIndex = s.showIndex;
    else out.showIndex = base.showIndex;
  }
  if (s.bgmVolume !== undefined) {
    // 背景音乐音量：旧客户端不携带时保持原值；携带非法值时回落默认（100）
    const v = Number(s.bgmVolume);
    if (Number.isFinite(v) && v >= 0 && v <= 100) out.bgmVolume = Math.round(v);
    else out.bgmVolume = base.bgmVolume;
  }
  if (s.promptText !== undefined) {
    // 提示词文本：旧客户端不携带时保持原值；携带时截断到上限
    out.promptText = typeof s.promptText === 'string' ? s.promptText.slice(0, PROMPT_MAX) : base.promptText;
  }
  if (s.showPrompt !== undefined) {
    // 提示词框显隐：旧客户端不携带时保持原值；携带非法值时回落默认（隐藏）
    if (typeof s.showPrompt === 'boolean') out.showPrompt = s.showPrompt;
    else out.showPrompt = base.showPrompt;
  }
  if (s.bylineText !== undefined) {
    // 署名文本：旧客户端不携带时保持原值；携带时截断到上限
    out.bylineText = typeof s.bylineText === 'string' ? s.bylineText.slice(0, BYLINE_MAX) : base.bylineText;
  }
  if (s.showByline !== undefined) {
    // 署名行显隐：旧客户端不携带时保持原值；携带非法值时回落默认（隐藏）
    if (typeof s.showByline === 'boolean') out.showByline = s.showByline;
    else out.showByline = base.showByline;
  }
  if (s.showWatermark !== undefined) {
    // 水印显隐：旧客户端不携带时保持原值；携带非法值时回落默认（隐藏）
    if (typeof s.showWatermark === 'boolean') out.showWatermark = s.showWatermark;
    else out.showWatermark = base.showWatermark;
  }
  if (s.watermarkText !== undefined) {
    // 水印文字：旧客户端不携带时保持原值；携带时截断到上限
    out.watermarkText =
      typeof s.watermarkText === 'string' ? s.watermarkText.slice(0, WATERMARK_MAX) : base.watermarkText;
  }
  if (s.watermarkFontSize !== undefined) {
    // 水印字号：越界钳制到 24-160，非法回落默认
    const v = Number(s.watermarkFontSize);
    if (Number.isFinite(v)) {
      out.watermarkFontSize = Math.min(WATERMARK_FONT_MAX, Math.max(WATERMARK_FONT_MIN, Math.round(v)));
    } else out.watermarkFontSize = base.watermarkFontSize;
  }
  if (s.watermarkFontFamily !== undefined) {
    // 水印字体形式：枚举校验，非法回落默认
    out.watermarkFontFamily = WATERMARK_FAMILIES.includes(s.watermarkFontFamily as WatermarkFamily)
      ? (s.watermarkFontFamily as WatermarkFamily)
      : base.watermarkFontFamily;
  }
  if (s.watermarkColor !== undefined) {
    // 水印颜色深浅：枚举校验，非法回落默认
    out.watermarkColor = WATERMARK_COLORS.includes(s.watermarkColor as WatermarkColor)
      ? (s.watermarkColor as WatermarkColor)
      : base.watermarkColor;
  }
  if (s.watermarkSpeed !== undefined) {
    // 水印巡游速度：枚举校验，非法回落默认
    out.watermarkSpeed = WATERMARK_SPEEDS.includes(s.watermarkSpeed as WatermarkSpeed)
      ? (s.watermarkSpeed as WatermarkSpeed)
      : base.watermarkSpeed;
  }
  if (s.watermarkFontWeight !== undefined) {
    // 水印字重：枚举校验，非法回落默认
    if (s.watermarkFontWeight === 'normal' || s.watermarkFontWeight === 'bold') {
      out.watermarkFontWeight = s.watermarkFontWeight;
    } else out.watermarkFontWeight = base.watermarkFontWeight;
  }
  if (s.watermarkOpacity !== undefined) {
    // 水印不透明度：越界钳制到 5-80，非法回落默认
    const v = Number(s.watermarkOpacity);
    if (Number.isFinite(v)) {
      out.watermarkOpacity = Math.min(WATERMARK_OPACITY_MAX, Math.max(WATERMARK_OPACITY_MIN, Math.round(v)));
    } else out.watermarkOpacity = base.watermarkOpacity;
  }
  // 注意：s.bgm（背景音乐文件）不在 v1 清单写路径受理范围 —— 文件与设置必须在
  // 同一临界区由 /api/videos/bgm 路由变更（先删旧文件再写清单），此处静默忽略，
  // 经 {...project.settings, ...patch} 合并后原值保留，不会被旧客户端回显清掉
  return out;
}

/**
 * 调整视频个数与矩阵：
 * - 扩容时末尾补空位；缩减时返回被移除位置上的文件名列表（由调用方删除文件）
 */
export function applyCountAndLayout(
  manifest: Manifest,
  count: number,
  layout: Layout,
): { manifest: Manifest; removedFilenames: string[] } {
  const removedFilenames: string[] = [];
  const nextSlots = manifest.slots.slice(0, count).map((s) => s);
  for (let i = count; i < manifest.slots.length; i++) {
    const old = manifest.slots[i];
    if (old?.video) removedFilenames.push(old.video.filename);
    else if (old?.html) removedFilenames.push(old.html.filename);
    else if (old?.image) removedFilenames.push(old.image.filename);
  }
  while (nextSlots.length < count) {
    nextSlots.push({ index: nextSlots.length, title: '', video: null, html: null });
  }
  return {
    manifest: { count, layout, slots: nextSlots.map((s, i) => ({ ...s, index: i })) },
    removedFilenames,
  };
}

/** 保存上传的内容文件（视频或 HTML，写入目标项目 files/ 目录；缺省为默认项目），返回其元数据 */
export async function saveContentFile(
  file: File,
  kind: ContentKind,
  projectId: string = DEFAULT_PROJECT_ID,
): Promise<FileMeta> {
  return saveFile(projectId, file, kind);
}

/** 删除指定项目中的内容文件（忽略不存在的情况；缺省为默认项目） */
export async function deleteVideoFile(filename: string, projectId: string = DEFAULT_PROJECT_ID): Promise<void> {
  return deleteFile(projectId, filename);
}
