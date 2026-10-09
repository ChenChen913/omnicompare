'use client';

/**
 * 矩阵下方的提示词与署名区域（录屏入镜用）：文本点击即编辑、失焦自动保存，
 * 随项目存服务端；宽度由 useAutoFit 的 effect 同步为视频墙实际渲染宽度。
 * 从 video-wall.tsx 拆出。
 */
import { PenLine, MessageSquareQuote } from 'lucide-react';
import { cn } from '@/lib/utils';
import { BYLINE_MAX, PROMPT_MAX } from '@/lib/types';

export function PromptBar({
  mode,
  showPrompt,
  showByline,
  promptText,
  bylineText,
  onPromptChange,
  onBylineChange,
  onPromptBlur,
  onBylineBlur,
  barRef,
}: {
  mode: 'studio' | 'focus';
  showPrompt: boolean;
  showByline: boolean;
  promptText: string;
  bylineText: string;
  onPromptChange: (text: string) => void;
  onBylineChange: (text: string) => void;
  onPromptBlur: () => void;
  onBylineBlur: () => void;
  barRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div ref={barRef} className={cn('mx-auto shrink-0', mode === 'focus' ? 'mt-3' : 'mt-4')}>
      {showPrompt && (
        <div className="rounded-xl border border-border/70 bg-card/60 px-4 py-3">
          <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <MessageSquareQuote className="h-3 w-3" aria-hidden />
            提示词
          </p>
          <textarea
            value={promptText}
            onChange={(e) => onPromptChange(e.target.value)}
            onBlur={onPromptBlur}
            rows={2}
            maxLength={PROMPT_MAX}
            placeholder="粘贴本次对比使用的提示词（录屏时可一并入镜）…"
            aria-label="提示词"
            /* field-sizing-content：高度随内容自适应（Chrome/Edge 123+）；rows=2 为不支持浏览器的兜底，
               45vh 封顶防止超长提示词独占屏幕 */
            className="w-full resize-none field-sizing-content max-h-[45vh] overflow-y-auto bg-transparent text-[13px] leading-relaxed text-foreground/90 outline-none placeholder:text-muted-foreground/40"
          />
        </div>
      )}
      {showByline && (
        <div
          className={cn(
            'flex items-center gap-2 rounded-xl border border-border/70 bg-card/60 px-4 py-2',
            showPrompt && 'mt-2',
          )}
        >
          <PenLine className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
          <input
            value={bylineText}
            onChange={(e) => onBylineChange(e.target.value)}
            onBlur={onBylineBlur}
            maxLength={BYLINE_MAX}
            placeholder="署名：测评博主 @账号 #标签 …"
            aria-label="署名"
            className="w-full bg-transparent text-[12px] text-foreground/80 outline-none placeholder:text-muted-foreground/40"
          />
        </div>
      )}
    </div>
  );
}
