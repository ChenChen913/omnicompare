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
import { Play, Shrink, UploadCloud } from 'lucide-react';
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
  Manifest,
  SLOT_MAX,
  Slot,
  aspectCss,
  defaultLayoutFor,
  isContentFile,
  validateClientFile,
} from '@/lib/types';
import { VideoCard } from './video-card';
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
  /** 在途未提交的标题（slot → 最新文本）：卸载时用 keepalive 补提交，避免最后一次编辑丢失 */
  const titlePending = useRef<Map<number, string>>(new Map());
  /* 自动适配视口测量锚点：顶栏 / 主体 / 网格 / 提示词栏 / 水印层 */
  const headerRef = useRef<HTMLElement | null>(null);
  const mainRef = useRef<HTMLElement | null>(null);
  const wallRef = useRef<HTMLDivElement | null>(null);
  const promptBarRef = useRef<HTMLDivElement | null>(null);
  const wmLayerRef = useRef<HTMLDivElement | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** refs 聚合为稳定对象（useAutoFit 的 effect 依赖） */
  const fitRefs = useMemo(
    () => ({ headerRef, mainRef, wallRef, promptBarRef, wmLayerRef }),
    [],
  );

  /* ---------- 派生 ---------- */
  const busy = importing || Object.values(uploading).some(Boolean);
  const filledCount = slots.filter((s) => s.video || s.html || s.image).length;
  /** 当前项目是否含视频：纯 HTML 项目没有「播放」语义，播放类控件随之隐藏/禁用 */
  const hasVideo = slots.some((s) => !!s.video);
  /** 当前项目是否含 HTML 页面：纯 HTML 项目用「刷新全部页面」替代播放组 */
  const hasHtml = slots.some((s) => s.kind === 'html' && !!s.html);
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
  /** withPid 镜像 ref：卸载 cleanup 里读最新项目 id（闭包会捕获首渲染的 DEFAULT） */
  const withPidRef = useRef(withPid);
  withPidRef.current = withPid;

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

  /* 卸载时清理计时器；在途标题用 keepalive 补提交（防抖窗口内关页会丢最后一次编辑） */
  useEffect(() => {
    const timers = titleTimers.current;
    const pending = titlePending.current;
    const hlTimer = highlightTimer.current;
    return () => {
      timers.forEach((t) => clearTimeout(t));
      if (hlTimer) clearTimeout(hlTimer);
      pending.forEach((title, index) => {
        fetch(withPidRef.current('/api/videos'), {
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
      titlePending.current.set(index, title);
      titleTimers.current.set(
        index,
        setTimeout(() => {
          titlePending.current.delete(index);
          // 闭包捕获提交时刻的 withPid（项目 id）：防抖窗口内切换项目后，
          // 标题仍会写进编辑它时所属的项目，而不是新项目
          fetch(withPid('/api/videos'), {
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

  /** 专注模式键盘快捷键：空格 / F = 播放 ⇄ 暂停；R = 全部归零并保持暂停。
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
        handleResetAll(false);
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
  }, [mode, getActiveVideos, handleLoopShow, handlePauseAll, handleResetAll, settings.bgm]);

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
  const fitActive = mode === 'focus' || settings.autoFit;
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
  /** 所有卡片共享的 props（与具体槽位无关）：useMemo 保证引用稳定 */
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
      onAspectOverride: handleSlotAspect,
      onFiles: handleCardFiles,
      onTitleChange: handleTitleChange,
      onClear: handleClearSlot,
      setVideoRef,
    }),
    [
      settings, mode, gridDrag, htmlRefreshTick,
      handleSlotAspect, handleCardFiles, handleTitleChange, handleClearSlot, setVideoRef,
    ],
  );

  /* 渲染列数：auto 模式窄屏收窄到 2 列竖向堆叠；整墙缩放宽度取求解值或手动档 */
  const gridCols = layoutMode === 'auto' && narrow ? Math.min(layout.cols, 2) : layout.cols;
  const gridStyle = {
    gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))`,
    width: fitActive ? (fitWidth !== null ? `${fitWidth}px` : '100%') : `${settings.wallScale}%`,
  } as const;
  const padCellCount = Math.max(0, layout.rows * layout.cols - slots.length);

  /* ---------- 渲染 ---------- */
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      {/* 顶部控制栏（仅 Studio 渲染；专注模式整体隐藏，退出入口在右下角圆形按钮） */}
      {mode === 'studio' && (
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
          onHtmlRefresh={() => setHtmlRefreshTick((t) => t + 1)}
        />
      )}

      {/* 专注模式操作区：右下角竖排圆形按钮（从头循环播放在上，退出在下） */}
      {mode === 'focus' && (
        <button
          type="button"
          onClick={handleLoopShow}
          title="从头循环播放：视频与背景音乐同步开始并循环"
          aria-label="从头循环播放"
          className="fixed bottom-[4.75rem] right-5 z-50 flex h-11 w-11 items-center justify-center rounded-full border border-primary/40 bg-primary/15 text-primary opacity-40 shadow-lg backdrop-blur transition-all hover:bg-primary/25 hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          <Play className="h-[18px] w-[18px] fill-current" aria-hidden />
        </button>
      )}
      {mode === 'focus' && (
        <button
          type="button"
          onClick={() => setMode('studio')}
          title="退出专注模式，返回工作台"
          aria-label="退出专注模式"
          className="fixed bottom-5 right-5 z-50 flex h-11 w-11 items-center justify-center rounded-full border border-border/60 bg-card/70 text-muted-foreground opacity-40 shadow-lg backdrop-blur transition-all hover:bg-card hover:text-foreground hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          <Shrink className="h-[18px] w-[18px]" aria-hidden />
        </button>
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

      {/* 主区：Studio 含左侧栏，Focus 满幅；两模式复用同一网格，切换不重建视频元素 */}
      <div
        className={cn(
          'mx-auto flex w-full flex-1 gap-5 px-3 sm:px-6',
          mode === 'focus' || !sidebarOpen ? 'max-w-[1800px]' : 'max-w-[1400px]',
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
        {mode === 'studio' && (
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
                  className={cn('mx-auto grid gap-3 sm:gap-5', mode === 'focus' && 'my-auto shrink-0')}
                  style={gridStyle}
                >
                  {slots.map((slot) => {
                    const isFilled = !!(slot.video || slot.html || slot.image);
                    /* 槽位差异化 props（上传中/高亮）叠加在共享 props 上；
                       key 用稳定文件名：DOM 节点被移动而非复用重建，视频播放不中断 */
                    const cardProps = {
                      ...sharedCardProps,
                      uploading: !!uploading[slot.index],
                      highlighted: highlight === slot.index,
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
          {promptVisible && (
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
          {wmVisible && <WatermarkLayer settings={settings} layerRef={wmLayerRef} />}
        </main>
      </div>

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
