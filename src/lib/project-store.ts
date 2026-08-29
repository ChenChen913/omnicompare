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
import {
  ContentItem,
  ContentKind,
  DEFAULT_PROJECT_ID,
  FileMeta,
  HTML_EXTS,
  Layout,
  MAX_FILE_SIZE,
  MAX_HTML_SIZE,
  Project,
  ProjectSettings,
  SLOT_MAX,
  SLOT_MIN,
  Slot,
  defaultLayoutFor,
  defaultSettings,
  isVideoFile,
  mimeFromExt,
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
  const kind: ContentKind = r.kind === 'html' ? 'html' : 'video';
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
    return { ...base, kind, file, status };
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
  const customRatio =
    r.customRatio &&
    typeof r.customRatio === 'object' &&
    Number((r.customRatio as Record<string, unknown>).w) > 0 &&
    Number((r.customRatio as Record<string, unknown>).h) > 0
      ? {
          w: Number((r.customRatio as Record<string, unknown>).w),
          h: Number((r.customRatio as Record<string, unknown>).h),
        }
      : undefined;
  return {
    aspectRatio,
    customRatio,
    showTitles: typeof r.showTitles === 'boolean' ? r.showTitles : base.showTitles,
    showInfo: typeof r.showInfo === 'boolean' ? r.showInfo : base.showInfo,
    loop: typeof r.loop === 'boolean' ? r.loop : base.loop,
    muted: typeof r.muted === 'boolean' ? r.muted : base.muted,
    playbackRate: [0.5, 1, 1.25, 1.5, 2].includes(Number(r.playbackRate))
      ? Number(r.playbackRate)
      : base.playbackRate,
  };
}

/**
 * 读取项目清单并归一化。
 * items 按 order 升序输出且重排为紧凑 0..n-1（容忍磁盘上的历史空洞）；
 * slotCount 兜底为 max(items.length, 1)，layout 兜底为按 slotCount 的近方形矩阵。
 */
export async function readProject(id: string): Promise<Project> {
  const now = new Date().toISOString();
  const base: Project = {
    id,
    name: id === DEFAULT_PROJECT_ID ? '默认项目' : '新建项目',
    status: 'active',
    items: [],
    layout: 'auto',
    slotCount: 6,
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

    const slotCount = clampInt(raw.slotCount, SLOT_MIN, SLOT_MAX, Math.max(items.length, 1));
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
    if (!item) return { index: i, title: '', video: null, html: null };
    // Step 7：单卡比例覆盖随视图透传（null = 跟随全局，蓝图 §13）
    const aspect = item.aspectRatio ?? null;
    return item.kind === 'html'
      ? { index: i, title: item.title, video: null, kind: 'html' as const, html: item.file, aspectRatio: aspect }
      : { index: i, title: item.title, video: item.file, kind: 'video' as const, html: null, aspectRatio: aspect };
  });
}

/* ============================== 文件服务 ============================== */

/** 服务端校验上传文件，返回错误信息（null 表示通过）；kind 由 MIME + 扩展名双判 */
export function validateUploadFile(
  name: string,
  mimeType: string,
  size: number,
): { kind: ContentKind } | { error: string } {
  if (size === 0) return { error: '文件内容为空' };
  const ext = path.extname(name).toLowerCase();
  const isHtml = (HTML_EXTS as readonly string[]).includes(ext);
  if (isHtml || mimeType === 'text/html') {
    if (size > MAX_HTML_SIZE) return { error: 'HTML 文件超过 10MB 大小限制' };
    if (!isHtml) return { error: '仅支持 .html / .htm 文件' };
    return { kind: 'html' };
  }
  if (size > MAX_FILE_SIZE) return { error: '文件超过 200MB 大小限制' };
  if (!isVideoFile(name, mimeType)) return { error: '仅支持视频或单文件 HTML' };
  return { kind: 'video' };
}

/** 保存上传文件到指定项目，返回其元数据 */
export async function saveFile(projectId: string, file: File, kind: ContentKind): Promise<FileMeta> {
  const dir = projectFilesDir(projectId);
  await fsp.mkdir(dir, { recursive: true });
  const extMatch = path.extname(file.name).toLowerCase();
  const ext = extMatch && /^(\.[A-Za-z0-9]{1,8})$/.test(extMatch) ? extMatch : kind === 'html' ? '.html' : '.mp4';
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

/** 删除项目内文件（忽略不存在的情况） */
export async function deleteFile(projectId: string, filename: string): Promise<void> {
  if (!isSafeFilename(filename)) return;
  await fsp.rm(path.join(projectFilesDir(projectId), filename), { force: true });
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

  // 读 v1 清单（损坏/缺失则按空项目迁移）
  let count = 6;
  let layout: Layout = defaultLayoutFor(6);
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
