'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Code2, Loader2, RefreshCw, Trash2, UploadCloud } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AspectRatio, Slot, aspectCss, aspectLabel, formatBytes } from '@/lib/types';
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
  /** 全局标题显隐：false 时隐藏标题与信息行，纯内容观看（蓝图 §13） */
  showTitles?: boolean;
  /** 单卡比例覆盖变更（null = 恢复跟随全局）；未传则不显示覆盖控件 */
  onAspectOverride?: (index: number, ar: AspectRatio | null) => void;
  /** 页面级拖拽导入进行中（用于在 iframe 上方临时铺一层可落放的护盾） */
  dragActive?: boolean;
  /** 拖拽排序手柄属性（dnd-kit attributes+listeners 合并后传入；
   * 不传 = 不参与排序（空位卡片），角标保持纯展示） */
  dragHandle?: React.HTMLAttributes<HTMLSpanElement> | null;
  /** 本卡片正在被拖拽（蓝图 §14：scale 1.02 + 阴影） */
  isDragging?: boolean;
  /** 处理文件（可多个）：第一个放入本位置，其余按顺序分配到其它位置 */
  onFiles: (files: File[], primarySlot: number) => void;
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
  showTitles = true,
  onAspectOverride,
  onFiles,
  onTitleChange,
  onClear,
  setVideoRef,
}: VideoCardProps) {
  const { index, title, video } = slot;
  const isHtml = slot.kind === 'html' && !!slot.html;
  const htmlFile = slot.html ?? null;
  const [dragOver, setDragOver] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const [prevFilename, setPrevFilename] = useState(video?.filename);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

  /* ---------- 视频错误状态：切换视频时重置 ---------- */
  if (prevFilename !== video?.filename) {
    setPrevFilename(video?.filename);
    setVideoError(false);
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
  }, [title, recalcHeight]);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) onFiles(files, index);
  };

  // 生效比例：单卡覆盖优先，否则全局；比例只控制卡片框，内容恒 object-contain（蓝图 §13 铁律）
  const effectiveAspect = slot.aspectRatio ?? globalAspect;

  const src = video
    ? `/api/files/${encodeURIComponent(video.filename)}`
    : htmlFile
      ? `/api/files/${encodeURIComponent(htmlFile.filename)}`
      : undefined;
  const displayName = video?.originalName ?? htmlFile?.originalName ?? '';
  const displaySize = video?.size ?? htmlFile?.size ?? 0;

  // 文件选择框按当前卡片状态收窄类型：空位两者都收，已放置按类型收
  const accept = isHtml
    ? '.html,.htm,text/html'
    : video
      ? 'video/mp4,video/*'
      : 'video/mp4,video/*,.html,.htm';

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
      {/* 位置角标：兼作拖拽排序手柄（有 dragHandle 时可抓取，蓝图 §14） */}
      <span
        {...(dragHandle ?? {})}
        aria-hidden={dragHandle ? undefined : true}
        title={dragHandle ? '拖动调整顺序' : undefined}
        className={cn(
          'absolute left-2.5 top-2.5 z-20 rounded-md border border-white/10 bg-black/60 px-1.5 py-0.5 text-[11px] font-semibold text-zinc-300 backdrop-blur-sm',
          dragHandle &&
            'cursor-grab touch-none select-none hover:border-primary/60 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 active:cursor-grabbing',
        )}
      >
        {index + 1}
      </span>

      {/* 内容区域：比例只控制卡片框（行内 aspect-ratio），视频 object-contain 不裁切；HTML 为沙箱 iframe */}
      <div
        style={{ aspectRatio: aspectCss(effectiveAspect) }}
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
        {video ? (
          <>
            <video
              ref={(el) => setVideoRef(index, el)}
              src={src}
              controls
              playsInline
              preload="auto"
              loop={loop}
              muted={muted}
              onError={() => setVideoError(true)}
              className="h-full w-full object-contain"
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
                服务端对该 URL 还强制 CSP sandbox + nosniff + no-store 双保险 */}
            <iframe
              key={iframeNonce}
              src={src}
              sandbox="allow-scripts"
              referrerPolicy="no-referrer"
              title={title || htmlFile.originalName}
              onLoad={() => setHtmlStatus('ready')}
              onError={() => setHtmlStatus('error')}
              className="h-full w-full border-0 bg-white"
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
                  松开鼠标导入到此位置
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
            <span className="text-[11px] text-muted-foreground/60">点击选择或拖入视频 / HTML 文件</span>
          </button>
        )}

        {/* HTML 类型角标（内容区左上，位置角标右侧） */}
        {isHtml && (
          <span className="absolute left-2.5 top-2.5 z-10 ml-9 flex items-center gap-1 rounded-md border border-white/10 bg-black/60 px-1.5 py-0.5 text-[11px] font-semibold text-zinc-300 backdrop-blur-sm">
            <Code2 className="h-3 w-3" aria-hidden />
            HTML
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

      {/* 标题 / 介绍输入区（showTitles=false 时整体隐藏，纯内容观看/录屏） */}
      {showTitles && (
      <div className="flex flex-1 flex-col gap-1.5 p-2.5 sm:p-3">
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
          className="no-scrollbar w-full resize-none overflow-hidden rounded-lg border border-transparent bg-muted/40 px-2.5 py-1.5 text-[13px] leading-snug text-foreground placeholder:text-muted-foreground/50 transition-colors focus:border-ring focus:bg-muted/60 focus:outline-none"
        />
        {(video || htmlFile) && (
          <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
            {/* 状态点：HTML 显示加载状态（绿=就绪 / 琥珀=加载中 / 红=失败）；视频默认就绪 */}
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
                    {([null, '16:9', '9:16', '1:1', 'original'] as const).map((a) => (
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
                title={isHtml ? '替换 HTML 页面' : '替换视频'}
                aria-label={`替换位置 ${index + 1} 的内容`}
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:opacity-40"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => onClear(index)}
                disabled={uploading}
                title={isHtml ? '移除 HTML 页面' : '移除视频'}
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
