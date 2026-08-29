/**
 * 布局 API（schema v2）
 * PATCH /api/projects/[id]/layout
 * body: { mode: 'auto' } 或 { rows, cols }（显式矩阵，容量需 >= max(slotCount, items.length)）
 * - Auto Layout：cols = ceil(sqrt(n))，rows = ceil(n / cols)（BLUEPRINT §12，渲染层同样可实现）
 * - 显式矩阵沿用 v1 强校验风格
 */
import { NextRequest, NextResponse } from 'next/server';
import { isValidId, readProject, withProjectLock, writeProject } from '@/lib/project-store';
import { SLOT_MAX, SLOT_MIN } from '@/lib/types';

export const dynamic = 'force-dynamic';

const noStore = { 'Cache-Control': 'no-store' } as const;

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  if (!isValidId(id)) return NextResponse.json({ error: '无效的项目 id' }, { status: 400, headers: noStore });

  const body = (await req.json().catch(() => null)) as
    | { mode?: unknown; rows?: unknown; cols?: unknown }
    | null;
  if (!body) return NextResponse.json({ error: '请求体格式错误' }, { status: 400, headers: noStore });

  return withProjectLock(id, async () => {
    const project = await readProject(id);
    const effectiveCount = Math.max(project.slotCount, project.items.length);

    if (body.mode === 'auto') {
      project.layout = 'auto';
    } else {
      const rows = body.rows;
      const cols = body.cols;
      if (
        typeof rows !== 'number' ||
        typeof cols !== 'number' ||
        !Number.isInteger(rows) ||
        !Number.isInteger(cols) ||
        rows < SLOT_MIN ||
        rows > SLOT_MAX ||
        cols < SLOT_MIN ||
        cols > SLOT_MAX
      ) {
        return NextResponse.json(
          { error: `行列需为 ${SLOT_MIN}-${SLOT_MAX} 之间的整数` },
          { status: 400, headers: noStore },
        );
      }
      if (rows * cols < effectiveCount) {
        return NextResponse.json(
          { error: '排列矩阵容量不小于当前内容数量与窗格数' },
          { status: 400, headers: noStore },
        );
      }
      project.layout = { rows, cols };
    }

    project.updatedAt = new Date().toISOString();
    await writeProject(project);
    return NextResponse.json(project, { headers: noStore });
  });
}
