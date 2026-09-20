/**
 * schema v2 存储核心：data/projects/[id]/manifest.json + data/projects/[id]/files/
 *
 * 关键不变量（延续 v1 教训，见 PROJECT.md）：
 * - 所有读-改-写临界区必须包 withProjectLock（按 projectId 维度互斥）
 * - 清单写入一律走原子写（临时文件 + rename）
 * - items.order 恒为 0..n-1 紧凑无空洞，任何增删后由 reindexItems 保证
 * - 删文件与清单变更同临界区完成，杜绝磁盘孤儿文件
 * - v1→v2 迁移一次性、幂等：以 data/projects/default/manifest.json 是否存在为判据
 */
import { promises as fsp } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { Unzip, UnzipInflate } from 'fflate';
import {
  BUNDLE_ASSET_EXTS,
  BUNDLE_ENTRY,
  BYLINE_MAX,
  ContentItem,
  ContentKind,
  DEFAULT_PROJECT_ID,
  FileMeta,
  HTML_EXTS,
  IMAGE_EXTS,
  Layout,
  MAX_BUNDLE_FILES,
  MAX_BUNDLE_SIZE,
  MAX_BUNDLE_UNCOMPRESSED,
  MAX_FILE_SIZE,
  MAX_HTML_SIZE,
  MAX_IMAGE_SIZE,
  Project,
  ProjectSettings,
  PROMPT_MAX,
  SLOT_MAX,
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
  SLOT_MIN,
  Slot,
  defaultLayoutFor,
  defaultSettings,
  parseTitleColor,
  parseTitleFontSize,
  parseScaleOption,
  LETTERBOX_FILLS,
  TITLE_ALIGNS,
  TITLE_POSITIONS,
  TITLE_WEIGHTS,
  isVideoFile,
  mimeFromExt,
  parseCustomRatio,
} from './types';

const DATA_DIR = path.join(process.cwd(), 'data');
const PROJECTS_DIR = path.join(DATA_DIR, 'projects');
/** v1 遗留目录（迁移后仅剩 .bak，保留用于兜底解析） */
export const LEGACY_UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

export function projectDir(id: string): string {
  return path.join(PROJECTS_DIR, id);
}
export function projectFilesDir(id: string): string {
  return path.join(PROJECTS_DIR, id, 'files');
}
function projectManifestPath(id: string): string {
  return path.join(PROJECTS_DIR, id, 'manifest.json');
}

/* ============================== 互斥锁 ============================== */

/**
 * 每个 projectId 一条互斥队列；'*' 保留给跨项目的初始化/迁移临界区。
 * 队列挂在 globalThis：Next dev 下模块会被重复求值（HMR、按路由独立打包），
 * 模块级 Map 会随实例重建而丢失，导致并发请求各自持有独立锁（丢更新）；
 * 挂在全局对象上可保证同进程内恒为同一实例（与 Prisma client 单例同款模式）。
 */
const LOCK_QUEUE_KEY = '__omnicompareProjectLockQueues';
const globalRef = globalThis as typeof globalThis & {
  [LOCK_QUEUE_KEY]?: Map<string, Promise<unknown>>;
};
const lockQueues: Map<string, Promise<unknown>> =
  globalRef[LOCK_QUEUE_KEY] ?? new Map<string, Promise<unknown>>();
globalRef[LOCK_QUEUE_KEY] = lockQueues;

function enqueue(key: string, fn: () => Promise<unknown>): Promise<unknown> {
  const prev = lockQueues.get(key) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  // 队尾吞掉错误，保证后续排队任务不受前一个失败影响
  lockQueues.set(
    key,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

/** 按 projectId 串行化读-改-写临界区 */
export function withProjectLock<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
  return enqueue(projectId, fn as () => Promise<unknown>) as Promise<T>;
}

/* ============================== 工具 ============================== */

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? Math.round(value) : NaN;
  if (!Number.isFinite(n) || n < min || n > max) return fallback;
  return n;
}

/** 校验布局合法性（行列均为 1-SLOT_MAX 的整数，且容量 >= count） */
export function isValidLayout(layout: unknown, count: number): layout is Layout {
  if (!layout || typeof layout !== 'object') return false;
  const { rows, cols } = layout as Record<string, unknown>;
  if (typeof rows !== 'number' || typeof cols !== 'number') return false;
  if (!Number.isInteger(rows) || !Number.isInteger(cols)) return false;
  if (rows < SLOT_MIN || rows > SLOT_MAX || cols < SLOT_MIN || cols > SLOT_MAX) return false;
  return rows * cols >= count;
}

/** 项目 id 合法性（目录名白名单，防路径穿越） */
export function isValidId(id: unknown): id is string {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id);
}

