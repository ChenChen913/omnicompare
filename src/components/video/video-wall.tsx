'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  Clapperboard,
  Expand,
  Eye,
  EyeOff,
  FolderPlus,
  Gauge,
  Info,
  LayoutGrid,
  Library,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Pause,
  Play,
  Repeat,
  Settings,
  Shrink,
  Sun,
  Trash2,
  UploadCloud,
  Volume2,
  VolumeX,
  Wand2,
} from 'lucide-react';
import { toast } from 'sonner';
import { useTheme } from 'next-themes';
import {
  DndContext,
  DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '@/lib/utils';
import {
  AspectRatio,
  DEFAULT_PROJECT_ID,
  Layout,
  Manifest,
  ManifestSettings,
  Project,
  SLOT_MAX,
  Slot,
  aspectCss,
  aspectLabel,
  defaultLayoutFor,
  defaultSettings,
  isContentFile,
  layoutOptionsFor,
  validateClientFile,
} from '@/lib/types';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { VideoCard, VideoCardProps } from './video-card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

/** 工作模式与侧栏开关（仅 UI 偏好，业务数据永远以服务端为准）；当前项目同此列 */
const PREF_MODE = 'omnicompare:mode';
const PREF_SIDEBAR = 'omnicompare:sidebar';
const PREF_PROJECT = 'omnicompare:project';

/** 项目状态展示名与状态点配色（蓝图 §7：active/draft/archived） */
const STATUS_META = {
  active: { label: '进行中', dot: 'bg-emerald-500' },
  draft: { label: '草稿', dot: 'bg-amber-500' },
  archived: { label: '已归档', dot: 'bg-muted-foreground/40' },
} as const;

function defaultSlots(): Slot[] {
  return Array.from({ length: 6 }, (_, i) => ({ index: i, title: '', video: null }));
}

/** 拖拽排序的稳定 id：文件名全局唯一（uuid + 扩展名），与 React key 同源；空位不参与排序 */
function sortableIdOf(slot: Slot): string {
  return slot.video?.filename ?? slot.html?.filename ?? `empty-${slot.index}`;
}

/**
 * Sortable 包装层：为已放置内容卡片接入 dnd-kit 排序。
 * 外层 div 承担 transform 与 ref；卡片本身只在拖拽中抬升（蓝图 §14）。
 * React key 用稳定文件名：排序后 DOM 节点被移动而非复用重建，视频播放不中断。
 */
function SortableCard({
  slot,
  ...cardProps
}: { slot: Slot } & Omit<VideoCardProps, 'slot' | 'dragHandle' | 'isDragging'>) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: sortableIdOf(slot),
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn('flex', isDragging && 'relative z-30')}
    >
      <VideoCard
        slot={slot}
        dragHandle={
          { ...(attributes as object), ...(listeners as object) } as React.HTMLAttributes<HTMLSpanElement>
        }
        isDragging={isDragging}
        {...cardProps}
      />
    </div>
  );
}

/** 顶部控制按钮的基础样式 */
const ctlBtn =
  'inline-flex h-10 items-center gap-1.5 rounded-lg border px-2.5 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-not-allowed disabled:opacity-50 sm:px-3';

/** 矩阵选项：迷你预览图 + 行×列标签 */
function MatrixOption({
  layout,
  count,
  active,
  onSelect,
}: {
  layout: Layout;
  count: number;
  active: boolean;
  onSelect: () => void;
}) {
  const pad = layout.rows * layout.cols - count;
  const maxDim = Math.max(layout.rows, layout.cols);
  const cell = Math.min(9, Math.max(4, Math.floor((84 - (maxDim - 1) * 2) / maxDim)));
  return (
    <button
      type="button"
      onClick={onSelect}
      title={`${layout.rows} 行 × ${layout.cols} 列${pad > 0 ? `，末尾留 ${pad} 个空格` : ''}`}
      aria-pressed={active}
      className={cn(
        'flex flex-col items-center justify-start gap-1.5 rounded-lg border px-1.5 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
        active
          ? 'border-primary bg-primary/15'
          : 'border-border/80 bg-muted/40 hover:border-muted-foreground/40 hover:bg-accent',
      )}
    >
      <span
        className="grid gap-[2px]"
        style={{ gridTemplateColumns: `repeat(${layout.cols}, ${cell}px)` }}
        aria-hidden
      >
        {Array.from({ length: layout.rows * layout.cols }).map((_, i) => (
          <span
            key={i}
            className={cn('rounded-[1px]', i < count ? 'bg-primary/80' : 'bg-muted-foreground/30')}
            style={{ width: cell, height: cell }}
          />
        ))}
      </span>
      <span className={cn('text-[11px] font-semibold', active ? 'text-primary' : 'text-muted-foreground')}>
        {layout.rows}×{layout.cols}
        {pad > 0 && <span className="ml-0.5 text-[9px] font-normal text-amber-600 dark:text-amber-400/90">补</span>}
      </span>
    </button>
  );
}

