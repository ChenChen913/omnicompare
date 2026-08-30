/**
 * 前后端共享的常量、类型与纯工具函数（不含任何 Node API，可安全用于客户端）
 */

/** 视频数量下限 / 上限 */
export const SLOT_MIN = 1;
export const SLOT_MAX = 12;

/** 单个视频文件大小上限（200MB） */
export const MAX_FILE_SIZE = 200 * 1024 * 1024;

/** 允许的视频扩展名 */
export const VIDEO_EXTS = ['.mp4', '.m4v', '.mov', '.webm', '.ogv', '.avi', '.mkv'] as const;

/** 单个 HTML 文件大小上限（10MB，见 BLUEPRINT §8） */
export const MAX_HTML_SIZE = 10 * 1024 * 1024;

/** 允许的 HTML 扩展名 */
export const HTML_EXTS = ['.html', '.htm'] as const;

/** 单个图片文件大小上限（20MB，第二阶段 Step A） */
export const MAX_IMAGE_SIZE = 20 * 1024 * 1024;

/** 允许的图片扩展名（SVG 以 <img> 渲染 + 服务端 CSP 沙箱双保险，脚本不执行） */
export const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.avif'] as const;

/** zip 资源包大小上限（50MB，第二阶段 Step B：多文件 HTML 页面） */
export const MAX_BUNDLE_SIZE = 50 * 1024 * 1024;

/** zip 包解压后总大小上限（120MB，防 zip 炸弹） */
export const MAX_BUNDLE_UNCOMPRESSED = 120 * 1024 * 1024;

/** zip 包内文件数上限 */
export const MAX_BUNDLE_FILES = 300;

/** zip 包入口文件（必须存在于包根目录） */
export const BUNDLE_ENTRY = 'index.html';

/** zip 包内允许的资源扩展名（web 资产白名单，其余一律拒收） */
export const BUNDLE_ASSET_EXTS = [
  '.html', '.htm', '.css', '.js', '.mjs', '.json', '.txt',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.avif', '.ico',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.mp3', '.wav', '.ogg', '.mp4', '.webm',
  '.wasm',
] as const;

/** 标题最大长度 */
export const TITLE_MAX = 100;

/** 内容类型：video / html（MVP）+ image（第二阶段 Step A，SVG 随图片链路支持） */
export type ContentKind = 'video' | 'html' | 'image';

/** 内容比例：original = 16:9 容器 + contain（v1 行为） */
export type AspectRatio = '16:9' | '9:16' | '1:1' | 'original' | 'custom';

/** 文件元数据（v1 SlotVideo 的沿用） */
export interface FileMeta {
  /** 服务器上生成的唯一文件名（uuid + 扩展名） */
  filename: string;
  /** 用户上传时的原始文件名 */
  originalName: string;
  /** 文件字节数 */
  size: number;
  /** MIME 类型 */
  mimeType: string;
}

/** 兼容别名：v1 代码中的 SlotVideo 即 FileMeta */
export type SlotVideo = FileMeta;

export interface Slot {
  /** 位置序号 0-based */
  index: number;
  /** 用户自定义标题 / 介绍 */
  title: string;
  /** 已放置的视频文件；空位或 HTML 条目为 null */
  video: SlotVideo | null;
  /** 条目类型（Step 5 扩展字段，向后兼容）：缺省视为 video；旧客户端只需忽略 */
  kind?: ContentKind;
  /** 已放置的 HTML 文件；仅 kind='html' 时存在 */
  html?: FileMeta | null;
  /** HTML 是否为 zip 资源包（Step B）；仅 kind='html' 时存在 */
  bundle?: boolean;
  /** 已放置的图片文件；仅 kind='image' 时存在（第二阶段 Step A） */
  image?: FileMeta | null;
  /** 单卡比例覆盖（Step 7 扩展字段，向后兼容）：null/缺省 = 跟随全局（蓝图 §13） */
  aspectRatio?: AspectRatio | null;
}

/** 排列矩阵：rows 行 × cols 列（rows*cols >= 视频数量，多出的为留空格） */
export interface Layout {
  rows: number;
  cols: number;
}

export interface Manifest {
  /** 视频位置个数 */
  count: number;
  /** 当前排列矩阵（layoutMode='auto' 时为按 count 自动计算的近方形矩阵） */
  layout: Layout;
  slots: Slot[];
  /** 布局模式（Step 6 扩展字段，向后兼容：缺省视为 manual）。
   * auto = 用户交给系统按数量自动排矩阵；manual = 用户显式选择了行列 */
  layoutMode?: 'auto' | 'manual';
  /** 项目级播放与展示设置（Step 7 扩展字段，向后兼容：缺省视为 defaultSettings()） */
  settings?: ManifestSettings;
}