/** 校验文件名是否安全（仅允许 uuid + 扩展名的形式） */
export function isSafeFilename(name: string): boolean {
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9]{1,8}$/.test(name) && !name.includes('..');
}

/** 清理原始文件名中的危险字符，保留可读性 */
function sanitizeOriginalName(name: string): string {
  const cleaned = name.replace(/[/\\:*?"<>|\u0000-\u001f]/g, '_').trim();
  return (cleaned || 'file').slice(0, 120);
}

/* ============================== 归一化读取 ============================== */

function normalizeFileMeta(raw: unknown): FileMeta | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.filename !== 'string' || !isSafeFilename(r.filename)) return null;
  return {
    filename: r.filename,
    originalName: typeof r.originalName === 'string' ? r.originalName : 'file',
    size: Number(r.size) || 0,
    mimeType: typeof r.mimeType === 'string' ? r.mimeType : 'application/octet-stream',
  };
}

/** 宽容归一化条目：字段缺失/非法时回落默认值，order 重排为紧凑序由调用方保证 */
function normalizeItem(raw: unknown, order: number): ContentItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const file = normalizeFileMeta(r.file);
  if (!file) return null;
  const kind: ContentKind =
    r.kind === 'html' ? 'html' : r.kind === 'image' ? 'image' : 'video';
  const now = new Date().toISOString();
  const base = {
    id: typeof r.id === 'string' && r.id.length > 0 ? r.id : randomUUID(),
    kind,
    title: typeof r.title === 'string' ? r.title.slice(0, 100) : '',
    order,
    // Step 7：归一化保留单卡比例覆盖（null/缺省 = 跟随全局；非法值回落 null）
    aspectRatio:
      r.aspectRatio === null || r.aspectRatio === undefined
        ? null
        : ['16:9', '9:16', '1:1', 'original', 'custom'].includes(r.aspectRatio as string)
          ? (r.aspectRatio as ContentItem['aspectRatio'])
          : null,
    createdAt: typeof r.createdAt === 'string' ? r.createdAt : now,
    updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : now,
  };
  if (kind === 'html') {
    const status = r.status === 'loading' || r.status === 'error' ? r.status : 'ready';
    // Step B：归一化保留 zip 包标志（仅接受布尔 true，其余视为缺省单文件）
    return r.bundle === true ? { ...base, kind, file, status, bundle: true } : { ...base, kind, file, status };
  }
  if (kind === 'image') {
    return { ...base, kind, file };
  }
  return { ...base, kind: 'video', file };
}

