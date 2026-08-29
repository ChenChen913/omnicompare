'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Clapperboard,
  Expand,
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
} from 'lucide-react';
import { toast } from 'sonner';
import { useTheme } from 'next-themes';
import { cn } from '@/lib/utils';
import {
  Layout,
  Manifest,
  SLOT_MAX,
  Slot,
  defaultLayoutFor,
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
import { VideoCard } from './video-card';

const PREF_LOOP = 'videowall:loop';
const PREF_MUTE = 'videowall:mute';
/** 工作模式与侧栏开关（仅 UI 偏好，业务数据永远以服务端为准） */
const PREF_MODE = 'omnicompare:mode';
const PREF_SIDEBAR = 'omnicompare:sidebar';

function defaultSlots(): Slot[] {
  return Array.from({ length: 6 }, (_, i) => ({ index: i, title: '', video: null }));
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
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState<Record<number, boolean>>({});
  const [importing, setImporting] = useState(false);
  const [loop, setLoop] = useState(true);
  const [mutedAll, setMutedAll] = useState(false);
  const [gridDrag, setGridDrag] = useState(false);
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  /** studio = 管理（全部控件 + 侧栏）；focus = 观看（极简顶栏 + 满幅网格） */
  const [mode, setMode] = useState<'studio' | 'focus'>('studio');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  /** 侧栏窗格列表点击定位时的高亮位 */
  const [highlight, setHighlight] = useState<number | null>(null);
  const [themeMounted, setThemeMounted] = useState(false);
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
  const getActiveVideos = useCallback(
    () =>
      slots
        .filter((s) => s.video)
        .map((s) => videoRefs.current[s.index])
        .filter((v): v is HTMLVideoElement => !!v),
    [slots],
  );

  /* ---------- 初始化：拉取清单 + 恢复本地偏好 ---------- */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/videos', { cache: 'no-store' });
        const data = (await res.json()) as Manifest;
        if (!cancelled && Array.isArray(data?.slots)) {
          setCount(data.count);
          setLayout(data.layout);
          setSlots(data.slots);
        }
      } catch {
        if (!cancelled) toast.error('加载视频列表失败，请刷新重试');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    try {
      const savedLoop = localStorage.getItem(PREF_LOOP);
      if (savedLoop !== null) setLoop(savedLoop === '1');
      const savedMute = localStorage.getItem(PREF_MUTE);
      if (savedMute !== null) setMutedAll(savedMute === '1');
      const savedMode = localStorage.getItem(PREF_MODE);
      if (savedMode === 'studio' || savedMode === 'focus') setMode(savedMode);
      const savedSidebar = localStorage.getItem(PREF_SIDEBAR);
      if (savedSidebar !== null) setSidebarOpen(savedSidebar === '1');
    } catch {
      /* 忽略隐私模式下的存储错误 */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(PREF_LOOP, loop ? '1' : '0');
    } catch {}
  }, [loop]);

  useEffect(() => {
    try {
      localStorage.setItem(PREF_MUTE, mutedAll ? '1' : '0');
    } catch {}
  }, [mutedAll]);

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

  /* React 对 video 的 muted/loop 属性更新不可靠，直接同步到 DOM 元素 */
  useEffect(() => {
    videoRefs.current.forEach((v) => {
      if (!v) return;
      v.loop = loop;
      v.muted = mutedAll;
    });
  }, [loop, mutedAll, slots]);

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
    async (nextCount: number, nextLayout: Layout): Promise<Manifest | null> => {
      try {
        const res = await fetch('/api/videos/layout', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ count: nextCount, rows: nextLayout.rows, cols: nextLayout.cols }),
        });
        const data = (await res.json().catch(() => null)) as (Manifest & { error?: string }) | null;
        if (!res.ok || !data?.slots) {
          toast.error(data?.error || '调整布局失败，请重试', { id: 'layout' });
          return null;
        }
        setCount(data.count);
        setLayout(data.layout);
        setSlots(data.slots);
        return data;
      } catch {
        toast.error('调整布局失败，请重试', { id: 'layout' });
        return null;
      }
    },
    [],
  );

  /** 缩减到 n 个位置时，将被移除区间内实际存在的内容数（视频或 HTML） */
  const removedContentCount = useCallback(
    (n: number) => slots.slice(n).filter((s) => s.video || s.html).length,
    [slots],
  );

  /** 选择数量：缩减且被移除区间内有内容时弹确认框 */
  const handleCountSelect = useCallback(
    (n: number) => {
      if (busy || n === count) return;
      if (removedContentCount(n) > 0) {
        setPendingCount(n);
        return;
      }
      void requestLayout(n, defaultLayoutFor(n)).then((m) => {
        // 固定 id：连续快速切换数量时只更新同一条提示，不会叠加成一堆
        if (m) toast.success(`已切换为 ${n} 个内容位`, { id: 'layout', duration: 2000 });
      });
    },
    [busy, count, removedContentCount, requestLayout],
  );

  const confirmShrink = useCallback(() => {
    const n = pendingCount;
    setPendingCount(null);
    if (n === null) return;
    const removed = removedContentCount(n);
    void requestLayout(n, defaultLayoutFor(n)).then((m) => {
      if (m) {
        toast.success(
          removed > 0 ? `已缩减为 ${n} 个内容位，${removed} 个内容已移除` : `已切换为 ${n} 个内容位`,
          { id: 'layout', duration: 2000 },
        );
      }
    });
  }, [pendingCount, removedContentCount, requestLayout]);

  const handleLayoutSelect = useCallback(
    (l: Layout) => {
      if (busy) return;
      void requestLayout(count, l);
    },
    [busy, count, requestLayout],
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
      const res = await fetch('/api/videos/upload', { method: 'POST', body: fd });
      const data = (await res.json().catch(() => null)) as (Manifest & { error?: string }) | null;
      if (!res.ok || !data?.slots) {
        return data?.error || `「${file.name}」上传失败，请重试`;
      }
      setCount(data.count);
      setLayout(data.layout);
      setSlots(data.slots);
      return null;
    } catch {
      return `「${file.name}」上传失败，请检查网络后重试`;
    } finally {
      setUploading((prev) => ({ ...prev, [index]: false }));
    }
  }, []);

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
        const m = await requestLayout(batch.length, defaultLayoutFor(batch.length));
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
    [slots, uploadToSlot, requestLayout],
  );

  /* ---------- 标题（防抖保存） ---------- */
  const handleTitleChange = useCallback((index: number, title: string) => {
    setSlots((prev) => prev.map((s) => (s.index === index ? { ...s, title } : s)));
    const timer = titleTimers.current.get(index);
    if (timer) clearTimeout(timer);
    titleTimers.current.set(
      index,
      setTimeout(() => {
        fetch('/api/videos', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slot: index, title }),
        }).catch(() => {});
      }, 600),
    );
  }, []);

  /* ---------- 移除 ---------- */
  const handleClearSlot = useCallback(async (index: number) => {
    try {
      const res = await fetch(`/api/videos?slot=${index}`, { method: 'DELETE' });
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
  }, []);

  const handleClearAll = useCallback(async () => {
    try {
      const res = await fetch('/api/videos?all=1', { method: 'DELETE' });
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
  }, []);

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

  const gridStyle = { gridTemplateColumns: `repeat(${layout.cols}, minmax(0, 1fr))` } as const;
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

                <span className="mr-1 hidden items-center rounded-full border border-border bg-card px-2.5 py-1 text-[11px] text-muted-foreground md:inline-flex">
                  已放置
                  {/* 定宽 + 等宽数字：数字位数变化（如 7/7 → 10/10）不会挤动旁边按钮 */}
                  <span className="ml-1 inline-block min-w-[5ch] text-center tabular-nums">
                    {filledCount}/{count}
                  </span>
                </span>
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
                      {layout.rows}×{layout.cols}
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
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {layoutOptionsFor(count).map((l) => (
                      <MatrixOption
                        key={`${l.rows}x${l.cols}`}
                        layout={l}
                        count={count}
                        active={l.rows === layout.rows && l.cols === layout.cols}
                        onSelect={() => handleLayoutSelect(l)}
                      />
                    ))}
                  </div>
                  {layout.rows * layout.cols > count && (
                    <p className="mt-2.5 text-[11px] leading-relaxed text-muted-foreground/70">
                      标注「补」的矩阵无法整除，会在末尾留出空格子。
                    </p>
                  )}
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
        {/* 左侧栏：仅 Studio + 桌面端（项目卡/视图导航为静态展示，随项目化步骤接活） */}
        {mode === 'studio' && sidebarOpen && (
          <aside
            className="sticky top-[74px] hidden h-fit w-60 shrink-0 flex-col gap-4 pb-6 lg:flex"
            aria-label="工作台侧栏"
          >
            {/* 项目卡 */}
            <div className="rounded-xl border border-border bg-card p-3.5">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
                  <Clapperboard className="h-[18px] w-[18px]" aria-hidden />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">默认项目</p>
                  <p className="text-[11px] leading-tight text-muted-foreground">多内容对比工作台</p>
                </div>
              </div>
              <span className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[11px] text-muted-foreground">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
                进行中
              </span>
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
        ) : (
          <div className="grid gap-3 sm:gap-5" style={gridStyle}>
            {slots.map((slot) => (
              <VideoCard
                key={slot.index}
                slot={slot}
                uploading={!!uploading[slot.index]}
                loop={loop}
                muted={mutedAll}
                highlighted={highlight === slot.index}
                dragActive={gridDrag}
                onFiles={(files, primary) => void distributeFiles(files, primary)}
                onTitleChange={handleTitleChange}
                onClear={handleClearSlot}
                setVideoRef={setVideoRef}
              />
            ))}
            {/* 矩阵容量大于视频数时，末尾留空的占位格 */}
            {Array.from({ length: padCellCount }).map((_, i) => (
              <div
                key={`pad-${i}`}
                aria-hidden
                className="aspect-video rounded-2xl border border-dashed border-border/60 bg-muted/20"
              />
            ))}
          </div>
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
                点右上「布局」选择内容位个数与几行几列，单内容会自动满幅展示
              </li>
              <li>
                <span className="mr-1 font-semibold text-foreground/80">2.</span>
                点击空位上传视频或单文件 HTML（页面自动运行），或把文件直接拖进页面
              </li>
              <li>
                <span className="mr-1 font-semibold text-foreground/80">3.</span>
                在内容下方填写标题或介绍，点「同时播放」一起观看视频；右上角可切换明暗与专注模式
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
