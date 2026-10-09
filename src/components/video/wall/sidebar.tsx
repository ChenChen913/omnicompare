'use client';

/**
 * 工作台侧栏：当前项目卡（状态/管理入口）、添加内容按钮、视图导航、
 * 当前活动窗格列表（点击定位 + 高亮）、收展把手。从 video-wall.tsx 拆出。
 * 容器定高（视口高 - 顶栏下沿 130px - 底部留白 16px）保证把手位置不随侧栏内容/
 * 收起状态变化；sticky 使把手在页面滚动时始终钉在视口垂直中部。
 */
import {
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Code2,
  Film,
  Image as ImageIcon,
  Library,
  LayoutGrid,
  Settings,
  UploadCloud,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { DEFAULT_PROJECT_ID, ProjectSummary, Slot } from '@/lib/types';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
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
import { STATUS_META } from './shared';

export function Sidebar(props: {
  open: boolean;
  onToggle: () => void;
  currentProject: ProjectSummary | null;
  projectName: string;
  filledCount: number;
  count: number;
  slots: Slot[];
  highlight: number | null;
  view: 'workspace' | 'library';
  projectsCount: number;
  renameDraft: string;
  projectBusy: boolean;
  busy: boolean;
  onRenameDraftChange: (name: string) => void;
  onUpdateProject: (id: string, patch: { name?: string; status?: ProjectSummary['status'] }) => void;
  onDeleteProject: (id: string) => void;
  onImportClick: () => void;
  onSetView: (view: 'workspace' | 'library') => void;
  onFocusSlot: (index: number) => void;
}) {
  const {
    open, onToggle, currentProject, projectName, filledCount, count, slots, highlight,
    view, projectsCount, renameDraft, projectBusy, busy,
    onRenameDraftChange, onUpdateProject, onDeleteProject, onImportClick, onSetView, onFocusSlot,
  } = props;

  const videoCount = slots.filter((s) => s.video).length;
  const htmlCount = slots.filter((s) => s.kind === 'html' && s.html).length;
  const imageCount = slots.filter((s) => s.kind === 'image' && s.image).length;

  return (
    <div className="sticky top-[130px] hidden h-[calc(100dvh-146px)] shrink-0 items-start lg:flex" data-sidebar-root>
      {open && (
        <aside className="flex w-60 flex-col gap-4 pb-6" aria-label="工作台侧栏">
          {/* 项目卡（Step 8 动态化：当前项目 + 状态 + 管理入口） */}
          <div className="rounded-xl border border-border bg-card p-3.5">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
                <Clapperboard className="h-[18px] w-[18px]" aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold" title={projectName}>
                  {projectName}
                </p>
                <p className="text-[11px] leading-tight text-muted-foreground">
                  {filledCount} / {count} 个内容位
                </p>
              </div>
            </div>
            {/* 内容构成小结：视频 x · 网页 y · 图片 z——与顶栏自动适配逻辑呼应 */}
            {filledCount > 0 && (
              <p className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <Film className="h-3 w-3" aria-hidden />
                  {videoCount} 视频
                </span>
                <span className="text-border" aria-hidden>|</span>
                <span className="inline-flex items-center gap-1">
                  <Code2 className="h-3 w-3" aria-hidden />
                  {htmlCount} 网页
                </span>
                {imageCount > 0 && (
                  <>
                    <span className="text-border" aria-hidden>|</span>
                    <span className="inline-flex items-center gap-1">
                      <ImageIcon className="h-3 w-3" aria-hidden />
                      {imageCount} 图片
                    </span>
                  </>
                )}
              </p>
            )}
            <div className="mt-3 flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[11px] text-muted-foreground">
                <span
                  className={cn('h-1.5 w-1.5 rounded-full', STATUS_META[currentProject?.status ?? 'active'].dot)}
                  aria-hidden
                />
                {STATUS_META[currentProject?.status ?? 'active'].label}
              </span>
              <Popover onOpenChange={(o) => o && onRenameDraftChange(currentProject?.name ?? projectName)}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="rounded-md border border-border bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                  >
                    管理
                  </button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-72 border-border bg-card p-3.5">
                  {/* 改名 */}
                  <p className="text-xs font-semibold tracking-wide text-muted-foreground">项目名称</p>
                  <div className="mt-1.5 flex gap-1.5">
                    <Input
                      value={renameDraft}
                      onChange={(e) => onRenameDraftChange(e.target.value)}
                      maxLength={100}
                      placeholder="项目名称"
                      aria-label="项目名称"
                      className="h-8 text-[13px]"
                    />
                    <button
                      type="button"
                      disabled={
                        !currentProject ||
                        projectBusy ||
                        !renameDraft.trim() ||
                        renameDraft.trim() === currentProject.name
                      }
                      onClick={() => currentProject && onUpdateProject(currentProject.id, { name: renameDraft.trim() })}
                      className="h-8 shrink-0 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      保存
                    </button>
                  </div>
                  {/* 状态 */}
                  <p className="mt-3 text-xs font-semibold tracking-wide text-muted-foreground">项目状态</p>
                  <div className="mt-1.5 grid grid-cols-3 gap-1.5">
                    {(['active', 'draft', 'archived'] as const).map((st) => (
                      <button
                        key={st}
                        type="button"
                        disabled={!currentProject}
                        aria-pressed={currentProject?.status === st}
                        onClick={() => currentProject && onUpdateProject(currentProject.id, { status: st })}
                        className={cn(
                          'h-8 rounded-md border text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-not-allowed disabled:opacity-50',
                          currentProject?.status === st
                            ? 'border-primary bg-primary/20 text-primary'
                            : 'border-border bg-muted/60 text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground',
                        )}
                      >
                        {STATUS_META[st].label}
                      </button>
                    ))}
                  </div>
                  {/* 删除（默认项目受保护） */}
                  {currentProject && currentProject.id !== DEFAULT_PROJECT_ID ? (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <button
                          type="button"
                          className="mt-3 h-8 w-full rounded-lg border border-destructive/40 text-xs font-semibold text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/50"
                        >
                          删除项目
                        </button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>删除项目「{currentProject.name}」？</AlertDialogTitle>
                          <AlertDialogDescription>
                            将删除该项目的全部内容文件与设置，此操作无法恢复。
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>取消</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => onDeleteProject(currentProject.id)}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:ring-destructive"
                          >
                            确认删除
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  ) : (
                    <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground/60">
                      默认项目不可删除；删除其他项目会连同其内容文件一并移除。
                    </p>
                  )}
                </PopoverContent>
              </Popover>
            </div>
          </div>

          {/* 添加内容：与顶栏「一键导入」同源，多选后按顺序填充空位 */}
          <button
            type="button"
            onClick={onImportClick}
            disabled={busy}
            className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-lg bg-primary text-[13px] font-semibold text-primary-foreground shadow-lg shadow-primary/30 transition-all hover:bg-primary/90 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50"
          >
            <UploadCloud className="h-4 w-4" aria-hidden />
            添加内容
          </button>

          {/* 视图导航（工作空间 / 项目库；设置入口评估后维持占位，见 BLUEPRINT D13） */}
          <nav className="flex flex-col gap-1" aria-label="视图切换">
            <p className="px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">视图</p>
            <button
              type="button"
              onClick={() => onSetView('workspace')}
              aria-current={view === 'workspace' ? 'page' : undefined}
              className={cn(
                'flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
                view === 'workspace'
                  ? 'bg-primary/15 text-primary'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              <LayoutGrid className="h-4 w-4" aria-hidden />
              工作空间
            </button>
            <button
              type="button"
              onClick={() => onSetView('library')}
              aria-current={view === 'library' ? 'page' : undefined}
              className={cn(
                'flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
                view === 'library'
                  ? 'bg-primary/15 text-primary'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              <Library className="h-4 w-4" aria-hidden />
              库
              <span className="ml-auto text-[10px] font-normal text-muted-foreground/60 tabular-nums">
                {projectsCount} 个项目
              </span>
            </button>
            <button
              type="button"
              disabled
              title="设置已收编于顶栏「布局」「播放」「标题」「填充」弹层，暂不提供独立页面（D13）"
              className="flex cursor-not-allowed items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium text-muted-foreground/50"
            >
              <Settings className="h-4 w-4" aria-hidden />
              设置
              <span className="ml-auto text-[10px] font-normal text-muted-foreground/40">收编于顶栏</span>
            </button>
          </nav>

          {/* 当前活动窗格：点击滚动定位并短暂高亮对应卡片 */}
          <div className="min-h-0">
            <p className="px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">
              当前活动窗格（{count}）
            </p>
            <div className="mt-1.5 max-h-[320px] space-y-0.5 overflow-y-auto pr-1">
              {slots.map((s) => (
                <button
                  key={s.index}
                  type="button"
                  onClick={() => onFocusSlot(s.index)}
                  aria-label={`定位到窗格 ${s.index + 1}`}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-accent',
                    highlight === s.index && 'bg-primary/10',
                  )}
                >
                  <span
                    className={cn(
                      'h-1.5 w-1.5 shrink-0 rounded-full',
                      s.kind === 'html'
                        ? 'bg-sky-500'
                        : s.kind === 'image'
                          ? 'bg-violet-500'
                          : s.video
                            ? 'bg-emerald-500'
                            : 'bg-muted-foreground/30',
                    )}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate text-xs text-foreground/80">
                    {s.title || s.video?.originalName || s.html?.originalName || s.image?.originalName || `空位 ${s.index + 1}`}
                  </span>
                  {s.kind === 'html' && (
                    <span className="shrink-0 rounded border border-border px-1 text-[9px] font-semibold leading-4 text-muted-foreground/70">
                      HTML
                    </span>
                  )}
                  {s.kind === 'image' && (
                    <span className="shrink-0 rounded border border-border px-1 text-[9px] font-semibold leading-4 text-muted-foreground/70">
                      图片
                    </span>
                  )}
                  <span
                    className={cn(
                      'shrink-0 text-[10px] tabular-nums',
                      s.video ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground/40',
                    )}
                  >
                    {s.index + 1}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </aside>
      )}
      {/* 侧栏开关：长条把手贴在侧栏右缘、垂直居中（不占顶栏），收起后仍在原位，点击随时展开 */}
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={open}
        title={open ? '收起侧栏' : '展开侧栏'}
        aria-label={open ? '收起侧栏' : '展开侧栏'}
        className="flex h-16 w-5 shrink-0 self-center items-center justify-center rounded-r-lg border border-l-0 border-border bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
      >
        {open ? <ChevronLeft className="h-3.5 w-3.5" aria-hidden /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden />}
      </button>
    </div>
  );
}
