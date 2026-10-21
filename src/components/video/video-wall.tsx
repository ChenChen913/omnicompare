'use client';

/**
 * 视频墙主组件：状态协调中枢。
 *
 * 2026-10 架构重构：本文件曾是 3665 行的「上帝组件」（62 个 useState、35 个
 * useCallback、18 个 useEffect 挤在一个函数里，占 src 总量 41%）。重构后：
 * - 设置域 33 个 useState → useWallSettings（单一 state 对象 + 快照回滚）
 * - 项目域（列表/切换/新建/改名/删除）→ useProjects
 * - autoFit 求解器与三个布局对齐 effect → useAutoFit
 * - 顶栏 / 侧栏 / 项目库 / 提示词栏 / 水印层 / 四个弹窗 → wall/ 子组件
 * 本文件只保留：清单状态与加载、上传分发、拖拽排序、批量播放控制、
 * BGM 管理、键盘快捷键与整体布局编排。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, Shrink, UploadCloud } from 'lucide-react';
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
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { cn } from '@/lib/utils';
import {
  AspectRatio,
  DEFAULT_PROJECT_ID,
  Layout,
  MAX_AUDIO_SIZE,
  MAX_ICON_SIZE,
  Manifest,
  SLOT_MAX,
  Slot,
  aspectCss,
  defaultLayoutFor,
  isContentFile,
  validateClientFile,
} from '@/lib/types';
import { VideoCard } from './video-card';
import { createTabRecorder, downloadRecording, estimateRecorderMeta, recordingFilename, requestTabCapture, type RecorderMeta } from '@/lib/screen-recorder';
import { useWallSettings } from './wall/use-wall-settings';
import { useProjects } from './wall/use-projects';
import { useAutoFit } from './wall/use-autofit';
import { TopBar } from './wall/top-bar';
import { Sidebar } from './wall/sidebar';
import { ProjectLibrary } from './wall/project-library';
import { PromptBar } from './wall/prompt-bar';
import { WatermarkLayer } from './wall/watermark-layer';
import {
  CreateProjectDialog,
  NotesDialog,
  ShrinkConfirmDialog,
  WatermarkTextDialog,
} from './wall/dialogs';
import {
  PREF_MODE,
  PREF_PROJECT,
  PREF_SIDEBAR,
  PREF_VIEW,
  SortableCard,
  defaultSlots,
  sortableIdOf,
} from './wall/shared';

export function VideoWall() {
  /* ---------- 清单状态（内容位与矩阵） ---------- */
  const [slots, setSlots] = useState<Slot[]>(defaultSlots);
  const [count, setCount] = useState(6);
  const [layout, setLayout] = useState<Layout>({ rows: 2, cols: 3 });
  /** 布局模式：auto = 按数量自动近方形（默认）；manual = 用户显式选矩阵（蓝图 §12） */
  const [layoutMode, setLayoutMode] = useState<'auto' | 'manual'>('auto');
  const [loading, setLoading] = useState(true);
  /** 项目切换过渡态：保留旧内容渐隐、新数据到达后渐显，避免骨架屏高度突变引起跳动 */
  const [switching, setSwitching] = useState(false);
  const [uploading, setUploading] = useState<Record<number, boolean>>({});
  const [importing, setImporting] = useState(false);
  /** 缩减数量确认框的目标值 */
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  /** studio = 管理（全部控件 + 侧栏 + 顶栏）；focus = 观看（顶栏整体隐藏 + 满幅网格） */
  const [mode, setMode] = useState<'studio' | 'focus'>('studio');
  /** workspace = 内容矩阵；library = 项目库（侧栏「库」入口，SPA 内切换） */
  const [view, setView] = useState<'workspace' | 'library'>('workspace');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  /** 侧栏窗格列表点击定位时的高亮位 */
  const [highlight, setHighlight] = useState<number | null>(null);
  const [themeMounted, setThemeMounted] = useState(false);
  /** 窄屏（<768px）标记：仅 auto 模式渲染列数收窄用 */
  const [narrow, setNarrow] = useState(false);
  /** 使用须知弹窗 */
  const [notesOpen, setNotesOpen] = useState(false);
  /** 「刷新全部页面」信号：自增触发所有 HTML 卡片重载 iframe（纯 HTML 项目的等价播放操作） */
  const [htmlRefreshTick, setHtmlRefreshTick] = useState(0);
  /** HTML 播放控制：命令广播（id 变化才执行）、重载/备场信号、暂停态、同步开始屏障 */
  const [htmlCommand, setHtmlCommand] = useState<{ id: number; action: 'pause' | 'play'; at?: number } | null>(null);
  const [htmlReload, setHtmlReload] = useState<{ tick: number; hold: boolean }>({ tick: 0, hold: false });
  const [htmlPaused, setHtmlPaused] = useState(false);
  const [htmlSyncPending, setHtmlSyncPending] = useState(false);
  const [htmlReadySet, setHtmlReadySet] = useState<number[]>([]);
  const htmlCommandId = useRef(0);
  /** 录制舞台：16:9 无间隙画布；阶段机 idle → loading（HTML 备场）→ countdown → live */
  const [recording, setRecording] = useState(false);
  const [recPhase, setRecPhase] = useState<'idle' | 'loading' | 'countdown' | 'live'>('idle');
  const [recCount, setRecCount] = useState(3);
  /** 应用内录屏是否真的在写数据（用于退出按钮文案） */
  const [recActive, setRecActive] = useState(false);
  const [recPaused, setRecPaused] = useState(false);
  /** 实际捕获参数（分辨率/帧率/目标码率），用于清晰度提示 */
  const [recMeta, setRecMeta] = useState<RecorderMeta | null>(null);
  /** 录制舞台比例：16:9 横屏 / 9:16 竖屏 / 1:1 方屏 */
  const [recordAspect, setRecordAspect] = useState<'16:9' | '9:16' | '1:1'>('16:9');
  /** 录制舞台显示卡片标题标签 */
  const [recordLabels, setRecordLabels] = useState(true);
  /** 空格暂停时同步暂停 MediaRecorder（把停顿从成片里剪掉） */
  const [trimPauses, setTrimPauses] = useState(true);
  const recStreamRef = useRef<MediaStream | null>(null);
  /** 裁到舞台后的录制流（canvas 视频 + 原标签页音频） */
  const recStageStreamRef = useRef<MediaStream | null>(null);
  const recCanvasStreamRef = useRef<MediaStream | null>(null);
  const recCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const recVideoRef = useRef<HTMLVideoElement | null>(null);
  const recRafRef = useRef<number | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recChunksRef = useRef<Blob[]>([]);
  /** 专注模式网页备场：idle（未挂载）→ loading（挂载+hold）→ playing ⇄ paused */
  const [focusStage, setFocusStage] = useState<'idle' | 'loading' | 'playing' | 'paused'>('idle');
  const [focusSuspended, setFocusSuspended] = useState(false);
  /** 水印文字编辑对话框：open 状态与草稿（确认才提交，取消/Esc 丢弃草稿）；
   *  enable：本次保存是否连带启用水印 */
  const [wmDialogOpen, setWmDialogOpen] = useState(false);
  const [wmDraft, setWmDraft] = useState('');
  const [wmDialogEnable, setWmDialogEnable] = useState(false);
  /** 背景音乐上传中 */
  const [bgmUploading, setBgmUploading] = useState(false);
  /** 自定义比例输入草稿（受控输入需要允许中间态，提交时再校验） */
  const [ratioDraft, setRatioDraft] = useState({ w: '16', h: '9' });

  const { resolvedTheme, setTheme } = useTheme();

  /* ---------- DOM 引用 ---------- */
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);
  const importInputRef = useRef<HTMLInputElement>(null);
  /** 背景音乐：<audio> 元素（loop 恒开，音量/倍速由 effect 同步）与上传 input */
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const bgmInputRef = useRef<HTMLInputElement>(null);
  const titleTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  /** 在途未提交的标题（slot → 最新文本 + 编辑时刻的提交 URL）：
 *  URL 快照携带编辑时刻的项目 id——防抖窗口内切换项目后，正常提交与卸载补提交
 *  （keepalive）都写回编辑它时所属的项目，而不是卸载时的当前项目 */
  const titlePending = useRef<Map<number, { title: string; url: string }>>(new Map());
  /* 自动适配视口测量锚点：顶栏 / 主体 / 网格 / 提示词栏 / 水印层 / 专注模式按钮区 */
  const headerRef = useRef<HTMLElement | null>(null);
  const mainRef = useRef<HTMLElement | null>(null);
  const wallRef = useRef<HTMLDivElement | null>(null);
  const promptBarRef = useRef<HTMLDivElement | null>(null);
  const wmLayerRef = useRef<HTMLDivElement | null>(null);
  /** 专注模式右下角悬浮按钮区（autoFit 为其预留空间，防视频墙重叠遮挡） */
  const focusBtnsRef = useRef<HTMLDivElement | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** refs 聚合为稳定对象（useAutoFit 的 effect 依赖） */
  const fitRefs = useMemo(
    () => ({ headerRef, mainRef, wallRef, promptBarRef, wmLayerRef, focusBtnsRef }),
    [],
  );

  /* ---------- 派生 ---------- */
  const busy = importing || Object.values(uploading).some(Boolean);
  const filledCount = slots.filter((s) => s.video || s.html || s.image).length;
  /** 当前项目是否含视频：纯 HTML 项目没有「播放」语义，播放类控件随之隐藏/禁用 */
  const hasVideo = slots.some((s) => !!s.video);
  /** 当前项目是否含 HTML 页面：纯 HTML 项目用「刷新全部页面」替代播放组 */
  const hasHtml = slots.some((s) => s.kind === 'html' && !!s.html);
  /** HTML 卡片数量：同步开始要等这么多张卡报告 ready */
  const htmlCount = slots.filter((s) => s.kind === 'html' && !!s.html).length;
  /** 当前项目是否含图片：模糊填充仅对视频/图片生效（Step C） */
  const hasImage = slots.some((s) => s.kind === 'image' && !!s.image);

  /* ---------- 拖拽导入提示（防卡死） ----------
      卡片级 handleDrop 会 stopPropagation（防主区重复导入），冒泡层 onDrop 收不到 →
      gridDrag 可能卡在 true；对策：dragover 持续触发时心跳续命，350ms 无 dragover
      （即拖拽会话已结束）自动收起提示。 */
  const [gridDrag, setGridDrag] = useState(false);
  const gridDragTimerRef = useRef<number | null>(null);
  const endGridDrag = useCallback(() => {
    if (gridDragTimerRef.current !== null) {
      window.clearTimeout(gridDragTimerRef.current);
      gridDragTimerRef.current = null;
    }
    setGridDrag(false);
  }, []);
  const keepGridDragAlive = useCallback(() => {
    if (gridDragTimerRef.current !== null) window.clearTimeout(gridDragTimerRef.current);
    gridDragTimerRef.current = window.setTimeout(endGridDrag, 350);
  }, [endGridDrag]);
  useEffect(
    () => () => {
      if (gridDragTimerRef.current !== null) window.clearTimeout(gridDragTimerRef.current);
    },
    [],
  );

  /* ---------- 项目域（列表/切换/新建/改名/删除） ---------- */
  /** 项目切换请求：保留旧内容进入过渡态，新数据到达后一次性淡入，避免高度突变跳动 */
  const requestSwitch = useCallback((id: string) => {
    setSwitching(true);
    projectApi.setProjectId(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setProjectId 是 useProjects 的稳定 setState
  }, []);
  const projectApi = useProjects({ busy, requestSwitch });
  const { projectId, projects, setProjectId } = projectApi;
  const currentProject = projects.find((p) => p.id === projectId) ?? null;
  const projectName =
    currentProject?.name ?? (projectId === DEFAULT_PROJECT_ID ? '默认项目' : '加载中…');

  /* v1 API 多项目参数（Step 8）：默认项目不带参数（旧端点零改动），其余项目追加 project= */
  const withPid = useCallback(
    (url: string) =>
      projectId === DEFAULT_PROJECT_ID
        ? url
        : `${url}${url.includes('?') ? '&' : '?'}project=${encodeURIComponent(projectId)}`,
    [projectId],
  );

  /* ---------- 设置域（服务端 Project.settings 为唯一事实源，蓝图 §7/§15） ---------- */
  const { settings, applySettings, patchLocal, updateSettings, savePromptIfChanged, saveBylineIfChanged } =
    useWallSettings(withPid);

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

  /* ---------- 初始化：拉取清单 + 恢复本地偏好 ---------- */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(withPid('/api/videos'), { cache: 'no-store' });
        if (res.status === 404) {
          // 当前项目已被其他会话删除：清除本地偏好并回落默认项目（触发重载）
          if (!cancelled) projectApi.fallbackToDefault();
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
        if (!cancelled) {
          setLoading(false);
          setSwitching(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- projectApi.fallbackToDefault 随 projectId 稳定
  }, [applySettings, withPid]);

  /* 窄屏检测：auto 模式下列数收窄到 2 竖向堆叠（蓝图 §12；仅影响渲染，不改存储矩阵） */
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const onChange = () => setNarrow(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  /* 恢复本地 UI 偏好（含当前项目 id；业务数据永远以服务端为准） */
  useEffect(() => {
    try {
      const savedMode = localStorage.getItem(PREF_MODE);
      if (savedMode === 'studio' || savedMode === 'focus') setMode(savedMode);
      const savedSidebar = localStorage.getItem(PREF_SIDEBAR);
      if (savedSidebar !== null) setSidebarOpen(savedSidebar === '1');
      const savedProject = localStorage.getItem(PREF_PROJECT);
      if (savedProject) setProjectId(savedProject);
      const savedView = localStorage.getItem(PREF_VIEW);
      if (savedView === 'workspace' || savedView === 'library') setView(savedView);
    } catch {
      /* 忽略隐私模式下的存储错误 */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅挂载时恢复一次
  }, []);

  /* UI 偏好持久化 */
  useEffect(() => {
    try {
      localStorage.setItem(PREF_MODE, mode);
    } catch {}
  }, [mode]);
  useEffect(() => {
    try {
      localStorage.setItem(PREF_VIEW, view);
    } catch {}
  }, [view]);
  useEffect(() => {
    try {
      localStorage.setItem(PREF_SIDEBAR, sidebarOpen ? '1' : '0');
    } catch {}
  }, [sidebarOpen]);

  /* 进入项目库时刷新项目列表（其他会话的状态变更也能看到） */
  useEffect(() => {
    if (view === 'library') void projectApi.refreshProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refreshProjects 引用稳定
  }, [view]);

  /* next-themes 首帧渲染后才确定主题，先挂载再渲染图标避免水合不一致 */
  useEffect(() => setThemeMounted(true), []);

  /** 切换明暗主题 */
  const toggleTheme = useCallback(() => {
    setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
  }, [resolvedTheme, setTheme]);

  /** 侧栏窗格点击：滚动到对应卡片并短暂高亮（只滚动视口、不改任何状态） */
  const focusSlot = useCallback((index: number) => {
    document.getElementById(`slot-card-${index}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    setHighlight(index);
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => setHighlight(null), 1600);
  }, []);

  /* 自定义比例草稿跟随服务端值同步（首次加载与切换项目后回填） */
  useEffect(() => {
    setRatioDraft({ w: String(settings.customRatio?.w ?? 16), h: String(settings.customRatio?.h ?? 9) });
  }, [settings.customRatio]);

  /** 提交自定义比例：非正数直接驳回并回填服务端值，不做静默兜底 */
  const applyCustomRatio = useCallback(() => {
    const w = Number(ratioDraft.w);
    const h = Number(ratioDraft.h);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
      toast.error('自定义比例需为两个正数', { id: 'aspect' });
      setRatioDraft({ w: String(settings.customRatio?.w ?? 16), h: String(settings.customRatio?.h ?? 9) });
      return;
    }
    void updateSettings({ aspectRatio: 'custom', customRatio: { w, h } });
  }, [ratioDraft, settings.customRatio, updateSettings]);

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
      v.loop = settings.loop;
      v.muted = settings.mutedAll;
      try {
        v.playbackRate = settings.rate;
      } catch {
        /* 个别浏览器对不支持的速率会抛错，忽略 */
      }
    });
  }, [settings.loop, settings.mutedAll, settings.rate, slots]);

  /* 卸载时清理计时器；在途标题用 keepalive 补提交（防抖窗口内关页会丢最后一次编辑）。
     提交 URL 用 pending 里存的编辑时刻快照：卸载前哪怕已切到其他项目，
     标题仍写回编辑它时所属的项目（与防抖提交同一语义） */
  useEffect(() => {
    const timers = titleTimers.current;
    const pending = titlePending.current;
    const hlTimer = highlightTimer.current;
    return () => {
      timers.forEach((t) => clearTimeout(t));
      if (hlTimer) clearTimeout(hlTimer);
      pending.forEach(({ title, url }, index) => {
        fetch(url, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slot: index, title }),
          /* keepalive：页面卸载后浏览器仍会完成该请求（64KB 上限对标题绰绰有余） */
          keepalive: true,
        }).catch(() => {});
      });
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

  /** 缩减到 n 个位置时，将被移除区间内实际存在的内容数 */
  const removedContentCount = useCallback(
    (n: number) => slots.slice(n).filter((s) => s.video || s.html || s.image).length,
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

  /** 手动选择矩阵：覆盖 auto 并记住（蓝图 §12） */
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
  const filledSlots = useMemo(() => slots.filter((s) => s.video || s.html || s.image), [slots]);
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
      const empties = slots.filter((s) => !s.video && !s.html && !s.image);
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
    [slots, filledSlots, sortableIds, withPid, applySettings],
  );

  /* ---------- 上传与分配 ---------- */
  /** 上传单个文件到指定位置；返回失败原因（null 表示成功），提示由调用方聚合成一条 */
  const uploadToSlot = useCallback(
    async (index: number, file: File): Promise<string | null> => {
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
    },
    [withPid],
  );

  /**
   * 分配一批文件：第一个进入 primarySlot（仅空位拖入时指定），其余按「空位优先」
   * 依次放入。智能识别（用户预期「上传几个就显示几个」）：
   * - 空项目：格数直接调整为本次导入数；
   * - 已有内容：只在空位不够时按缺口扩容——绝不静默替换已占用卡片
   *   （替换已有内容走卡片信息行的「替换」按钮，属显式意图）。
   */
  const distributeFiles = useCallback(
    async (files: File[], primarySlot?: number) => {
      const vids = files.filter((f) => isContentFile(f.name, f.type));
      const skipped = files.length - vids.length;
      if (vids.length === 0) {
        toast.error('仅支持视频、图片或单文件 HTML，请重新选择', { id: 'import' });
        return;
      }
      if (vids.length > SLOT_MAX) {
        toast.warning(`单次最多导入 ${SLOT_MAX} 个内容，超出部分已忽略`, { id: 'import' });
      }
      const batch = vids.slice(0, SLOT_MAX);

      let targetSlots = slots;
      let primary = primarySlot;
      /** 本次导入调整了格数（空项目收缩 / 容量扩容），用于提示文案 */
      let resized = false;
      let finalCount = slots.length;

      const filled = slots.filter((s) => s.video || s.html || s.image).length;
      if (filled === 0) {
        // 空项目：格数 = 本次导入数（上传几个显示几个）
        if (slots.length !== batch.length) {
          const m = await requestLayout(
            batch.length,
            layoutMode === 'auto' ? 'auto' : defaultLayoutFor(batch.length),
          );
          if (!m) return;
          targetSlots = m.slots;
          resized = true;
          finalCount = batch.length;
        }
      } else {
        // 已有内容：可容纳数 = 空位数 +（明确指向某张卡片时可替换该卡片 1 个）
        const emptyCount = slots.length - filled;
        const capacity = emptyCount + (primary !== undefined ? 1 : 0);
        if (batch.length > capacity) {
          const newCount = Math.min(slots.length + (batch.length - capacity), SLOT_MAX);
          if (newCount > slots.length) {
            const m = await requestLayout(
              newCount,
              layoutMode === 'auto' ? 'auto' : defaultLayoutFor(newCount),
            );
            if (!m) return;
            targetSlots = m.slots;
            resized = true;
            finalCount = newCount;
          }
        }
      }
      if (primary !== undefined && !targetSlots.some((s) => s.index === primary)) {
        primary = undefined;
      }

      // 目标位选择：主位置（明确指向的卡片，可为替换）+ 全部空位；
      // 放不下的文件在结果中如实报告
      const targets: number[] = [];
      if (primary !== undefined) targets.push(primary);
      targets.push(
        ...targetSlots
          .filter((s) => !s.video && !s.html && !s.image && s.index !== primary)
          .map((s) => s.index),
      );

      setImporting(true);
      try {
        const n = Math.min(targets.length, batch.length);
        const unplaced = batch.length - n;
        let ok = 0;
        const failures: string[] = [];
        for (let i = 0; i < n; i++) {
          const err = await uploadToSlot(targets[i], batch[i]);
          if (err) failures.push(err);
          else ok++;
        }
        // 单条聚合提示：成功 / 部分失败 / 全部失败都只占一条
        if (ok > 0) {
          const parts: string[] = [
            resized
              ? `已调整为 ${finalCount} 位并导入 ${ok} 个内容`
              : batch.length === 1
                ? '已导入 1 个内容'
                : `已导入 ${ok} 个内容`,
          ];
          if (failures.length > 0) {
            parts.push(`${failures.length} 个失败（${failures[0]}${failures.length > 1 ? ' 等' : ''}）`);
          }
          if (unplaced > 0) parts.push(`${unplaced} 个未放置（内容位已达上限 ${SLOT_MAX} 个）`);
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
        } else if (unplaced > 0) {
          toast.warning(`${unplaced} 个未放置（内容位已达上限 ${SLOT_MAX} 个）`, {
            id: 'import',
            duration: 4500,
          });
        }
      } finally {
        setImporting(false);
      }
    },
    [slots, layoutMode, uploadToSlot, requestLayout],
  );

  /* ---------- 标题（防抖保存） ---------- */
  const handleTitleChange = useCallback(
    (index: number, title: string) => {
      setSlots((prev) => prev.map((s) => (s.index === index ? { ...s, title } : s)));
      const timer = titleTimers.current.get(index);
      if (timer) clearTimeout(timer);
      // 提交 URL 随文本一并快照：防抖提交与卸载补提交走同一 URL
      // （防抖窗口内切换项目后，标题仍写进编辑它时所属的项目，而不是新项目）
      const url = withPid('/api/videos');
      titlePending.current.set(index, { title, url });
      titleTimers.current.set(
        index,
        setTimeout(() => {
          titlePending.current.delete(index);
          fetch(url, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ slot: index, title }),
          })
            .then((res) => {
              if (!res.ok) toast.error('标题保存失败，请重试', { id: 'title-save' });
            })
            .catch(() => toast.error('标题保存失败，请检查网络后重试', { id: 'title-save' }));
        }, 600),
      );
    },
    [withPid],
  );

  /* ---------- 移除 ---------- */
  const handleClearSlot = useCallback(
    async (index: number) => {
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
    },
    [withPid],
  );

  /* ---------- 卡片图标（above 标题带头像）：上传/替换与移除 ---------- */
  /** 上传/替换图标：POST FormData → 响应清单回填（服务端同临界区删除旧图标文件）；
   *  复用本槽位的 uploading 状态（上传期间头像与替换按钮禁用） */
  const handleIconFiles = useCallback(
    async (file: File, index: number) => {
      if (file.size > MAX_ICON_SIZE) {
        toast.error('图标不能超过 5MB', { id: 'icon' });
        return;
      }
      setUploading((prev) => ({ ...prev, [index]: true }));
      try {
        const fd = new FormData();
        fd.append('file', file);
        const res = await fetch(withPid(`/api/videos/icon?slot=${index}`), {
          method: 'POST',
          body: fd,
        });
        const data = (await res.json().catch(() => null)) as (Manifest & { error?: string }) | null;
        if (!res.ok || !data?.slots) throw new Error(data?.error || '图标上传失败');
        setSlots(data.slots);
        toast.success(`已设置位置 ${index + 1} 的图标`, { id: 'icon' });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : '图标上传失败，请重试', { id: 'icon' });
      } finally {
        setUploading((prev) => ({ ...prev, [index]: false }));
      }
    },
    [withPid],
  );

  /** 移除图标：DELETE → 响应清单回填（文件由服务端同临界区清理） */
  const handleIconRemove = useCallback(
    async (index: number) => {
      try {
        const res = await fetch(withPid(`/api/videos/icon?slot=${index}`), { method: 'DELETE' });
        const data = (await res.json().catch(() => null)) as (Manifest & { error?: string }) | null;
        if (!res.ok || !data?.slots) throw new Error(data?.error || '移除失败');
        setSlots(data.slots);
        toast.success(`已移除位置 ${index + 1} 的图标`, { id: 'icon' });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : '图标移除失败，请重试', { id: 'icon' });
      }
    },
    [withPid],
  );

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
  /**
   * 归零并同步起播（同时播放 / 归零并播放 / 专注模式循环按钮三处共用）：
   * 先统一暂停并归零（含背景音乐），80ms 后一起 play 保证起始同步；
   * 全部被浏览器拦截时提示重试。
   * React 对 video 的属性更新不可靠，操作全部直接作用于 DOM 元素。
   */
  const restartAndPlay = useCallback(
    (active: HTMLVideoElement[]) => {
      active.forEach((v) => {
        try {
          v.pause();
          v.currentTime = 0;
        } catch {
          /* 个别浏览器在未加载元数据时设置进度会抛错，忽略 */
        }
      });
      try {
        audioRef.current?.pause();
        if (audioRef.current) audioRef.current.currentTime = 0;
      } catch {}
      window.setTimeout(() => {
        const attempts = active.map((v) => v.play());
        // 背景音乐跟随视频一起从头播放（audio loop 恒开，循环由元素自身保证）
        if (settings.bgm && audioRef.current) {
          try {
            void audioRef.current.play().catch(() => {});
          } catch {}
        }
        Promise.allSettled(attempts).then((results) => {
          if (results.length > 0 && results.every((r) => r.status === 'rejected')) {
            toast.error('播放被浏览器拦截，请再点一次', { id: 'play' });
          }
        });
      }, 80);
    },
    [settings.bgm],
  );

  const handlePlayAll = useCallback(() => {
    const active = getActiveVideos();
    if (active.length === 0 && !settings.bgm) {
      toast.error('还没有可播放的视频，请先上传', { id: 'play' });
      return;
    }
    restartAndPlay(active);
  }, [getActiveVideos, settings.bgm, restartAndPlay]);

  const handlePauseAll = useCallback(() => {
    const active = getActiveVideos();
    if (active.length === 0 && !settings.bgm) {
      toast.error('还没有可播放的视频，请先上传', { id: 'play' });
      return;
    }
    active.forEach((v) => {
      try {
        v.pause();
      } catch {}
    });
    try {
      audioRef.current?.pause();
    } catch {}
  }, [getActiveVideos, settings.bgm]);

  /** 一键重置（录屏备场）：全部视频归零、网页 iframe 重载、背景音乐归零；
   *  play=true 时归零后立即同步起播（等价专注模式圆形按钮），false 时保持暂停 */
  const handleResetAll = useCallback(
    (play: boolean) => {
      const active = getActiveVideos();
      if (active.length === 0 && !settings.bgm && !hasHtml) {
        toast.error('还没有可重置的内容，请先上传', { id: 'reset' });
        return;
      }
      // 网页"从头开始" = 重载 iframe（与「刷新全部页面」同一信号）
      setHtmlRefreshTick((n) => n + 1);
      setHtmlPaused(false);
      if (!play) {
        // 仅归零暂停：视频与背景音乐归零，不起播
        active.forEach((v) => {
          try {
            v.pause();
            v.currentTime = 0;
          } catch {
            /* 未加载元数据时设置进度可能抛错，忽略 */
          }
        });
        try {
          audioRef.current?.pause();
          if (audioRef.current) audioRef.current.currentTime = 0;
        } catch {}
        return;
      }
      restartAndPlay(active);
    },
    [getActiveVideos, settings.bgm, hasHtml, restartAndPlay],
  );

  /** 专注模式圆形按钮：视频 + 背景音乐全部从头开始同步播放，并保持循环 */
  const handleLoopShow = useCallback(() => {
    const active = getActiveVideos();
    if (active.length === 0 && !settings.bgm) {
      toast.error('还没有视频或背景音乐，请先上传', { id: 'loop-show' });
      return;
    }
    restartAndPlay(active);
  }, [getActiveVideos, settings.bgm, restartAndPlay]);

  /* ---------- HTML 播放控制 ---------- */
  /** 广播一条暂停/继续命令：id 自增，卡片据此只执行一次 */
  const sendHtmlCommand = useCallback((action: 'pause' | 'play', at?: number) => {
    htmlCommandId.current += 1;
    setHtmlCommand({ id: htmlCommandId.current, action, at });
  }, []);

  const handleHtmlPause = useCallback(() => {
    if (!hasHtml) return;
    sendHtmlCommand('pause');
    setHtmlPaused(true);
  }, [hasHtml, sendHtmlCommand]);

  const handleHtmlResume = useCallback(() => {
    if (!hasHtml) return;
    sendHtmlCommand('play', Date.now() + 200);
    setHtmlPaused(false);
  }, [hasHtml, sendHtmlCommand]);

  /** 重来：重载全部 iframe 并自动播放（命令式页面唯一可靠的重置方式） */
  const handleHtmlRestart = useCallback(() => {
    if (!hasHtml) return;
    setHtmlPaused(false);
    setHtmlSyncPending(false);
    setHtmlReadySet([]);
    setHtmlReload((prev) => ({ tick: prev.tick + 1, hold: false }));
  }, [hasHtml]);

  /** 同步开始：全部 iframe 以 hold 重载 → 各自就绪冻结 → 收齐后同一帧释放 */
  const handleHtmlSyncStart = useCallback(() => {
    if (!hasHtml) return;
    setHtmlPaused(false);
    setHtmlReadySet([]);
    setHtmlSyncPending(true);
    setHtmlReload((prev) => ({ tick: prev.tick + 1, hold: true }));
  }, [hasHtml]);

  /** 卡片就绪上报：去重后加入屏障集合 */
  const handleHtmlReady = useCallback((index: number) => {
    setHtmlReadySet((prev) => (prev.includes(index) ? prev : [...prev, index]));
  }, []);

  // 收齐所有 HTML 卡后统一释放；12 秒兜底防止某张卡永远不就绪
  useEffect(() => {
    if (!htmlSyncPending) return;
    if (htmlReadySet.length >= htmlCount && htmlCount > 0) {
      setHtmlSyncPending(false);
      sendHtmlCommand('play', Date.now() + 300);
      return;
    }
    const timer = setTimeout(() => {
      setHtmlSyncPending(false);
      sendHtmlCommand('play', Date.now() + 300);
    }, 12000);
    return () => clearTimeout(timer);
  }, [htmlSyncPending, htmlReadySet, htmlCount, sendHtmlCommand]);

  /* ---------- 专注模式：网页备场 ---------- */
  /** 进入专注先卸载 iframe、显示黑场：等空格/播放键再加载 */
  const suspendFocusHtml = useCallback(() => {
    setFocusStage('idle');
    setFocusSuspended(true);
    setHtmlReadySet([]);
    setHtmlSyncPending(false);
    setHtmlPaused(false);
    getActiveVideos().forEach((v) => {
      try { v.pause(); } catch {}
    });
    try { audioRef.current?.pause(); } catch {}
  }, [getActiveVideos]);

  /** 开始：挂载全部 iframe（hold=1），收齐 ready 后统一 play + 视频归零 */
  const startFocusLoad = useCallback(() => {
    setFocusStage('loading');
    setFocusSuspended(false);
    setHtmlPaused(false);
    setHtmlReadySet([]);
    setHtmlSyncPending(false);
    setHtmlReload((prev) => ({ tick: prev.tick + 1, hold: true }));
  }, []);

  const startFocusPlayback = useCallback(() => {
    sendHtmlCommand('play', Date.now() + 120);
    setFocusStage('playing');
    const active = getActiveVideos();
    if (active.length > 0 || settings.bgm) restartAndPlay(active);
  }, [sendHtmlCommand, getActiveVideos, restartAndPlay, settings.bgm]);

  /** 暂停：网页冻结，视频/BGM 暂停（保留进度） */
  const pauseFocusAll = useCallback(() => {
    sendHtmlCommand('pause');
    setFocusStage('paused');
    getActiveVideos().forEach((v) => {
      try { v.pause(); } catch {}
    });
    try { audioRef.current?.pause(); } catch {}
  }, [sendHtmlCommand, getActiveVideos]);

  /** 继续：网页与视频从暂停处恢复 */
  const resumeFocusAll = useCallback(() => {
    sendHtmlCommand('play', Date.now() + 100);
    setFocusStage('playing');
    getActiveVideos().forEach((v) => { void v.play().catch(() => {}); });
    if (settings.bgm) void audioRef.current?.play().catch(() => {});
  }, [sendHtmlCommand, getActiveVideos, settings.bgm]);

  /** 专注模式播放键 / 空格：loading 忽略 → idle 挂载加载 → playing 暂停 → paused 继续 */
  const handleFocusAction = useCallback(() => {
    if (focusStage === 'loading') return;
    if (focusStage === 'idle') {
      startFocusLoad();
      return;
    }
    if (focusStage === 'playing') pauseFocusAll();
    else if (focusStage === 'paused') resumeFocusAll();
  }, [focusStage, startFocusLoad, pauseFocusAll, resumeFocusAll]);

  /** R：视频归零、网页卸载回黑场，等下一次开始重新加载 */
  const resetVideosForFocus = useCallback(() => {
    getActiveVideos().forEach((v) => {
      try {
        v.pause();
        v.currentTime = 0;
      } catch {}
    });
    try {
      audioRef.current?.pause();
      if (audioRef.current) audioRef.current.currentTime = 0;
    } catch {}
  }, [getActiveVideos]);

  // 进入专注：卸载网页等开始；离开专注：恢复挂载（之前卸载过则重载自动播放）
  const prevModeRef = useRef(mode);
  useEffect(() => {
    if (prevModeRef.current === mode) return;
    prevModeRef.current = mode;
    if (mode === 'focus' && hasHtml) {
      suspendFocusHtml();
    } else if (mode !== 'focus') {
      const wasUnloaded = focusSuspended || focusStage === 'loading' || focusStage === 'idle';
      setFocusStage('idle');
      setFocusSuspended(false);
      if (hasHtml && wasUnloaded) {
        setHtmlReload((prev) => ({ tick: prev.tick + 1, hold: false }));
      }
    }
  }, [mode, hasHtml, focusSuspended, focusStage, suspendFocusHtml]);

  // 专注模式下项目才加载完成：同样先卸载
  useEffect(() => {
    if (mode === 'focus' && hasHtml && !focusSuspended && focusStage === 'idle') {
      suspendFocusHtml();
    }
  }, [mode, hasHtml, focusSuspended, focusStage, suspendFocusHtml]);

  // 加载完成（或 12 秒兜底）→ 同帧开演
  useEffect(() => {
    if (mode !== 'focus' || focusStage !== 'loading') return;
    if (htmlCount > 0 && htmlReadySet.length >= htmlCount) {
      startFocusPlayback();
      return;
    }
    const timer = setTimeout(() => startFocusPlayback(), 12000);
    return () => clearTimeout(timer);
  }, [mode, focusStage, htmlReadySet, htmlCount, startFocusPlayback]);

  // 迟到的 ready：已开演时补发 play，避免超时后加载完的页面停在冻结态
  useEffect(() => {
    if (mode === 'focus' && focusStage === 'playing' && htmlReadySet.length > 0) {
      sendHtmlCommand('play', Date.now() + 50);
    }
  }, [mode, focusStage, htmlReadySet.length, sendHtmlCommand]);

  /* ---------- 录制舞台 ---------- */
  /** 停止录制：onstop 里统一生成 Blob 并下载 */
  const stopRecorder = useCallback(() => {
    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') rec.stop();
    recorderRef.current = null;
    setRecActive(false);
    setRecPaused(false);
    setRecMeta(null);
    if (recRafRef.current !== null) {
      cancelAnimationFrame(recRafRef.current);
      recRafRef.current = null;
    }
    recStageStreamRef.current?.getTracks().forEach((t) => t.stop());
    recStageStreamRef.current = null;
    recCanvasStreamRef.current?.getTracks().forEach((t) => t.stop());
    recCanvasStreamRef.current = null;
    recStreamRef.current?.getTracks().forEach((t) => t.stop());
    recStreamRef.current = null;
    if (recVideoRef.current) {
      recVideoRef.current.srcObject = null;
      recVideoRef.current.remove();
      recVideoRef.current = null;
    }
    recCanvasRef.current = null;
  }, []);

  /** 提前把标签页捕获流挂到一个隐藏 video 上，countdown 归零时可直接抓帧 */
  const prepareRecVideo = useCallback(async () => {
    if (recVideoRef.current || !recStreamRef.current) return;
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = recStreamRef.current;
    video.style.cssText = 'position:fixed;left:-100000px;top:0;width:2px;height:2px;opacity:0;pointer-events:none';
    document.body.appendChild(video);
    try {
      await video.play();
    } catch {}
    if (video.videoWidth === 0) {
      await new Promise<void>((resolve) => {
        const done = () => resolve();
        video.addEventListener('loadedmetadata', done, { once: true });
        setTimeout(done, 1200);
      });
    }
    if (!recStreamRef.current) {
      video.remove();
      return;
    }
    recVideoRef.current = video;
  }, []);

  /**
   * 只录舞台：把标签页视频按舞台在页面中的物理像素位置裁出来画到 canvas，
   * canvas 尺寸 = 舞台物理尺寸（例如 1498×842），不再包含黑边，也不会被放大。
   * 这样成片的内容像素与原界面 1:1。
   */
  const startStageCanvas = useCallback(() => {
    const source = recStreamRef.current;
    const video = recVideoRef.current;
    const stage = wallRef.current;
    if (!source || !video || !stage) return false;
    const vw = video.videoWidth || Math.round(innerWidth * devicePixelRatio);
    const vh = video.videoHeight || Math.round(innerHeight * devicePixelRatio);
    if (vw < 2 || vh < 2) return false;
    const rect = stage.getBoundingClientRect();
    const sx = vw / Math.max(1, innerWidth);
    const sy = vh / Math.max(1, innerHeight);
    const cropX = Math.max(0, Math.round(rect.left * sx));
    const cropY = Math.max(0, Math.round(rect.top * sy));
    const cropW = Math.min(vw - cropX, Math.max(2, Math.round(rect.width * sx)));
    const cropH = Math.min(vh - cropY, Math.max(2, Math.round(rect.height * sy)));
    if (cropW < 16 || cropH < 16) return false;

    const canvas = document.createElement('canvas');
    canvas.width = cropW;
    canvas.height = cropH;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return false;
    const draw = () => {
      try {
        ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
      } catch {}
      recRafRef.current = requestAnimationFrame(draw);
    };
    draw();

    const canvasStream = canvas.captureStream(60);
    const mixed = new MediaStream([...canvasStream.getVideoTracks(), ...source.getAudioTracks()]);
    recCanvasRef.current = canvas;
    recCanvasStreamRef.current = canvasStream;
    recStageStreamRef.current = mixed;
    setRecMeta(estimateRecorderMeta(mixed));
    return true;
  }, []);

  /** 倒计时归零时才开始写数据：此时舞台已干净，录到的第一帧就是动画起点 */
  const beginRecorder = useCallback(() => {
    const stream = recStageStreamRef.current ?? recStreamRef.current;
    if (!stream || recorderRef.current) return;
    const created = createTabRecorder(stream);
    if (!created) return;
    const { recorder: rec, meta } = created;
    recChunksRef.current = [];
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) recChunksRef.current.push(e.data);
    };
    rec.onstop = () => {
      const blob = new Blob(recChunksRef.current, { type: rec.mimeType || 'video/webm' });
      recChunksRef.current = [];
      if (blob.size > 0) {
        downloadRecording(blob, recordingFilename(rec.mimeType));
        toast.success(`录制已保存为 ${rec.mimeType.includes('mp4') ? 'MP4' : 'WebM'}`, { id: 'record-save' });
      }
    };
    rec.start(1000);
    recorderRef.current = rec;
    setRecMeta(meta);
    setRecActive(true);
  }, []);

  const exitRecording = useCallback(() => {
    stopRecorder();
    setRecording(false);
    setRecPhase('idle');
    setRecCount(3);
  }, [stopRecorder]);

  /** 进入录制：请求标签页捕获（点击是用户手势），失败则用 OBS 兜底 */
  const handleEnterRecord = useCallback(async () => {
    if (recording) return;
    if (filledCount === 0) {
      toast.error('还没有可录制的内容，请先上传', { id: 'record' });
      return;
    }

    toast.loading('请求屏幕捕获：请选择当前标签页…', { id: 'record-capture' });
    let stream: MediaStream | null = null;
    try {
      stream = await requestTabCapture();
    } catch {
      stream = null;
    }
    if (stream) {
      recStreamRef.current = stream;
      const meta = estimateRecorderMeta(stream);
      if (meta.width > 0 && meta.height > 0) {
        setRecMeta(meta);
        const format = meta.mimeType.includes('mp4') ? 'H.264/MP4' : 'VP9/WebM';
        toast.success(
          `捕获 ${meta.width}×${meta.height} @${Math.round(meta.fps)}fps · ${format} · 目标 ${(meta.bitrate / 1e6).toFixed(1)} Mbps`,
          { id: 'record-capture' },
        );
        if (typeof window !== 'undefined' && meta.width < window.innerWidth * 0.9) {
          toast.warning('捕获分辨率低于窗口：全屏或放大窗口可提升清晰度', { id: 'record-quality' });
        }
      } else {
        toast.success('已捕获当前标签页，倒计时后自动开录', { id: 'record-capture' });
      }
      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        stopRecorder();
        toast.info('屏幕捕获已停止', { id: 'record-capture' });
      });
    } else {
      toast.info('未开启应用内录屏：仍可排练，或用 OBS 捕获本窗口', { id: 'record-capture' });
    }

    setRecording(true);
    setRecCount(3);
    window.scrollTo({ top: 0 });
    if (typeof document !== 'undefined' && !document.hasFocus()) {
      toast.warning('窗口不在前台：浏览器会把动画限到约 20fps，录制前请点回本窗口', { id: 'record-focus' });
    }
    if (htmlCount > 0) {
      setHtmlPaused(false);
      setHtmlReadySet([]);
      setHtmlSyncPending(false);
      setHtmlReload((prev) => ({ tick: prev.tick + 1, hold: true }));
      setRecPhase('loading');
    } else {
      setRecPhase('countdown');
    }
  }, [recording, filledCount, htmlCount, stopRecorder]);

  // 备场完成 → 倒计时（12 秒兜底，避免某张页面卡住）
  useEffect(() => {
    if (!recording || recPhase !== 'loading') return;
    if (htmlCount > 0 && htmlReadySet.length >= htmlCount) {
      setRecPhase('countdown');
      return;
    }
    const timer = setTimeout(() => setRecPhase('countdown'), 12000);
    return () => clearTimeout(timer);
  }, [recording, recPhase, htmlReadySet, htmlCount]);

  // 舞台挂载后提前准备隐藏 video，倒计时结束即可抓帧
  useEffect(() => {
    if (!recording) return;
    const timer = setTimeout(() => { void prepareRecVideo(); }, 100);
    return () => clearTimeout(timer);
  }, [recording, prepareRecVideo]);

  // 倒计时 3-2-1 → 裁舞台 + 开录 + 同帧开演：HTML 统一 play，视频/BGM 归零起播
  useEffect(() => {
    if (!recording || recPhase !== 'countdown') return;
    setRecCount(3);
    let n = 3;
    const timer = setInterval(() => {
      n -= 1;
      setRecCount(n);
      if (n <= 0) {
        clearInterval(timer);
        setRecPhase('live');
        // 录制从这一帧开始：先清掉所有 toast，避免「捕获成功/窗口不在前台」录进成片
        toast.dismiss();
        startStageCanvas();
        beginRecorder();
        if (htmlCount > 0) sendHtmlCommand('play', Date.now() + 100);
        const active = getActiveVideos();
        if (active.length > 0 || settings.bgm) restartAndPlay(active);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [recording, recPhase, htmlCount, sendHtmlCommand, getActiveVideos, restartAndPlay, settings.bgm, beginRecorder, startStageCanvas]);

  // 录制态键盘：Esc 停止保存；A 比例、L 标签、P 停顿剪辑；live 后空格暂停/继续、R 重来
  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        exitRecording();
        return;
      }
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;

      if (e.code === 'KeyA') {
        e.preventDefault();
        setRecordAspect((prev) => (prev === '16:9' ? '9:16' : prev === '9:16' ? '1:1' : '16:9'));
        return;
      }
      if (e.code === 'KeyL') {
        e.preventDefault();
        setRecordLabels((prev) => !prev);
        return;
      }
      if (e.code === 'KeyP') {
        e.preventDefault();
        setTrimPauses((prev) => !prev);
        return;
      }

      if (recPhase !== 'live') return;
      if (e.code === 'Space') {
        e.preventDefault();
        const vids = getActiveVideos();
        const videosPlaying = vids.some((v) => !v.paused);
        const contentPlaying = (hasHtml && !htmlPaused) || videosPlaying;
        // 停顿剪辑：暂停时同步 pause MediaRecorder，恢复时 resume，成片里不保留冻结段
        if (trimPauses) {
          const rec = recorderRef.current;
          if (rec?.state === 'recording' && contentPlaying) {
            rec.pause();
            setRecPaused(true);
          } else if (rec?.state === 'paused' && !contentPlaying) {
            rec.resume();
            setRecPaused(false);
          }
        }
        if (htmlPaused) handleHtmlResume();
        else handleHtmlPause();
        if (vids.some((v) => !v.paused)) {
          vids.forEach((v) => {
            try { v.pause(); } catch {}
          });
          try { audioRef.current?.pause(); } catch {}
        } else {
          vids.forEach((v) => { void v.play().catch(() => {}); });
          if (settings.bgm) void audioRef.current?.play().catch(() => {});
        }
        return;
      }
      if (e.code === 'KeyR') {
        e.preventDefault();
        if (htmlCount > 0) handleHtmlRestart();
        const vids = getActiveVideos();
        if (vids.length > 0 || settings.bgm) restartAndPlay(vids);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    recording, recPhase, exitRecording, htmlPaused, handleHtmlPause, handleHtmlResume,
    handleHtmlRestart, getActiveVideos, settings.bgm, restartAndPlay, htmlCount, trimPauses, hasHtml,
  ]);

  /* ---------- 背景音乐（BGM）----------
     全局唯一一轨：文件经 /api/videos/bgm 上传/移除，音量经 settings PATCH 持久化。
     <audio loop> 恒开（循环由元素自身保证），音量/倍速由下方 effect 同步到元素。 */
  /** 音量 0-100 → 元素 0-1（bgm 变化时元素重挂载，一并在依赖里兜底） */
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = settings.bgmVolume / 100;
  }, [settings.bgmVolume, settings.bgm]);
  /** 播放倍速与视频保持一致（用户在菜单调倍速时背景音乐同步变速） */
  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = settings.rate;
  }, [settings.rate, settings.bgm]);

  /** 专注模式键盘快捷键：空格 / F = 开始⇄暂停；R = 归零并重新备场。
   *  有网页时先重载冻结，空格/播放键才真正开始，与视频逻辑一致；
   *  标题/提示词输入框等聚焦时不抢键；空格默认滚动页面，需 preventDefault */
  useEffect(() => {
    if (mode !== 'focus') return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const isReset = e.code === 'KeyR';
      if (!isReset && e.code !== 'Space' && e.key !== 'f' && e.key !== 'F') return;
      e.preventDefault();
      if (isReset) {
        if (hasHtml) {
          resetVideosForFocus();
          suspendFocusHtml();
        } else {
          handleResetAll(false);
        }
        return;
      }
      if (hasHtml) {
        handleFocusAction();
        return;
      }
      const anyPlaying =
        getActiveVideos().some((v) => !v.paused)
        || (!!settings.bgm && !!audioRef.current && !audioRef.current.paused);
      if (anyPlaying) handlePauseAll();
      else handleLoopShow();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    mode, hasHtml, handleFocusAction, resetVideosForFocus, suspendFocusHtml, handleResetAll,
    getActiveVideos, handlePauseAll, handleLoopShow, settings.bgm,
  ]);

  /** 上传/更换背景音乐：POST FormData → 响应清单回填（服务端同临界区删除旧文件） */
  const handleBgmFile = useCallback(
    async (file: File) => {
      if (file.size > MAX_AUDIO_SIZE) {
        toast.error('背景音乐不能超过 50MB', { id: 'bgm' });
        return;
      }
      setBgmUploading(true);
      try {
        const fd = new FormData();
        fd.append('file', file);
        const res = await fetch(withPid('/api/videos/bgm'), { method: 'POST', body: fd });
        const data = (await res.json().catch(() => null)) as (Manifest & { error?: string }) | null;
        if (!res.ok || !data?.slots) throw new Error(data?.error || '上传失败');
        applySettings(data.settings);
        toast.success(`背景音乐已设置：${file.name}`, { id: 'bgm' });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : '背景音乐上传失败，请重试', { id: 'bgm' });
      } finally {
        setBgmUploading(false);
      }
    },
    [withPid, applySettings],
  );

  /** 移除背景音乐：DELETE /api/videos/bgm → 响应清单回填 */
  const handleRemoveBgm = useCallback(async () => {
    try {
      const res = await fetch(withPid('/api/videos/bgm'), { method: 'DELETE' });
      const data = (await res.json().catch(() => null)) as (Manifest & { error?: string }) | null;
      if (!res.ok || !data?.slots) throw new Error(data?.error || '移除失败');
      applySettings(data.settings);
      toast.success('已移除背景音乐', { id: 'bgm' });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '背景音乐移除失败，请重试', { id: 'bgm' });
    }
  }, [withPid, applySettings]);

  /* ---------- 自动适配视口（autoFit，含提示词栏宽/水印层对齐） ---------- */
  const promptVisible = view === 'workspace' && filledCount > 0 && (settings.showPrompt || settings.showByline);
  const wmVisible = view === 'workspace' && filledCount > 0 && settings.wmShow;
  const fitActive = !recording && (mode === 'focus' || settings.autoFit);
  const fitWidth = useAutoFit({
    refs: fitRefs,
    fitActive,
    mode,
    loading,
    view,
    filledCount,
    promptVisible,
    wmVisible,
  });

  /* ---------- 卡片渲染 props：公共部分引用稳定（配合 VideoCard memo 跳过无关重渲） ---------- */
  /** 文件落入分发：与 distributeFiles 解耦为稳定引用 */
  const handleCardFiles = useCallback(
    (files: File[], primarySlot?: number) => void distributeFiles(files, primarySlot),
    [distributeFiles],
  );
  const setVideoRef = useCallback((index: number, el: HTMLVideoElement | null) => {
    videoRefs.current[index] = el;
  }, []);
  /** 所有卡片共享的 props（与具体槽位无关）：useMemo 保证引用稳定。
   *  依赖按字段细化而非整个 settings 对象：水印（wm 前缀各字段）、提示词/署名
   *  （prompt/byline）、BGM（bgm/bgmVolume）、墙缩放（wallScale/autoFit）等
   *  不影响卡片渲染的字段变化不再重建本对象 → memo 后全部卡片跳过重渲
   *  （水印不透明度拖动是高频路径）。 */
  const sharedCardProps = useMemo(
    () => ({
      loop: settings.loop,
      muted: settings.mutedAll,
      focusMode: mode === 'focus',
      lockControls: settings.lockControls,
      dragActive: gridDrag,
      globalAspect: settings.aspect,
      globalCustomRatio: settings.customRatio,
      showTitles: settings.showTitles,
      showInfo: settings.showInfo,
      showIndex: settings.showIndex,
      letterboxFill: settings.letterboxFill,
      htmlScale: settings.htmlScale,
      titleAlign: settings.titleAlign,
      titleFontSize: settings.titleFontSize,
      titlePosition: settings.titlePosition,
      titleWeight: settings.titleWeight,
      titleColor: settings.titleColor,
      refreshSignal: htmlRefreshTick,
      htmlSuspended: focusSuspended,
      htmlCommand,
      htmlReload,
      onHtmlReady: handleHtmlReady,
      onAspectOverride: handleSlotAspect,
      onFiles: handleCardFiles,
      onTitleChange: handleTitleChange,
      onIconFiles: handleIconFiles,
      onIconRemove: handleIconRemove,
      onClear: handleClearSlot,
      setVideoRef,
    }),
    [
      settings.loop, settings.mutedAll, settings.lockControls, settings.aspect,
      settings.customRatio, settings.showTitles, settings.showInfo, settings.showIndex,
      settings.letterboxFill, settings.htmlScale, settings.titleAlign, settings.titleFontSize,
      settings.titlePosition, settings.titleWeight, settings.titleColor,
      mode, gridDrag, htmlRefreshTick, htmlCommand, htmlReload, handleHtmlReady, focusSuspended,
      handleSlotAspect, handleCardFiles, handleTitleChange, handleIconFiles, handleIconRemove, handleClearSlot, setVideoRef,
    ],
  );

  /* 渲染列数：auto 模式窄屏收窄到 2 列竖向堆叠；整墙缩放宽度取求解值或手动档 */
  const gridCols = layoutMode === 'auto' && narrow ? Math.min(layout.cols, 2) : layout.cols;
  /** 录制舞台只渲染已填充内容，并按数量压成紧凑矩阵（4 个 = 标准 2×2） */
  const recordSlots = slots.filter((s) => !!(s.video || s.html || s.image));
  const recordCols =
    recordSlots.length <= 1 ? 1 : recordSlots.length <= 4 ? 2 : Math.min(3, Math.ceil(Math.sqrt(recordSlots.length)));
  const visibleSlots = recording ? recordSlots : slots;
  const padCellCount = recording ? 0 : Math.max(0, layout.rows * layout.cols - slots.length);
  const [recordAspectW, recordAspectH] =
    recordAspect === '16:9' ? [16, 9] : recordAspect === '9:16' ? [9, 16] : [1, 1];
  /** 录制舞台：严格按所选比例，紧凑矩阵无间隙铺满 */
  const gridStyle = recording
    ? {
        gridTemplateColumns: `repeat(${recordCols}, minmax(0, 1fr))`,
        gridTemplateRows: 'auto',
        alignContent: 'center',
        width: `min(100vw, calc(100vh * ${recordAspectW} / ${recordAspectH}))`,
        height: `min(100vh, calc(100vw * ${recordAspectH} / ${recordAspectW}))`,
        gap: 0,
      }
    : {
        gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))`,
        width: fitActive ? (fitWidth !== null ? `${fitWidth}px` : '100%') : `${settings.wallScale}%`,
      };

  /* ---------- 渲染 ---------- */
  return (
    <div className={cn('flex min-h-screen flex-col bg-background text-foreground', recording && 'overflow-hidden bg-black', recording && recPhase === 'live' && 'cursor-none')}>
      {/* 顶部控制栏（仅 Studio 渲染；专注模式整体隐藏，退出入口在右下角圆形按钮） */}
      {mode === 'studio' && !recording && (
        <TopBar
          headerRef={headerRef}
          mode={mode}
          view={view}
          sidebarOpen={sidebarOpen}
          busy={busy}
          filledCount={filledCount}
          hasVideo={hasVideo}
          hasHtml={hasHtml}
          hasImage={hasImage}
          projectName={projectName}
          projects={projects}
          projectId={projectId}
          onSwitchProject={projectApi.switchProject}
          onNewProject={() => {
            projectApi.setNewName('');
            projectApi.setCreating(true);
          }}
          themeMounted={themeMounted}
          resolvedTheme={resolvedTheme}
          onToggleTheme={toggleTheme}
          onOpenNotes={() => setNotesOpen(true)}
          count={count}
          layout={layout}
          layoutMode={layoutMode}
          onCountSelect={handleCountSelect}
          onLayoutSelect={handleLayoutSelect}
          onAutoSelect={handleAutoSelect}
          settings={settings}
          updateSettings={updateSettings}
          patchLocal={patchLocal}
          ratioDraft={ratioDraft}
          onRatioDraftChange={setRatioDraft}
          onApplyCustomRatio={applyCustomRatio}
          onPlayAll={handlePlayAll}
          onPauseAll={handlePauseAll}
          onResetAll={handleResetAll}
          onImportClick={() => importInputRef.current?.click()}
          onBgmClick={() => bgmInputRef.current?.click()}
          bgmUploading={bgmUploading}
          onRemoveBgm={() => void handleRemoveBgm()}
          onEditWatermarkText={() => {
            setWmDraft(settings.wmText);
            setWmDialogEnable(false);
            setWmDialogOpen(true);
          }}
          onClearAll={() => void handleClearAll()}
          onEnterFocus={() => {
            if (view === 'library') setView('workspace');
            setMode('focus');
          }}
          htmlPaused={htmlPaused}
          onHtmlSyncStart={handleHtmlSyncStart}
          onHtmlPause={handleHtmlPause}
          onHtmlResume={handleHtmlResume}
          onHtmlRestart={handleHtmlRestart}
          onEnterRecord={handleEnterRecord}
        />
      )}

      {/* 专注模式操作区：右下角竖排圆形按钮（从头循环播放在上，退出在下）。
          容器化 + data-focus-buttons：autoFit 求解器测量其包围盒，为按钮预留空间
          （墙的可用宽/高在按钮区方向退让，防重叠遮挡）；pointer-events-none 容器
          不拦截两按钮间隙处的点击（透传给下方视频），按钮自身恢复 auto */}
      {mode === 'focus' && !recording && (
        <div
          ref={focusBtnsRef}
          data-focus-buttons
          className="pointer-events-none fixed bottom-5 right-5 z-50 flex flex-col gap-3"
        >
          <button
            type="button"
            onClick={hasHtml ? handleFocusAction : handleLoopShow}
            disabled={hasHtml && focusStage === 'loading'}
            title={
              hasHtml
                ? focusStage === 'loading'
                  ? '页面加载中…'
                  : focusStage === 'playing'
                    ? '暂停全部内容'
                    : focusStage === 'paused'
                      ? '继续播放'
                      : '开始：加载全部页面并同步播放'
                : '从头循环播放：视频与背景音乐同步开始并循环'
            }
            aria-label={hasHtml ? (focusStage === 'playing' ? '暂停全部内容' : '开始播放') : '从头循环播放'}
            className="pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full border border-primary/40 bg-primary/15 text-primary opacity-40 shadow-lg backdrop-blur transition-all hover:bg-primary/25 hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-wait"
          >
            {hasHtml && focusStage === 'playing' ? (
              <Pause className="h-[18px] w-[18px]" aria-hidden />
            ) : (
              <Play className="h-[18px] w-[18px] fill-current" aria-hidden />
            )}
          </button>
          <button
            type="button"
            onClick={() => setMode('studio')}
            title="退出专注模式，返回工作台"
            aria-label="退出专注模式"
            className="pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full border border-border/60 bg-card/70 text-muted-foreground opacity-40 shadow-lg backdrop-blur transition-all hover:bg-card hover:text-foreground hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            <Shrink className="h-[18px] w-[18px]" aria-hidden />
          </button>
        </div>
      )}

      {/* 专注模式网页备场提示：未挂载时提示开始，加载中提示等待 */}
      {mode === 'focus' && !recording && hasHtml && (focusStage === 'idle' || focusStage === 'loading') && (
        <div className="pointer-events-none fixed bottom-7 left-1/2 z-40 -translate-x-1/2 rounded-full border border-primary/30 bg-black/65 px-4 py-2 text-xs font-medium text-white/90 shadow-lg backdrop-blur">
          {focusStage === 'loading' ? '页面加载中…' : '按空格或点右下角 ▶ 开始（将加载全部页面）'}
        </div>
      )}

      {/* 拖拽导入的浮动提示（专注模式下顶栏已隐藏，提示贴近页顶） */}
      {gridDrag && (
        <div className={cn('pointer-events-none fixed inset-x-0 z-50 flex justify-center', mode === 'focus' ? 'top-4' : 'top-16')}>
          <div className="flex items-center gap-2 rounded-full border border-primary/60 bg-primary/15 px-4 py-2 text-sm font-medium text-primary shadow-xl shadow-primary/10 backdrop-blur">
            <UploadCloud className="h-4 w-4" aria-hidden />
            松开鼠标导入内容 · 文件较多时会自动扩展位数
          </div>
        </div>
      )}

      {/* 主区：Studio 含左侧栏，Focus 满幅无上限（大屏墙可生长至视口宽）；两模式复用同一网格，切换不重建视频元素 */}
      <div
        className={cn(
          'mx-auto flex w-full flex-1 gap-5 px-3 sm:px-6',
          // 专注模式解除 max-w 上限：屏幕宽于 1800px 时墙不再被卡在中间留大边，
          // 由 autoFit 求解器按高度约束在满幅与恰好同屏之间取值
          mode === 'focus' ? 'max-w-none' : !sidebarOpen ? 'max-w-[1800px]' : 'max-w-[1400px]',
        )}
        onDragOver={(e) => {
          // 仅外部文件拖入时提示；卡片排序（pointer 模拟）不产生 dataTransfer
          if (view === 'library' || !e.dataTransfer.types.includes('Files')) return;
          e.preventDefault();
          setGridDrag(true);
          keepGridDragAlive();
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) endGridDrag();
        }}
        onDropCapture={() => {
          // 捕获阶段兜底：卡片级 handleDrop 会 stopPropagation（防重复导入），
          // 捕获阶段先于目标阶段执行，保证任何卡内松手都立即复位拖拽提示
          endGridDrag();
        }}
        onDrop={(e) => {
          if (view === 'library') return; // 库视图不接收文件导入
          e.preventDefault();
          endGridDrag();
          const files = Array.from(e.dataTransfer.files);
          if (files.length > 0) void distributeFiles(files);
        }}
      >
        {/* 左侧栏：仅 Studio + 桌面端 */}
        {mode === 'studio' && !recording && (
          <Sidebar
            open={sidebarOpen}
            onToggle={() => setSidebarOpen((v) => !v)}
            currentProject={currentProject}
            projectName={projectName}
            filledCount={filledCount}
            count={count}
            slots={slots}
            highlight={highlight}
            view={view}
            projectsCount={projects.length}
            renameDraft={projectApi.renameDraft}
            projectBusy={projectApi.projectBusy}
            busy={busy}
            onRenameDraftChange={projectApi.setRenameDraft}
            onUpdateProject={projectApi.updateProject}
            onDeleteProject={projectApi.deleteProject}
            onImportClick={() => importInputRef.current?.click()}
            onSetView={setView}
            onFocusSlot={focusSlot}
          />
        )}

        <main
          ref={mainRef}
          className={cn(
            // focus 下 flex-col：网格 my-auto 垂直居中；studio 保持块级布局零变化
            'relative min-w-0 flex-1 transition-opacity duration-300',
            mode === 'focus' ? 'flex flex-col py-3 sm:py-4' : 'py-4 sm:py-7',
            recording && 'fixed inset-0 z-[60] flex items-center justify-center bg-black py-0',
            switching && 'pointer-events-none opacity-45',
          )}
        >
          {view === 'library' ? (
            <ProjectLibrary projects={projects} projectId={projectId} onOpen={openFromLibrary} />
          ) : loading ? (
            <div className="grid gap-3 sm:gap-5" style={gridStyle}>
              {slots.map((s) => (
                <div key={s.index} className="overflow-hidden rounded-2xl border border-border bg-card">
                  <div className="aspect-video w-full animate-pulse bg-muted" />
                  <div className="p-3">
                    <div className="h-6 w-full animate-pulse rounded-lg bg-muted" />
                  </div>
                </div>
              ))}
            </div>
          ) : filledCount === 0 ? (
            /* 空状态引导（D7：仅简单文字提示 + 最小上传入口） */
            <div className="flex min-h-[420px] w-full flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border/70 bg-card/40 px-6 py-14 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-full border border-dashed border-muted-foreground/40 text-muted-foreground/60">
                <UploadCloud className="h-6 w-6" aria-hidden />
              </span>
              <div className="space-y-1">
                <p className="text-base font-semibold text-foreground/90">「{projectName}」暂无内容</p>
                <p className="mx-auto max-w-md text-[13px] leading-relaxed text-muted-foreground">
                  把视频、图片或 HTML 文件拖到页面任意位置，或点击下方按钮选择文件，内容将按顺序填入内容位
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
                支持视频（MP4 / MOV / WebM 等）、图片（PNG / JPG / WebP / SVG 等）、单文件 HTML 与 zip 页面包（含 index.html）；内容超过内容位数量时会自动扩位
              </p>
            </div>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={sortableIds} strategy={rectSortingStrategy}>
                {/* ref=自动适配测量锚点；focus 下 my-auto 垂直居中 + shrink-0 防被 flex 压缩 */}
                <div
                  ref={wallRef}
                  data-record-stage={recording ? 'true' : undefined}
                  data-record-aspect={recording ? recordAspect : undefined}
                  data-record-labels={recording ? String(recordLabels) : undefined}
                  data-record-trim={recording ? String(trimPauses) : undefined}
                  data-rec-active={recording ? String(recActive) : undefined}
                  data-rec-paused={recording ? String(recPaused) : undefined}
                  data-rec-meta={
                    recMeta ? `${recMeta.width}x${recMeta.height}@${Math.round(recMeta.fps)}:${recMeta.bitrate}` : undefined
                  }
                  className={cn('mx-auto grid gap-3 sm:gap-5', mode === 'focus' && 'my-auto shrink-0', recording && 'm-0 gap-0')}
                  style={gridStyle}
                >
                  {visibleSlots.map((slot) => {
                    const isFilled = !!(slot.video || slot.html || slot.image);
                    /* 槽位差异化 props（上传中/高亮）叠加在共享 props 上；
                       key 用稳定文件名：DOM 节点被移动而非复用重建，视频播放不中断 */
                    const cardProps = {
                      ...sharedCardProps,
                      ...(recording
                        ? {
                            showTitles: false,
                            showInfo: false,
                            showIndex: false,
                            focusMode: true,
                            lockControls: true,
                            dragActive: false,
                            globalAspect: recordAspect,
                            recordLabel: recordLabels ? (slot.title || '').trim() || null : null,
                          }
                        : {}),
                      uploading: !!uploading[slot.index],
                      highlighted: !recording && highlight === slot.index,
                    };
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
                      style={{ aspectRatio: aspectCss(settings.aspect, settings.customRatio) }}
                      className="rounded-2xl border border-dashed border-border/60 bg-muted/20"
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}

          {/* 提示词与署名（录屏入镜用） */}
          {!recording && promptVisible && (
            <PromptBar
              mode={mode}
              showPrompt={settings.showPrompt}
              showByline={settings.showByline}
              promptText={settings.promptText}
              bylineText={settings.bylineText}
              onPromptChange={(text) => patchLocal({ promptText: text })}
              onBylineChange={(text) => patchLocal({ bylineText: text })}
              onPromptBlur={savePromptIfChanged}
              onBylineBlur={saveBylineIfChanged}
              barRef={promptBarRef}
            />
          )}

          {/* 防伪水印蒙版层 */}
          {!recording && wmVisible && <WatermarkLayer settings={settings} layerRef={wmLayerRef} />}
        </main>
      </div>

      {/* 录制舞台遮罩：备场 / 倒计时；live 后消失（Esc 或右上角退出） */}
      {recording && (
        <>
          {recPhase !== 'live' && (
            <div className="pointer-events-none fixed inset-0 z-[70] flex items-center justify-center bg-black/35">
              <div className="flex min-w-[220px] flex-col items-center gap-2 rounded-3xl border border-white/10 bg-black/75 px-10 py-8 text-white shadow-2xl backdrop-blur">
                <p className="text-xs uppercase tracking-[0.3em] text-white/60">
                  {recPhase === 'loading' ? '页面备场中' : '准备录制'}
                </p>
                <p className="text-7xl font-bold tabular-nums">
                  {recPhase === 'loading' ? '···' : Math.max(recCount, 0)}
                </p>
                <p className="text-[11px] text-white/50">
                  {recPhase === 'loading' ? '全部页面就绪后自动倒计时' : '倒计时结束同帧开演'}
                </p>
                <p className="text-[10px] text-white/35">
                  L 标签 · A 比例 · P 停顿剪辑 · 空格暂停 · Esc 保存
                </p>
              </div>
            </div>
          )}
          <div className="fixed right-5 top-5 z-[80]">
            <button
              type="button"
              onClick={exitRecording}
              className="rounded-full border border-white/15 bg-black/50 px-3 py-1.5 text-xs text-white/70 opacity-0 backdrop-blur transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
              title={
                recActive
                  ? `${recMeta ? `${recMeta.width}×${recMeta.height} @${Math.round(recMeta.fps)}fps · ${(recMeta.bitrate / 1e6).toFixed(1)}Mbps · ${recMeta.mimeType.includes('mp4') ? 'H.264/MP4' : 'VP9/WebM'} · ` : ''}停止录制并保存（Esc）`
                  : '退出录制舞台（Esc）'
              }
              aria-label={recActive ? '停止录制并保存' : '退出录制舞台'}
            >
              {recActive && <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-rose-500 align-middle" aria-hidden />}
              {recActive ? '停止并保存 · Esc' : '退出录制 · Esc'}
            </button>
          </div>
        </>
      )}

      {/* 缩减数量确认框 */}
      <ShrinkConfirmDialog
        pendingCount={pendingCount}
        removedCount={removedContentCount(pendingCount ?? 0)}
        onConfirm={confirmShrink}
        onCancel={() => setPendingCount(null)}
      />

      {/* 新建项目（Step 8 多项目）：创建后立即切换到新项目 */}
      <CreateProjectDialog
        open={projectApi.creating}
        name={projectApi.newName}
        busy={projectApi.projectBusy}
        onNameChange={projectApi.setNewName}
        onCreate={() => void projectApi.createProject()}
        onClose={() => projectApi.setCreating(false)}
      />

      {/* 使用须知弹窗 */}
      <NotesDialog open={notesOpen} onClose={() => setNotesOpen(false)} />

      {/* 一键导入的隐藏文件选择框（视频、图片与单文件 HTML） */}
      <input
        ref={importInputRef}
        type="file"
        accept="video/mp4,video/*,.html,.htm,.zip,image/png,image/jpeg,image/gif,image/webp,image/svg+xml,image/bmp,image/avif"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length > 0) void distributeFiles(files);
          e.target.value = '';
        }}
      />

      {/* 背景音乐的隐藏文件选择框 */}
      <input
        ref={bgmInputRef}
        type="file"
        accept="audio/*,.mp3,.m4a,.aac,.wav,.ogg,.oga,.flac"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleBgmFile(file);
          e.target.value = '';
        }}
      />

      {/* 背景音乐元素：loop 恒开；src 跟随项目 settings.bgm，音量/倍速由 effect 同步 */}
      <audio
        ref={audioRef}
        loop
        preload="auto"
        src={settings.bgm ? `/api/files/${settings.bgm.filename}` : undefined}
        className="hidden"
      />

      {/* 水印文字编辑：确认才提交（取消/Esc 丢弃草稿）；顶栏按钮首次启用时保存会连带开启水印 */}
      <WatermarkTextDialog
        open={wmDialogOpen}
        draft={wmDraft}
        onDraftChange={setWmDraft}
        onOpenChange={(open) => {
          setWmDialogOpen(open);
          if (!open) setWmDialogEnable(false);
        }}
        onSave={(text) => {
          patchLocal({ wmText: text });
          void updateSettings(
            wmDialogEnable && text
              ? { watermarkText: text, showWatermark: true }
              : { watermarkText: text },
          );
        }}
      />
    </div>
  );

  /** 打开项目库中的某个项目：切换项目并回到工作空间视图 */
  function openFromLibrary(id: string) {
    if (id !== projectId) projectApi.switchProject(id);
    setView('workspace');
  }
}
