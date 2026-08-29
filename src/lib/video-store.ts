/**
 * 服务端视频存储：data/uploads/ 保存视频文件，data/manifest.json 保存清单
 * 清单包含：视频个数 count、排列矩阵 layout、各位置 slots
 */
import { promises as fsp } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import {
  Layout,
  Manifest,
  MAX_FILE_SIZE,
  SLOT_MAX,
  SLOT_MIN,
  Slot,
  SlotVideo,
  defaultLayoutFor,
  isVideoFile,
  mimeFromExt,
} from './types';

const DATA_DIR = path.join(process.cwd(), 'data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const MANIFEST_PATH = path.join(DATA_DIR, 'manifest.json');

async function ensureDirs(): Promise<void> {
  await fsp.mkdir(UPLOAD_DIR, { recursive: true });
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? Math.round(value) : NaN;
  if (!Number.isFinite(n) || n < min || n > max) return fallback;
  return n;
}

function defaultManifest(): Manifest {
  const count = 6;
  return {
    count,
    layout: defaultLayoutFor(count),
    slots: Array.from({ length: count }, (_, i) => ({ index: i, title: '', video: null })),
  };
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

/** 读取清单；文件缺失或损坏时返回默认清单，并兼容旧格式（无 count/layout 字段） */
export async function readManifest(): Promise<Manifest> {
  await ensureDirs();
  try {
    const raw = await fsp.readFile(MANIFEST_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<Manifest> & { slots?: Partial<Slot>[] };
    const rawSlots = Array.isArray(parsed.slots) ? parsed.slots : [];
    const count = clampInt(parsed.count ?? rawSlots.length ?? 6, SLOT_MIN, SLOT_MAX, 6);
    const layout: Layout = isValidLayout(parsed.layout, count)
      ? { rows: parsed.layout.rows, cols: parsed.layout.cols }
      : defaultLayoutFor(count);

    const slots: Slot[] = Array.from({ length: count }, (_, i) => {
      const s = rawSlots.find((x) => x?.index === i) ?? rawSlots[i];
      return {
        index: i,
        title: typeof s?.title === 'string' ? s.title : '',
        video:
          s?.video && typeof s.video.filename === 'string'
            ? {
                filename: s.video.filename,
                originalName: typeof s.video.originalName === 'string' ? s.video.originalName : 'video',
                size: Number(s.video.size) || 0,
                mimeType: typeof s.video.mimeType === 'string' ? s.video.mimeType : 'video/mp4',
              }
            : null,
      };
    });
    return { count, layout, slots };
  } catch {
    return defaultManifest();
  }
}

/** 原子写入清单（先写临时文件再 rename） */
export async function writeManifest(manifest: Manifest): Promise<void> {
  await ensureDirs();
  const tmp = `${MANIFEST_PATH}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(manifest, null, 2), 'utf-8');
  await fsp.rename(tmp, MANIFEST_PATH);
}

/**
 * 清单「读-改-写」互斥锁：单进程内将临界区串行化，
 * 防止并发请求互相覆盖（lost update）产生丢失的清单条目与磁盘孤儿文件。
 */
let manifestQueue: Promise<unknown> = Promise.resolve();
export function withManifestLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = manifestQueue.then(fn, fn);
  // 队尾吞掉错误，保证后续排队任务不受前一个失败影响
  manifestQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
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
  const nextSlots: Slot[] = [];
  for (let i = 0; i < count; i++) {
    const old = manifest.slots[i];
    nextSlots.push(old ? { ...old, index: i } : { index: i, title: '', video: null });
  }
  const removedFilenames: string[] = [];
  for (let i = count; i < manifest.slots.length; i++) {
    const old = manifest.slots[i];
    if (old?.video) removedFilenames.push(old.video.filename);
  }
  return {
    manifest: { count, layout, slots: nextSlots },
    removedFilenames,
  };
}

/** 清理文件名中的危险字符，保留可读性 */
function sanitizeOriginalName(name: string): string {
  const cleaned = name.replace(/[/\\:*?"<>|\u0000-\u001f]/g, '_').trim();
  return (cleaned || 'video').slice(0, 120);
}

/** 服务端校验视频文件，返回错误信息（null 表示通过） */
export function validateVideoFile(name: string, mimeType: string, size: number): string | null {
  if (size === 0) return '文件内容为空';
  if (size > MAX_FILE_SIZE) return '文件超过 200MB 大小限制';
  if (!isVideoFile(name, mimeType)) return '仅支持视频文件（MP4 / MOV / WebM 等）';
  return null;
}

/** 保存上传的视频文件，返回其元数据 */
export async function saveVideoFile(file: File): Promise<SlotVideo> {
  await ensureDirs();
  const extMatch = /\.([A-Za-z0-9]{1,8})$/.exec(file.name);
  const ext = extMatch ? `.${extMatch[1].toLowerCase()}` : '.mp4';
  const filename = `${randomUUID()}${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  await fsp.writeFile(path.join(UPLOAD_DIR, filename), buffer);
  return {
    filename,
    originalName: sanitizeOriginalName(file.name),
    size: file.size,
    mimeType: file.type || mimeFromExt(filename),
  };
}

/** 校验文件名是否安全（仅允许 uuid + 扩展名的形式） */
export function isSafeFilename(name: string): boolean {
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9]{1,8}$/.test(name) && !name.includes('..');
}

/** 删除上传目录中的视频文件（忽略不存在的情况） */
export async function deleteVideoFile(filename: string): Promise<void> {
  if (!isSafeFilename(filename)) return;
  await fsp.rm(path.join(UPLOAD_DIR, filename), { force: true });
}
