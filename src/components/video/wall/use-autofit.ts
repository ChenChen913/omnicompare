'use client';

/**
 * 自动适配视口（autoFit）hook：整墙高度超出视口可用空间时等比缩小到恰好同屏
 * （截图/录屏全入镜）；视口变大时逐轮回涨至满宽。从 video-wall.tsx 拆出。
 *
 * 目标求解墙宽 px（fitWidth）。格子高度随宽度单调增长（内容区 aspect-ratio 驱动），
 * 每轮按实测高度比例收缩：newW = w × avail/h —— 不动点迭代，线性布局一轮到位，
 * 非线性（标题换行/单卡覆盖比例）2-6 轮收敛；步长限制 ±35% 防过渡态读数过冲，
 * 目标上限 = 容器宽：墙比容器矮即满宽（100%），比视口高则缩到恰好同屏；
 * 视口变大时允许逐轮回涨（防历史收缩值卡死在屏幕中间）。
 * 应用 grid width = w*px —— 纯布局变化：
 * 文字重新排版保持清晰、dnd 拖拽坐标零偏差、无需外层高度补偿。
 * 触发：RO 观察 grid（内容/布局变化）与 main（容器宽变化，如侧栏开合）+ window resize；
 * rAF 合并，每帧最多一次求解；迭代上限 14 防震荡。
 *
 * 附带两个布局对齐 effect（同样操作 DOM，与求解器共享测量锚点）：
 * - 提示词/署名区域宽度跟随视频墙实际渲染宽度；
 * - 水印蒙版层位置/尺寸实时对齐视频墙（巡游范围 = 墙的实际区域）。
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/** 收敛防护：单次布局环境内最多迭代次数（比例法每轮收窄一档，防极端布局震荡） */
const FIT_MAX_ITERATIONS = 14;

/* React Compiler 的 immutability 规则不允许在 hook 内直接修改「从参数派生的对象」的
   属性（refs.promptBarRef.current.style 被视为 hook argument 的别名）；把 DOM 写入
   收口到模块级 helper，函数边界同时让意图更清晰。 */
function setElementWidth(el: HTMLElement, px: number): void {
  el.style.width = `${px}px`;
}

function setLayerBox(el: HTMLElement, box: { top: number; left: number; width: number; height: number }): void {
  el.style.top = `${box.top}px`;
  el.style.left = `${box.left}px`;
  el.style.width = `${box.width}px`;
  el.style.height = `${box.height}px`;
}

export interface AutoFitRefs {
  /** 顶栏（studio 模式扣除其高度） */
  headerRef: React.RefObject<HTMLElement | null>;
  /** 主体容器（扣除内边距） */
  mainRef: React.RefObject<HTMLElement | null>;
  /** 视频墙（自然高度测量源） */
  wallRef: React.RefObject<HTMLDivElement | null>;
  /** 提示词/署名区域（autoFit 求解时预留其高度） */
  promptBarRef: React.RefObject<HTMLDivElement | null>;
  /** 水印蒙版层 */
  wmLayerRef: React.RefObject<HTMLDivElement | null>;
}

