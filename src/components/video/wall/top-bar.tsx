'use client';

/**
 * 顶部控制栏：品牌行（品牌 / 项目切换 / 使用须知 / 主题）+ 功能行（播放 / 布局 /
 * 播放设置 / 标题 / 填充 / 上传 / 音乐 / 水印 / 录屏 / 清空 / 专注）。
 * 从 video-wall.tsx 拆出（纯展示 + 回调，状态全部由主组件持有）。
 *
 * 固定两行结构（震动根治）：无论项目内容是视频还是网页、播放/刷新按钮组如何显隐，
 * 顶栏恒为「品牌行 + 功能行」两行、高度不变，主体内容不再被顶栏行数变化推动上下跳动。
 * 专注模式整体隐藏顶栏（零干扰观看），退出入口固定在页面右下角圆形按钮。
 */
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDownToLine,
  Bold,
  BookOpen,
  ChevronDown,
  Clapperboard,
  Code2,
  Crop,
  Droplets,
  Expand,
  Film,
  FolderPlus,
  Gauge,
  Image as ImageIcon,
  LayoutGrid,
  Library,
  Minus,
  Moon,
  Music,
  Palette,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Stamp,
  Sun,
  Trash2,
  Type,
  UploadCloud,
  Video,
  Volume2,
  Wand2,
  Pause,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  AspectRatio,
  Layout,
  SLOT_MAX,
  LETTERBOX_FILLS,
  ManifestSettings,
  ProjectSummary,
  SCALE_STEPS,
  TITLE_ALIGNS,
  TITLE_COLOR_DEFAULT,
  TITLE_COLOR_PALETTE,
  TITLE_FONT_DEFAULT,
  TITLE_FONT_MAX,
  TITLE_FONT_MIN,
  TITLE_FONT_PRESETS,
  TITLE_POSITIONS,
  TITLE_WEIGHTS,
  WATERMARK_COLORS,
  WATERMARK_FONT_MAX,
  WATERMARK_FONT_MIN,
  WATERMARK_OPACITY_MAX,
  WATERMARK_OPACITY_MIN,
  WATERMARK_SPEEDS,
  aspectLabel,
  layoutOptionsFor,
} from '@/lib/types';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import { Input } from '@/components/ui/input';
import { ctlBtn, Divider, MatrixOption, STATUS_META } from './shared';
import { WallSettings } from './use-wall-settings';

export interface TopBarProps {
  headerRef: React.RefObject<HTMLElement | null>;
  mode: 'studio' | 'focus';
  view: 'workspace' | 'library';
  sidebarOpen: boolean;
  busy: boolean;
  filledCount: number;
  hasVideo: boolean;
  hasHtml: boolean;
  hasImage: boolean;
  /* 项目 */
  projectName: string;
  projects: ProjectSummary[];
  projectId: string;
  onSwitchProject: (id: string) => void;
  onNewProject: () => void;
  /* 主题 */
  themeMounted: boolean;
  resolvedTheme: string | undefined;
  onToggleTheme: () => void;
  onOpenNotes: () => void;
  /* 布局 */
  count: number;
  layout: Layout;
  layoutMode: 'auto' | 'manual';
  onCountSelect: (n: number) => void;
  onLayoutSelect: (l: Layout) => void;
  onAutoSelect: () => void;
  /* 设置（比例 / 缩放 / 标题 / 填充 / 水印 / 录屏） */
  settings: WallSettings;
  updateSettings: (partial: Partial<ManifestSettings>) => Promise<void>;
  patchLocal: (partial: Partial<WallSettings>) => void;
  ratioDraft: { w: string; h: string };
  onRatioDraftChange: (draft: { w: string; h: string }) => void;
  onApplyCustomRatio: () => void;
  /* 播放 */
  onPlayAll: () => void;
  onPauseAll: () => void;
  onResetAll: (play: boolean) => void;
  /* 上传与背景音乐 */
  onImportClick: () => void;
  onBgmClick: () => void;
  bgmUploading: boolean;
  onRemoveBgm: () => void;
  /* 水印对话框 */
  onEditWatermarkText: () => void;
  /* 清空 / 专注 */
  onClearAll: () => void;
  onEnterFocus: () => void;
  /** 「刷新全部页面」信号（纯 HTML 项目的主动作） */
  onHtmlRefresh: () => void;
}

