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
import { ContentItem, DEFAULT_PROJECT_ID, FileMeta, Layout, Manifest, Slot } from './types';
import {
  deleteFile,
  ensureDefaultProject,
  readProject,
  saveFile,
  toSlots,
  withProjectLock,
  writeProject,
} from './project-store';

export { isValidLayout, isSafeFilename } from './project-store';

/**
 * 清单「读-改-写」互斥锁：单进程内将临界区串行化，
 * 防止并发请求互相覆盖（lost update）产生丢失的清单条目与磁盘孤儿文件。
 * v1 全局锁 = v2 默认项目锁。
 */
export function withManifestLock<T>(fn: () => Promise<T>): Promise<T> {
  return withProjectLock(DEFAULT_PROJECT_ID, fn);
}

/** 读取默认项目的 v1 视图清单 */
export async function readManifest(): Promise<Manifest> {
  await ensureDefaultProject();
  const project = await readProject(DEFAULT_PROJECT_ID);
  return {
    count: project.slotCount,
    layout: project.layout === 'auto' ? { rows: 1, cols: project.slotCount } : project.layout,
    slots: toSlots(project),
  };
}

/** 写清单：body 为 v1 视图（readManifest 的产物），按 slots 差量写回 items */
export async function writeManifest(manifest: Manifest): Promise<void> {
  const project = await readProject(DEFAULT_PROJECT_ID);
  project.slotCount = manifest.count;
  // v1 视图无 auto 概念：矩阵始终为显式行列
  project.layout = manifest.layout;
  project.items = manifest.slots
    .map((slot: Slot, order: number): ContentItem | null => {
      if (!slot.video) return null;
      const existing = project.items[order];
      const now = new Date().toISOString();
      return {
        id: existing?.id ?? randomUUID(),
        kind: 'video',
        title: slot.title,
        order,
        aspectRatio: existing?.aspectRatio ?? null,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        file: slot.video,
      };
    })
    .filter((it): it is ContentItem => it !== null)
    // 紧凑序不变量：删除/替换后重排为 0..n-1（空洞在写入时即消除，蓝图 §19.4）
    .map((it, i) => (it.order === i ? it : { ...it, order: i }));
  project.updatedAt = new Date().toISOString();
  await writeProject(project);
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
  }
  while (nextSlots.length < count) {
    nextSlots.push({ index: nextSlots.length, title: '', video: null });
  }
  return {
    manifest: { count, layout, slots: nextSlots.map((s, i) => ({ ...s, index: i })) },
    removedFilenames,
  };
}

/** 服务端校验视频文件，返回错误信息（null 表示通过） */
export function validateVideoFile(name: string, mimeType: string, size: number): string | null {
  if (size === 0) return '文件内容为空';
  if (size > 200 * 1024 * 1024) return '文件超过 200MB 大小限制';
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
  const videoExts = ['.mp4', '.m4v', '.mov', '.webm', '.ogv', '.avi', '.mkv'];
  if (!mimeType.startsWith('video/') && !videoExts.includes(ext)) {
    return '仅支持视频文件（MP4 / MOV / WebM 等）';
  }
  return null;
}

/** 保存上传的视频文件（写入默认项目 files/ 目录），返回其元数据 */
export async function saveVideoFile(file: File): Promise<FileMeta> {
  return saveFile(DEFAULT_PROJECT_ID, file, 'video');
}

/** 删除默认项目中的视频文件（忽略不存在的情况） */
export async function deleteVideoFile(filename: string): Promise<void> {
  return deleteFile(DEFAULT_PROJECT_ID, filename);
}