/** v1 视图的项目级设置（Blueprint §7 ProjectSettings 的 v1 平铺子集，customRatio 为第二阶段 UI） */
export interface ManifestSettings {
  aspectRatio: AspectRatio;
  showTitles: boolean;
  showInfo: boolean;
  loop: boolean;
  muted: boolean;
  playbackRate: number;
  /** 留白填充（第二阶段 Step C）：base = 底色吸收；blur = 模糊背景填充（仅视频/图片，HTML 豁免） */
  letterboxFill: 'base' | 'blur';
}

/** 比例选项 -> CSS aspect-ratio 值；original/custom 均回落 16/9 容器 + contain（蓝图 §13） */
export function aspectCss(a: AspectRatio | null | undefined): string {
  switch (a) {
    case '9:16':
      return '9 / 16';
    case '1:1':
      return '1 / 1';
    case '16:9':
    case 'original':
    case 'custom':
    default:
      return '16 / 9';
  }
}

/** 比例选项的界面标签；null = 跟随全局 */
export function aspectLabel(a: AspectRatio | null | undefined): string {
  switch (a) {
    case '16:9':
      return '16:9';
    case '9:16':
      return '9:16';
    case '1:1':
      return '1:1';
    case 'custom':
      return '自定义';
    case null:
      return '跟随';
    case 'original':
    default:
      return '原始';
  }
}

/* ============================== schema v2 ============================== */

/** 内容条目基础字段（id 为全生命周期稳定锚点，order 决定矩阵位置，0..n-1 紧凑无空洞） */
export interface ContentItemBase {
  id: string;
  kind: ContentKind;
  title: string;
  order: number;
  /** null = 跟随全局比例 */
  aspectRatio: AspectRatio | null;
  createdAt: string;
  updatedAt: string;
}

export interface VideoAsset {
  kind: 'video';
  file: FileMeta;
}

export interface HtmlAsset {
  kind: 'html';
  file: FileMeta;
  /** 加载状态：服务端落库即 ready，客户端渲染时按 iframe 事件本地流转 */
  status: 'loading' | 'ready' | 'error';
  /** zip 资源包条目（第二阶段 Step B）：file.filename 同时是 files/ 下的目录名，
   * 页面经 /api/bundles/[filename]/index.html 服务；缺省 = 单文件 HTML */
  bundle?: boolean;
}

export interface ImageAsset {
  kind: 'image';
  file: FileMeta;
}

export type ContentItem = ContentItemBase & (VideoAsset | HtmlAsset | ImageAsset);

/** 项目级播放与展示设置 */
export interface ProjectSettings {
  aspectRatio: AspectRatio;
  customRatio?: { w: number; h: number };
  /** 标题显隐：控制内容下方标题输入框 */
  showTitles: boolean;
  /** 属性信息显隐：控制标题下方信息行（文件名/大小/比例/操作） */
  showInfo: boolean;
  loop: boolean;
  muted: boolean;
  playbackRate: number;
  /** 留白填充（第二阶段 Step C）：base = 底色吸收（默认）；blur = 同内容模糊放大铺底 */
  letterboxFill: 'base' | 'blur';
}

/** 项目（schema v2 顶层）：items 顺序即矩阵填充顺序 */
export interface Project {
  id: string;
  name: string;
  status: 'active' | 'draft' | 'archived';
  items: ContentItem[];
  layout: Layout | 'auto';
  /** 可见窗格数（v1 count 的沿用，1-12）；新 UI 全面接管后评估移除 */
  slotCount: number;
  settings: ProjectSettings;
  createdAt: string;
  updatedAt: string;
}

/** 默认项目 id：v1 数据迁移的目标项目，API 兼容层的操作对象 */
export const DEFAULT_PROJECT_ID = 'default';

export function defaultSettings(): ProjectSettings {
  return {
    aspectRatio: 'original',
    showTitles: true,
    showInfo: true,
    loop: false,
    muted: true,
    playbackRate: 1,
    letterboxFill: 'base',
  };
}

function isPrime(n: number): boolean {
  if (n < 2) return false;
  for (let i = 2; i * i <= n; i++) {
    if (n % i === 0) return false;
  }
  return true;
}

/**
 * 为给定视频个数生成可选的排列矩阵（行×列）。
 * - 优先给出能整除的矩阵（rows*cols === count），按“接近方形、横屏优先”排序；
 * - 质数（5、7、11 等只有长条可选时）补充“近方形 + 末尾留空”的矩阵。
 */
