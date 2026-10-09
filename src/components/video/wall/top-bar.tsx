'use client';

/**
 * 顶部控制栏：品牌行（品牌 / 项目切换 / 使用须知 / 主题）+ 功能行（播放 / 布局 /
 * 播放设置 / 标题 / 填充 / 上传 / 音乐 / 水印 / 录屏 / 清空 / 专注）。
 * 从 video-wall.tsx 拆出（纯展示 + 回调，状态全部由主组件持有）。
 *
 * 固定两行结构（震动根治）：无论项目内容是视频还是网页、播放/刷新按钮组如何显隐，
 * 顶栏恒为「品牌行 + 功能行」两行、高度不变，主体内容不再被顶栏行数变化推动上下跳动。
 * 专注模式整体隐藏顶栏（零干扰观看），退出入口固定在页面右下角圆形按钮。
 *
 * 2026-10 二次拆分：布局弹层 → top-bar-layout.tsx；播放/标题/填充/水印四个设置
 * 下拉 → top-bar-menus.tsx。本文件只保留顶栏骨架与按钮编排。
 */
import {
  BookOpen,
  ChevronDown,
  Clapperboard,
  Code2,
  Expand,
  Film,
  FolderPlus,
  Image as ImageIcon,
  Library,
  Moon,
  Music,
  Play,
  RefreshCw,
  Sun,
  Trash2,
  UploadCloud,
  Video,
  Pause,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Layout,
  ManifestSettings,
  ProjectSummary,
} from '@/lib/types';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
import { ctlBtn, Divider, STATUS_META } from './shared';
import { WallSettings } from './use-wall-settings';
import { LayoutPopover } from './top-bar-layout';
import { FillMenu, PlaybackMenu, TitleMenu, WatermarkMenu } from './top-bar-menus';

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

          {/* 布局弹层：内容位数量 / 矩阵 / 比例 / 自动适配 / 整体大小 / 页面缩放（top-bar-layout.tsx） */}
          {view === 'workspace' && (
            <LayoutPopover
              busy={busy}
              count={count}
              layout={layout}
              layoutMode={layoutMode}
              onCountSelect={onCountSelect}
              onLayoutSelect={onLayoutSelect}
              onAutoSelect={onAutoSelect}
              s={s}
              updateSettings={updateSettings}
              ratioDraft={ratioDraft}
              onRatioDraftChange={onRatioDraftChange}
              onApplyCustomRatio={onApplyCustomRatio}
            />
          )}

          {/* 播放下拉（拆分按钮 1/3）：循环/静音/重置/倍速/背景音乐；纯 HTML 项目隐藏（top-bar-menus.tsx） */}
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
            <TitleMenu s={s} updateSettings={updateSettings} patchLocal={patchLocal} />
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
