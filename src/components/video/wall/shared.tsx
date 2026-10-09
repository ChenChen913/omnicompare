'use client';

/**
 * video-wall 家族共享的常量与无状态小组件。
 * 从 video-wall.tsx 中拆出（3665 行上帝组件瘦身的第一步），
 * 这里只放「与状态无关、被多处复用」的部分。
 */
import { Slot } from '@/lib/types';
import { VideoCard, VideoCardProps } from '../video-card';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '@/lib/utils';

/** 工作模式与侧栏开关（仅 UI 偏好，业务数据永远以服务端为准）；当前项目同此列 */
export const PREF_MODE = 'omnicompare:mode';
export const PREF_SIDEBAR = 'omnicompare:sidebar';
export const PREF_PROJECT = 'omnicompare:project';
export const PREF_VIEW = 'omnicompare:view';

/** 项目状态展示名与状态点配色（蓝图 §7：active/draft/archived） */
export const STATUS_META = {
  active: { label: '进行中', dot: 'bg-emerald-500' },
  draft: { label: '草稿', dot: 'bg-amber-500' },
  archived: { label: '已归档', dot: 'bg-muted-foreground/40' },
} as const;

export function defaultSlots(): Slot[] {
  return Array.from({ length: 6 }, (_, i) => ({ index: i, title: '', video: null }));
}

/** 拖拽排序的稳定 id：文件名全局唯一（uuid + 扩展名），与 React key 同源；空位不参与排序 */
export function sortableIdOf(slot: Slot): string {
  return slot.video?.filename ?? slot.html?.filename ?? slot.image?.filename ?? `empty-${slot.index}`;
}

/** 顶部控制按钮的基础样式 */
export const ctlBtn =
  'inline-flex h-10 items-center gap-1.5 rounded-lg border px-2.5 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-not-allowed disabled:opacity-50 sm:px-3';

/** 顶部按钮组之间的竖向分隔线：把「播放 / 管理与显示 / 模式」分成视觉上独立的组 */
export function Divider() {
  return <span aria-hidden className="mx-0.5 hidden h-6 w-px shrink-0 bg-border sm:block" />;
}

/** 矩阵选项：迷你预览图 + 行×列标签 */
export function MatrixOption({
  layout,
  count,
  active,
  onSelect,
}: {
  layout: { rows: number; cols: number };
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

/**
 * Sortable 包装层：为已放置内容卡片接入 dnd-kit 排序。
 * 外层 div 承担 transform 与 ref；卡片本身只在拖拽中抬升（蓝图 §14）。
 * React key 用稳定文件名：排序后 DOM 节点被移动而非复用重建，视频播放不中断。
 */
export function SortableCard({
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