function normalizeSettings(raw: unknown): ProjectSettings {
  const base = defaultSettings();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Record<string, unknown>;
  const aspectRatio = ['16:9', '9:16', '1:1', 'original', 'custom'].includes(r.aspectRatio as string)
    ? (r.aspectRatio as ProjectSettings['aspectRatio'])
    : base.aspectRatio;
  const customRatio = parseCustomRatio(r.customRatio) ?? undefined;
  return {
    aspectRatio,
    customRatio,
    showTitles: typeof r.showTitles === 'boolean' ? r.showTitles : base.showTitles,
    showInfo: typeof r.showInfo === 'boolean' ? r.showInfo : base.showInfo,
    // 位置编号显隐：非法/缺失回落显示（v1 行为）
    showIndex: typeof r.showIndex === 'boolean' ? r.showIndex : base.showIndex,
    loop: typeof r.loop === 'boolean' ? r.loop : base.loop,
    muted: typeof r.muted === 'boolean' ? r.muted : base.muted,
    playbackRate: [0.5, 1, 1.25, 1.5, 2].includes(Number(r.playbackRate))
      ? Number(r.playbackRate)
      : base.playbackRate,
    // Step C：留白填充模式（base/blur/cover，非法值回落底色）
    letterboxFill: (LETTERBOX_FILLS as readonly string[]).includes(r.letterboxFill as string)
      ? (r.letterboxFill as ProjectSettings['letterboxFill'])
      : base.letterboxFill,
    // 缩放档位：非法/缺失回落 100（与引入前行为一致）
    wallScale: parseScaleOption(r.wallScale) ?? base.wallScale,
    htmlScale: parseScaleOption(r.htmlScale) ?? base.htmlScale,
    // 自动适配视口：非法/缺失回落开启（整墙超出视口自动缩小同屏）
    autoFit: typeof r.autoFit === 'boolean' ? r.autoFit : base.autoFit,
    // 标题格式（全局同步）：对齐非法回落居中；字号非法/越界回落默认
    titleAlign: (TITLE_ALIGNS as readonly string[]).includes(r.titleAlign as string)
      ? (r.titleAlign as ProjectSettings['titleAlign'])
      : base.titleAlign,
    titleFontSize: parseTitleFontSize(r.titleFontSize) ?? base.titleFontSize,
    // 标题位置/字重/颜色：非法一律回落默认（below/normal/'default'）
    titlePosition: (TITLE_POSITIONS as readonly string[]).includes(r.titlePosition as string)
      ? (r.titlePosition as ProjectSettings['titlePosition'])
      : base.titlePosition,
    titleWeight: (TITLE_WEIGHTS as readonly string[]).includes(r.titleWeight as string)
      ? (r.titleWeight as ProjectSettings['titleWeight'])
      : base.titleWeight,
    titleColor: parseTitleColor(r.titleColor) ?? base.titleColor,
    // 背景音乐：文件元数据非法一律回落 null（文件本体生命周期由 /api/videos/bgm 路由管理）
    bgm: normalizeFileMeta(r.bgm),
    // 背景音乐音量：非法/越界回落 100
    bgmVolume: clampInt(r.bgmVolume, 0, 100, base.bgmVolume),
    // 提示词与署名（录屏入镜）：非字符串回落空文本，字符串截断到上限；显隐非法/缺失回落隐藏
    promptText: typeof r.promptText === 'string' ? r.promptText.slice(0, PROMPT_MAX) : base.promptText,
    showPrompt: typeof r.showPrompt === 'boolean' ? r.showPrompt : base.showPrompt,
    bylineText: typeof r.bylineText === 'string' ? r.bylineText.slice(0, BYLINE_MAX) : base.bylineText,
    showByline: typeof r.showByline === 'boolean' ? r.showByline : base.showByline,
    // 水印（防伪）：显隐非法/缺失回落隐藏；文字截断；字号/不透明度越界钳制；字体形式/字重枚举校验
    showWatermark: typeof r.showWatermark === 'boolean' ? r.showWatermark : base.showWatermark,
    watermarkText: typeof r.watermarkText === 'string' ? r.watermarkText.slice(0, WATERMARK_MAX) : base.watermarkText,
    watermarkFontSize: clampInt(
      r.watermarkFontSize,
      WATERMARK_FONT_MIN,
      WATERMARK_FONT_MAX,
      base.watermarkFontSize,
    ),
    watermarkFontFamily: WATERMARK_FAMILIES.includes(r.watermarkFontFamily as WatermarkFamily)
      ? (r.watermarkFontFamily as WatermarkFamily)
      : base.watermarkFontFamily,
    watermarkColor: WATERMARK_COLORS.includes(r.watermarkColor as WatermarkColor)
      ? (r.watermarkColor as WatermarkColor)
      : base.watermarkColor,
    watermarkSpeed: WATERMARK_SPEEDS.includes(r.watermarkSpeed as WatermarkSpeed)
      ? (r.watermarkSpeed as WatermarkSpeed)
      : base.watermarkSpeed,
    watermarkFontWeight:
      r.watermarkFontWeight === 'normal' || r.watermarkFontWeight === 'bold'
        ? r.watermarkFontWeight
        : base.watermarkFontWeight,
    watermarkOpacity: clampInt(
      r.watermarkOpacity,
      WATERMARK_OPACITY_MIN,
      WATERMARK_OPACITY_MAX,
      base.watermarkOpacity,
    ),
  };
}

/**
 * 读取项目清单并归一化。
 * items 按 order 升序输出且重排为紧凑 0..n-1（容忍磁盘上的历史空洞）；
 * slotCount 兜底为 max(items.length, 1)，layout 兜底为按 slotCount 的近方形矩阵。
 *
 * 默认项目读取前先跑一次幂等迁移（见下方注释），这是迁移不被绕过的兜底保险。
 */
