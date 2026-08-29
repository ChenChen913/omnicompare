'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, RefreshCw, Trash2, UploadCloud } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Slot, formatBytes } from '@/lib/types';

interface VideoCardProps {
  slot: Slot;
  uploading: boolean;
  loop: boolean;
  muted: boolean;
  /** 侧栏「当前窗格列表」点击定位时的高亮态 */
  highlighted?: boolean;
  /** 处理文件（可多个）：第一个放入本位置，其余按顺序分配到其它位置 */
  onFiles: (files: File[], primarySlot: number) => void;
  onTitleChange: (slotIndex: number, title: string) => void;
  onClear: (slotIndex: number) => void;
  setVideoRef: (index: number, el: HTMLVideoElement | null) => void;
}

export function VideoCard({
  slot,
  uploading,
  loop,
  muted,
  highlighted,
  onFiles,
  onTitleChange,
  onClear,
  setVideoRef,
}: VideoCardProps) {
  const { index, title, video } = slot;
  const [dragOver, setDragOver] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const [prevFilename, setPrevFilename] = useState(video?.filename);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 切换视频时在渲染期重置错误状态（React 推荐模式，避免额外 effect）
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

  const src = video ? `/api/files/${encodeURIComponent(video.filename)}` : undefined;

  return (
    <article
      id={`slot-card-${index}`}
      className={cn(
        'group relative flex flex-col overflow-hidden rounded-2xl border bg-card shadow-lg shadow-black/10 transition-all duration-200',
        dragOver
          ? 'scale-[1.015] border-primary/80 bg-primary/5 ring-2 ring-primary/40'
          : 'border-border hover:border-muted-foreground/40',
        highlighted && 'border-primary/60 ring-2 ring-primary/70',
      )}
    >
      {/* 位置角标 */}
      <span
        aria-hidden
        className="absolute left-2.5 top-2.5 z-20 rounded-md border border-white/10 bg-black/60 px-1.5 py-0.5 text-[11px] font-semibold text-zinc-300 backdrop-blur-sm"
      >
        {index + 1}
      </span>

      {/* 视频区域：固定宽高比，object-contain 保证不裁切原始画面 */}
      <div
        className="relative aspect-video w-full overflow-hidden bg-black"
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
        ) : (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex h-full w-full cursor-pointer flex-col items-center justify-center gap-2 px-3 text-muted-foreground/70 transition-colors hover:bg-accent hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-not-allowed"
            aria-label={`位置 ${index + 1}：暂无视频，点击上传`}
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-full border border-dashed border-muted-foreground/40">
              <UploadCloud className="h-5 w-5" aria-hidden />
            </span>
            <span className="text-sm font-medium">暂无视频</span>
            <span className="text-[11px] text-muted-foreground/60">点击选择或拖拽视频到此处</span>
          </button>
        )}

        {/* 上传中遮罩 */}
        {uploading && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-2.5 bg-black/70 backdrop-blur-sm">
            <Loader2 className="h-7 w-7 animate-spin text-primary" aria-hidden />
            <p className="text-xs text-zinc-100">正在上传…</p>
          </div>
        )}
      </div>

      {/* 标题 / 介绍输入区 */}
      <div className="flex flex-1 flex-col gap-1.5 p-2.5 sm:p-3">
        <textarea
          ref={textareaRef}
          rows={1}
          value={title}
          maxLength={100}
          onChange={(e) => onTitleChange(index, e.target.value)}
          onFocus={() => recalcHeight(true)}
          onBlur={() => recalcHeight(false)}
          placeholder="给视频起个标题，或写点介绍…"
          aria-label={`位置 ${index + 1} 的标题与介绍`}
          className="no-scrollbar w-full resize-none overflow-hidden rounded-lg border border-transparent bg-muted/40 px-2.5 py-1.5 text-[13px] leading-snug text-foreground placeholder:text-muted-foreground/50 transition-colors focus:border-ring focus:bg-muted/60 focus:outline-none"
        />
        {video && (
          <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span className="min-w-0 truncate" title={video.originalName}>
              {video.originalName} · {formatBytes(video.size)}
            </span>
            <span className="flex shrink-0 items-center gap-0.5">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                title="替换视频"
                aria-label={`替换位置 ${index + 1} 的视频`}
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:opacity-40"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => onClear(index)}
                disabled={uploading}
                title="移除视频"
                aria-label={`移除位置 ${index + 1} 的视频`}
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/50 disabled:opacity-40"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </button>
            </span>
          </div>
        )}
      </div>

      {/* 隐藏的文件选择框 */}
      <input
        ref={fileInputRef}
        type="file"
        accept="video/mp4,video/*"
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
