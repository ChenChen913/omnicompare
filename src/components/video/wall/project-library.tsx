'use client';

/**
 * 项目库视图（Step D）：项目卡片网格，点击卡片打开对应工作台。
 * 排序：进行中 > 草稿 > 已归档，同组内按更新时间倒序。从 video-wall.tsx 拆出。
 */
import { ChevronRight, Code2, Film, Image as ImageIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ProjectSummary } from '@/lib/types';
import { STATUS_META } from './shared';

const STATUS_ORDER = { active: 0, draft: 1, archived: 2 } as const;

export function ProjectLibrary({
  projects,
  projectId,
  onOpen,
}: {
  projects: ProjectSummary[];
  projectId: string;
  onOpen: (id: string) => void;
}) {
  return (
    <section className="w-full" aria-label="项目库">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[13px] text-muted-foreground">
          点击卡片打开对应工作台；新建项目在顶栏，改名/归档/删除在打开项目后的侧栏「管理」。
        </p>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {[...projects]
          .sort((a, b) => {
            if (STATUS_ORDER[a.status] !== STATUS_ORDER[b.status]) {
              return STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
            }
            return b.updatedAt > a.updatedAt ? 1 : -1;
          })
          .map((p) => {
            const { videoCount: vc, htmlCount: hc, imageCount: ic } = p;
            const isCurrent = p.id === projectId;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => onOpen(p.id)}
                className={cn(
                  'group flex flex-col gap-3 rounded-2xl border bg-card p-5 text-left transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-black/10',
                  isCurrent ? 'border-primary/70 ring-2 ring-primary/40' : 'border-border hover:border-primary/50',
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-[15px] font-bold text-foreground" title={p.name}>
                      {p.name}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground/70">
                      更新于 {new Date(p.updatedAt).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}
                      {isCurrent && <span className="ml-1.5 font-semibold text-primary">· 当前打开</span>}
                    </p>
                  </div>
                  <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[11px] text-muted-foreground">
                    <span className={cn('h-1.5 w-1.5 rounded-full', STATUS_META[p.status].dot)} aria-hidden />
                    {STATUS_META[p.status].label}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5" title={`${vc} 个视频`}>
                    <Film className="h-3 w-3" aria-hidden />{vc}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5" title={`${hc} 个网页`}>
                    <Code2 className="h-3 w-3" aria-hidden />{hc}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5" title={`${ic} 张图片`}>
                    <ImageIcon className="h-3 w-3" aria-hidden />{ic}
                  </span>
                  <span className="ml-auto inline-flex items-center gap-1 text-[11px] font-semibold text-primary opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                    打开工作台
                    <ChevronRight className="h-3 w-3" aria-hidden />
                  </span>
                </div>
              </button>
            );
          })}
      </div>
    </section>
  );
}