export function layoutOptionsFor(count: number): Layout[] {
  const exact: Layout[] = [];
  for (let r = 1; r <= count; r++) {
    if (count % r === 0) exact.push({ rows: r, cols: count / r });
  }
  exact.sort((a, b) => {
    const da = Math.abs(a.cols - a.rows);
    const db = Math.abs(b.cols - b.rows);
    if (da !== db) return da - db;
    const pa = a.cols >= a.rows ? 0 : 1;
    const pb = b.cols >= b.rows ? 0 : 1;
    if (pa !== pb) return pa - pb;
    return a.rows - b.rows;
  });

  const options: Layout[] = [];
  if (count > 3 && isPrime(count)) {
    let best: Layout | null = null;
    for (let r = 2; r <= Math.ceil(Math.sqrt(count)) + 1; r++) {
      const c = Math.ceil(count / r);
      const area = r * c;
      if (
        !best ||
        area < best.rows * best.cols ||
        (area === best.rows * best.cols && Math.abs(c - r) < Math.abs(best.cols - best.rows))
      ) {
        best = { rows: r, cols: c };
      }
    }
    if (best) {
      options.push(best);
      if (best.rows !== best.cols) options.push({ rows: best.cols, cols: best.rows });
    }
  }
  options.push(...exact);

  const seen = new Set<string>();
  return options.filter((l) => {
    const key = `${l.rows}x${l.cols}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** 给定数量的默认矩阵：第一个（最接近方形、横屏优先）选项 */
export function defaultLayoutFor(count: number): Layout {
  return layoutOptionsFor(count)[0] ?? { rows: 1, cols: count };
}

/**
 * Auto Layout（蓝图 §12）：按 count 自动求近方形矩阵。
 * cols = ceil(sqrt(count))，rows = ceil(count / cols)，保证 rows*cols >= count。
 * 窄屏（<768px）下的列数收窄到 2 由渲染层处理，此函数始终返回桌面端矩阵。
 */
export function autoLayoutFor(count: number): Layout {
  const n = Math.max(1, Math.floor(count));
  const cols = Math.max(1, Math.ceil(Math.sqrt(n)));
  const rows = Math.max(1, Math.ceil(n / cols));
  return { rows, cols };
}

/** 扩展名 -> MIME 类型（含视频/图片/web 资产；web 资产类型供 zip 包条目静态服务使用） */
export function mimeFromExt(name: string): string {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(name);
  const ext = m ? `.${m[1].toLowerCase()}` : '';
  const map: Record<string, string> = {
    '.mp4': 'video/mp4',
    '.m4v': 'video/x-m4v',
    '.mov': 'video/quicktime',
    '.webm': 'video/webm',
    '.ogv': 'video/ogg',
    '.avi': 'video/x-msvideo',
    '.mkv': 'video/x-matroska',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.bmp': 'image/bmp',
    '.avif': 'image/avif',
    '.ico': 'image/x-icon',
    '.html': 'text/html',
    '.htm': 'text/html',
    '.css': 'text/css',
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.json': 'application/json',
    '.txt': 'text/plain',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.otf': 'font/otf',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
  };
  return map[ext] ?? 'application/octet-stream';
}

/** 判断是否为可接受的视频文件（客户端上传前 & 服务端落盘前共用） */
export function isVideoFile(name: string, mimeType: string): boolean {
  if (mimeType.startsWith('video/')) return true;
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(name);
  if (!m) return false;
  return (VIDEO_EXTS as readonly string[]).includes(`.${m[1].toLowerCase()}`);
}

/** 判断是否为可接受的 HTML 文件（扩展名判别，与服务端 validateUploadFile 的 ext 规则一致） */
export function isHtmlFile(name: string): boolean {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(name);
  if (!m) return false;
  return (HTML_EXTS as readonly string[]).includes(`.${m[1].toLowerCase()}`);
}

/** 判断是否为可接受的图片文件（扩展名或 MIME 判别；SVG 随图片链路支持） */
export function isImageFile(name: string, mimeType?: string): boolean {
  if (mimeType && mimeType.startsWith('image/')) return true;
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(name);
  if (!m) return false;
  return (IMAGE_EXTS as readonly string[]).includes(`.${m[1].toLowerCase()}`);
}

/** 判断是否为可导入的内容文件（视频、单文件 HTML、图片或 zip 资源包） */
export function isContentFile(name: string, mimeType: string): boolean {
  return isVideoFile(name, mimeType) || isHtmlFile(name) || isImageFile(name, mimeType) || isZipFile(name);
}

/** 判断是否为 zip 资源包（多文件 HTML 页面，Step B） */
export function isZipFile(name: string): boolean {
  return /\.zip$/i.test(name);
}

/**
 * 客户端上传预检：返回错误信息（null 表示通过）。
 * 与服务端 validateUploadFile 保持同一套规则，提前拦截以免浪费一次请求。
 */
export function validateClientFile(file: { name: string; type: string; size: number }): string | null {
  if (file.size === 0) return '文件内容为空';
  if (isHtmlFile(file.name)) {
    if (file.size > MAX_HTML_SIZE) return 'HTML 文件超过 10MB 大小限制';
    return null;
  }
  if (isZipFile(file.name)) {
    if (file.size > MAX_BUNDLE_SIZE) return 'zip 包超过 50MB 大小限制';
    return null;
  }
  if (isImageFile(file.name, file.type)) {
    if (file.size > MAX_IMAGE_SIZE) return '图片文件超过 20MB 大小限制';
    return null;
  }
  if (!isVideoFile(file.name, file.type)) return '仅支持视频、图片或单文件 HTML';
  if (file.size > MAX_FILE_SIZE) return '文件超过 200MB 大小限制';
  return null;
}

/** 字节数格式化为可读文本 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
