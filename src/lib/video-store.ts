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
  AspectRatio,
  ContentItem,
  ContentKind,
  DEFAULT_PROJECT_ID,
  FileMeta,
  Layout,
  Manifest,
  ManifestSettings,
  ProjectSettings,
  Slot,
  autoLayoutFor,
  defaultSettings,
} from './types';
import {
  deleteFile,
  ensureDefaultProject,
  readProject,
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
      showTitles: st.showTitles,
      showInfo: st.showInfo,
      loop: st.loop,
      muted: st.muted,
      playbackRate: st.playbackRate,
    },
  };
}

/** 写清单：body 为 v1 视图（readManifest 的产物），按 slots 差量写回 items。
 * Step 5 起视图携带 kind/html 扩展字段，HTML 条目在 v1 写路径中原样保留；
 * 兼容未携带扩展字段的旧客户端（仅有 video 字段的槽位照常落为视频条目）。 */
export async function writeManifest(manifest: Manifest, projectId: string = DEFAULT_PROJECT_ID): Promise<void> {
  const project = await readProject(projectId);
  const previousFiles = new Set(project.items.map((it) => it.file.filename));

  project.slotCount = manifest.count;
  // Step 6 起 v1 视图支持 auto 模式：layoutMode='auto' 时存 'auto'，
  // 矩阵由读取方按 slotCount 现算；manual 时存显式行列（原行为）
  project.layout = manifest.layoutMode === 'auto' ? 'auto' : manifest.layout;
  // Step 7：视图携带设置时写回（仅接受合法值，防御旧/异常客户端）
  if (manifest.settings) {
    project.settings = {
      ...project.settings,
      ...normalizeManifestSettings(manifest.settings),
    };
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
      // HTML 条目：保留原有加载状态（status 由客户端渲染时本地流转）
      items.push({
        ...base,
        kind: 'html',
        file: slot.html,
        status: existing && existing.kind === 'html' ? existing.status : 'ready',
      });
    } else if (slot.video) {
      items.push({ ...base, kind: 'video', file: slot.video });
    }
    // 其余（video 与 html 均为空）= 空位：不生成条目，紧凑序由下方重排保证
  });
  project.items = items
    // 紧凑序不变量：删除/替换后重排为 0..n-1（空洞在写入时即消除，蓝图 §19.4）
    .map((it, i) => (it.order === i ? it : { ...it, order: i }));

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
 * v1 视图设置 -> ProjectSettings 字段校验：仅接受合法值，其余回落默认项目当前值。
 * customRatio 为第二阶段 UI，v1 视图不涉及。
 */
function normalizeManifestSettings(s: ManifestSettings): ProjectSettings {
  const base = defaultSettings();
  const aspects: AspectRatio[] = ['16:9', '9:16', '1:1', 'original', 'custom'];
  return {
    aspectRatio: aspects.includes(s.aspectRatio) ? s.aspectRatio : base.aspectRatio,
    showTitles: typeof s.showTitles === 'boolean' ? s.showTitles : base.showTitles,
    showInfo: typeof s.showInfo === 'boolean' ? s.showInfo : base.showInfo,
    loop: typeof s.loop === 'boolean' ? s.loop : base.loop,
    muted: typeof s.muted === 'boolean' ? s.muted : base.muted,
    playbackRate:
      typeof s.playbackRate === 'number' && [0.5, 1, 1.25, 1.5, 2].includes(s.playbackRate)
        ? s.playbackRate
        : base.playbackRate,
  };
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
