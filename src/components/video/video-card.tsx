'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Code2, Image as ImageIcon, Loader2, RefreshCw, Trash2, UploadCloud } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  AspectRatio,
  LetterboxFill,
  Slot,
  TitleAlign,
  TitlePosition,
  TitleWeight,
  TITLE_COLOR_DEFAULT,
  TITLE_FONT_DEFAULT,
  aspectCss,
  aspectLabel,
  formatBytes,
} from '@/lib/types';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export interface VideoCardProps {
  slot: Slot;
  uploading: boolean;
  loop: boolean;
  muted: boolean;
  /** 侧栏「当前窗格列表」点击定位时的高亮态 */
  highlighted?: boolean;
  /** 全局内容比例（蓝图 §13）；单卡覆盖由 slot.aspectRatio 表达，null = 跟随全局 */
  globalAspect?: AspectRatio;
  /** 全局自定义比例宽高：仅当生效比例为 'custom' 时参与计算（缺省/非法回落 16:9） */
  globalCustomRatio?: { w: number; h: number };
  /** 全局标题显隐：false 时隐藏标题输入框（蓝图 §13） */
  showTitles?: boolean;
  /** 全局属性信息显隐：false 时隐藏标题下方信息行（文件名/大小/比例/操作） */
  showInfo?: boolean;
  /** 全局位置编号显隐：false 时隐藏左上角数字角标（仅视觉隐藏，拖拽手柄能力保留，截图更干净） */
  showIndex?: boolean;
  /** 留白填充模式（Step C 扩展 cover）：base = 底色吸收；blur = 同内容模糊放大铺底；
   *  cover = 铺满裁切（object-cover，无黑边）；仅视频/图片生效，HTML 豁免 */
  letterboxFill?: LetterboxFill;
  /** 全局标题对齐（同步所有卡片）：left / center / right */
  titleAlign?: TitleAlign;
  /** 全局标题字号 px（同步所有卡片，TITLE_FONT_MIN~MAX） */
  titleFontSize?: number;
  /** 全局标题位置（同步所有卡片）：below = 内容下方（v1 行为）；overlay = 内容内部顶部叠加（两者排他） */
  titlePosition?: TitlePosition;
  /** 全局标题字重（同步所有卡片）：normal / medium / bold */
  titleWeight?: TitleWeight;
  /** 全局标题颜色（同步所有卡片）：'default' 或色板 hex；overlay 的 default 用白色+投影保可读 */
  titleColor?: string;
  /** 网页页面缩放百分比（同步所有 HTML 卡片，SCALE_STEPS 档位）：
   *  iframe 以放大 1/scale 的虚拟视口渲染页面再等比缩回卡片框，页面内容缩小后完整可见；
   *  100 = 原始行为（内容超出框时由 iframe 自行滚动/裁切） */
  htmlScale?: number;
  /** 「刷新全部页面」信号（纯 HTML 项目顶栏主动作）：数值变化时重载本卡 iframe；0 = 从未触发 */
  refreshSignal?: number;
  /** 单卡比例覆盖变更（null = 恢复跟随全局）；未传则不显示覆盖控件 */
  onAspectOverride?: (index: number, ar: AspectRatio | null) => void;
  /** 页面级拖拽导入进行中（用于在 iframe 上方临时铺一层可落放的护盾） */
  dragActive?: boolean;
  /** 拖拽排序手柄属性（dnd-kit attributes+listeners 合并后传入；
   * 不传 = 不参与排序（空位卡片），角标保持纯展示） */
  dragHandle?: React.HTMLAttributes<HTMLSpanElement> | null;
  /** 本卡片正在被拖拽（蓝图 §14：scale 1.02 + 阴影） */
  isDragging?: boolean;
  /** 处理文件（可多个）：拖到空位时 primarySlot 指向该位置，第一个文件精确落入；
   *  拖到已占用卡片时 primarySlot 不传，文件按「空位优先」顺序放入（绝不覆盖已有内容），
   *  替换已有内容请使用卡片信息行的「替换」按钮 */
  onFiles: (files: File[], primarySlot?: number) => void;
  onTitleChange: (slotIndex: number, title: string) => void;
  onClear: (slotIndex: number) => void;
  setVideoRef: (index: number, el: HTMLVideoElement | null) => void;
}