export function VideoWall() {
  const [slots, setSlots] = useState<Slot[]>(defaultSlots);
  const [count, setCount] = useState(6);
  const [layout, setLayout] = useState<Layout>({ rows: 2, cols: 3 });
  /** 布局模式：auto = 按数量自动近方形（默认）；manual = 用户显式选矩阵（蓝图 §12） */
  const [layoutMode, setLayoutMode] = useState<'auto' | 'manual'>('auto');
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState<Record<number, boolean>>({});
  const [importing, setImporting] = useState(false);
  /* 播放与展示设置（Step 7：服务端 Project.settings 为唯一事实源，蓝图 §7/§15） */
  const [loop, setLoop] = useState(true);
  const [mutedAll, setMutedAll] = useState(false);
  const [aspect, setAspect] = useState<AspectRatio>('original');
  const [showTitles, setShowTitles] = useState(true);
  const [showInfo, setShowInfo] = useState(true);
  const [rate, setRate] = useState(1);
  const [gridDrag, setGridDrag] = useState(false);
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  /** studio = 管理（全部控件 + 侧栏）；focus = 观看（极简顶栏 + 满幅网格） */
  const [mode, setMode] = useState<'studio' | 'focus'>('studio');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  /** 侧栏窗格列表点击定位时的高亮位 */
  const [highlight, setHighlight] = useState<number | null>(null);
  const [themeMounted, setThemeMounted] = useState(false);
  /** 窄屏（<768px）标记：仅 auto 模式渲染列数收窄用 */
  const [narrow, setNarrow] = useState(false);
  /* 多项目（Step 8）：当前项目 id + 项目列表（顶栏切换器与侧栏项目卡共用） */
  const [projectId, setProjectId] = useState<string>(DEFAULT_PROJECT_ID);
  const [projects, setProjects] = useState<Project[]>([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [projectBusy, setProjectBusy] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');
  const { resolvedTheme, setTheme } = useTheme();

  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);
  const importInputRef = useRef<HTMLInputElement>(null);
  const titleTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setVideoRef = useCallback((index: number, el: HTMLVideoElement | null) => {
    videoRefs.current[index] = el;
  }, []);

  const busy = importing || Object.values(uploading).some(Boolean);
  const filledCount = slots.filter((s) => s.video || s.html).length;
  const currentProject = projects.find((p) => p.id === projectId) ?? null;
  const projectName =
    currentProject?.name ?? (projectId === DEFAULT_PROJECT_ID ? '默认项目' : '加载中…');

  /** v1 API 多项目参数（Step 8）：默认项目不带参数（旧端点零改动），其余项目追加 project= */
  const withPid = useCallback(
    (url: string) =>
      projectId === DEFAULT_PROJECT_ID
        ? url
        : `${url}${url.includes('?') ? '&' : '?'}project=${encodeURIComponent(projectId)}`,
    [projectId],
  );
  const getActiveVideos = useCallback(
    () =>
      slots
        .filter((s) => s.video)
        .map((s) => videoRefs.current[s.index])
        .filter((v): v is HTMLVideoElement => !!v),
    [slots],
  );

  /* ---------- 拖拽排序传感器（鼠标距离阈值 / 触摸延迟防滚动误触 / 键盘无障碍） ---------- */
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  /** 从任意清单响应中同步播放与展示设置（缺省字段回落默认值） */
  const applySettings = useCallback((s?: ManifestSettings) => {
    const d = defaultSettings();
    setAspect(s?.aspectRatio ?? d.aspectRatio);
    setShowTitles(s?.showTitles ?? d.showTitles);
    setShowInfo(s?.showInfo ?? d.showInfo);
    setLoop(s?.loop ?? d.loop);
    setMutedAll(s?.muted ?? d.muted);
    setRate(s?.playbackRate ?? d.playbackRate);
  }, []);

  /* ---------- 初始化：拉取清单 + 恢复本地偏好 ---------- */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(withPid('/api/videos'), { cache: 'no-store' });
        if (res.status === 404) {
          // 当前项目已被其他会话删除：清除本地偏好并回落默认项目（触发重载）
          if (!cancelled) {
            try {
              localStorage.removeItem(PREF_PROJECT);
            } catch {}
            setProjectId(DEFAULT_PROJECT_ID);
          }
          return;
        }
        const data = (await res.json()) as Manifest;
        if (!cancelled && Array.isArray(data?.slots)) {
          setCount(data.count);
          setLayout(data.layout);
          setLayoutMode(data.layoutMode === 'auto' ? 'auto' : 'manual');
          setSlots(data.slots);
          applySettings(data.settings);
        }
      } catch {
        if (!cancelled) toast.error('加载内容列表失败，请刷新重试');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applySettings, withPid]);

  /* 窄屏检测：auto 模式下列数收窄到 2 竖向堆叠（蓝图 §12；仅影响渲染，不改存储矩阵） */
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const onChange = () => setNarrow(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    try {
      const savedMode = localStorage.getItem(PREF_MODE);
      if (savedMode === 'studio' || savedMode === 'focus') setMode(savedMode);
      const savedSidebar = localStorage.getItem(PREF_SIDEBAR);
      if (savedSidebar !== null) setSidebarOpen(savedSidebar === '1');
      const savedProject = localStorage.getItem(PREF_PROJECT);
      if (savedProject) setProjectId(savedProject);
    } catch {
      /* 忽略隐私模式下的存储错误 */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(PREF_MODE, mode);
    } catch {}
  }, [mode]);

  useEffect(() => {
    try {
      localStorage.setItem(PREF_SIDEBAR, sidebarOpen ? '1' : '0');
    } catch {}
  }, [sidebarOpen]);

  /* ---------- 多项目管理（Step 8）：列表加载 / 切换 / 新建 / 改名 / 状态 / 删除 ---------- */
  /** 项目列表加载；同时校正本地持久化的当前项目（被其他会话删除后回落默认） */
  const refreshProjects = useCallback(async () => {
    try {
      const res = await fetch('/api/projects', { cache: 'no-store' });
      const list = (await res.json().catch(() => null)) as Project[] | null;
      if (!Array.isArray(list)) return;
      setProjects(list);
      setProjectId((cur) => {
        if (cur !== DEFAULT_PROJECT_ID && !list.some((p) => p.id === cur)) {
          try {
            localStorage.removeItem(PREF_PROJECT);
          } catch {}
          return DEFAULT_PROJECT_ID;
        }
        return cur;
      });
    } catch {
      /* 列表加载失败不阻塞主流程，下次操作重试 */
    }
  }, []);

  useEffect(() => {
    void refreshProjects();
  }, [refreshProjects]);

  /** 切换项目：内容处理中禁止切换，避免在途请求把旧项目数据写进新项目视图 */
  const switchProject = useCallback(
    (id: string) => {
      if (id === projectId) return;
      if (busy) {
        toast.warning('内容处理中，请稍后再切换项目', { id: 'project' });
        return;
      }
      try {
        localStorage.setItem(PREF_PROJECT, id);
      } catch {}
      setLoading(true);
      setProjectId(id);
    },
    [projectId, busy],
  );

  const createProject = useCallback(async () => {
    if (busy) {
      toast.warning('内容处理中，请稍后再新建项目', { id: 'project' });
      return;
    }
    setProjectBusy(true);
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName }),
      });
      const p = (await res.json().catch(() => null)) as (Project & { error?: string }) | null;
      if (!res.ok || !p?.id) {
        toast.error(p?.error || '新建项目失败，请重试', { id: 'project' });
        return;
      }
      setProjects((prev) => [...prev, p]);
      setNewName('');
      setCreating(false);
      try {
        localStorage.setItem(PREF_PROJECT, p.id);
      } catch {}
      setLoading(true);
      setProjectId(p.id);
      toast.success(`已创建「${p.name}」并切换`, { id: 'project' });
    } catch {
      toast.error('新建项目失败，请重试', { id: 'project' });
    } finally {
      setProjectBusy(false);
    }
  }, [newName, busy]);

  /** 改名 / 状态：乐观更新 + 失败回滚（同 updateSettings 风格） */
  const updateProject = useCallback(
    async (id: string, patch: { name?: string; status?: Project['status'] }) => {
      const prevList = projects;
      setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
      try {
        const res = await fetch(`/api/projects/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        });
        const p = (await res.json().catch(() => null)) as (Project & { error?: string }) | null;
        if (!res.ok || !p?.id) throw new Error(p?.error || '保存失败');
        toast.success(patch.name !== undefined ? '项目已重命名' : '项目状态已更新', { id: 'project' });
      } catch {
        setProjects(prevList);
        toast.error('项目更新失败，请重试', { id: 'project' });
      }
    },
    [projects],
  );

  const deleteProject = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE' });
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as { error?: string } | null;
          toast.error(data?.error || '删除项目失败', { id: 'project' });
          return;
        }
        setProjects((prev) => prev.filter((p) => p.id !== id));
        if (id === projectId) {
          try {
            localStorage.removeItem(PREF_PROJECT);
          } catch {}
          setLoading(true);
          setProjectId(DEFAULT_PROJECT_ID);
        }
        toast.success('项目已删除', { id: 'project' });
      } catch {
        toast.error('删除项目失败', { id: 'project' });
      }
    },
    [projectId],
  );

  /* next-themes 首帧渲染后才确定主题，先挂载再渲染图标避免水合不一致 */
  useEffect(() => setThemeMounted(true), []);

  /** 切换明暗主题 */
  const toggleTheme = useCallback(() => {
    setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
  }, [resolvedTheme, setTheme]);

  /** Studio ↔ Focus 双向切换：只改壳层，不动内容与播放状态 */
  const toggleMode = useCallback(() => {
    setMode((m) => (m === 'studio' ? 'focus' : 'studio'));
  }, []);

  /**
   * 侧栏窗格点击：滚动到对应卡片并短暂高亮。
   * 只滚动视口、不改任何状态，网格与视频元素不受影响。
   */
  const focusSlot = useCallback((index: number) => {
    document.getElementById(`slot-card-${index}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    setHighlight(index);
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => setHighlight(null), 1600);
  }, []);

  /**
   * 全局设置更新：乐观更新 + PATCH 响应回填；失败提示不叠加（固定通道 id）。
   * loop/muted/比例/标题与属性显隐/播放速度全部走服务端 Project.settings（蓝图 §7/§15）。
   */
  const updateSettings = useCallback(
    async (partial: Partial<ManifestSettings>) => {
      const prev = { aspect, showTitles, showInfo, loop, muted: mutedAll, playbackRate: rate };
      // 乐观回填
      if (partial.aspectRatio !== undefined) setAspect(partial.aspectRatio);
      if (partial.showTitles !== undefined) setShowTitles(partial.showTitles);
      if (partial.showInfo !== undefined) setShowInfo(partial.showInfo);
      if (partial.loop !== undefined) setLoop(partial.loop);
      if (partial.muted !== undefined) setMutedAll(partial.muted);
      if (partial.playbackRate !== undefined) setRate(partial.playbackRate);
      try {
        const res = await fetch(withPid('/api/videos/settings'), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(partial),
        });
        const data = (await res.json().catch(() => null)) as (Manifest & { error?: string }) | null;
        if (!res.ok || !data?.slots) throw new Error(data?.error || '设置保存失败');
        applySettings(data.settings);
      } catch {
        // 回滚乐观更新
        setAspect(prev.aspect);
        setShowTitles(prev.showTitles);
        setShowInfo(prev.showInfo);
        setLoop(prev.loop);
        setMutedAll(prev.muted);
        setRate(prev.playbackRate);
        toast.error('设置保存失败，请重试', { id: 'settings' });
      }
    },
    [aspect, showTitles, showInfo, loop, mutedAll, rate, applySettings, withPid],
  );

  /** 单卡比例覆盖：null = 恢复跟随全局（蓝图 §13）；乐观更新 + 失败回滚 */
  const handleSlotAspect = useCallback(
    (index: number, ar: AspectRatio | null) => {
      const prevSlots = slots;
      setSlots((s) => s.map((it) => (it.index === index ? { ...it, aspectRatio: ar } : it)));
      void (async () => {
        try {
          const res = await fetch(withPid('/api/videos'), {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ slot: index, aspectRatio: ar }),
          });
          const data = (await res.json().catch(() => null)) as (Manifest & { error?: string }) | null;
          if (!res.ok || !data?.slots) throw new Error(data?.error || '比例保存失败');
          setSlots(data.slots);
        } catch {
          setSlots(prevSlots);
          toast.error('比例保存失败，已恢复', { id: 'aspect' });
        }
      })();
    },
    [slots, withPid],
  );

  /* React 对 video 的 muted/loop/playbackRate 属性更新不可靠，直接同步到 DOM 元素 */
  useEffect(() => {
    videoRefs.current.forEach((v) => {
      if (!v) return;
      v.loop = loop;
      v.muted = mutedAll;
      try {
        v.playbackRate = rate;
      } catch {
        /* 个别浏览器对不支持的速率会抛错，忽略 */
      }
    });
  }, [loop, mutedAll, rate, slots]);

  useEffect(() => {
    const timers = titleTimers.current;
    const hlTimer = highlightTimer.current;
    return () => {
      timers.forEach((t) => clearTimeout(t));
      if (hlTimer) clearTimeout(hlTimer);
    };
  }, []);

  /* ---------- 数量与矩阵 ---------- */
  const requestLayout = useCallback(
    async (nextCount: number, nextLayout: Layout | 'auto'): Promise<Manifest | null> => {
      try {
        const res = await fetch(withPid('/api/videos/layout'), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body:
            nextLayout === 'auto'
              ? JSON.stringify({ count: nextCount, layout: 'auto' })
              : JSON.stringify({ count: nextCount, rows: nextLayout.rows, cols: nextLayout.cols }),
        });
        const data = (await res.json().catch(() => null)) as (Manifest & { error?: string }) | null;
        if (!res.ok || !data?.slots) {
          toast.error(data?.error || '调整布局失败，请重试', { id: 'layout' });
          return null;
        }
        setCount(data.count);
        setLayout(data.layout);
        setLayoutMode(data.layoutMode === 'auto' ? 'auto' : 'manual');
        setSlots(data.slots);
        return data;
      } catch {
        toast.error('调整布局失败，请重试', { id: 'layout' });
        return null;
      }
    },
    [withPid],
  );

  /** 缩减到 n 个位置时，将被移除区间内实际存在的内容数（视频或 HTML） */
  const removedContentCount = useCallback(
    (n: number) => slots.slice(n).filter((s) => s.video || s.html).length,
    [slots],
  );

  /** 选择数量：缩减且被移除区间内有内容时弹确认框；auto 模式矩阵随数量自动跟随 */
  const handleCountSelect = useCallback(
    (n: number) => {
      if (busy || n === count) return;
      if (removedContentCount(n) > 0) {
        setPendingCount(n);
        return;
      }
      void requestLayout(n, layoutMode === 'auto' ? 'auto' : defaultLayoutFor(n)).then((m) => {
        // 固定 id：连续快速切换数量时只更新同一条提示，不会叠加成一堆
        if (m) toast.success(`已切换为 ${n} 个内容位`, { id: 'layout', duration: 2000 });
      });
    },
    [busy, count, layoutMode, removedContentCount, requestLayout],
  );

  const confirmShrink = useCallback(() => {
    const n = pendingCount;
    setPendingCount(null);
    if (n === null) return;
    const removed = removedContentCount(n);
    void requestLayout(n, layoutMode === 'auto' ? 'auto' : defaultLayoutFor(n)).then((m) => {
      if (m) {
        toast.success(
          removed > 0 ? `已缩减为 ${n} 个内容位，${removed} 个内容已移除` : `已切换为 ${n} 个内容位`,
          { id: 'layout', duration: 2000 },
        );
      }
    });
  }, [pendingCount, layoutMode, removedContentCount, requestLayout]);

  /** 手动选择矩阵：覆盖 auto 并记住（蓝图 §12「用户任何手动选择都会覆盖 auto 并记住」） */
  const handleLayoutSelect = useCallback(
    (l: Layout) => {
      if (busy) return;
      void requestLayout(count, l);
    },
    [busy, count, requestLayout],
  );

  /** 切回自动排列：矩阵交给系统按数量计算 */
  const handleAutoSelect = useCallback(() => {
    if (busy || layoutMode === 'auto') return;
    void requestLayout(count, 'auto').then((m) => {
      if (m) toast.success('已切换为自动排列', { id: 'layout', duration: 2000 });
    });
  }, [busy, count, layoutMode, requestLayout]);

  /* ---------- 拖拽排序 ---------- */
  const filledSlots = useMemo(() => slots.filter((s) => s.video || s.html), [slots]);
  const sortableIds = useMemo(() => filledSlots.map(sortableIdOf), [filledSlots]);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const oldIdx = sortableIds.indexOf(String(active.id));
      const newIdx = sortableIds.indexOf(String(over.id));
      if (oldIdx === -1 || newIdx === -1) return;

      const reordered = arrayMove(filledSlots, oldIdx, newIdx);
      // 服务端语义：新位置 i 放旧位置 order[i] 的内容；在 index 重编号前捕获旧位置
      const order = reordered.map((s) => s.index);
      const empties = slots.filter((s) => !s.video && !s.html);
      const prevSlots = slots;
      // 乐观更新：紧凑左填不变量（内容在前、空位在后），index 重编号。
      // 卡片 key 为稳定文件名：DOM 节点被移动而非重建，视频播放状态不中断
      setSlots([...reordered, ...empties].map((s, i) => ({ ...s, index: i })));
      void (async () => {
        try {
          const res = await fetch(withPid('/api/videos/reorder'), {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ order }),
          });
          const data = (await res.json().catch(() => null)) as (Manifest & { error?: string }) | null;
          if (!res.ok || !data?.slots) throw new Error(data?.error || '排序保存失败');
          setCount(data.count);
          setLayout(data.layout);
          setLayoutMode(data.layoutMode === 'auto' ? 'auto' : 'manual');
          setSlots(data.slots);
          applySettings(data.settings);
        } catch {
          setSlots(prevSlots);
          toast.error('排序保存失败，已恢复原顺序', { id: 'reorder' });
        }
      })();
    },
    [slots, filledSlots, sortableIds, withPid],
  );

  /* ---------- 上传与分配 ---------- */
  /** 上传单个文件到指定位置；返回失败原因（null 表示成功），提示由调用方聚合成一条 */
  const uploadToSlot = useCallback(async (index: number, file: File): Promise<string | null> => {
    const invalid = validateClientFile(file);
    if (invalid) return `「${file.name}」${invalid}`;
    setUploading((prev) => ({ ...prev, [index]: true }));
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('slot', String(index));
      const res = await fetch(withPid('/api/videos/upload'), { method: 'POST', body: fd });
      const data = (await res.json().catch(() => null)) as (Manifest & { error?: string }) | null;
      if (!res.ok || !data?.slots) {
        return data?.error || `「${file.name}」上传失败，请重试`;
      }
      setCount(data.count);
      setLayout(data.layout);
      setLayoutMode(data.layoutMode === 'auto' ? 'auto' : 'manual');
      setSlots(data.slots);
      return null;
    } catch {
      return `「${file.name}」上传失败，请检查网络后重试`;
    } finally {
      setUploading((prev) => ({ ...prev, [index]: false }));
    }
  }, [withPid]);

  /**
   * 分配一批文件：第一个进入 primarySlot（如果指定），
   * 其余按「空位优先、已占用靠后」的顺序依次放入。
   * 智能识别：文件数超过当前位数时自动扩容并换用合适的矩阵。
   */
  const distributeFiles = useCallback(
    async (files: File[], primarySlot?: number) => {
      const vids = files.filter((f) => isContentFile(f.name, f.type));
      const skipped = files.length - vids.length;
      if (vids.length === 0) {
        toast.error('仅支持视频或单文件 HTML，请重新选择', { id: 'import' });
        return;
      }
      if (vids.length > SLOT_MAX) {
        toast.warning(`单次最多导入 ${SLOT_MAX} 个内容，超出部分已忽略`, { id: 'import' });
      }
      const batch = vids.slice(0, SLOT_MAX);

      let targetSlots = slots;
      let primary = primarySlot;
      let expanded = false;

      if (batch.length > slots.length) {
        const m = await requestLayout(
          batch.length,
          layoutMode === 'auto' ? 'auto' : defaultLayoutFor(batch.length),
        );
        if (!m) return;
        targetSlots = m.slots;
        expanded = true;
      }
      if (primary !== undefined && !targetSlots.some((s) => s.index === primary)) {
        primary = undefined;
      }

      // 目标位选择：空位（无 video 也无 html）优先
      const targets: number[] = [];
      if (primary !== undefined) targets.push(primary);
      targets.push(...targetSlots.filter((s) => !s.video && !s.html && s.index !== primary).map((s) => s.index));
      targets.push(...targetSlots.filter((s) => (s.video || s.html) && s.index !== primary).map((s) => s.index));

      setImporting(true);
      try {
        const n = Math.min(targets.length, batch.length);
        let ok = 0;
        const failures: string[] = [];
        for (let i = 0; i < n; i++) {
          const err = await uploadToSlot(targets[i], batch[i]);
          if (err) failures.push(err);
          else ok++;
        }
        // 单条聚合提示：成功 / 部分失败 / 全部失败都只占一条，附扩位与跳过信息，避免逐文件刷屏
        if (ok > 0) {
          const parts: string[] = [
            expanded
              ? `已扩展至 ${batch.length} 位并导入 ${ok} 个内容`
              : batch.length === 1
                ? '已导入 1 个内容'
                : `已导入 ${ok} 个内容`,
          ];
          if (failures.length > 0) {
            parts.push(`${failures.length} 个失败（${failures[0]}${failures.length > 1 ? ' 等' : ''}）`);
          }
          if (skipped > 0) parts.push(`${skipped} 个不支持的文件已跳过`);
          if (failures.length > 0) {
            toast.warning(parts.join('，'), { id: 'import', duration: 4500 });
          } else {
            toast.success(parts.join('，'), { id: 'import' });
          }
        } else if (failures.length > 0) {
          toast.error(
            failures.length > 1
              ? `导入失败：${failures.length} 个文件均未成功（${failures[0]}）`
              : `导入失败：${failures[0]}`,
            { id: 'import', duration: 4500 },
          );
        }
      } finally {
        setImporting(false);
      }
    },
    [slots, layoutMode, uploadToSlot, requestLayout],
  );

  /* ---------- 标题（防抖保存） ---------- */
  const handleTitleChange = useCallback((index: number, title: string) => {
    setSlots((prev) => prev.map((s) => (s.index === index ? { ...s, title } : s)));
    const timer = titleTimers.current.get(index);
    if (timer) clearTimeout(timer);
    titleTimers.current.set(
      index,
      setTimeout(() => {
        fetch(withPid('/api/videos'), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slot: index, title }),
        }).catch(() => {});
      }, 600),
    );
  }, [withPid]);

  /* ---------- 移除 ---------- */
  const handleClearSlot = useCallback(async (index: number) => {
    try {
      const res = await fetch(withPid(`/api/videos?slot=${index}`), { method: 'DELETE' });
      const data = (await res.json().catch(() => null)) as (Manifest & { error?: string }) | null;
      if (!res.ok || !data?.slots) {
        toast.error(data?.error || '移除失败，请重试', { id: 'slot' });
        return;
      }
      setSlots(data.slots);
      toast.success(`已移除位置 ${index + 1} 的内容`, { id: 'slot' });
    } catch {
      toast.error('移除失败，请重试', { id: 'slot' });
    }
  }, [withPid]);

  const handleClearAll = useCallback(async () => {
    try {
      const res = await fetch(withPid('/api/videos?all=1'), { method: 'DELETE' });
      const data = (await res.json().catch(() => null)) as (Manifest & { error?: string }) | null;
      if (!res.ok || !data?.slots) {
        toast.error(data?.error || '清空失败，请重试', { id: 'clear' });
        return;
      }
      setCount(data.count);
      setLayout(data.layout);
      setSlots(data.slots);
      toast.success('已清空全部内容', { id: 'clear' });
    } catch {
      toast.error('清空失败，请重试', { id: 'clear' });
    }
  }, [withPid]);

  /* ---------- 批量播放控制 ---------- */
  const handlePlayAll = useCallback(() => {
    const active = getActiveVideos();
    if (active.length === 0) {
      toast.error('还没有可播放的视频，请先上传', { id: 'play' });
      return;
    }
    // 先统一暂停并回到开头，再一起播放，保证起始同步
    active.forEach((v) => {
      try {
        v.pause();
        v.currentTime = 0;
      } catch {
        /* 个别浏览器在未加载元数据时设置进度会抛错，忽略 */
      }
    });
    window.setTimeout(() => {
      const attempts = active.map((v) => v.play());
      Promise.allSettled(attempts).then((results) => {
        if (results.length > 0 && results.every((r) => r.status === 'rejected')) {
          toast.error('播放被浏览器拦截，请再点一次「同时播放」', { id: 'play' });
        }
      });
    }, 80);
  }, [getActiveVideos]);

  const handlePauseAll = useCallback(() => {
    const active = getActiveVideos();
    if (active.length === 0) {
      toast.error('还没有可播放的视频，请先上传', { id: 'play' });
      return;
    }
    active.forEach((v) => {
      try {
        v.pause();
      } catch {}
    });
  }, [getActiveVideos]);

  /* 渲染列数：auto 模式窄屏收窄到 2 列竖向堆叠（蓝图 §12）；手动模式保持存储矩阵 */
  const gridCols = layoutMode === 'auto' && narrow ? Math.min(layout.cols, 2) : layout.cols;
  const gridStyle = { gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))` } as const;
  const padCellCount = Math.max(0, layout.rows * layout.cols - slots.length);

  /* ---------- 渲染 ---------- */
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      {/* 顶部：品牌 + 全局控制（Studio 全量管理控件 / Focus 极简观看控件） */}
      <header className="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur">
        <div
          className={cn(
            'mx-auto flex w-full flex-wrap items-center gap-x-4 gap-y-2.5 px-3 py-3 sm:px-6',
            mode === 'focus' || !sidebarOpen ? 'max-w-[1800px]' : 'max-w-[1400px]',
          )}
        >
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-lg shadow-primary/25">
              <Clapperboard className="h-5 w-5" aria-hidden />
            </div>
            <div className="min-w-0">
              <h1 className="text-base font-bold leading-tight tracking-wide sm:text-lg">OmniCompare</h1>
              {mode === 'studio' && (
                <p className="text-[11px] leading-tight text-muted-foreground sm:text-xs">
                  灵动对比 · 多内容并行对比工作台
                </p>
              )}
            </div>
          </div>

          {/* 项目切换器（Step 8 多项目；Studio 模式显示，Focus 保持极简顶栏） */}
          {mode === 'studio' && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  disabled={busy}
                  title="切换项目"
                  aria-label={`当前项目：${projectName}，点击切换`}
                  className="inline-flex h-9 max-w-[180px] items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-[13px] font-semibold text-foreground/90 transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-not-allowed disabled:opacity-50 sm:max-w-[240px]"
                >
                  <span className="truncate">{projectName}</span>
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-[15rem] border-border bg-card">
                {(['active', 'draft', 'archived'] as const).map((st) => {
                  const group = projects.filter((p) => p.status === st);
                  if (group.length === 0) return null;
                  return (
                    <div key={st}>
                      <p className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                        {STATUS_META[st].label}
                      </p>
                      {group.map((p) => (
                        <DropdownMenuItem
                          key={p.id}
                          onClick={() => switchProject(p.id)}
                          className={cn('gap-2 text-[13px]', p.id === projectId && 'font-semibold text-primary')}
                        >
                          <span
                            className={cn('h-1.5 w-1.5 shrink-0 rounded-full', STATUS_META[st].dot)}
                            aria-hidden
                          />
                          <span className="min-w-0 flex-1 truncate">{p.name}</span>
                          <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                            {p.items.length}
                          </span>
                        </DropdownMenuItem>
                      ))}
                    </div>
                  );
                })}
                <div className="mt-1.5 border-t border-border/70 pt-1.5">
                  <DropdownMenuItem
                    onClick={() => {
                      setNewName('');
                      setCreating(true);
                    }}
                    className="text-[13px] font-semibold text-primary"
                  >
                    <FolderPlus className="mr-1.5 h-4 w-4" aria-hidden />
                    新建项目
                  </DropdownMenuItem>
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          <div className="ml-auto flex flex-wrap items-center gap-1.5 sm:gap-2">
            {mode === 'studio' ? (
              <>
                {/* 侧栏开关（侧栏仅桌面端展示） */}
                <button
                  type="button"
                  onClick={() => setSidebarOpen((v) => !v)}
                  aria-pressed={sidebarOpen}
                  className={cn(
                    ctlBtn,
                    'hidden border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground lg:inline-flex',
                  )}
                  title={sidebarOpen ? '收起侧栏' : '展开侧栏'}
                  aria-label={sidebarOpen ? '收起侧栏' : '展开侧栏'}
                >
                  {sidebarOpen ? (
                    <PanelLeftClose className="h-4 w-4" aria-hidden />
                  ) : (
                    <PanelLeftOpen className="h-4 w-4" aria-hidden />
                  )}
                </button>
              </>
            ) : (
              <span className="mr-1 inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />
                专注模式
              </span>
            )}

            <button
              type="button"
              onClick={handlePlayAll}
              className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-[13px] font-semibold text-primary-foreground shadow-lg shadow-primary/30 transition-all hover:bg-primary/90 hover:shadow-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-95 sm:px-4"
            >
              <Play className="h-4 w-4 fill-current" aria-hidden />
              同时播放
            </button>

            <button
              type="button"
              onClick={handlePauseAll}
              className={cn(ctlBtn, 'border-border bg-card text-foreground/90 hover:bg-accent hover:text-accent-foreground')}
              title="全部暂停"
              aria-label="全部暂停"
            >
              <Pause className="h-4 w-4" aria-hidden />
              <span className="hidden sm:inline">暂停</span>
            </button>

            {/* 数量与布局（管理控件，Focus 模式隐藏） */}
            {mode === 'studio' && (
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    disabled={busy}
                    className={cn(
                      ctlBtn,
                      'border-border bg-card text-foreground/90 hover:bg-accent hover:text-accent-foreground',
                    )}
                    title="设置内容位数量与排列矩阵"
                    aria-label="设置内容位数量与排列矩阵"
                  >
                    <LayoutGrid className="h-4 w-4" aria-hidden />
                    <span className="hidden sm:inline">布局</span>
                    <span className="inline-block min-w-[4ch] text-center text-[11px] font-semibold tabular-nums text-primary">
                      {layoutMode === 'auto' ? '自动' : `${layout.rows}×${layout.cols}`}
                    </span>
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  align="end"
                  className="w-80 border-border bg-card p-4 text-card-foreground"
                >
                  <p className="text-xs font-semibold tracking-wide text-muted-foreground">内容位数量</p>
                  <div className="mt-2 grid grid-cols-6 gap-1.5">
                    {Array.from({ length: SLOT_MAX }, (_, i) => i + 1).map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => handleCountSelect(n)}
                        disabled={busy}
                        aria-pressed={n === count}
                        className={cn(
                          'h-8 rounded-md border text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-not-allowed disabled:opacity-50',
                          n === count
                            ? 'border-primary bg-primary/20 text-primary'
                            : 'border-border bg-muted/60 text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground',
                        )}
                      >
                        {n}
                      </button>
                    ))}
                  </div>

                  <p className="mt-4 text-xs font-semibold tracking-wide text-muted-foreground">
                    排列矩阵
                    <span className="ml-1 font-normal text-muted-foreground/70">（行 × 列）</span>
                  </p>
                  {/* 自动排列：矩阵随数量自动计算（默认），任何手动选择都会覆盖并记住 */}
                  <button
                    type="button"
                    onClick={handleAutoSelect}
                    disabled={busy}
                    aria-pressed={layoutMode === 'auto'}
                    className={cn(
                      'mt-2 flex h-9 w-full items-center gap-2 rounded-lg border px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-not-allowed disabled:opacity-50',
                      layoutMode === 'auto'
                        ? 'border-primary bg-primary/15 text-primary'
                        : 'border-border bg-muted/40 text-foreground/80 hover:border-muted-foreground/40 hover:bg-accent',
                    )}
                  >
                    <Wand2 className="h-3.5 w-3.5" aria-hidden />
                    自动排列
                    {layoutMode === 'auto' && (
                      <span className="rounded border border-primary/40 bg-primary/10 px-1 py-px tabular-nums text-primary">
                        {layout.rows}×{layout.cols}
                      </span>
                    )}
                    <span className="ml-auto text-[10px] font-normal text-muted-foreground">
                      随数量自动计算
                    </span>
                  </button>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {layoutOptionsFor(count).map((l) => (
                      <MatrixOption
                        key={`${l.rows}x${l.cols}`}
                        layout={l}
                        count={count}
                        active={layoutMode === 'manual' && l.rows === layout.rows && l.cols === layout.cols}
                        onSelect={() => handleLayoutSelect(l)}
                      />
                    ))}
                  </div>
                  <p className="mt-2.5 text-[11px] leading-relaxed text-muted-foreground/70">
                    {layoutMode === 'manual' && layout.rows * layout.cols > count
                      ? '标注「补」的矩阵无法整除，会在末尾留出空格子。'
                      : '选择具体行列后即固定为手动模式，可随时切回自动。'}
                  </p>

                  <p className="mt-4 text-xs font-semibold tracking-wide text-muted-foreground">
                    内容比例
                    <span className="ml-1 font-normal text-muted-foreground/70">（卡片框，内容不裁切）</span>
                  </p>
                  <div className="mt-2 grid grid-cols-4 gap-1.5">
                    {(['original', '16:9', '9:16', '1:1'] as AspectRatio[]).map((a) => (
                      <button
                        key={a}
                        type="button"
                        onClick={() => void updateSettings({ aspectRatio: a })}
                        aria-pressed={aspect === a}
                        className={cn(
                          'h-8 rounded-md border text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
                          aspect === a
                            ? 'border-primary bg-primary/20 text-primary'
                            : 'border-border bg-muted/60 text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground',
                        )}
                      >
                        {aspectLabel(a)}
                      </button>
                    ))}
                  </div>
                  <p className="mt-2.5 text-[11px] leading-relaxed text-muted-foreground/70">
                    「原始」为 16:9 容器等比容纳；竖版内容选 9:16 可减少留白，单卡可在信息行单独覆盖。
                  </p>
                </PopoverContent>
              </Popover>
            )}

            <button
              type="button"
              aria-pressed={loop}
              onClick={() => setLoop((v) => !v)}
              className={cn(
                ctlBtn,
                loop
                  ? 'border-primary/50 bg-primary/15 text-primary hover:bg-primary/25'
                  : 'border-border bg-card text-foreground/90 hover:bg-accent hover:text-accent-foreground',
              )}
              title={loop ? '循环播放：开' : '循环播放：关'}
              aria-label={loop ? '关闭循环播放' : '开启循环播放'}
            >
              <Repeat className="h-4 w-4" aria-hidden />
              <span className="hidden sm:inline">循环</span>
            </button>

            <button
              type="button"
              aria-pressed={mutedAll}
              onClick={() => setMutedAll((v) => !v)}
              className={cn(
                ctlBtn,
                mutedAll
                  ? 'border-amber-500/50 bg-amber-500/15 text-amber-600 hover:bg-amber-500/25 dark:text-amber-300'
                  : 'border-border bg-card text-foreground/90 hover:bg-accent hover:text-accent-foreground',
              )}
              title={mutedAll ? '取消全部静音' : '全部静音'}
              aria-label={mutedAll ? '取消全部静音' : '全部静音'}
            >
              {mutedAll ? (
                <VolumeX className="h-4 w-4" aria-hidden />
              ) : (
                <Volume2 className="h-4 w-4" aria-hidden />
              )}
              <span className="hidden lg:inline">{mutedAll ? '取消静音' : '静音'}</span>
            </button>

            {/* 播放速度（仅作用视频，蓝图 §9；非 1× 时高亮提示） */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    ctlBtn,
                    rate !== 1
                      ? 'border-primary/50 bg-primary/15 text-primary hover:bg-primary/25'
                      : 'border-border bg-card text-foreground/90 hover:bg-accent hover:text-accent-foreground',
                  )}
                  title="播放速度"
                  aria-label={`播放速度：${rate} 倍`}
                >
                  <Gauge className="h-4 w-4" aria-hidden />
                  <span className="hidden sm:inline tabular-nums">{rate}×</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[9rem] border-border bg-card">
                {[0.5, 1, 1.25, 1.5, 2].map((r) => (
                  <DropdownMenuItem
                    key={r}
                    onClick={() => void updateSettings({ playbackRate: r })}
                    className={cn('text-[13px]', r === rate && 'font-semibold text-primary')}
                  >
                    {r === 1 ? '常速（1×）' : `${r}×`}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* 标题显隐（全局，蓝图 §13）：只控制内容下方的标题输入框 */}
            <button
              type="button"
              aria-pressed={showTitles}
              onClick={() => void updateSettings({ showTitles: !showTitles })}
              className={cn(
                ctlBtn,
                showTitles
                  ? 'border-border bg-card text-foreground/90 hover:bg-accent hover:text-accent-foreground'
                  : 'border-primary/50 bg-primary/15 text-primary hover:bg-primary/25',
              )}
              title={showTitles ? '隐藏标题' : '显示标题'}
              aria-label={showTitles ? '隐藏标题' : '显示标题'}
            >
              {showTitles ? <Eye className="h-4 w-4" aria-hidden /> : <EyeOff className="h-4 w-4" aria-hidden />}
              <span className="hidden lg:inline">标题</span>
            </button>

            {/* 属性信息显隐（全局）：控制标题下方信息行（文件名/大小/比例/操作） */}
            <button
              type="button"
              aria-pressed={showInfo}
              onClick={() => void updateSettings({ showInfo: !showInfo })}
              className={cn(
                ctlBtn,
                showInfo
                  ? 'border-border bg-card text-foreground/90 hover:bg-accent hover:text-accent-foreground'
                  : 'border-primary/50 bg-primary/15 text-primary hover:bg-primary/25',
              )}
              title={showInfo ? '隐藏属性信息' : '显示属性信息'}
              aria-label={showInfo ? '隐藏属性信息' : '显示属性信息'}
            >
              {showInfo ? <Info className="h-4 w-4" aria-hidden /> : <EyeOff className="h-4 w-4" aria-hidden />}
              <span className="hidden lg:inline">属性</span>
            </button>

            {mode === 'studio' && (
              <>
                <button
                  type="button"
                  onClick={() => importInputRef.current?.click()}
                  disabled={busy}
                  className={cn(ctlBtn, 'border-border bg-card text-foreground/90 hover:bg-accent hover:text-accent-foreground')}
                  title="选择多个视频，按顺序填入各位置"
                  aria-label="一键导入多个视频"
                >
                  <UploadCloud className="h-4 w-4" aria-hidden />
                  <span className="hidden lg:inline">一键导入</span>
                </button>

                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <button
                      type="button"
                      disabled={busy}
                      className={cn(
                        ctlBtn,
                        'border-transparent bg-transparent px-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive sm:px-2.5',
                      )}
                      title="清空全部内容"
                      aria-label="清空全部内容"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>清空全部内容？</AlertDialogTitle>
                      <AlertDialogDescription>
                        将移除全部 {filledCount} 个内容及其标题，此操作无法恢复。
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>取消</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={handleClearAll}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:ring-destructive"
                      >
                        确认清空
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </>
            )}

            {/* 明暗主题切换 */}
            <button
              type="button"
              onClick={toggleTheme}
              className={cn(ctlBtn, 'border-border bg-card text-foreground/90 hover:bg-accent hover:text-accent-foreground')}
              /* title 与图标一样受 themeMounted 门控：服务端与水合首帧统一渲染暗色文案，
                 避免 next-themes 客户端同步读主题导致的水合属性不一致（控制台警告） */
              title={themeMounted && resolvedTheme === 'dark' ? '切换到亮色模式' : '切换到暗色模式'}
              aria-label="切换明暗主题"
            >
              {themeMounted && resolvedTheme === 'dark' ? (
                <Sun className="h-4 w-4" aria-hidden />
              ) : (
                <Moon className="h-4 w-4" aria-hidden />
              )}
            </button>

            {/* Studio ↔ Focus 模式切换 */}
            {mode === 'studio' ? (
              <button
                type="button"
                onClick={() => setMode('focus')}
                className={cn(ctlBtn, 'border-primary/50 bg-primary/10 text-primary hover:bg-primary/20')}
                title="进入专注模式：隐藏管理控件，专心观看对比"
                aria-label="进入专注模式"
              >
                <Expand className="h-4 w-4" aria-hidden />
                <span className="hidden sm:inline">专注</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setMode('studio')}
                className={cn(ctlBtn, 'border-primary/50 bg-primary/10 text-primary hover:bg-primary/20')}
                title="退出专注模式，返回工作台"
                aria-label="退出专注模式"
              >
                <Shrink className="h-4 w-4" aria-hidden />
                <span className="hidden sm:inline">退出专注</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* 拖拽导入的浮动提示 */}
      {gridDrag && (
        <div className="pointer-events-none fixed inset-x-0 top-16 z-50 flex justify-center">
          <div className="flex items-center gap-2 rounded-full border border-primary/60 bg-primary/15 px-4 py-2 text-sm font-medium text-primary shadow-xl shadow-primary/10 backdrop-blur">
            <UploadCloud className="h-4 w-4" aria-hidden />
            松开鼠标导入内容 · 文件较多时会自动扩展位数
          </div>
        </div>
      )}

      {/* 主区：Studio 含左侧栏，Focus 满幅；两模式复用同一网格，切换不重建视频元素 */}
      <div
        className={cn(
          'mx-auto flex w-full flex-1 gap-5 px-3 sm:px-6',
          mode === 'focus' || !sidebarOpen ? 'max-w-[1800px]' : 'max-w-[1400px]',
        )}
        onDragOver={(e) => {
          // 仅外部文件拖入时提示；卡片排序（pointer 模拟）不产生 dataTransfer
          if (!e.dataTransfer.types.includes('Files')) return;
          e.preventDefault();
          if (!gridDrag) setGridDrag(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setGridDrag(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setGridDrag(false);
          const files = Array.from(e.dataTransfer.files);
          if (files.length > 0) void distributeFiles(files);
        }}
      >
        {/* 左侧栏：仅 Studio + 桌面端（项目卡已随 Step 8 接活；库/设置视图仍为占位） */}
        {mode === 'studio' && sidebarOpen && (
          <aside
            className="sticky top-[74px] hidden h-fit w-60 shrink-0 flex-col gap-4 pb-6 lg:flex"
            aria-label="工作台侧栏"
          >
            {/* 项目卡（Step 8 动态化：当前项目 + 状态 + 管理入口） */}
            <div className="rounded-xl border border-border bg-card p-3.5">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
                  <Clapperboard className="h-[18px] w-[18px]" aria-hidden />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold" title={projectName}>
                    {projectName}
                  </p>
                  <p className="text-[11px] leading-tight text-muted-foreground">
                    {filledCount} / {count} 个内容位
                  </p>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[11px] text-muted-foreground">
                  <span
                    className={cn('h-1.5 w-1.5 rounded-full', STATUS_META[currentProject?.status ?? 'active'].dot)}
                    aria-hidden
                  />
                  {STATUS_META[currentProject?.status ?? 'active'].label}
                </span>
                <Popover onOpenChange={(open) => open && setRenameDraft(currentProject?.name ?? projectName)}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="rounded-md border border-border bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                    >
                      管理
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-72 border-border bg-card p-3.5">
                    {/* 改名 */}
                    <p className="text-xs font-semibold tracking-wide text-muted-foreground">项目名称</p>
                    <div className="mt-1.5 flex gap-1.5">
                      <Input
                        value={renameDraft}
                        onChange={(e) => setRenameDraft(e.target.value)}
                        maxLength={100}
                        placeholder="项目名称"
                        aria-label="项目名称"
                        className="h-8 text-[13px]"
                      />
                      <button
                        type="button"
                        disabled={
                          !currentProject ||
                          projectBusy ||
                          !renameDraft.trim() ||
                          renameDraft.trim() === currentProject.name
                        }
                        onClick={() => currentProject && void updateProject(currentProject.id, { name: renameDraft.trim() })}
                        className="h-8 shrink-0 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        保存
                      </button>
                    </div>
                    {/* 状态 */}
                    <p className="mt-3 text-xs font-semibold tracking-wide text-muted-foreground">项目状态</p>
                    <div className="mt-1.5 grid grid-cols-3 gap-1.5">
                      {(['active', 'draft', 'archived'] as const).map((st) => (
                        <button
                          key={st}
                          type="button"
                          disabled={!currentProject}
                          aria-pressed={currentProject?.status === st}
                          onClick={() => currentProject && void updateProject(currentProject.id, { status: st })}
                          className={cn(
                            'h-8 rounded-md border text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-not-allowed disabled:opacity-50',
                            currentProject?.status === st
                              ? 'border-primary bg-primary/20 text-primary'
                              : 'border-border bg-muted/60 text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground',
                          )}
                        >
                          {STATUS_META[st].label}
                        </button>
                      ))}
                    </div>
                    {/* 删除（默认项目受保护） */}
                    {currentProject && currentProject.id !== DEFAULT_PROJECT_ID ? (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <button
                            type="button"
                            className="mt-3 h-8 w-full rounded-lg border border-destructive/40 text-xs font-semibold text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/50"
                          >
                            删除项目
                          </button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>删除项目「{currentProject.name}」？</AlertDialogTitle>
                            <AlertDialogDescription>
                              将删除该项目的全部内容文件与设置，此操作无法恢复。
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>取消</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => void deleteProject(currentProject.id)}
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:ring-destructive"
                            >
                              确认删除
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    ) : (
                      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground/60">
                        默认项目不可删除；删除其他项目会连同其内容文件一并移除。
                      </p>
                    )}
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            {/* 添加内容：与顶栏「一键导入」同源，多选后按顺序填充空位 */}
            <button
              type="button"
              onClick={() => importInputRef.current?.click()}
              disabled={busy}
              className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-lg bg-primary text-[13px] font-semibold text-primary-foreground shadow-lg shadow-primary/30 transition-all hover:bg-primary/90 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50"
            >
              <UploadCloud className="h-4 w-4" aria-hidden />
              添加内容
            </button>

            {/* 视图导航（库/设置为占位，随后续阶段开放） */}
            <nav className="flex flex-col gap-1" aria-label="视图切换">
              <p className="px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">视图</p>
              <button
                type="button"
                aria-current="page"
                className="flex items-center gap-2.5 rounded-lg bg-primary/15 px-3 py-2 text-[13px] font-medium text-primary"
              >
                <LayoutGrid className="h-4 w-4" aria-hidden />
                工作空间
              </button>
              <button
                type="button"
                disabled
                title="第二阶段上线"
                className="flex cursor-not-allowed items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium text-muted-foreground/50"
              >
                <Library className="h-4 w-4" aria-hidden />
                库
                <span className="ml-auto text-[10px] font-normal text-muted-foreground/40">即将上线</span>
              </button>
              <button
                type="button"
                disabled
                title="第二阶段上线"
                className="flex cursor-not-allowed items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium text-muted-foreground/50"
              >
                <Settings className="h-4 w-4" aria-hidden />
                设置
                <span className="ml-auto text-[10px] font-normal text-muted-foreground/40">即将上线</span>
              </button>
            </nav>

            {/* 当前活动窗格：点击滚动定位并短暂高亮对应卡片 */}
            <div className="min-h-0">
              <p className="px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                当前活动窗格（{count}）
              </p>
              <div className="mt-1.5 max-h-[320px] space-y-0.5 overflow-y-auto pr-1">
                {slots.map((s) => (
                  <button
                    key={s.index}
                    type="button"
                    onClick={() => focusSlot(s.index)}
                    aria-label={`定位到窗格 ${s.index + 1}`}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-accent',
                      highlight === s.index && 'bg-primary/10',
                    )}
                  >
                    <span
                      className={cn(
                        'h-1.5 w-1.5 shrink-0 rounded-full',
                        s.kind === 'html' ? 'bg-sky-500' : s.video ? 'bg-emerald-500' : 'bg-muted-foreground/30',
                      )}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 truncate text-xs text-foreground/80">
                      {s.title || s.video?.originalName || s.html?.originalName || `空位 ${s.index + 1}`}
                    </span>
                    {s.kind === 'html' && (
                      <span className="shrink-0 rounded border border-border px-1 text-[9px] font-semibold leading-4 text-muted-foreground/70">
                        HTML
                      </span>
                    )}
                    <span
                      className={cn(
                        'shrink-0 text-[10px] tabular-nums',
                        s.video ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground/40',
                      )}
                    >
                      {s.index + 1}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </aside>
        )}

        <main className="min-w-0 flex-1 py-4 sm:py-7">
        {loading ? (
          <div className="grid gap-3 sm:gap-5" style={gridStyle}>
            {slots.map((s) => (
              <div
                key={s.index}
                className="overflow-hidden rounded-2xl border border-border bg-card"
              >
                <div className="aspect-video w-full animate-pulse bg-muted" />
                <div className="p-3">
                  <div className="h-6 w-full animate-pulse rounded-lg bg-muted" />
                </div>
              </div>
            ))}
          </div>
        ) : filledCount === 0 ? (
          /* 空状态引导（D7：仅简单文字提示 + 最小上传入口，不做花哨插画） */
          <div className="flex min-h-[420px] w-full flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border/70 bg-card/40 px-6 py-14 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full border border-dashed border-muted-foreground/40 text-muted-foreground/60">
              <UploadCloud className="h-6 w-6" aria-hidden />
            </span>
            <div className="space-y-1">
              <p className="text-base font-semibold text-foreground/90">「{projectName}」暂无内容</p>
              <p className="mx-auto max-w-md text-[13px] leading-relaxed text-muted-foreground">
                把视频或 HTML 文件拖到页面任意位置，或点击下方按钮选择文件，内容将按顺序填入内容位
              </p>
            </div>
            <button
              type="button"
              onClick={() => importInputRef.current?.click()}
              disabled={busy}
              className="mt-1 inline-flex h-10 items-center gap-1.5 rounded-lg bg-primary px-4 text-[13px] font-semibold text-primary-foreground shadow-lg shadow-primary/30 transition-all hover:bg-primary/90 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50"
            >
              <UploadCloud className="h-4 w-4" aria-hidden />
              选择文件导入
            </button>
            <p className="text-[11px] text-muted-foreground/60">
              支持视频（MP4 / MOV / WebM 等）与单文件 HTML；内容超过内容位数量时会自动扩位
            </p>
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={sortableIds} strategy={rectSortingStrategy}>
              <div className="grid gap-3 sm:gap-5" style={gridStyle}>
                {slots.map((slot) => {
                  const isFilled = !!(slot.video || slot.html);
                  const cardProps = {
                    uploading: !!uploading[slot.index],
                    loop,
                    muted: mutedAll,
                    highlighted: highlight === slot.index,
                    dragActive: gridDrag,
                    globalAspect: aspect,
                    showTitles,
                    showInfo,
                    onAspectOverride: handleSlotAspect,
                    onFiles: (files: File[], primary: number) => void distributeFiles(files, primary),
                    onTitleChange: handleTitleChange,
                    onClear: handleClearSlot,
                    setVideoRef,
                  } as const;
                  /* key 用稳定文件名：排序后 DOM 节点被移动而非复用重建，视频播放不中断；
                     空位卡片不注册 sortable，永远留在末尾 */
                  return isFilled ? (
                    <SortableCard key={sortableIdOf(slot)} slot={slot} {...cardProps} />
                  ) : (
                    <VideoCard key={`empty-${slot.index}`} slot={slot} {...cardProps} />
                  );
                })}
                {/* 矩阵容量大于内容数时，末尾留空的占位格 */}
                {Array.from({ length: padCellCount }).map((_, i) => (
                  <div
                    key={`pad-${i}`}
                    aria-hidden
                    style={{ aspectRatio: aspectCss(aspect) }}
                    className="rounded-2xl border border-dashed border-border/60 bg-muted/20"
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </main>
      </div>

      {/* 底部：使用说明（Focus 模式隐藏，专注观看） */}
      {mode === 'studio' && (
        <footer className="mt-auto border-t border-border/70 bg-muted/30">
          <div className="mx-auto w-full max-w-[1400px] px-3 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:px-6">
            <ol className="flex flex-col gap-1.5 text-xs text-muted-foreground sm:flex-row sm:flex-wrap sm:gap-x-6">
              <li>
                <span className="mr-1 font-semibold text-foreground/80">1.</span>
                矩阵默认自动排列，也可在右上「布局」里固定行列；抓住卡片左上角序号可拖动排序
              </li>
              <li>
                <span className="mr-1 font-semibold text-foreground/80">2.</span>
                点击空位上传视频或单文件 HTML（页面自动运行），或把文件直接拖进页面
              </li>
              <li>
                <span className="mr-1 font-semibold text-foreground/80">3.</span>
                在内容下方填写标题或介绍，点「同时播放」一起观看视频；「布局」里可调内容比例，顶栏可调速与显隐标题/属性
              </li>
            </ol>
            <p className="mt-2.5 text-[11px] text-muted-foreground/60">
              内容与设置保存在服务器上，刷新页面或换台设备打开都不会丢失；HTML 页面在独立沙箱中运行，无法访问本站数据。
            </p>
          </div>
        </footer>
      )}

      {/* 缩减数量确认框 */}
      <AlertDialog
        open={pendingCount !== null}
        onOpenChange={(open) => {
          if (!open) setPendingCount(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>缩减内容位数量？</AlertDialogTitle>
            <AlertDialogDescription>
              缩减到 {pendingCount} 个将移除末尾多余的{' '}
              {removedContentCount(pendingCount ?? 0)} 个内容及其标题，且无法恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmShrink}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:ring-destructive"
            >
              确认缩减
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 新建项目（Step 8 多项目）：创建后立即切换到新项目 */}
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="border-border bg-card text-card-foreground sm:max-w-[24rem]">
          <DialogHeader>
            <DialogTitle>新建项目</DialogTitle>
            <DialogDescription>
              为一批新内容创建独立工作台：内容、布局与设置互相隔离，可随时在顶栏切换。
            </DialogDescription>
          </DialogHeader>
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void createProject();
              }
            }}
            maxLength={100}
            placeholder="项目名称（留空则自动命名）"
            aria-label="项目名称"
            autoFocus
          />
          <DialogFooter className="gap-2">
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="inline-flex h-9 items-center rounded-lg border border-border bg-card px-4 text-[13px] font-medium text-foreground/90 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
            >
              取消
            </button>
            <button
              type="button"
              disabled={projectBusy}
              onClick={() => void createProject()}
              className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-[13px] font-semibold text-primary-foreground shadow-lg shadow-primary/30 transition-all hover:bg-primary/90 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50"
            >
              {projectBusy ? '创建中…' : '创建并切换'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 一键导入的隐藏文件选择框（视频与单文件 HTML） */}
      <input
        ref={importInputRef}
        type="file"
        accept="video/mp4,video/*,.html,.htm"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length > 0) void distributeFiles(files);
          e.target.value = '';
        }}
      />
    </div>
  );
}