export function TopBar(props: TopBarProps) {
  const {
    headerRef, mode, view, sidebarOpen, busy, filledCount, hasVideo, hasHtml, hasImage,
    projectName, projects, projectId, onSwitchProject, onNewProject,
    themeMounted, resolvedTheme, onToggleTheme, onOpenNotes,
    count, layout, layoutMode, onCountSelect, onLayoutSelect, onAutoSelect,
    settings, updateSettings, patchLocal, ratioDraft, onRatioDraftChange, onApplyCustomRatio,
    onPlayAll, onPauseAll, onResetAll,
    onImportClick, onBgmClick, bgmUploading, onRemoveBgm,
    onEditWatermarkText, onClearAll, onEnterFocus, onHtmlRefresh,
  } = props;
  const s = settings;

  return (
    <header ref={headerRef} className="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur">
      <div
        className={cn(
          'mx-auto flex w-full flex-col gap-2 px-3 py-3 sm:px-6',
          !sidebarOpen ? 'max-w-[1800px]' : 'max-w-[1400px]',
        )}
      >
        {/* 第一行：品牌 + 项目切换 + 使用须知 + 主题（高度恒定） */}
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-lg shadow-primary/25">
            <Clapperboard className="h-5 w-5" aria-hidden />
          </div>
          <div className="min-w-0">
            <h1 className="text-base font-bold leading-tight tracking-wide sm:text-lg">OmniCompare</h1>
            {mode === 'studio' && (
              <p className="text-[11px] leading-tight text-muted-foreground sm:text-xs">
                灵动对比 · 多内容并行对比工作台
              </p>
            )}
          </div>

          {/* 项目切换器（Step 8 多项目） */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                disabled={busy}
                title="切换项目"
                aria-label={`当前项目：${projectName}，点击切换`}
                className="inline-flex h-9 max-w-[180px] items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-[13px] font-semibold text-foreground/90 transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-not-allowed disabled:opacity-50 sm:max-w-[240px]"
              >
                <span className="truncate">{projectName}</span>
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[15rem] border-border bg-card">
              {(['active', 'draft', 'archived'] as const).map((st) => {
                const group = projects.filter((p) => p.status === st);
                if (group.length === 0) return null;
                return (
                  <div key={st}>
                    <p className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                      {STATUS_META[st].label}
                    </p>
                    {group.map((p) => {
                      const { videoCount: vc, htmlCount: hc, imageCount: ic } = p;
                      return (
                        <DropdownMenuItem
                          key={p.id}
                          onClick={() => onSwitchProject(p.id)}
                          className={cn('gap-2 text-[13px]', p.id === projectId && 'font-semibold text-primary')}
                        >
                          <span
                            className={cn('h-1.5 w-1.5 shrink-0 rounded-full', STATUS_META[st].dot)}
                            aria-hidden
                          />
                          <span className="min-w-0 flex-1 truncate">{p.name}</span>
                          {/* 内容类型徽标：切换前即可预知顶栏形态 */}
                          {vc > 0 && (
                            <span className="inline-flex shrink-0 items-center gap-0.5 rounded border border-border px-1 text-[10px] tabular-nums text-muted-foreground" title={`${vc} 个视频`}>
                              <Film className="h-2.5 w-2.5" aria-hidden />
                              {vc}
                            </span>
                          )}
                          {hc > 0 && (
                            <span className="inline-flex shrink-0 items-center gap-0.5 rounded border border-border px-1 text-[10px] tabular-nums text-muted-foreground" title={`${hc} 个网页`}>
                              <Code2 className="h-2.5 w-2.5" aria-hidden />
                              {hc}
                            </span>
                          )}
                          {ic > 0 && (
                            <span className="inline-flex shrink-0 items-center gap-0.5 rounded border border-border px-1 text-[10px] tabular-nums text-muted-foreground" title={`${ic} 张图片`}>
                              <ImageIcon className="h-2.5 w-2.5" aria-hidden />
                              {ic}
                            </span>
                          )}
                        </DropdownMenuItem>
                      );
                    })}
                  </div>
                );
              })}
              <div className="mt-1.5 border-t border-border/70 pt-1.5">
                <DropdownMenuItem onClick={onNewProject} className="text-[13px] font-semibold text-primary">
                  <FolderPlus className="mr-1.5 h-4 w-4" aria-hidden />
                  新建项目
                </DropdownMenuItem>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* 使用须知：紧贴项目切换器右侧，点击弹出 */}
          <button
            type="button"
            onClick={onOpenNotes}
            title="使用须知"
            aria-label="查看使用须知"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            <BookOpen className="h-[18px] w-[18px]" aria-hidden />
          </button>

          {/* 第一行右上角：明暗主题（无框只有太阳/月亮） */}
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={onToggleTheme}
              /* title 与图标一样受 themeMounted 门控：服务端与水合首帧统一渲染暗色文案，
                 避免 next-themes 客户端同步读主题导致的水合属性不一致（控制台警告） */
              title={themeMounted && resolvedTheme === 'dark' ? '切换到亮色模式' : '切换到暗色模式'}
              aria-label="切换明暗主题"
              className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
            >
              {themeMounted && resolvedTheme === 'dark' ? (
                <Sun className="h-[18px] w-[18px]" aria-hidden />
              ) : (
                <Moon className="h-[18px] w-[18px]" aria-hidden />
              )}
            </button>
          </div>
        </div>

        {/* 第二行：功能按钮行——不换行、窄屏横向滑动，任何项目切换/按钮显隐下高度恒定（震动根治）。 */}
        <div className="no-scrollbar -mx-1 flex min-w-0 items-center gap-1.5 overflow-x-auto px-1 [&>*]:shrink-0 sm:gap-2">
          {/* 项目库视图：库标签 + 新建项目（保持功能行高度恒定） */}
          {view === 'library' && (
            <>
              <span className="inline-flex h-10 items-center gap-1.5 px-1 text-[13px] font-semibold text-muted-foreground">
                <Library className="h-4 w-4" aria-hidden />
                项目库
                <span className="tabular-nums text-muted-foreground/60">· {projects.length} 个项目</span>
              </span>
              <Divider />
              <button
                type="button"
                disabled={busy}
                onClick={onNewProject}
                className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-[13px] font-semibold text-primary-foreground shadow-lg shadow-primary/30 transition-all hover:bg-primary/90 hover:shadow-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 sm:px-4"
              >
                <FolderPlus className="h-4 w-4" aria-hidden />
                新建项目
              </button>
              <Divider />
            </>
          )}

          {/* 播放控制组：纯 HTML 项目没有播放语义，整组隐藏 */}
          {view === 'workspace' && hasVideo && (
            <>
              <button
                type="button"
                onClick={onPlayAll}
                className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-[13px] font-semibold text-primary-foreground shadow-lg shadow-primary/30 transition-all hover:bg-primary/90 hover:shadow-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-95 sm:px-4"
              >
                <Play className="h-4 w-4 fill-current" aria-hidden />
                同时播放
              </button>

              <button
                type="button"
                onClick={onPauseAll}
                className={cn(ctlBtn, 'border-border bg-card text-foreground/90 hover:bg-accent hover:text-accent-foreground')}
                title="全部暂停"
                aria-label="全部暂停"
              >
                <Pause className="h-4 w-4" aria-hidden />
                <span className="hidden sm:inline">暂停</span>
              </button>

              <Divider />
            </>
          )}

          {/* 纯 HTML 项目：页面打开即自动运行，主动作是「刷新全部页面」（D11），
              与视频项目的播放组占用同一槽位——顶栏逻辑随内容自动适配 */}
          {view === 'workspace' && hasHtml && !hasVideo && filledCount > 0 && (
            <>
              <button
                type="button"
                onClick={onHtmlRefresh}
                className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-[13px] font-semibold text-primary-foreground shadow-lg shadow-primary/30 transition-all hover:bg-primary/90 hover:shadow-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-95 sm:px-4"
                title="重新加载全部 HTML 页面，回到各自初始状态"
                aria-label="刷新全部页面"
              >
                <RefreshCw className="h-4 w-4" aria-hidden />
                刷新全部
              </button>

              <Divider />
            </>
          )}

          {/* 布局弹层：内容位数量 / 矩阵 / 比例 / 自动适配 / 整体大小 / 页面缩放 */}
          {view === 'workspace' && (
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
          )}

          {/* 播放下拉（拆分按钮 1/3）：循环/静音/重置/倍速/背景音乐；纯 HTML 项目隐藏 */}
          {view === 'workspace' && hasVideo && (
            <PlaybackMenu
              s={s}
              updateSettings={updateSettings}
              patchLocal={patchLocal}
              onResetAll={onResetAll}
              onBgmClick={onBgmClick}
              bgmUploading={bgmUploading}
              onRemoveBgm={onRemoveBgm}
            />
          )}

          {/* 标题下拉（拆分按钮 2/3）：显隐 + 位置/对齐/字号/粗细/颜色五组全局格式 */}
          {view === 'workspace' && (
            <TitleMenu s={s} updateSettings={updateSettings} />
          )}

          {/* 黑边填充下拉（拆分按钮 3/3）：仅视频/图片项目显示 */}
          {view === 'workspace' && (hasVideo || hasImage) && (
            <FillMenu s={s} updateSettings={updateSettings} />
          )}

          {view === 'workspace' && (
            <>
              <button
                type="button"
                onClick={onImportClick}
                disabled={busy}
                className={cn(ctlBtn, 'border-primary/40 bg-primary/10 text-primary hover:bg-primary/20')}
                title="上传视频、图片、HTML 或 zip 页面包：按顺序填入空位，不会覆盖已有内容"
                aria-label="上传内容文件"
              >
                <UploadCloud className="h-4 w-4" aria-hidden />
                <span>上传</span>
              </button>

              {/* 背景音乐快捷入口：琥珀色系与「上传」主色区分 */}
              <button
                type="button"
                onClick={onBgmClick}
                disabled={bgmUploading}
                className={cn(
                  ctlBtn,
                  'border-amber-500/40 bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 dark:text-amber-400',
                )}
                title={s.bgm ? `背景音乐：${s.bgm.originalName}（点击更换）` : '上传背景音乐：支持 mp3、wav、flac、m4a 等，50MB 内'}
                aria-label="上传背景音乐"
              >
                <Music className="h-4 w-4" aria-hidden />
                <span>{bgmUploading ? '上传中…' : '音乐'}</span>
                {s.bgm && <span className="h-1.5 w-1.5 rounded-full bg-amber-500 dark:bg-amber-400" aria-hidden />}
              </button>

              {/* 水印（防伪）：完整功能面板挂在顶栏按钮上 */}
              <WatermarkMenu s={s} updateSettings={updateSettings} patchLocal={patchLocal} onEditText={onEditWatermarkText} />

              {/* 录屏模式（锁定控件）：cyan 青色系 */}
              <button
                type="button"
                onClick={() => void updateSettings({ lockControls: !s.lockControls })}
                className={cn(
                  ctlBtn,
                  'border-cyan-500/40 bg-cyan-500/10 text-cyan-600 hover:bg-cyan-500/20 dark:text-cyan-400',
                )}
                title={
                  s.lockControls
                    ? '录屏模式已开：专注模式下视频控件锁定，悬停不再显示（点击关闭）'
                    : '录屏模式：专注模式下锁定视频控件，鼠标悬停不再显示进度条'
                }
                aria-label="录屏模式"
                aria-pressed={s.lockControls}
              >
                <Video className="h-4 w-4" aria-hidden />
                <span>录屏</span>
                {s.lockControls && <span className="h-1.5 w-1.5 rounded-full bg-cyan-500 dark:bg-cyan-400" aria-hidden />}
              </button>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <button
                    type="button"
                    disabled={busy}
                    className={cn(
                      ctlBtn,
                      'border-transparent bg-transparent px-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive sm:px-2.5',
                    )}
                    title="清空全部内容"
                    aria-label="清空全部内容"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>清空全部内容？</AlertDialogTitle>
                    <AlertDialogDescription>
                      将移除全部 {filledCount} 个内容及其标题，此操作无法恢复。
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>取消</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={onClearAll}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:ring-destructive"
                    >
                      确认清空
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}

          <Divider />

          {/* 进入专注模式（退出入口在右下角圆形按钮） */}
          <button
            type="button"
            onClick={onEnterFocus}
            className={cn(ctlBtn, 'border-primary/50 bg-primary/10 text-primary hover:bg-primary/20')}
            title="进入专注模式：隐藏顶栏与全部管理控件，专心观看对比"
            aria-label="进入专注模式"
          >
            <Expand className="h-4 w-4" aria-hidden />
            <span className="hidden sm:inline">专注</span>
          </button>
        </div>
      </div>
    </header>
  );
}

/* ============================== 播放下拉 ============================== */

function PlaybackMenu({
  s,
  updateSettings,
  patchLocal,
  onResetAll,
  onBgmClick,
  bgmUploading,
  onRemoveBgm,
}: {
  s: WallSettings;
  updateSettings: (partial: Partial<ManifestSettings>) => Promise<void>;
  patchLocal: (partial: Partial<WallSettings>) => void;
  onResetAll: (play: boolean) => void;
  onBgmClick: () => void;
  bgmUploading: boolean;
  onRemoveBgm: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(ctlBtn, 'border-border bg-card text-foreground/90 hover:bg-accent hover:text-accent-foreground')}
          title="循环播放、全部静音与播放速度"
          aria-label="播放设置"
        >
          <Play className="h-4 w-4" aria-hidden />
          <span className="hidden sm:inline">播放</span>
          <span className="inline-block min-w-[3ch] text-center text-[11px] font-semibold tabular-nums text-primary">
            {s.rate}×
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[12rem] border-border bg-card">
        <DropdownMenuCheckboxItem
          checked={s.loop}
          onCheckedChange={(v) => void updateSettings({ loop: v === true })}
          className="text-[13px]"
        >
          循环播放
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={s.mutedAll}
          onCheckedChange={(v) => void updateSettings({ muted: v === true })}
          className="text-[13px]"
        >
          全部静音
        </DropdownMenuCheckboxItem>
        {/* 一键重置：视频归零、网页重载、背景音乐归零；录屏前备场用 */}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => onResetAll(false)} className="text-[13px]">
          <RotateCcw className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          全部归零并暂停
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onResetAll(true)} className="text-[13px]">
          <Play className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          全部归零并播放
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="text-[13px]">
            <Gauge className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            播放速度
            <span className="ml-auto pl-2 text-[11px] tabular-nums text-muted-foreground">{s.rate}×</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="min-w-[8rem] border-border bg-card">
            {[0.5, 1, 1.25, 1.5, 2].map((r) => (
              <DropdownMenuItem
                key={r}
                onClick={() => void updateSettings({ playbackRate: r })}
                className={cn('text-[13px]', r === s.rate && 'font-semibold text-primary')}
              >
                {r === 1 ? '常速（1×）' : `${r}×`}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        {/* 背景音乐：上传/更换、移除与音量（全局唯一一轨，存项目 settings） */}
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="text-[13px]">
            <Music className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            背景音乐
            <span className="ml-auto max-w-[10rem] truncate pl-2 text-[11px] text-muted-foreground">
              {s.bgm ? s.bgm.originalName : '未设置'}
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="min-w-[13rem] border-border bg-card">
            {s.bgm ? (
              <>
                <div className="px-2 py-1.5 text-[11px] text-muted-foreground" title={s.bgm.originalName}>
                  <span className="block truncate">当前：{s.bgm.originalName}</span>
                </div>
                <div className="px-2 py-2">
                  <div className="mb-1 flex items-center justify-between text-[12px] text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Volume2 className="h-3.5 w-3.5" aria-hidden />
                      音量
                    </span>
                    <span className="tabular-nums">{s.bgmVolume}%</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={s.bgmVolume}
                    onChange={(e) => patchLocal({ bgmVolume: Number(e.target.value) })}
                    onPointerUp={() => void updateSettings({ bgmVolume: s.bgmVolume })}
                    onKeyUp={() => void updateSettings({ bgmVolume: s.bgmVolume })}
                    aria-label="背景音乐音量"
                    className="w-full accent-[var(--primary)]"
                  />
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={bgmUploading} onClick={onBgmClick} className="text-[13px]">
                  <Music className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                  {bgmUploading ? '上传中…' : '换一首'}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onRemoveBgm} className="text-[13px] text-destructive">
                  移除背景音乐
                </DropdownMenuItem>
              </>
            ) : (
              <DropdownMenuItem disabled={bgmUploading} onClick={onBgmClick} className="text-[13px]">
                <Music className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                {bgmUploading ? '上传中…' : '上传背景音乐'}
              </DropdownMenuItem>
            )}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* ============================== 标题下拉 ============================== */

function TitleMenu({
  s,
  updateSettings,
}: {
  s: WallSettings;
  updateSettings: (partial: Partial<ManifestSettings>) => Promise<void>;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(ctlBtn, 'border-border bg-card text-foreground/90 hover:bg-accent hover:text-accent-foreground')}
          title="标题与属性信息的显隐、位置、对齐、字号、粗细与颜色"
          aria-label="标题设置"
        >
          <Type className="h-4 w-4" aria-hidden />
          <span className="hidden sm:inline">标题</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[12rem] border-border bg-card">
        <DropdownMenuCheckboxItem
          checked={s.showTitles}
          onCheckedChange={(v) => void updateSettings({ showTitles: v === true })}
          className="text-[13px]"
        >
          显示标题
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={s.showInfo}
          onCheckedChange={(v) => void updateSettings({ showInfo: v === true })}
          className="text-[13px]"
        >
          显示属性信息
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={s.showIndex}
          onCheckedChange={(v) => void updateSettings({ showIndex: v === true })}
          className="text-[13px]"
        >
          显示位置编号
        </DropdownMenuCheckboxItem>
        {/* 提示词与署名（矩阵下方，录屏入镜用） */}
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem
          checked={s.showPrompt}
          onCheckedChange={(v) => void updateSettings({ showPrompt: v === true })}
          className="text-[13px]"
        >
          显示提示词
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={s.showByline}
          onCheckedChange={(v) => void updateSettings({ showByline: v === true })}
          className="text-[13px]"
        >
          显示署名
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        {/* 标题格式（全局同步） */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger disabled={!s.showTitles} className="text-[13px]">
            <AlignCenter className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            标题对齐
            <span className="ml-auto pl-2 text-[11px] text-muted-foreground">
              {s.titleAlign === 'left' ? '居左' : s.titleAlign === 'right' ? '居右' : '居中'}
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="min-w-[8rem] border-border bg-card">
            {TITLE_ALIGNS.map((a) => (
              <DropdownMenuItem
                key={a}
                onClick={() => void updateSettings({ titleAlign: a })}
                className={cn('text-[13px]', a === s.titleAlign && 'font-semibold text-primary')}
              >
                {a === 'left' ? (
                  <AlignLeft className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                ) : a === 'right' ? (
                  <AlignRight className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                ) : (
                  <AlignCenter className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                )}
                {a === 'left' ? '居左' : a === 'right' ? '居右' : '居中'}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger disabled={!s.showTitles} className="text-[13px]">
            <Type className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            标题字号
            <span className="ml-auto pl-2 text-[11px] tabular-nums text-muted-foreground">
              {s.titleFontSize}px
            </span>
          </DropdownMenuSubTrigger>
          {/* onSelect preventDefault 保持菜单展开，可连续点按微调 */}
          <DropdownMenuSubContent className="min-w-[12rem] border-border bg-card">
            {/* 常用字号快捷档：一键跳档（16→60 只需一点） */}
            <div className="grid grid-cols-3 gap-1 px-2 pb-1 pt-1" role="group" aria-label="常用字号快捷档">
              {TITLE_FONT_PRESETS.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => void updateSettings({ titleFontSize: n })}
                  aria-pressed={s.titleFontSize === n}
                  className={cn(
                    'rounded-md px-1 py-1 text-[12px] font-semibold tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
                    s.titleFontSize === n
                      ? 'bg-primary/15 text-primary'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                  )}
                >
                  {n}px
                </button>
              ))}
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                void updateSettings({ titleFontSize: Math.max(TITLE_FONT_MIN, s.titleFontSize - 1) });
              }}
              disabled={s.titleFontSize <= TITLE_FONT_MIN}
              className="text-[13px]"
            >
              <Minus className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              减小字号
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                void updateSettings({ titleFontSize: Math.min(TITLE_FONT_MAX, s.titleFontSize + 1) });
              }}
              disabled={s.titleFontSize >= TITLE_FONT_MAX}
              className="text-[13px]"
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              增大字号
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                void updateSettings({ titleFontSize: TITLE_FONT_DEFAULT });
              }}
              disabled={s.titleFontSize === TITLE_FONT_DEFAULT}
              className="text-[13px]"
            >
              恢复默认（{TITLE_FONT_DEFAULT}px）
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger disabled={!s.showTitles} className="text-[13px]">
            <ArrowDownToLine className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            标题位置
            <span className="ml-auto pl-2 text-[11px] text-muted-foreground">
              {s.titlePosition === 'overlay' ? '顶部叠加' : '内容下方'}
            </span>
          </DropdownMenuSubTrigger>
          {/* 两种位置排他显示：below = 下方编辑框；overlay = 内容顶部叠加（点击可编辑） */}
          <DropdownMenuSubContent className="min-w-[9rem] border-border bg-card">
            {TITLE_POSITIONS.map((p) => (
              <DropdownMenuItem
                key={p}
                onClick={() => void updateSettings({ titlePosition: p })}
                className={cn('text-[13px]', p === s.titlePosition && 'font-semibold text-primary')}
              >
                {p === 'overlay' ? '内容顶部叠加' : '内容下方（默认）'}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger disabled={!s.showTitles} className="text-[13px]">
            <Bold className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            标题粗细
            <span className="ml-auto pl-2 text-[11px] text-muted-foreground">
              {s.titleWeight === 'bold' ? '加粗' : s.titleWeight === 'medium' ? '中等' : '正常'}
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="min-w-[8rem] border-border bg-card">
            {TITLE_WEIGHTS.map((w) => (
              <DropdownMenuItem
                key={w}
                onClick={() => void updateSettings({ titleWeight: w })}
                className={cn('text-[13px]', w === s.titleWeight && 'font-semibold text-primary')}
              >
                <span className="mr-1" style={{ fontWeight: w === 'bold' ? 700 : w === 'medium' ? 500 : 400 }}>
                  Aa
                </span>
                {w === 'bold' ? '加粗' : w === 'medium' ? '中等' : '正常'}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger disabled={!s.showTitles} className="text-[13px]">
            <Palette className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            标题颜色
            <span
              aria-hidden
              className="ml-auto inline-block h-3.5 w-3.5 shrink-0 rounded-full border border-border"
              style={{
                background:
                  s.titleColor === TITLE_COLOR_DEFAULT
                    ? 'linear-gradient(135deg, #fff 0%, #fff 50%, #171717 50%, #171717 100%)'
                    : s.titleColor,
              }}
            />
          </DropdownMenuSubTrigger>
          {/* 色板白名单（防任意 CSS 注入）；跟随主题 = below 用前景色 / overlay 用白色+投影 */}
          <DropdownMenuSubContent className="min-w-[9rem] border-border bg-card">
            <DropdownMenuItem
              onClick={() => void updateSettings({ titleColor: TITLE_COLOR_DEFAULT })}
              className={cn('text-[13px]', s.titleColor === TITLE_COLOR_DEFAULT && 'font-semibold text-primary')}
            >
              跟随主题
            </DropdownMenuItem>
            {TITLE_COLOR_PALETTE.map((c) => (
              <DropdownMenuItem
                key={c}
                onClick={() => void updateSettings({ titleColor: c })}
                className={cn('text-[13px]', s.titleColor === c && 'font-semibold text-primary')}
              >
                <span
                  aria-hidden
                  className="mr-1.5 inline-block h-3.5 w-3.5 shrink-0 rounded-full border border-border"
                  style={{ background: c }}
                />
                {c}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* ============================== 填充下拉 ============================== */

function FillMenu({
  s,
  updateSettings,
}: {
  s: WallSettings;
  updateSettings: (partial: Partial<ManifestSettings>) => Promise<void>;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(ctlBtn, 'border-border bg-card text-foreground/90 hover:bg-accent hover:text-accent-foreground')}
          title="黑边填充方式：留黑边 / 模糊填充 / 铺满裁切（铺满会等比放大裁掉超出部分）"
          aria-label="黑边填充设置"
        >
          {s.letterboxFill === 'cover' ? (
            <Crop className="h-4 w-4" aria-hidden />
          ) : s.letterboxFill === 'blur' ? (
            <Droplets className="h-4 w-4" aria-hidden />
          ) : (
            <Expand className="h-4 w-4" aria-hidden />
          )}
          <span className="hidden sm:inline">填充</span>
          <span className="inline-block text-[11px] font-semibold text-primary">
            {s.letterboxFill === 'cover' ? '铺满' : s.letterboxFill === 'blur' ? '模糊' : '黑边'}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[13rem] border-border bg-card">
        {LETTERBOX_FILLS.map((f) => (
          <DropdownMenuItem
            key={f}
            onClick={() => void updateSettings({ letterboxFill: f })}
            className={cn('text-[13px]', f === s.letterboxFill && 'font-semibold text-primary')}
          >
            {f === 'cover' ? (
              <Crop className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            ) : f === 'blur' ? (
              <Droplets className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            ) : (
              <Expand className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            )}
            {f === 'cover' ? '铺满裁切（无黑边）' : f === 'blur' ? '模糊填充' : '留黑边（默认）'}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* ============================== 水印下拉 ============================== */

function WatermarkMenu({
  s,
  updateSettings,
  patchLocal,
  onEditText,
}: {
  s: WallSettings;
  updateSettings: (partial: Partial<ManifestSettings>) => Promise<void>;
  patchLocal: (partial: Partial<WallSettings>) => void;
  onEditText: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            ctlBtn,
            'border-violet-500/40 bg-violet-500/10 text-violet-600 hover:bg-violet-500/20 dark:text-violet-400',
          )}
          title="水印：防伪标志盖在视频区上方缓慢巡游（点击设置）"
          aria-label="水印设置"
        >
          <Stamp className="h-4 w-4" aria-hidden />
          <span>水印</span>
          {s.wmShow && <span className="h-1.5 w-1.5 rounded-full bg-violet-500 dark:bg-violet-400" aria-hidden />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64 border-border bg-card">
        <DropdownMenuCheckboxItem
          checked={s.wmShow}
          onCheckedChange={(v) => {
            void updateSettings({ showWatermark: v === true });
            /* 首次开启且还没设文字：直接带出文字编辑，避免空水印挂在屏幕上 */
            if (v === true && !s.wmText) onEditText();
          }}
          className="text-[13px]"
        >
          启用水印
        </DropdownMenuCheckboxItem>
        <DropdownMenuItem onClick={onEditText} className="text-[13px]">
          水印文字…
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <div className="px-2 py-2">
          <div className="mb-1 flex items-center justify-between text-[12px] text-muted-foreground">
            <span>字号</span>
            <span className="tabular-nums">{s.wmFontSize}px</span>
          </div>
          <input
            type="range"
            min={WATERMARK_FONT_MIN}
            max={WATERMARK_FONT_MAX}
            step={1}
            value={s.wmFontSize}
            onChange={(e) => patchLocal({ wmFontSize: Number(e.target.value) })}
            onPointerUp={() => void updateSettings({ watermarkFontSize: s.wmFontSize })}
            onKeyUp={() => void updateSettings({ watermarkFontSize: s.wmFontSize })}
            aria-label="水印字号"
            className="w-full accent-[var(--primary)]"
          />
          <div className="mb-1 mt-3 flex items-center justify-between text-[12px] text-muted-foreground">
            <span>颜色深浅</span>
          </div>
          <div className="flex gap-1" role="radiogroup" aria-label="水印颜色深浅">
            {WATERMARK_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={s.wmColor === c}
                onClick={() => void updateSettings({ watermarkColor: c })}
                className={cn(
                  'flex-1 rounded-md border px-1 py-1 text-[12px] transition-colors',
                  s.wmColor === c
                    ? 'border-violet-500/60 bg-violet-500/15 text-violet-600 dark:text-violet-300'
                    : 'border-border/60 text-muted-foreground hover:bg-muted/60',
                )}
              >
                {c === 'auto' ? '跟随主题' : c === 'white' ? '白' : '黑'}
              </button>
            ))}
          </div>
          <div className="mb-1 mt-3 flex items-center justify-between text-[12px] text-muted-foreground">
            <span>巡游速度</span>
          </div>
          <div className="flex gap-1" role="radiogroup" aria-label="水印巡游速度">
            {WATERMARK_SPEEDS.map((sp) => (
              <button
                key={sp}
                type="button"
                role="radio"
                aria-checked={s.wmSpeed === sp}
                onClick={() => void updateSettings({ watermarkSpeed: sp })}
                className={cn(
                  'flex-1 rounded-md border px-1 py-1 text-[12px] transition-colors',
                  s.wmSpeed === sp
                    ? 'border-violet-500/60 bg-violet-500/15 text-violet-600 dark:text-violet-300'
                    : 'border-border/60 text-muted-foreground hover:bg-muted/60',
                )}
              >
                {sp === 'slow' ? '慢' : sp === 'normal' ? '标准' : '快'}
              </button>
            ))}
          </div>
          <div className="mb-1 mt-3 flex items-center justify-between text-[12px] text-muted-foreground">
            <span>不透明度</span>
            <span className="tabular-nums">{s.wmOpacity}%</span>
          </div>
          <input
            type="range"
            min={WATERMARK_OPACITY_MIN}
            max={WATERMARK_OPACITY_MAX}
            step={1}
            value={s.wmOpacity}
            onChange={(e) => patchLocal({ wmOpacity: Number(e.target.value) })}
            onPointerUp={() => void updateSettings({ watermarkOpacity: s.wmOpacity })}
            onKeyUp={() => void updateSettings({ watermarkOpacity: s.wmOpacity })}
            aria-label="水印不透明度"
            className="w-full accent-[var(--primary)]"
          />
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem
          checked={s.wmWeight === 'bold'}
          onCheckedChange={(v) =>
            void updateSettings({ watermarkFontWeight: v === true ? 'bold' : 'normal' })
          }
          className="text-[13px]"
        >
          加粗
        </DropdownMenuCheckboxItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="text-[13px]">字体形式</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="min-w-[9rem] border-border bg-card">
            <DropdownMenuRadioGroup
              value={s.wmFamily}
              onValueChange={(v) => void updateSettings({ watermarkFontFamily: v as typeof s.wmFamily })}
            >
              <DropdownMenuRadioItem value="default" className="text-[13px]">
                默认
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="serif" className="text-[13px]">
                衬线
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="hand" className="text-[13px]">
                手写
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="mono" className="text-[13px]">
                等宽
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