type HtmlStatus = 'loading' | 'ready' | 'error';

/** iframe 加载超时（毫秒）：超时仍未 onload 判定为失败（BLUEPRINT §10） */
const HTML_LOAD_TIMEOUT = 15000;

export function VideoCard({
  slot,
  uploading,
  loop,
  muted,
  highlighted,
  dragActive,
  dragHandle,
  isDragging,
  globalAspect = 'original',
  globalCustomRatio,
  showTitles = true,
  showInfo = true,
  showIndex = true,
  letterboxFill = 'base',
  htmlScale = 100,
  titleAlign = 'center',
  titleFontSize = TITLE_FONT_DEFAULT,
  titlePosition = 'below',
  titleWeight = 'normal',
  titleColor = TITLE_COLOR_DEFAULT,
  refreshSignal = 0,
  onAspectOverride,
  onFiles,
  onTitleChange,
  onClear,
  setVideoRef,
}: VideoCardProps) {
  const { index, title, video } = slot;
  const isHtml = slot.kind === 'html' && !!slot.html;
  const htmlFile = slot.html ?? null;
  const isImage = slot.kind === 'image' && !!slot.image;
  const imageFile = slot.image ?? null;
  const [dragOver, setDragOver] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [prevFilename, setPrevFilename] = useState(video?.filename);
  const [prevImageName, setPrevImageName] = useState(imageFile?.filename);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  /** overlay 标题条：展示态（点击进入编辑）⇄ 编辑态（失焦退出）；below/overlay 排他，textareaRef 复用 */
  const [overlayEditing, setOverlayEditing] = useState(false);
  /** 主视频本地引用（父级 setVideoRef 之外的副本，用于同步模糊背景层，Step C） */
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const bgVideoRef = useRef<HTMLVideoElement | null>(null);

  /* ---------- 标题样式派生（below/overlay 共用一套全局格式，保证模式切换视觉连续） ---------- */
  const overlayMode = showTitles && titlePosition === 'overlay';
  const belowMode = showTitles && titlePosition !== 'overlay';
  const titleFontWeight = titleWeight === 'bold' ? 700 : titleWeight === 'medium' ? 500 : 400;
  const titleColorCss = titleColor !== TITLE_COLOR_DEFAULT ? titleColor : undefined;

  /** 把主视频的播放态镜像到模糊背景层（播放/暂停/拖动/倍速/换源）；失败静默 */
  const syncBgFromMain = useCallback(() => {
    const main = localVideoRef.current;
    const bg = bgVideoRef.current;
    if (!main || !bg) return;
    try {
      bg.playbackRate = main.playbackRate;
      if (Math.abs(bg.currentTime - main.currentTime) > 0.35) {
        bg.currentTime = main.currentTime;
      }
      if (main.paused) {
        bg.pause();
      } else {
        void bg.play().catch(() => {});
      }
    } catch {
      /* 元数据未就绪时设置 currentTime 会拑错，忽略 */
    }
  }, []);

  /* ---------- HTML 状态机：loading → ready（onload）/ error（onerror 或 15s 超时） ---------- */
  const [htmlStatus, setHtmlStatus] = useState<HtmlStatus>('loading');
  const [iframeNonce, setIframeNonce] = useState(0);
  const [prevHtmlName, setPrevHtmlName] = useState<string | undefined>(undefined);

  // 切换 HTML 文件时在渲染期重置状态（React 推荐模式，避免额外 effect）
  if (prevHtmlName !== htmlFile?.filename) {
    setPrevHtmlName(htmlFile?.filename);
    setHtmlStatus('loading');
  }

  // loading 状态下启动超时计时；就绪/出错/重挂载后重置
  useEffect(() => {
    if (!isHtml || htmlStatus !== 'loading') return;
    const timer = setTimeout(() => setHtmlStatus('error'), HTML_LOAD_TIMEOUT);
    return () => clearTimeout(timer);
  }, [isHtml, htmlStatus, htmlFile?.filename, iframeNonce]);

  /** 重试：换 key 强制重挂载 iframe，重新走一遍 loading → ready/error */
  const retryHtml = useCallback(() => {
    setHtmlStatus('loading');
    setIframeNonce((n) => n + 1);
  }, []);

  /** 顶栏「刷新全部」信号：渲染期检测变化并重置状态（React 推荐模式，避免 effect 级联渲染）。
   *  signal=0 为初始值不触发；isHtml/文件名变化有各自的重置逻辑，不在此叠加 */
  const [prevRefreshSignal, setPrevRefreshSignal] = useState(refreshSignal);
  if (prevRefreshSignal !== refreshSignal) {
    setPrevRefreshSignal(refreshSignal);
    if (isHtml && refreshSignal !== 0) {
      setHtmlStatus('loading');
      setIframeNonce((n) => n + 1);
    }
  }

  /* ---------- 视频/图片错误状态：切换文件时重置 ---------- */
  if (prevFilename !== video?.filename) {
    setPrevFilename(video?.filename);
    setVideoError(false);
  }
  if (prevImageName !== imageFile?.filename) {
    setPrevImageName(imageFile?.filename);
    setImageError(false);
  }

  // 标题输入框自动增高：聚焦时完全展开（长标题编辑全可见），失焦时收折到约 4 行；
  // 配合 no-scrollbar，任何情况下都不会出现滚动条
  const recalcHeight = useCallback((expand: boolean) => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = expand ? `${ta.scrollHeight}px` : `${Math.min(ta.scrollHeight, 88)}px`;
  }, []);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    const focused = document.activeElement === ta;
    recalcHeight(focused);
  }, [title, titleFontSize, recalcHeight]);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;
    // 已占用卡片不再作为替换目标：文件按「空位优先」顺序放入，绝不覆盖已有内容；
    // 拖到空位时仍精确落入该位置。替换已有内容请走信息行的「替换」按钮（显式意图）
    const occupied = !!(video || htmlFile || imageFile);
    onFiles(files, occupied ? undefined : index);
  };

  // 生效比例：单卡覆盖优先，否则全局；比例只控制卡片框，内容恒 object-contain（蓝图 §13 铁律）
  const effectiveAspect = slot.aspectRatio ?? globalAspect;
  // 'custom' 时用全局自定义宽高（单卡只覆盖档位，不单独设宽高）；缺失/非法由 aspectCss 回落 16:9
  const boxAspect = aspectCss(effectiveAspect, globalCustomRatio);

  /** 网页页面缩放比（0.33~1）：iframe 虚拟视口放大倍数的倒数；100% → 1（原始行为） */
  const htmlScaleRatio = Math.min(Math.max(htmlScale, 1), 100) / 100;

  const isBundle = isHtml && slot.bundle === true;
  const htmlSrc = htmlFile
    ? isBundle
      ? `/api/bundles/${encodeURIComponent(htmlFile.filename)}/index.html`
      : `/api/files/${encodeURIComponent(htmlFile.filename)}`
    : undefined;
  const src = video
    ? `/api/files/${encodeURIComponent(video.filename)}`
    : isBundle
      ? htmlSrc
      : htmlFile
        ? `/api/files/${encodeURIComponent(htmlFile.filename)}`
        : imageFile
          ? `/api/files/${encodeURIComponent(imageFile.filename)}`
          : undefined;
  const displayName = video?.originalName ?? htmlFile?.originalName ?? imageFile?.originalName ?? '';
  const displaySize = video?.size ?? htmlFile?.size ?? imageFile?.size ?? 0;

  // 文件选择框按当前卡片状态收窄类型：空位全类型都收，已放置按类型收
  const accept = isHtml
    ? '.html,.htm,text/html,.zip,application/zip'
    : isImage
      ? 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml,image/bmp,image/avif'
      : video
        ? 'video/mp4,video/*'
        : 'video/mp4,video/*,.html,.htm,.zip,image/png,image/jpeg,image/gif,image/webp,image/svg+xml';

  return (
    <article
      id={`slot-card-${index}`}
      className={cn(
        'group relative flex h-full w-full flex-col overflow-hidden rounded-2xl border bg-card shadow-lg shadow-black/10 transition-all duration-200',
        dragOver
          ? 'scale-[1.015] border-primary/80 bg-primary/5 ring-2 ring-primary/40'
          : 'border-border hover:border-muted-foreground/40',
        highlighted && 'border-primary/60 ring-2 ring-primary/70',
        isDragging && 'scale-[1.02] border-primary/70 shadow-2xl shadow-primary/25 ring-2 ring-primary/50',
      )}
    >
      {/* 位置角标：兼作拖拽排序手柄（有 dragHandle 时可抓取，蓝图 §14）。
          showIndex=false 时仅视觉隐藏（opacity-0）：拖拽/键盘能力保留，界面与截图更干净 */}
      <span
        {...(dragHandle ?? {})}
        aria-hidden={dragHandle ? undefined : true}
        title={dragHandle ? '拖动调整顺序' : undefined}
        className={cn(
          'absolute left-2.5 top-2.5 z-20 rounded-md border border-white/10 bg-black/60 px-1.5 py-0.5 text-[11px] font-semibold text-zinc-300 backdrop-blur-sm',
          dragHandle &&
            'cursor-grab touch-none select-none hover:border-primary/60 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 active:cursor-grabbing',
          !showIndex && 'opacity-0',
        )}
      >
        {index + 1}
      </span>

      {/* 内容区域：比例只控制卡片框（行内 aspect-ratio），视频 object-contain 不裁切；HTML 为沙箱 iframe */}
      <div
        style={{ aspectRatio: boxAspect }}
        className="relative w-full overflow-hidden bg-black"
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false);
        }}
        onDrop={handleDrop}
      >
        {/* overlay 标题（titlePosition='overlay'，与下方标题排他）：内容顶部渐变底条，
            容器 pointer-events-none 不挡视频/iframe 交互，仅文字/编辑框可点；
            z-[15]：低于位置角标/拖拽护盾(z-20)与上传遮罩(z-30)，高于内容与错误遮罩(z-10)；
            左对齐时 pl-11 避开左上角位置角标（拖拽手柄），中/右对齐不受影响；
            overlay 模式下 HTML/图片类型徽标隐藏（顶部空间让给标题，信息行仍有完整信息） */}
        {overlayMode && (video || htmlFile || imageFile) && (
          <div
            className={cn(
              'pointer-events-none absolute inset-x-0 top-0 z-[15] flex items-start bg-gradient-to-b from-black/70 via-black/35 to-transparent pb-2 pt-1',
              titleAlign === 'left'
                ? showIndex
                  ? 'justify-start pl-11 pr-3'
                  : 'justify-start pl-3 pr-3' // 编号隐藏后不再需要避让角标
                : titleAlign === 'right'
                  ? 'justify-end pl-3 pr-3'
                  : 'justify-center px-3',
            )}
          >
            {overlayEditing ? (
              <textarea
                ref={textareaRef}
                rows={1}
                value={title}
                maxLength={100}
                autoFocus
                onChange={(e) => onTitleChange(index, e.target.value)}
                onBlur={() => setOverlayEditing(false)}
                onInput={(e) => {
                  const ta = e.currentTarget;
                  ta.style.height = 'auto';
                  ta.style.height = `${ta.scrollHeight}px`;
                }}
                placeholder="点击输入标题…"
                aria-label={`位置 ${index + 1} 的标题（叠加显示编辑）`}
                style={{
                  textAlign: titleAlign,
                  fontSize: `${titleFontSize}px`,
                  fontWeight: titleFontWeight,
                  color: titleColor !== TITLE_COLOR_DEFAULT ? titleColor : '#ffffff',
                  textShadow: '0 1px 4px rgba(0,0,0,0.7)',
                }}
                className="pointer-events-auto no-scrollbar min-w-0 flex-1 resize-none overflow-hidden rounded-md border border-dashed border-white/40 bg-black/30 px-1.5 py-0.5 leading-snug text-white placeholder:text-white/50 focus:outline-none"
              />
            ) : (
              <button
                type="button"
                onClick={() => setOverlayEditing(true)}
                title="点击编辑标题"
                aria-label={`位置 ${index + 1} 的叠加标题，点击编辑`}
                style={{
                  fontSize: `${titleFontSize}px`,
                  fontWeight: titleFontWeight,
                  color: titleColor !== TITLE_COLOR_DEFAULT ? titleColor : '#ffffff',
                  textShadow: '0 1px 4px rgba(0,0,0,0.7)',
                }}
                className={cn(
                  'pointer-events-auto min-w-0 max-w-full rounded-md px-1 py-0.5 text-left leading-snug line-clamp-2 whitespace-pre-wrap transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60',
                  !title && 'opacity-60',
                )}
              >
                {title || '点击设置标题'}
              </button>
            )}
          </div>
        )}
        {video ? (
          <>
            {/* 模糊背景填充（Step C，letterboxFill='blur' 时）：同源视频镜像副本，
                object-cover 放大铺满 + 模糊，播放态由主视频事件驱动同步；
                静音常开、无控件、pointer-events-none，纯装饰层 */}
            {letterboxFill === 'blur' && (
              <video
                ref={bgVideoRef}
                src={src}
                aria-hidden
                tabIndex={-1}
                muted
                loop
                playsInline
                preload="auto"
                className="pointer-events-none absolute inset-0 z-0 h-full w-full scale-125 object-cover blur-2xl"
              />
            )}
            <video
              ref={(el) => {
                localVideoRef.current = el;
                setVideoRef(index, el);
              }}
              src={src}
              controls
              playsInline
              preload="auto"
              loop={loop}
              muted={muted}
              onError={() => setVideoError(true)}
              onPlay={syncBgFromMain}
              onPause={syncBgFromMain}
              onSeeked={syncBgFromMain}
              onRateChange={syncBgFromMain}
              onLoadedMetadata={syncBgFromMain}
              className={cn(
                'relative z-10 h-full w-full',
                // cover = 铺满裁切（用户可选，无黑边）；base/blur 维持 contain 不裁切（蓝图 §13 原行为）
                letterboxFill === 'cover' ? 'object-cover' : 'object-contain',
              )}
              aria-label={`位置 ${index + 1} 的视频：${title || video.originalName}`}
            />
            {videoError && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-1.5 bg-black/85 px-4 text-center">
                <p className="text-sm font-medium text-destructive">视频加载失败</p>
                <p className="text-[11px] leading-relaxed text-zinc-400">
                  文件可能已损坏或格式不受支持，可尝试替换或移除
                </p>
              </div>
            )}
          </>
        ) : htmlFile ? (
          <>
            {/* 沙箱渲染：仅 allow-scripts，绝不给 allow-same-origin（BLUEPRINT §11.3）；
                服务端对该 URL 还强制 CSP sandbox + nosniff + no-store 双保险。
                页面缩放（htmlScale）：iframe 以放大 1/scale 的虚拟视口渲染页面，
                再 transform scale 等比缩回卡片框 —— 页面内容整体缩小后完整可见，
                解决固定宽高的桌面页在小卡片内被裁切/滚动的问题；
                scale=1（默认）时 width/height 100% 与引入前行为完全一致。 */}
            <iframe
              key={iframeNonce}
              src={src}
              sandbox="allow-scripts"
              referrerPolicy="no-referrer"
              title={title || htmlFile.originalName}
              onLoad={() => setHtmlStatus('ready')}
              onError={() => setHtmlStatus('error')}
              className="absolute inset-0 border-0 bg-white"
              style={{
                width: `${100 / htmlScaleRatio}%`,
                height: `${100 / htmlScaleRatio}%`,
                transform: `scale(${htmlScaleRatio})`,
                transformOrigin: 'top left',
              }}
            />
            {htmlStatus === 'loading' && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-card">
                <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden />
                <p className="text-xs text-muted-foreground">页面加载中…</p>
              </div>
            )}
            {htmlStatus === 'error' && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-1.5 bg-card px-4 text-center">
                <p className="text-sm font-medium text-destructive">页面加载失败</p>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  文件可能缺失或内容无法渲染
                </p>
                <button
                  type="button"
                  onClick={retryHtml}
                  className="mt-1 inline-flex h-8 items-center rounded-lg border border-border bg-muted/60 px-3 text-xs font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                >
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                  重试
                </button>
              </div>
            )}
            {/* 拖拽护盾：iframe 会吞掉拖拽事件，页面级拖入时在其上方铺一层可落放遮罩，
                保证「拖文件到 HTML 卡片」与视频卡片体验一致 */}
            {dragActive && (
              <div
                className="absolute inset-0 z-20 flex items-center justify-center border-2 border-dashed border-primary/70 bg-primary/10"
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
              >
                <p className="rounded-full bg-background/90 px-3 py-1 text-xs font-medium text-primary shadow">
                  松开鼠标添加内容（不会覆盖本卡片）
                </p>
              </div>
            )}
          </>
        ) : imageFile ? (
          <>
            {/* 模糊背景填充（Step C）：同图放大铺满 + 模糊，静态零成本 */}
            {letterboxFill === 'blur' && (
              <img
                src={src}
                alt=""
                aria-hidden
                className="pointer-events-none absolute inset-0 z-0 h-full w-full scale-125 object-cover blur-2xl"
              />
            )}
            {/* 图片渲染：base/blur 维持 contain 不裁切（蓝图 §13 铁律），cover 时铺满裁切；
                以 <img> 渲染 SVG，脚本天然不执行，服务端另有 CSP sandbox 兜底 */}
            <img
              src={src}
              alt={`位置 ${index + 1} 的图片：${title || imageFile.originalName}`}
              loading="lazy"
              onError={() => setImageError(true)}
              className={cn(
                'relative z-10 h-full w-full',
                letterboxFill === 'cover' ? 'object-cover' : 'object-contain',
              )}
            />
            {imageError && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-1.5 bg-black/85 px-4 text-center">
                <p className="text-sm font-medium text-destructive">图片加载失败</p>
                <p className="text-[11px] leading-relaxed text-zinc-400">
                  文件可能已损坏或格式不受支持，可尝试替换或移除
                </p>
              </div>
            )}
          </>
        ) : (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex h-full w-full cursor-pointer flex-col items-center justify-center gap-2 px-3 text-muted-foreground/70 transition-colors hover:bg-accent hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-not-allowed"
            aria-label={`位置 ${index + 1}：暂无内容，点击上传`}
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-full border border-dashed border-muted-foreground/40">
              <UploadCloud className="h-5 w-5" aria-hidden />
            </span>
            <span className="text-sm font-medium">暂无内容</span>
            <span className="text-[11px] text-muted-foreground/60">点击选择或拖入视频 / 图片 / HTML 文件</span>
          </button>
        )}

        {/* HTML / 图片类型角标（内容区左上，位置角标右侧；编号隐藏时直接落在左上角） */}
        {isHtml && !overlayMode && (
          <span className={cn(
            'absolute left-2.5 top-2.5 z-10 flex items-center gap-1 rounded-md border border-white/10 bg-black/60 px-1.5 py-0.5 text-[11px] font-semibold text-zinc-300 backdrop-blur-sm',
            showIndex && 'ml-9',
          )}>
            <Code2 className="h-3 w-3" aria-hidden />
            {isBundle ? 'HTML 包' : 'HTML'}
          </span>
        )}
        {isImage && !overlayMode && (
          <span className={cn(
            'absolute left-2.5 top-2.5 z-10 flex items-center gap-1 rounded-md border border-white/10 bg-black/60 px-1.5 py-0.5 text-[11px] font-semibold text-zinc-300 backdrop-blur-sm',
            showIndex && 'ml-9',
          )}>
            <ImageIcon className="h-3 w-3" aria-hidden />
            图片
          </span>
        )}

        {/* 上传中遮罩 */}
        {uploading && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-2.5 bg-black/70 backdrop-blur-sm">
            <Loader2 className="h-7 w-7 animate-spin text-primary" aria-hidden />
            <p className="text-xs text-zinc-100">正在上传…</p>
          </div>
        )}
      </div>

      {/* 标题 / 属性信息区（两者可独立显隐；标题仅在 below 模式下在此渲染，overlay 模式排他显示在内容顶部） */}
      {(belowMode || showInfo) && (
      <div className="flex flex-1 flex-col gap-1.5 p-2.5 sm:p-3">
        {belowMode && (
        <textarea
          ref={textareaRef}
          rows={1}
          value={title}
          maxLength={100}
          onChange={(e) => onTitleChange(index, e.target.value)}
          onFocus={() => recalcHeight(true)}
          onBlur={() => recalcHeight(false)}
          placeholder="给内容起个标题，或写点介绍…"
          aria-label={`位置 ${index + 1} 的标题与介绍`}
          style={{
            textAlign: titleAlign,
            fontSize: `${titleFontSize}px`,
            fontWeight: titleFontWeight,
            ...(titleColorCss ? { color: titleColorCss } : {}),
          }}
          className="no-scrollbar w-full resize-none overflow-hidden rounded-lg border border-transparent bg-muted/40 px-2.5 py-1.5 leading-snug text-foreground placeholder:text-muted-foreground/50 transition-colors focus:border-ring focus:bg-muted/60 focus:outline-none"
        />
        )}
        {showInfo && (video || htmlFile || imageFile) && (
          <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
            {/* 状态点：HTML 显示加载状态（绿=就绪 / 琥珀=加载中 / 红=失败）；视频与图片默认就绪 */}
            <span className="flex min-w-0 items-center gap-1.5">
              {isHtml && (
                <span
                  role="status"
                  aria-label={
                    htmlStatus === 'ready' ? '页面就绪' : htmlStatus === 'loading' ? '页面加载中' : '页面加载失败'
                  }
                  className={cn(
                    'h-1.5 w-1.5 shrink-0 rounded-full',
                    htmlStatus === 'ready' && 'bg-emerald-500',
                    htmlStatus === 'loading' && 'animate-pulse bg-amber-500',
                    htmlStatus === 'error' && 'bg-destructive',
                  )}
                />
              )}
              <span className="min-w-0 truncate" title={displayName}>
                {displayName} · {formatBytes(displaySize)}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-0.5">
              {/* 单卡比例覆盖（蓝图 §13）：跟随全局或指定框型；null = 恢复跟随 */}
              {onAspectOverride && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      title="本卡比例（覆盖全局）"
                      aria-label={`位置 ${index + 1} 的比例：${slot.aspectRatio ? aspectLabel(slot.aspectRatio) : '跟随全局'}`}
                      className={cn(
                        'rounded-md px-1.5 py-1 text-[11px] font-semibold tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
                        slot.aspectRatio
                          ? 'text-primary hover:bg-primary/10'
                          : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                      )}
                    >
                      {slot.aspectRatio ? aspectLabel(slot.aspectRatio) : '跟随'}
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-[8.5rem] border-border bg-card">
                    {([null, '16:9', '9:16', '1:1', 'original', 'custom'] as const).map((a) => (
                      <DropdownMenuItem
                        key={a ?? 'follow'}
                        onClick={() => onAspectOverride(index, a)}
                        className={cn(
                          'text-[13px]',
                          (slot.aspectRatio ?? null) === a && 'font-semibold text-primary',
                        )}
                      >
                        {a === null ? '跟随全局' : aspectLabel(a)}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                title={isHtml ? '替换 HTML 页面' : isImage ? '替换图片' : '替换视频'}
                aria-label={`替换位置 ${index + 1} 的内容`}
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:opacity-40"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => onClear(index)}
                disabled={uploading}
                title={isHtml ? '移除 HTML 页面' : isImage ? '移除图片' : '移除视频'}
                aria-label={`移除位置 ${index + 1} 的内容`}
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/50 disabled:opacity-40"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </button>
            </span>
          </div>
        )}
      </div>
      )}

      {/* 隐藏的文件选择框（按当前卡片状态收窄类型） */}
      <input
        ref={fileInputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFiles([file], index);
          e.target.value = '';
        }}
      />
    </article>
  );
}