export async function readProject(id: string): Promise<Project> {
  // 默认项目：先确保 v1→v2 迁移已完成。
  // 背景（历史事故）：清单缺失时本函数会返回一份"空白默认项目"，任何 v2 写路径
  // （PATCH settings/layout 等）都会把它落盘，于是 migrateV1ToV2 的幂等判据
  // 「data/projects/default/manifest.json 是否存在」被提前占用，v1 数据永远迁不进来
  // —— 用户升级后旧内容彻底不可见。把迁移放在读取入口，任何路径都无法绕过。
  if (id === DEFAULT_PROJECT_ID) await ensureDefaultProject();

  const now = new Date().toISOString();
  const base: Project = {
    id,
    name: id === DEFAULT_PROJECT_ID ? '默认项目' : '新建项目',
    status: 'active',
    items: [],
    layout: 'auto',
    // 清单缺失/损坏的兑底：空项目从 1 个空框开始（与新建项目一致，上传几个内容就扩到几格）
    slotCount: 1,
    settings: defaultSettings(),
    createdAt: now,
    updatedAt: now,
  };
  try {
    const raw = JSON.parse(await fsp.readFile(projectManifestPath(id), 'utf-8')) as Record<
      string,
      unknown
    >;
    const itemsRaw = Array.isArray(raw.items) ? raw.items : [];
    const items = itemsRaw
      .map((it, i) => normalizeItem(it, i))
      .filter((it): it is ContentItem => it !== null)
      .map((it, i) => ({ ...it, order: i }));

    // 窗格数恒不小于条目数：v1 视图按 slotCount 输出槽位，一旦小于条目数，
    // 尾部条目在 v1 视图里不可见，会被 v1 写路径当成"已删除内容"清理掉（静默丢数据）。
    const slotCount = Math.max(
      clampInt(raw.slotCount, SLOT_MIN, SLOT_MAX, Math.max(items.length, 1)),
      Math.min(items.length, SLOT_MAX),
    );
    const effectiveCount = Math.max(slotCount, items.length);
    const layoutRaw = raw.layout;
    const layout: Layout | 'auto' =
      layoutRaw === 'auto'
        ? 'auto'
        : isValidLayout(layoutRaw, effectiveCount)
          ? { rows: (layoutRaw as Layout).rows, cols: (layoutRaw as Layout).cols }
          : defaultLayoutFor(effectiveCount);

    const status =
      raw.status === 'draft' || raw.status === 'archived' ? raw.status : ('active' as const);

    return {
      ...base,
      name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 100) : base.name,
      status,
      items,
      layout,
      slotCount,
      settings: normalizeSettings(raw.settings),
      createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : base.createdAt,
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : base.updatedAt,
    };
  } catch {
    return base;
  }
}

