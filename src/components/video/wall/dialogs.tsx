'use client';

/**
 * video-wall 的四个弹窗：缩减数量确认 / 新建项目 / 使用须知 / 水印文字编辑。
 * 从 video-wall.tsx 拆出（纯展示 + 回调，状态全部由主组件持有）。
 */
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { WATERMARK_MAX } from '@/lib/types';

/* ============================== 缩减数量确认 ============================== */

export function ShrinkConfirmDialog({
  pendingCount,
  removedCount,
  onConfirm,
  onCancel,
}: {
  pendingCount: number | null;
  removedCount: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <AlertDialog open={pendingCount !== null} onOpenChange={(open) => { if (!open) onCancel(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>缩减内容位数量？</AlertDialogTitle>
          <AlertDialogDescription>
            缩减到 {pendingCount} 个将移除末尾多余的 {removedCount} 个内容及其标题，且无法恢复。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:ring-destructive"
          >
            确认缩减
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/* ============================== 新建项目 ============================== */

export function CreateProjectDialog({
  open,
  name,
  busy,
  onNameChange,
  onCreate,
  onClose,
}: {
  open: boolean;
  name: string;
  busy: boolean;
  onNameChange: (name: string) => void;
  onCreate: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="border-border bg-card text-card-foreground sm:max-w-[24rem]">
        <DialogHeader>
          <DialogTitle>新建项目</DialogTitle>
          <DialogDescription>
            为一批新内容创建独立工作台：内容、布局与设置互相隔离，可随时在顶栏切换。
          </DialogDescription>
        </DialogHeader>
        <Input
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onCreate();
            }
          }}
          maxLength={100}
          placeholder="项目名称（留空则自动命名）"
          aria-label="项目名称"
          autoFocus
        />
        <DialogFooter className="gap-2">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 items-center rounded-lg border border-border bg-card px-4 text-[13px] font-medium text-foreground/90 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            取消
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onCreate}
            className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-[13px] font-semibold text-primary-foreground shadow-lg shadow-primary/30 transition-all hover:bg-primary/90 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? '创建中…' : '创建并切换'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ============================== 使用须知 ============================== */

const NOTE_ITEMS: { title: string; body: React.ReactNode }[] = [
  {
    title: '布局与排序',
    body: (
      <>
        矩阵默认自动排列，可在顶栏「布局」中固定行列与内容比例。抓住卡片左上角编号即可
        <strong className="font-semibold text-foreground/90">拖动排序</strong>
        ；截图需要干净画面时，可在「标题」菜单中隐藏编号。
      </>
    ),
  },
  {
    title: '导入内容',
    body: (
      <>
        点击空位或把文件拖进页面即可上传，支持
        <strong className="font-semibold text-foreground/90">
          视频（MP4 / MOV / WebM 等）、图片（PNG / JPG / WebP / SVG 等）、单文件 HTML 与 zip 页面包
        </strong>
        。上传几个就显示几个内容框，超出时自动扩位；文件拖到已占用的卡片上会自动放入下一个空位，
        不会覆盖已有内容，替换内容请用卡片信息行的「替换」按钮；依赖同目录资源的页面请打成 zip 包导入。
      </>
    ),
  },
  {
    title: '播放与展示',
    body: (
      <>
        内容下方可填写标题与介绍；顶栏「播放」「标题」「填充」三个按钮分别控制
        <strong className="font-semibold text-foreground/90">循环/静音/倍速、标题样式与黑边填充</strong>
        ，对全部卡片同时生效。
      </>
    ),
  },
  {
    title: '顶栏随内容自动适配',
    body: (
      <>
        <strong className="font-semibold text-foreground/90">含视频的项目</strong>
        显示「同时播放 / 暂停」；
        <strong className="font-semibold text-foreground/90">纯网页项目</strong>
        没有播放概念，主动作变为「刷新全部」；混合项目两者并存（播放仅对视频生效）。无需手动选择模式。
      </>
    ),
  },
  {
    title: '多项目管理',
    body: (
      <>
        顶栏左上角可切换项目（项目名右侧的
        <strong className="font-semibold text-foreground/90">角标</strong>
        标明内容构成），支持新建、重命名、归档与删除；各项目的
        <strong className="font-semibold text-foreground/90">内容、布局与设置互相隔离</strong>
        。
      </>
    ),
  },
  {
    title: '数据安全',
    body: (
      <>
        内容与设置均
        <strong className="font-semibold text-foreground/90">保存在服务器</strong>
        ，刷新页面或换设备打开都不会丢失；HTML 页面在
        <strong className="font-semibold text-foreground/90">独立沙箱</strong>
        中运行，无法访问本站数据。
      </>
    ),
  },
];

export function NotesDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="border-border bg-card text-card-foreground sm:max-w-[32rem]">
        <DialogHeader>
          <DialogTitle>使用须知</DialogTitle>
          <DialogDescription>关于布局、导入、播放与多项目的 6 个要点。</DialogDescription>
        </DialogHeader>
        <ol className="flex max-h-[60vh] flex-col gap-3.5 overflow-y-auto pr-1 text-[13px] leading-relaxed text-muted-foreground">
          {NOTE_ITEMS.map((note, i) => (
            <li key={note.title} className="flex items-start gap-2.5">
              <span
                aria-hidden
                className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/10 text-[11px] font-bold tabular-nums text-primary"
              >
                {i + 1}
              </span>
              <p className="min-w-0 flex-1">
                <strong className="font-semibold text-foreground/90">{note.title}</strong>
                <br />
                {note.body}
              </p>
            </li>
          ))}
        </ol>
        <DialogFooter>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 items-center rounded-lg bg-primary px-5 text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            知道了
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ============================== 水印文字编辑 ============================== */

export function WatermarkTextDialog({
  open,
  draft,
  onDraftChange,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  draft: string;
  onDraftChange: (text: string) => void;
  onOpenChange: (open: boolean) => void;
  /** 保存：确认才提交（取消/Esc 丢弃草稿）；enable=true 时保存会连带开启水印 */
  onSave: (text: string) => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>水印文字</AlertDialogTitle>
          <AlertDialogDescription>
            显示在视频区上方的防伪标志，屏保式缓慢巡游、随当前项目保存，最长 60 字。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Input
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          maxLength={WATERMARK_MAX}
          placeholder="例如：@你的频道名 · 未经授权禁止搬运"
          aria-label="水印文字"
        />
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction onClick={() => onSave(draft.trim())}>保存</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