export function useAutoFit(args: {
  refs: AutoFitRefs;
  /** 生效条件：专注模式恒定生效；工作台跟随 autoFit 设置 */
  fitActive: boolean;
  mode: 'studio' | 'focus';
  /** 初次加载完成前不求解（骨架屏高度无意义） */
  loading: boolean;
  view: 'workspace' | 'library';
  filledCount: number;
  /** 提示词/署名区域存在性（变化会改变可用空间） */
  promptVisible: boolean;
  /** 水印层存在性 */
  wmVisible: boolean;
}) {
  const { refs, fitActive, mode, loading, view, filledCount, promptVisible, wmVisible } = args;
  /** 求解结果：墙宽 px（null = 满宽 100%） */
  const [fitWidth, setFitWidth] = useState<number | null>(null);
  /** fitWidth 镜像 ref：测量回调内读写最新值，避免 RO 循环里读到过期闭包 */
  const fitWidthRef = useRef<number | null>(null);
  const fitIterRef = useRef(0);

  useLayoutEffect(() => {
    const { headerRef, mainRef, wallRef, promptBarRef } = refs;
    const applyFitWidth = (v: number | null) => {
      if (fitWidthRef.current !== v) {
        fitWidthRef.current = v;
        setFitWidth(v);
      }
    };
    if (!fitActive) {
      applyFitWidth(null);
      fitIterRef.current = 0;
      return;
    }
    /* 布局环境（模式/行数/比例/挂载时机）变化：重置迭代计数 */
    fitIterRef.current = 0;
    let raf = 0;
    /** 应用一轮求解结果：与当前值相同 = 已收敛/下限钳制，复位迭代预算
     *  （RO 只在尺寸变化时触发，相同值不会形成循环；复位保证后续环境变化有完整重算预算） */
    const commit = (next: number | null) => {
      if (next === fitWidthRef.current) {
        fitIterRef.current = 0;
        return;
      }
      fitIterRef.current += 1;
      applyFitWidth(next);
    };
    const measure = () => {
      raf = 0;
      const wall = wallRef.current;
      const main = mainRef.current;
      if (!wall || !wall.isConnected || !main) return;
      const ms = getComputedStyle(main);
      const avail =
        window.innerHeight -
        (mode === 'studio' ? (headerRef.current?.offsetHeight ?? 0) : 0) -
        (parseFloat(ms.paddingTop) || 0) -
        (parseFloat(ms.paddingBottom) || 0) -
        // 网格下方提示词/署名区域（含上边距）：可见时为它预留空间，保证一并入镜
        ((promptBarRef.current?.offsetHeight ?? 0) > 0
          ? (promptBarRef.current?.offsetHeight ?? 0) + 16
          : 0) -
        2;
      const containerW = main.clientWidth - (parseFloat(ms.paddingLeft) || 0) - (parseFloat(ms.paddingRight) || 0);
      const rect = wall.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      if (w <= 0 || h <= 0 || containerW <= 0 || avail <= 0) return;
      /* 迭代上限：连续多轮仍有变化时强制静止（极端布局保护，正常 2-7 轮收敛后自动复位） */
      if (fitIterRef.current >= FIT_MAX_ITERATIONS) return;
      const raw = w * (avail / h);
      /* 步长限制 ±35%：防过渡态（字体加载中/图片占位）读数过冲导致来回震荡。
       * 目标 = 恰好同屏的等比宽度，上限钳到容器宽（满宽即自然上限）。
       * 允许放大（w*1.35 每轮）：视口变大（拉高窗口 / 换大屏 / 进入专注模式腾出
       * 顶栏侧栏空间）后墙能重新长回满宽——此前「只缩不放」会把历史收缩值
       * 永久卡死在屏幕中间（用户实测：小窗收缩 1012px → 拉大窗口仍停 1012px） */
      const target = Math.min(containerW, Math.max(w * 0.65, raw));
      const stepped = Math.min(target, w * 1.35);
      if (!Number.isFinite(stepped) || stepped <= 0) return;
      /* 达到容器宽 = 满宽即可容纳，回到 100%；下限 240 保证可读性 */
      commit(stepped >= containerW - 1 ? null : Math.max(240, Math.round(stepped)));
    };
    const schedule = () => {
      if (raf === 0) raf = window.requestAnimationFrame(measure);
    };
    schedule();
    const ro = new ResizeObserver(schedule);
    if (wallRef.current) ro.observe(wallRef.current);
    if (mainRef.current) ro.observe(mainRef.current);
    window.addEventListener('resize', schedule);
    return () => {
      if (raf !== 0) window.cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('resize', schedule);
    };
  }, [refs, fitActive, mode, loading, view, filledCount, promptVisible]);

  /* 提示词/署名区域宽度跟随视频墙实际渲染宽度（录屏观感）：墙是内容自适应宽度
     （窄视频窄墙、宽视频宽墙，autoFit 求解的 fitWidth 也是布局宽度），
     区域与墙同宽居中才上下对齐。RO 监听墙与区域自身：
     - 墙尺寸变化 → 同步宽度；
     - 提示词内容增高（field-sizing 自适应）→ 区域自身 RO 触发并派发 resize，
       让 autoFit 重测 avail（main 高度被 flex 约束，自身增高不会触发 main 的 RO）。 */
  useEffect(() => {
    const { wallRef, promptBarRef } = refs;
    const wall = wallRef.current;
    const bar = promptBarRef.current;
    if (!wall || !bar) return;
    const sync = () => {
      const w = Math.round(wall.getBoundingClientRect().width);
      if (w > 0) setElementWidth(bar, w);
      // 区域/墙尺寸变化都可能改变 autoFit 的可用空间，通知重测（无 autoFit 时 measure 不挂载，事件无人监听，零成本）
      window.dispatchEvent(new Event('resize'));
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(wall);
    ro.observe(bar);
    return () => ro.disconnect();
  }, [refs, view, filledCount, promptVisible]);

  /* 水印蒙版层对齐视频墙：巡游范围 = 墙的实际渲染区域（单视频=单卡、多视频=整墙），
     而不是整个内容区（避免巡到墙外空白处）。墙尺寸/位置变化（增删内容、autoFit 求解、
     工作室/专注模式切换、窗口缩放）都通过 RO + resize 重算。
     坐标换算：墙 rect 视口坐标 − main rect 视口坐标 = 相对 main（水印层的 offsetParent）偏移 */
  useEffect(() => {
    const { wallRef, wmLayerRef } = refs;
    const wall = wallRef.current;
    const layer = wmLayerRef.current;
    if (!wall || !layer) return;
    const sync = () => {
      const wallRect = wall.getBoundingClientRect();
      const parent = layer.offsetParent;
      if (!parent) return;
      const parentRect = parent.getBoundingClientRect();
      setLayerBox(layer, {
        top: wallRect.top - parentRect.top,
        left: wallRect.left - parentRect.left,
        width: wallRect.width,
        height: wallRect.height,
      });
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(wall);
    window.addEventListener('resize', sync);
    // capture=true 捕获内部容器滚动（main/墙滚动时墙的视口位置变化，RO 不触发）
    window.addEventListener('scroll', sync, true);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', sync);
      window.removeEventListener('scroll', sync, true);
    };
  }, [refs, wmVisible, view, filledCount, mode]);

  return fitWidth;
}