/** 原子写入项目清单（先写临时文件再 rename；临时名含随机后缀，防跨实例同名踩踏） */
export async function writeProject(project: Project): Promise<void> {
  await fsp.mkdir(projectFilesDir(project.id), { recursive: true });
  const target = projectManifestPath(project.id);
  const tmp = `${target}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(project, null, 2), 'utf-8');
  await fsp.rename(tmp, target);
}

/** 列出全部项目 id（目录即项目） */
export async function listProjectIds(): Promise<string[]> {
  try {
    const entries = await fsp.readdir(PROJECTS_DIR, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && isValidId(e.name))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

/** 项目是否存在（以 manifest.json 是否可读为判据，不触发默认项目迁移） */
export async function projectExists(id: string): Promise<boolean> {
  try {
    await fsp.access(projectManifestPath(id));
    return true;
  } catch {
    return false;
  }
}

/* ============================== 条目操作（纯函数） ============================== */

/** 增删后重排 order 为 0..n-1 紧凑序 */
export function reindexItems(items: ContentItem[]): ContentItem[] {
  return items.map((it, i) => (it.order === i ? it : { ...it, order: i }));
}

/** 拖拽/端点排序：按 orderedIds 重排，缺失或多余的 id 追加在尾部 */
export function applyReorder(items: ContentItem[], orderedIds: string[]): ContentItem[] {
  const byId = new Map(items.map((it) => [it.id, it]));
  const next: ContentItem[] = [];
  for (const id of orderedIds) {
    const item = byId.get(id);
    if (item) {
      next.push(item);
      byId.delete(id);
    }
  }
  next.push(...byId.values());
  return reindexItems(next);
}

/* ============================== v1 兼容视图 ============================== */

/**
 * 项目 → v1 slots 视图（order=位置；items 紧凑序保证对齐）。
 * Step 5 起视图携带 kind/html 扩展字段（向后兼容：旧客户端忽略即可），
 * 使 v1 写路径经 writeManifest 往返时能原样保留 HTML 条目。
 */
export function toSlots(project: Project): Slot[] {
  return Array.from({ length: project.slotCount }, (_, i) => {
    const item = project.items[i];
    if (!item) return { index: i, title: '', video: null, html: null, image: null };
    // Step 7：单卡比例覆盖随视图透传（null = 跟随全局，蓝图 §13）
    const aspect = item.aspectRatio ?? null;
    if (item.kind === 'html') {
      return {
        index: i,
        title: item.title,
        video: null,
        kind: 'html' as const,
        html: item.file,
        image: null,
        ...(item.bundle ? { bundle: true as const } : {}),
        aspectRatio: aspect,
      };
    }
    if (item.kind === 'image') {
      return { index: i, title: item.title, video: null, kind: 'image' as const, html: null, image: item.file, aspectRatio: aspect };
    }
    return { index: i, title: item.title, video: item.file, kind: 'video' as const, html: null, image: null, aspectRatio: aspect };
  });
}

/* ============================== 文件服务 ============================== */

/** zip 的 MIME 类型（不同浏览器/系统给出的变体） */
const ZIP_MIMES = ['application/zip', 'application/x-zip-compressed'];

/** 服务端校验上传文件，返回错误信息（null 表示通过）；kind 由 MIME + 扩展名双判（video / html / image；zip 为 bundle 型 html） */
export function validateUploadFile(
  name: string,
  mimeType: string,
  size: number,
): { kind: ContentKind; bundle?: boolean } | { error: string } {
  if (size === 0) return { error: '文件内容为空' };
  const ext = path.extname(name).toLowerCase();
  const isHtml = (HTML_EXTS as readonly string[]).includes(ext);
  if (isHtml || mimeType === 'text/html') {
    // 双判一致性检查：MIME 明确是 zip 却挂着 .html 扩展名 —— 说明上传方标错了类型
    // （典型场景：zip 包被改名成 .html）。放行会把压缩二进制当 HTML 存成单文件页面，
    // 既不渲染也不报错，用户只会看到"传上去了但打不开"。宁可明确拒收。
    if (ZIP_MIMES.includes(mimeType)) return { error: '文件类型与扩展名不一致：这是 zip 包，请用 .zip 扩展名上传' };
    if (size > MAX_HTML_SIZE) return { error: 'HTML 文件超过 10MB 大小限制' };
    if (!isHtml) return { error: '仅支持 .html / .htm 文件' };
    return { kind: 'html' };
  }
  // zip 资源包（Step B）：多文件 HTML 页面，解压后以目录形式存放，经 /api/bundles/ 服务
  if (ext === '.zip' || ZIP_MIMES.includes(mimeType)) {
    if (size > MAX_BUNDLE_SIZE) return { error: 'zip 包超过 50MB 大小限制' };
    if (ext !== '.zip') return { error: '仅支持 .zip 资源包' };
    return { kind: 'html', bundle: true };
  }
  // 图片（第二阶段 Step A）：扩展名白名单或 image/* MIME 双判；SVG 同样接受（服务层 CSP 沙箱）
  const isImageExt = (IMAGE_EXTS as readonly string[]).includes(ext);
  if (isImageExt || mimeType.startsWith('image/')) {
    if (size > MAX_IMAGE_SIZE) return { error: '图片文件超过 20MB 大小限制' };
    if (!isImageExt) return { error: '仅支持 PNG / JPG / GIF / WebP / SVG / BMP / AVIF 图片' };
    return { kind: 'image' };
  }
  if (size > MAX_FILE_SIZE) return { error: '文件超过 200MB 大小限制' };
  if (!isVideoFile(name, mimeType)) return { error: '仅支持视频、图片或单文件 HTML' };
  return { kind: 'video' };
}

/** 保存上传文件到指定项目，返回其元数据；kind='audio' 用于背景音乐（同存 files/ 目录） */
export async function saveFile(
  projectId: string,
  file: File,
  kind: ContentKind | 'audio',
): Promise<FileMeta> {
  const dir = projectFilesDir(projectId);
  await fsp.mkdir(dir, { recursive: true });
  const extMatch = path.extname(file.name).toLowerCase();
  const ext =
    extMatch && /^(\.[A-Za-z0-9]{1,8})$/.test(extMatch)
      ? extMatch
      : kind === 'html'
        ? '.html'
        : kind === 'image'
          ? '.png'
          : kind === 'audio'
            ? '.mp3'
            : '.mp4';
  const filename = `${randomUUID()}${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  await fsp.writeFile(path.join(dir, filename), buffer);
  return {
    filename,
    originalName: sanitizeOriginalName(file.name),
    size: file.size,
    mimeType: file.type || mimeFromExt(filename),
  };
}

/* ============================== zip 资源包（Step B） ============================== */

/**
 * Windows 保留设备名（CON/PRN/AUX/NUL/COM1-9/LPT1-9，含带扩展名形式）：
 * 这些名字作为路径段在 Windows 上会命中设备而不是普通文件，一律拒绝。
 */
const WINDOWS_RESERVED_SEGMENT = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/**
 * 归一化 zip 内部路径，非法时抛错（zip-slip 防护）：
 * - 反斜杠统一为正斜杠；拒绝绝对路径、盘符、空字节、.. 段、Windows 保留设备名
 * - 去掉空段与 ./ 段，返回包内相对路径
 */
function sanitizeZipEntryPath(rawPath: string): string {
  const reject = (): never => {
    throw new Error(`zip 包内含不安全的路径：${rawPath}`);
  };
  if (rawPath.includes('\0')) reject();
  const normalized = rawPath.replace(/\\/g, '/');
  if (/^[A-Za-z]:/.test(normalized)) reject(); // Windows 盘符
  if (normalized.startsWith('/')) reject(); // 绝对路径
  const segments: string[] = [];
  for (const seg of normalized.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') reject(); // 路径穿越
    if (WINDOWS_RESERVED_SEGMENT.test(seg)) reject(); // Windows 设备名
    segments.push(seg);
  }
  if (segments.length === 0) reject();
  return segments.join('/');
}

/** 把解压分片合并成一个连续缓冲（分片是 Buffer 视图时不做额外拷贝） */
function concatChunks(chunks: Uint8Array[], total: number): Uint8Array {
  const out = Buffer.allocUnsafe(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/**
 * 喂给 fflate 的 zip 输入切片大小。
 *
 * 为什么必须切片：fflate 的 Inflate 每次 `push` 只会把"当次输入能解出的内容"投递出来
 * （`Inflate.prototype.c` 用 32KB 预分配缓冲 + 按需翻倍，然后一次性 ondata）。
 * 一次性把整个 zip 交给 `Unzip.push(buf, true)`，它就会把**整个条目**解完再一次性投递
 * ——实测 300MB 载荷只回调一次、单片 300MB，此时"边解边累计"的限额检查形同虚设。
 * 按 8KB 切片喂入后，单次投递上界 ≈ 8KB × DEFLATE 理论最大膨胀比(≈1032:1) ≈ 8MB，
 * 越限中止的滞后被压到 MB 级，内存上界才真正落到「限额 + 一片」。
 */
const ZIP_INPUT_SLICE = 8 * 1024;

/**
 * 保存 zip 资源包：流式解压，边解边校验，超限立即中止。
 * 安全部署（历史事故修正）：路径归一化 + 扩展名白名单 + 文件数/解压总大小限额。
 *
 * 早期实现用 `unzipSync` 先把整包解压进内存、再检查 120MB 限额，
 * 于是 300KB 的 zip 炸弹（解压比 ~1000:1）能让进程 RSS 暴涨数百 MB；
 * 上限允许的 50MB 包理论上可申请数十 GB。现在改为 fflate 的流式 Unzip：
 *   1. 预检中央目录/本地头声明的 originalSize，典型炸弹在 inflate 之前就被拒（零解压成本）；
 *   2. 分片喂入 + 解压过程中累计**实际**字节数，声明值被伪造也能在越限瞬间中止；
 *   3. 中止用异常硬退出 push 循环。
 * 全部通过后才落盘，失败不留半包。
 */
export async function saveBundle(projectId: string, file: File): Promise<FileMeta> {
  const filesDir = projectFilesDir(projectId);
  await fsp.mkdir(filesDir, { recursive: true });
  const filename = `${randomUUID()}.html`;
  const bundleDir = path.join(filesDir, filename);

  const zipBuffer = new Uint8Array(await file.arrayBuffer());

  /** 已校验通过、待落盘的文件 */
  const cleaned: { relPath: string; data: Uint8Array }[] = [];
  /** 已受理的条目数：在 onfile 阶段即刻累加，不依赖条目是否已完成解压 */
  let entryCount = 0;
  let declaredTotal = 0;
  let actualTotal = 0;
  /**
   * 中止原因。onfile 阶段的校验直接抛错即可干净退出；
   * 但 ondata 阶段（已经进入 inflate 循环）抛错会被 fflate 用空 chunk 再次回调，
   * 噪音异常会盖掉真正原因，故先记原因再抛，由 push 之后的统一出口上报。
   */
  let aborted: Error | null = null;
  const fail = (message: string): never => {
    aborted = new Error(message);
    throw aborted;
  };

  const unzip = new Unzip();
  unzip.register(UnzipInflate);
  unzip.onfile = (entry) => {
    if (aborted) return; // push 循环尚未退出时的残余回调
    if (entry.name.endsWith('/')) return; // 目录条目：写文件时按需建目录

    if (entryCount >= MAX_BUNDLE_FILES) {
      fail(`zip 包内文件数超过 ${MAX_BUNDLE_FILES} 个限制`);
    }
    entryCount += 1;
    const relPath = sanitizeZipEntryPath(entry.name);
    const ext = path.extname(relPath).toLowerCase();
    if (!(BUNDLE_ASSET_EXTS as readonly string[]).includes(ext)) {
      fail(`zip 包内含不支持的文件类型：${entry.name}`);
    }
    // 预检声明值：zip 通常在此就能拒绝，无需付出任何解压成本
    declaredTotal += entry.originalSize ?? 0;
    if (declaredTotal > MAX_BUNDLE_UNCOMPRESSED) {
      fail('zip 包解压后超过 120MB 总大小限制');
    }

    const chunks: Uint8Array[] = [];
    let got = 0;
    entry.ondata = (err, chunk, final) => {
      if (aborted) return;
      if (err) fail('无法解析 zip 包，文件可能已损坏');
      if (chunk && chunk.length > 0) {
        chunks.push(chunk);
        got += chunk.length;
        actualTotal += chunk.length;
      }
      // 声明值可被伪造，以实际解压量为准
      if (actualTotal > MAX_BUNDLE_UNCOMPRESSED) {
        fail('zip 包解压后超过 120MB 总大小限制');
      }
      if (final) cleaned.push({ relPath, data: concatChunks(chunks, got) });
    };
    entry.start();
  };

  try {
    // 分片喂入：保证解码器增量投递，限额检查才有意义（见 ZIP_INPUT_SLICE 说明）
    for (let offset = 0; offset < zipBuffer.length; offset += ZIP_INPUT_SLICE) {
      if (aborted) break;
      const end = Math.min(offset + ZIP_INPUT_SLICE, zipBuffer.length);
      unzip.push(zipBuffer.subarray(offset, end), end === zipBuffer.length);
    }
  } catch (err) {
    // 中止时 fflate 可能用空 chunk 再次回调，噪音异常不覆盖真正的中止原因
    if (!aborted) throw err;
  }
  if (aborted) throw aborted;

  if (cleaned.length === 0) throw new Error('zip 包为空');
  if (!cleaned.some((c) => c.relPath === BUNDLE_ENTRY)) {
    throw new Error(`zip 包根目录缺少 ${BUNDLE_ENTRY} 入口文件`);
  }

  // 落盘（路径已归一化，不会越出包目录）
  await fsp.mkdir(bundleDir, { recursive: true });
  for (const { relPath, data } of cleaned) {
    const target = path.join(bundleDir, relPath);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, data);
  }

  return {
    filename,
    originalName: sanitizeOriginalName(file.name),
    size: file.size,
    mimeType: 'application/zip',
  };
}

/**
 * 跨项目解析 zip 包目录（包目录名 = file.filename = [uuid].html）：
 * 返回包目录绝对路径；不存在或非目录返回 null。
 */
export async function resolveBundleDir(name: string): Promise<string | null> {
  if (!isSafeFilename(name) || !name.endsWith('.html')) return null;
  const ids = await listProjectIds();
  for (const id of ids) {
    const p = path.join(projectFilesDir(id), name);
    try {
      const st = await fsp.stat(p);
      if (st.isDirectory()) return p;
    } catch {
      /* 继续查找下一个位置 */
    }
  }
  return null;
}

/** 删除项目内文件或包目录（忽略不存在的情况；recursive 兼容 Step B 包目录） */
export async function deleteFile(projectId: string, filename: string): Promise<void> {
  if (!isSafeFilename(filename)) return;
  await fsp.rm(path.join(projectFilesDir(projectId), filename), { force: true, recursive: true });
}

export interface ResolvedFile {
  absolutePath: string;
  projectId: string | null;
  isHtml: boolean;
}

/**
 * 跨项目解析文件名（文件名含 uuid，全局唯一）：
 * 先查各项目的 files/，再兜底 v1 遗留目录 data/uploads/ 与迁移备份目录。
 */
export async function resolveFileAnyProject(name: string): Promise<ResolvedFile | null> {
  if (!isSafeFilename(name)) return null;
  const ids = await listProjectIds();
  for (const id of ids) {
    const p = path.join(projectFilesDir(id), name);
    try {
      const st = await fsp.stat(p);
      if (st.isFile() && st.size > 0) {
        return {
          absolutePath: p,
          projectId: id,
          isHtml: (HTML_EXTS as readonly string[]).includes(path.extname(name).toLowerCase()),
        };
      }
    } catch {
      /* 继续查找下一个位置 */
    }
  }
  for (const dir of [LEGACY_UPLOAD_DIR, `${LEGACY_UPLOAD_DIR}.v1.bak`]) {
    const p = path.join(dir, name);
    try {
      const st = await fsp.stat(p);
      if (st.isFile() && st.size > 0) {
        return {
          absolutePath: p,
          projectId: null,
          isHtml: (HTML_EXTS as readonly string[]).includes(path.extname(name).toLowerCase()),
        };
      }
    } catch {
      /* 兜底目录不存在则跳过 */
    }
  }
  return null;
}

/* ============================== v1 → v2 迁移 ============================== */

/** 确保默认项目存在；首次访问时把 v1 数据一次性搬入（幂等）。
 * 迁移单例同样挂 globalThis：防止模块多实例时迁移并发重入。 */
export function ensureDefaultProject(): Promise<void> {
  const MIGRATION_KEY = '__omnicompareMigrationPromise';
  const ref = globalThis as typeof globalThis & { [MIGRATION_KEY]?: Promise<void> };
  if (!ref[MIGRATION_KEY]) {
    ref[MIGRATION_KEY] = enqueue('*', migrateV1ToV2).then(
      () => undefined,
      (err) => {
        // 迁移失败时重置单例，允许下次请求重试
        ref[MIGRATION_KEY] = undefined;
        throw err;
      },
    );
  }
  return ref[MIGRATION_KEY];
}

async function migrateV1ToV2(): Promise<void> {
  await fsp.mkdir(PROJECTS_DIR, { recursive: true });
  const targetManifest = projectManifestPath(DEFAULT_PROJECT_ID);
  try {
    await fsp.access(targetManifest);
    return; // 已迁移（幂等出口）
  } catch {
    /* 首次迁移 */
  }

  const filesDir = projectFilesDir(DEFAULT_PROJECT_ID);
  await fsp.mkdir(filesDir, { recursive: true });
  const now = new Date().toISOString();

  // 读 v1 清单（损坏/缺失则按空项目迁移：从 1 个空框开始，与新建项目一致）
  let count = 1;
  let layout: Layout = defaultLayoutFor(1);
  const v1Slots: { title: string; video: FileMeta | null }[] = [];
  try {
    const v1 = JSON.parse(
      await fsp.readFile(path.join(DATA_DIR, 'manifest.json'), 'utf-8'),
    ) as Record<string, unknown>;
    count = clampInt(v1.count, SLOT_MIN, SLOT_MAX, 6);
    if (isValidLayout(v1.layout, count)) layout = v1.layout as Layout;
    const slotsRaw = Array.isArray(v1.slots) ? v1.slots : [];
    for (let i = 0; i < count; i++) {
      const s = slotsRaw.find((x) => x?.index === i) ?? slotsRaw[i];
      v1Slots.push({
        title: typeof s?.title === 'string' ? s.title.slice(0, 100) : '',
        video:
          s?.video && typeof s.video.filename === 'string'
            ? {
                filename: s.video.filename,
                originalName:
                  typeof s.video.originalName === 'string' ? s.video.originalName : 'video',
                size: Number(s.video.size) || 0,
                mimeType: typeof s.video.mimeType === 'string' ? s.video.mimeType : 'video/mp4',
              }
            : null,
      });
    }
  } catch {
    for (let i = 0; i < count; i++) v1Slots.push({ title: '', video: null });
  }

  // 搬移文件：data/uploads/x → data/projects/default/files/x（rename 失败回退 copy）
  for (const slot of v1Slots) {
    if (!slot.video) continue;
    const from = path.join(LEGACY_UPLOAD_DIR, slot.video.filename);
    const to = path.join(filesDir, slot.video.filename);
    try {
      await fsp.rename(from, to);
    } catch {
      try {
        await fsp.copyFile(from, to);
      } catch {
        slot.video = null; // 文件确实丢失：清单不再引用，避免死链
      }
    }
  }

  // 构建 v2 项目：order 压缩为 0..n-1（有视频的槽位按原顺序排列）
  const items: ContentItem[] = [];
  for (const slot of v1Slots) {
    if (!slot.video) continue;
    items.push({
      id: randomUUID(),
      kind: 'video',
      title: slot.title,
      order: items.length,
      aspectRatio: null,
      createdAt: now,
      updatedAt: now,
      file: slot.video,
    });
  }

  const project: Project = {
    id: DEFAULT_PROJECT_ID,
    name: '默认项目',
    status: 'active',
    items: reindexItems(items),
    layout,
    slotCount: count,
    settings: defaultSettings(),
    createdAt: now,
    updatedAt: now,
  };
  await writeProject(project);

  // v1 清单改名备份；uploads 目录内已清空的尽量改名备份（失败不影响迁移结果）
  try {
    await fsp.rename(path.join(DATA_DIR, 'manifest.json'), path.join(DATA_DIR, 'manifest.v1.bak.json'));
  } catch {
    /* 无 v1 清单（全新安装）时无需备份 */
  }
  try {
    await fsp.rename(LEGACY_UPLOAD_DIR, `${LEGACY_UPLOAD_DIR}.v1.bak`);
  } catch {
    /* 目录非空残留或不存在时保留原样，resolveFileAnyProject 仍可兜底 */
  }
}
