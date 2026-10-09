'use client';

/**
 * 顶栏「布局」弹层（从 top-bar.tsx 拆出，纯展示 + 回调）：
 * 内容位数量 / 排列矩阵（自动 + 手动）/ 内容比例（含自定义宽高输入）/
 * 自动适配视口 / 整墙大小 / 页面缩放（仅 HTML 卡片）。
 * 数量与矩阵走清单接口（onCountSelect/onLayoutSelect/onAutoSelect），
 * 比例与缩放走 settings 接口（updateSettings）。
 */
import { LayoutGrid, Wand2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  AspectRatio,
  Layout,
  SLOT_MAX,
  SCALE_STEPS,
  ManifestSettings,
  aspectLabel,
  layoutOptionsFor,
} from '@/lib/types';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { ctlBtn, MatrixOption } from './shared';
import { WallSettings } from './use-wall-settings';

export function LayoutPopover(props: {
  busy: boolean;
  count: number;
  layout: Layout;
  layoutMode: 'auto' | 'manual';
  onCountSelect: (n: number) => void;
  onLayoutSelect: (l: Layout) => void;
  onAutoSelect: () => void;
  s: WallSettings;
  updateSettings: (partial: Partial<ManifestSettings>) => Promise<void>;
  ratioDraft: { w: string; h: string };
  onRatioDraftChange: (draft: { w: string; h: string }) => void;
  onApplyCustomRatio: () => void;
}) {
  const {
    busy, count, layout, layoutMode,
    onCountSelect, onLayoutSelect, onAutoSelect,
    s, updateSettings, ratioDraft, onRatioDraftChange, onApplyCustomRatio,
  } = props;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={busy}
          className={cn(ctlBtn, 'border-border bg-card text-foreground/90 hover:bg-accent hover:text-accent-foreground')}
          title="设置内容位数量与排列矩阵"
          aria-label="设置内容位数量与排列矩阵"
        >
          <LayoutGrid className="h-4 w-4" aria-hidden />
          <span className="hidden sm:inline">布局</span>
          <span className="inline-block min-w-[4ch] text-center text-[11px] font-semibold tabular-nums text-primary">
            {layoutMode === 'auto' ? '自动' : `${layout.rows}×${layout.cols}`}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="max-h-[calc(100vh-6rem)] w-80 overflow-y-auto border-border bg-card p-4 text-card-foreground"
      >
        <p className="text-xs font-semibold tracking-wide text-muted-foreground">内容位数量</p>
        <div className="mt-2 grid grid-cols-6 gap-1.5">
          {Array.from({ length: SLOT_MAX }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => onCountSelect(n)}
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
        {/* 自动排列：矩阵随数量自动计算（默认），任何手动选择都会覆盖并记住 */}
        <button
          type="button"
          onClick={onAutoSelect}
          disabled={busy}
          aria-pressed={layoutMode === 'auto'}
          className={cn(
            'mt-2 flex h-9 w-full items-center gap-2 rounded-lg border px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-not-allowed disabled:opacity-50',
            layoutMode === 'auto'
              ? 'border-primary bg-primary/15 text-primary'
              : 'border-border bg-muted/40 text-foreground/80 hover:border-muted-foreground/40 hover:bg-accent',
          )}
        >
          <Wand2 className="h-3.5 w-3.5" aria-hidden />
          自动排列
          {layoutMode === 'auto' && (
            <span className="rounded border border-primary/40 bg-primary/10 px-1 py-px tabular-nums text-primary">
              {layout.rows}×{layout.cols}
            </span>
          )}
          <span className="ml-auto text-[10px] font-normal text-muted-foreground">随数量自动计算</span>
        </button>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {layoutOptionsFor(count).map((l) => (
            <MatrixOption
              key={`${l.rows}x${l.cols}`}
              layout={l}
              count={count}
              active={layoutMode === 'manual' && l.rows === layout.rows && l.cols === layout.cols}
              onSelect={() => onLayoutSelect(l)}
            />
          ))}
        </div>
        <p className="mt-2.5 text-[11px] leading-relaxed text-muted-foreground/70">
          {layoutMode === 'manual' && layout.rows * layout.cols > count
            ? '标注「补」的矩阵无法整除，会在末尾留出空格子。'
            : '选择具体行列后即固定为手动模式，可随时切回自动。'}
        </p>

        <p className="mt-4 text-xs font-semibold tracking-wide text-muted-foreground">
          内容比例
          <span className="ml-1 font-normal text-muted-foreground/70">（卡片框，内容不裁切）</span>
        </p>
        <div className="mt-2 grid grid-cols-4 gap-1.5">
          {(['original', '16:9', '9:16', '1:1'] as AspectRatio[]).map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => void updateSettings({ aspectRatio: a })}
              aria-pressed={s.aspect === a}
              className={cn(
                'h-8 rounded-md border text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
                s.aspect === a
                  ? 'border-primary bg-primary/20 text-primary'
                  : 'border-border bg-muted/60 text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground',
              )}
            >
              {aspectLabel(a)}
            </button>
          ))}
        </div>
        {/* 自定义比例（蓝图 §13）：宽高比直接写进卡片容器的 aspect-ratio */}
        <div className="mt-2 flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => void updateSettings({ aspectRatio: 'custom' })}
            aria-pressed={s.aspect === 'custom'}
            className={cn(
              'h-8 shrink-0 rounded-md border px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
              s.aspect === 'custom'
                ? 'border-primary bg-primary/20 text-primary'
                : 'border-border bg-muted/60 text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground',
            )}
          >
            自定义
          </button>
          <Input
            value={ratioDraft.w}
            onChange={(e) => onRatioDraftChange({ ...ratioDraft, w: e.target.value })}
            onBlur={onApplyCustomRatio}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onApplyCustomRatio();
              }
            }}
            inputMode="numeric"
            aria-label="自定义比例宽"
            className="h-8 w-full min-w-0 text-center text-xs tabular-nums"
          />
          <span className="shrink-0 text-xs text-muted-foreground">:</span>
          <Input
            value={ratioDraft.h}
            onChange={(e) => onRatioDraftChange({ ...ratioDraft, h: e.target.value })}
            onBlur={onApplyCustomRatio}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onApplyCustomRatio();
              }
            }}
            inputMode="numeric"
            aria-label="自定义比例高"
            className="h-8 w-full min-w-0 text-center text-xs tabular-nums"
          />
        </div>
        <p className="mt-2.5 text-[11px] leading-relaxed text-muted-foreground/70">
          「原始」为 16:9 容器等比容纳；竖版内容选 9:16 可减少留白，单卡可在信息行单独覆盖。
          自定义比例填宽 : 高（如 21 : 9），失焦或回车即保存。
        </p>

        {/* 自动适配视口（全局同步） */}
        <p className="mt-4 text-xs font-semibold tracking-wide text-muted-foreground">
          自动适配视口
          <span className="ml-1 font-normal text-muted-foreground/70">（超出即缩，整墙同屏）</span>
        </p>
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          {([true, false] as const).map((v) => (
            <button
              key={String(v)}
              type="button"
              onClick={() => void updateSettings({ autoFit: v })}
              aria-pressed={s.autoFit === v}
              className={cn(
                'h-8 rounded-md border text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
                s.autoFit === v
                  ? 'border-primary bg-primary/20 text-primary'
                  : 'border-border bg-muted/60 text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground',
              )}
            >
              {v ? '开启' : '关闭'}
            </button>
          ))}
        </div>
        <p className="mt-2.5 text-[11px] leading-relaxed text-muted-foreground/70">
          {s.autoFit
            ? '整墙高度超出浏览器视口时自动等比缩小到恰好同屏（两视频纵向布局也能一屏截全）；专注模式始终自动适配并居中显示。'
            : '已关闭：按下方「整体大小」手动档位缩放整墙。专注模式下仍会自动适配。'}
        </p>

        {/* 整体大小 */}
        <p className={cn('mt-4 text-xs font-semibold tracking-wide text-muted-foreground', s.autoFit && 'opacity-50')}>
          整体大小
          <span className="ml-1 font-normal text-muted-foreground/70">
            （{s.autoFit ? '自动适配已接管' : '缩放整墙，同屏可见'}）
          </span>
        </p>
        <div className="mt-2 grid grid-cols-5 gap-1.5">
          {SCALE_STEPS.map((st) => (
            <button
              key={st}
              type="button"
              disabled={s.autoFit}
              onClick={() => void updateSettings({ wallScale: st })}
              aria-pressed={s.wallScale === st}
              className={cn(
                'h-8 rounded-md border text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-not-allowed disabled:opacity-40',
                s.wallScale === st
                  ? 'border-primary bg-primary/20 text-primary'
                  : 'border-border bg-muted/60 text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground',
              )}
            >
              {st}%
            </button>
          ))}
        </div>
        <p className="mt-2.5 text-[11px] leading-relaxed text-muted-foreground/70">
          {s.autoFit
            ? '自动适配开启中：整墙超出视口时自动等比缩小；关闭后可手动选择档位。'
            : s.wallScale === 100
              ? '100% 为原始大小；纵向多行布局截图时可选 50% / 33% 缩小整墙。'
              : `当前整墙缩放至 ${s.wallScale}%，格子随宽度等比缩小，纵向布局也能一屏截全。`}
        </p>

        {/* 页面缩放（仅 HTML 卡片生效） */}
        <p className="mt-4 text-xs font-semibold tracking-wide text-muted-foreground">
          页面缩放
          <span className="ml-1 font-normal text-muted-foreground/70">（仅网页卡片生效）</span>
        </p>
        <div className="mt-2 grid grid-cols-5 gap-1.5">
          {SCALE_STEPS.map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => void updateSettings({ htmlScale: st })}
              aria-pressed={s.htmlScale === st}
              className={cn(
                'h-8 rounded-md border text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
                s.htmlScale === st
                  ? 'border-primary bg-primary/20 text-primary'
                  : 'border-border bg-muted/60 text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground',
              )}
            >
              {st}%
            </button>
          ))}
        </div>
        <p className="mt-2.5 text-[11px] leading-relaxed text-muted-foreground/70">
          {s.htmlScale === 100
            ? '100% 为原始大小；网页内容被裁切时可选 75% / 50% 看到更完整的页面。'
            : `网页以 ${100 / (s.htmlScale / 100)}% 宽高的视口渲染后缩至 ${s.htmlScale}% 显示，内容更完整。`}
        </p>
      </PopoverContent>
    </Popover>
  );
}
