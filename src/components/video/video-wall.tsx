'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Clapperboard,
  LayoutGrid,
  Moon,
  Pause,
  Play,
  Repeat,
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
  MAX_FILE_SIZE,
  SLOT_MAX,
  Slot,
  defaultLayoutFor,
  isVideoFile,
  layoutOptionsFor,
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
        {pad > 0 && <span className="ml-0.5 text-[9px] font-normal text-amber-400/90">补</span>}
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
  const { resolvedTheme, setTheme } = useTheme();

  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);
  const importInputRef = useRef<HTMLInputElement>(null);
  const titleTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const setVideoRef = useCallback((index: number, el: HTMLVideoElement | null) => {
    videoRefs.current[index] = el;
  }, []);

  const busy = importing || Object.values(uploading).some(Boolean);
  const filledCount = slots.filter((s) => s.video).length;
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
    return () => {
      timers.forEach((t) => clearTimeout(t));
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

  /** 缩减到 n 个位置时，将被移除区间内实际存在的视频数 */
  const removedVideoCount = useCallback(
    (n: number) => slots.slice(n).filter((s) => s.video).length,
    [slots],
  );

  /** 选择数量：缩减且被移除区间内有视频时弹确认框 */
  const handleCountSelect = useCallback(
    (n: number) => {
      if (busy || n === count) return;
      if (removedVideoCount(n) > 0) {
        setPendingCount(n);
        return;
      }
      void requestLayout(n, defaultLayoutFor(n)).then((m) => {
        // 固定 id：连续快速切换数量时只更新同一条提示，不会叠加成一堆
        if (m) toast.success(`已切换为 ${n} 个视频位`, { id: 'layout', duration: 2000 });
      });
    },
    [busy, count, removedVideoCount, requestLayout],
  );

  const confirmShrink = useCallback(() => {
    const n = pendingCount;
    setPendingCount(null);
    if (n === null) return;
    const removed = removedVideoCount(n);
    void requestLayout(n, defaultLayoutFor(n)).then((m) => {
      if (m) {
        toast.success(
          removed > 0 ? `已缩减为 ${n} 个视频位，${removed} 个视频已移除` : `已切换为 ${n} 个视频位`,
          { id: 'layout', duration: 2000 },
        );
      }
    });
  }, [pendingCount, removedVideoCount, requestLayout]);

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
    if (!isVideoFile(file.name, file.type)) return `「${file.name}」不是视频文件`;
    if (file.size > MAX_FILE_SIZE) return `「${file.name}」超过 200MB 限制`;
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
      const vids = files.filter((f) => isVideoFile(f.name, f.type));
      const skipped = files.length - vids.length;
      if (vids.length === 0) {
        toast.error('请选择视频文件（MP4、MOV、WebM 等）', { id: 'import' });
        return;
      }
      if (vids.length > SLOT_MAX) {
        toast.warning(`单次最多导入 ${SLOT_MAX} 个视频，超出部分已忽略`, { id: 'import' });
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

      const targets: number[] = [];
      if (primary !== undefined) targets.push(primary);
      targets.push(...targetSlots.filter((s) => !s.video && s.index !== primary).map((s) => s.index));
      targets.push(...targetSlots.filter((s) => s.video && s.index !== primary).map((s) => s.index));

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
              ? `已扩展至 ${batch.length} 位并导入 ${ok} 个视频`
              : batch.length === 1
                ? '已导入 1 个视频'
                : `已导入 ${ok} 个视频`,
          ];
          if (failures.length > 0) {
            parts.push(`${failures.length} 个失败（${failures[0]}${failures.length > 1 ? ' 等' : ''}）`);
          }
          if (skipped > 0) parts.push(`${skipped} 个非视频文件已跳过`);
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
      toast.success(`已移除位置 ${index + 1} 的视频`, { id: 'slot' });
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
      toast.success('已清空全部视频', { id: 'clear' });
    } catch {
      toast.error('清空失败，请重试', { id: 'clear' });
    }
  }, []);

  /* ---------- 批量播放控制 ---------- */
  const handlePlayAll = useCallback(() => {
    const active = getActiveVideos();
    if (active.length === 0) {
      toast.error('还没有视频，请先上传', { id: 'play' });
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
      toast.error('还没有视频，请先上传', { id: 'play' });
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
      {/* 顶部：标题 + 全局控制 */}
      <header className="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-4 gap-y-2.5 px-3 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-lg shadow-primary/25">
              <Clapperboard className="h-5 w-5" aria-hidden />
            </div>
            <div className="min-w-0">
              <h1 className="text-base font-bold leading-tight tracking-wide sm:text-lg">OmniCompare</h1>
              <p className="text-[11px] leading-tight text-muted-foreground sm:text-xs">
                灵动对比 · 多内容并行对比工作台
              </p>
            </div>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-1.5 sm:gap-2">
            <span className="mr-1 hidden items-center rounded-full border border-border bg-card px-2.5 py-1 text-[11px] text-muted-foreground md:inline-flex">
              已放置
              {/* 定宽 + 等宽数字：数字位数变化（如 7/7 → 10/10）不会挤动旁边按钮 */}
              <span className="ml-1 inline-block min-w-[5ch] text-center tabular-nums">
                {filledCount}/{count}
              </span>
            </span>

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

            {/* 数量与布局 */}
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  disabled={busy}
                  className={cn(
                    ctlBtn,
                    'border-border bg-card text-foreground/90 hover:bg-accent hover:text-accent-foreground',
                  )}
                  title="设置视频数量与排列矩阵"
                  aria-label="设置视频数量与排列矩阵"
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
                <p className="text-xs font-semibold tracking-wide text-muted-foreground">视频数量</p>
                <div className="mt-2 grid grid-cols-6 gap-1.5">
                  {Array.from({ length: SLOT_MAX }, (_, i) => i + 1).map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => handleCountSelect(n)}
                      disabled={busy}
                      aria-pressed={n === count}
                      className={cn(
                        'h-8 rounded-md border text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/60 disabled:cursor-not-allowed disabled:opacity-50',
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

            <button
              type="button"
              aria-pressed={loop}
              onClick={() => setLoop((v) => !v)}
              className={cn(
                ctlBtn,
                loop
                  ? 'border-violet-500/50 bg-violet-500/15 text-violet-300 hover:bg-violet-500/25 hover:text-violet-200'
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
                  ? 'border-amber-500/50 bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 hover:text-amber-200'
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
                    'border-transparent bg-transparent px-2 text-zinc-500 hover:bg-red-500/10 hover:text-red-400 sm:px-2.5',
                  )}
                  title="清空全部视频"
                  aria-label="清空全部视频"
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </button>
              </AlertDialogTrigger>
              <AlertDialogContent className="border-zinc-800 bg-zinc-900 text-zinc-100">
                <AlertDialogHeader>
                  <AlertDialogTitle>清空全部视频？</AlertDialogTitle>
                  <AlertDialogDescription className="text-zinc-400">
                    将移除全部 {filledCount} 个视频及其标题，此操作无法恢复。
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel className="border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-700 hover:text-white">
                    取消
                  </AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleClearAll}
                    className="bg-red-600 text-white hover:bg-red-500 focus-visible:ring-red-500"
                  >
                    确认清空
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </header>

      {/* 拖拽导入的浮动提示 */}
      {gridDrag && (
        <div className="pointer-events-none fixed inset-x-0 top-16 z-50 flex justify-center">
          <div className="flex items-center gap-2 rounded-full border border-violet-400/60 bg-violet-500/15 px-4 py-2 text-sm font-medium text-violet-200 shadow-xl shadow-violet-500/10 backdrop-blur">
            <UploadCloud className="h-4 w-4" aria-hidden />
            松开鼠标导入视频 · 文件较多时会自动扩展位数
          </div>
        </div>
      )}

      {/* 视频网格：按所选矩阵排列 */}
      <main
        className="mx-auto w-full max-w-6xl flex-1 px-3 py-4 sm:px-6 sm:py-7"
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
        {loading ? (
          <div className="grid gap-3 sm:gap-5" style={gridStyle}>
            {slots.map((s) => (
              <div
                key={s.index}
                className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/70"
              >
                <div className="aspect-video w-full animate-pulse bg-zinc-800/60" />
                <div className="p-3">
                  <div className="h-6 w-full animate-pulse rounded-lg bg-zinc-800/60" />
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
                className="aspect-video rounded-2xl border border-dashed border-zinc-800/60 bg-zinc-900/20"
              />
            ))}
          </div>
        )}
      </main>

      {/* 底部：使用说明 */}
      <footer className="mt-auto border-t border-zinc-800/70 bg-zinc-950">
        <div className="mx-auto w-full max-w-6xl px-3 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:px-6">
          <ol className="flex flex-col gap-1.5 text-xs text-zinc-500 sm:flex-row sm:flex-wrap sm:gap-x-6">
            <li>
              <span className="mr-1 font-semibold text-zinc-400">1.</span>
              点右上「布局」选择视频个数与几行几列，单视频会自动满幅展示
            </li>
            <li>
              <span className="mr-1 font-semibold text-zinc-400">2.</span>
              点击空位上传，或把文件直接拖进页面（一次拖多个会自动扩展位数）
            </li>
            <li>
              <span className="mr-1 font-semibold text-zinc-400">3.</span>
              在视频下方填写标题或介绍，点「同时播放」一起观看
            </li>
          </ol>
          <p className="mt-2.5 text-[11px] text-zinc-700">
            视频与设置保存在服务器上，刷新页面或换台设备打开都不会丢失。
          </p>
        </div>
      </footer>

      {/* 缩减数量确认框 */}
      <AlertDialog
        open={pendingCount !== null}
        onOpenChange={(open) => {
          if (!open) setPendingCount(null);
        }}
      >
        <AlertDialogContent className="border-zinc-800 bg-zinc-900 text-zinc-100">
          <AlertDialogHeader>
            <AlertDialogTitle>缩减视频数量？</AlertDialogTitle>
            <AlertDialogDescription className="text-zinc-400">
              缩减到 {pendingCount} 个将移除末尾多余的{' '}
              {removedVideoCount(pendingCount ?? 0)} 个视频及其标题，且无法恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-700 hover:text-white">
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmShrink}
              className="bg-red-600 text-white hover:bg-red-500 focus-visible:ring-red-500"
            >
              确认缩减
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 一键导入的隐藏文件选择框 */}
      <input
        ref={importInputRef}
        type="file"
        accept="video/mp4,video/*"
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
