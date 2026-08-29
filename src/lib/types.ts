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

/** 标题最大长度 */
export const TITLE_MAX = 100;

/** 内容类型：MVP 仅 video / html；image、svg、markdown、pdf 为第二阶段预留 */
export type ContentKind = 'video' | 'html';

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
}

/** 排列矩阵：rows 行 × cols 列（rows*cols >= 视频数量，多出的为留空格） */
export interface Layout {
  rows: number;
  cols: number;
}

export interface Manifest {
  /** 视频位置个数 */
  count: number;
  /** 当前排列矩阵 */
  layout: Layout;
  slots: Slot[];
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
}

export type ContentItem = ContentItemBase & (VideoAsset | HtmlAsset);

/** 项目级播放与展示设置 */
export interface ProjectSettings {
  aspectRatio: AspectRatio;
  customRatio?: { w: number; h: number };
  showTitles: boolean;
  loop: boolean;
  muted: boolean;
  playbackRate: number;
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
    loop: false,
    muted: true,
    playbackRate: 1,
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

/** 扩展名 -> MIME 类型 */
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

/** 判断是否为可导入的内容文件（视频或单文件 HTML） */
export function isContentFile(name: string, mimeType: string): boolean {
  return isVideoFile(name, mimeType) || isHtmlFile(name);
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
  if (!isVideoFile(file.name, file.type)) return '仅支持视频或单文件 HTML';
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
