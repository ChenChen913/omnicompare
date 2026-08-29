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

/** 标题最大长度 */
export const TITLE_MAX = 100;

export interface SlotVideo {
  /** 服务器上生成的唯一文件名（uuid + 扩展名） */
  filename: string;
  /** 用户上传时的原始文件名 */
  originalName: string;
  /** 文件字节数 */
  size: number;
  /** MIME 类型 */
  mimeType: string;
}

export interface Slot {
  /** 位置序号 0-based */
  index: number;
  /** 用户自定义标题 / 介绍 */
  title: string;
  /** 已放置的视频，空位为 null */
  video: SlotVideo | null;
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

/** 字节数格式化为可读文本 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
