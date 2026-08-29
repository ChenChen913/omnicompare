/**
 * 批量排序 API（schema v2，拖拽排序，蓝图 §14）
 * PATCH /api/projects/[id]/items/reorder  { orderedIds: string[] }
 * - orderedIds 为完整的新顺序（须恰好覆盖该项目当前全部条目，服务端严格校验）
 * - applyReorder 按 id 重排并保证 order 0..n-1 紧凑无空洞（蓝图 §19.4）
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  applyReorder,
  isValidId,
  readProject,
  withProjectLock,
  writeProject,
} from '@/lib/project-store';

export const dynamic = 'force-dynamic';

const noStore = { 'Cache-Control': 'no-store' } as const;

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  if (!isValidId(id)) {
    return NextResponse.json({ error: '无效的项目 id' }, { status: 400, headers: noStore });
  }

  const body = (await req.json().catch(() => null)) as { orderedIds?: unknown } | null;
  if (!body || !Array.isArray(body.orderedIds) || body.orderedIds.some((x) => typeof x !== 'string')) {
    return NextResponse.json(
      { error: '请求体需为 { orderedIds: string[] }' },
      { status: 400, headers: noStore },
    );
  }
  const orderedIds = body.orderedIds as string[];

  return withProjectLock(id, async () => {
    const project = await readProject(id);

    // 严格校验：恰好覆盖全部条目（防静默丢条目 / 防未知 id 混入 / 防重复 id）
    const currentIds = new Set(project.items.map((it) => it.id));
    if (orderedIds.length !== project.items.length) {
      return NextResponse.json(
        { error: 'orderedIds 数量与内容条目数不一致' },
        { status: 400, headers: noStore },
      );
    }
    if (new Set(orderedIds).size !== orderedIds.length) {
      return NextResponse.json({ error: 'orderedIds 存在重复' }, { status: 400, headers: noStore });
    }
    for (const oid of orderedIds) {
      if (!currentIds.has(oid)) {
        return NextResponse.json({ error: `未知条目 id：${oid.slice(0, 8)}…` }, { status: 400, headers: noStore });
      }
    }

    project.items = applyReorder(project.items, orderedIds);
    project.updatedAt = new Date().toISOString();
    await writeProject(project);

    return NextResponse.json({ items: project.items }, { headers: noStore });
  });
}
