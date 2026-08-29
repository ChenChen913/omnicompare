/**
 * 条目清单 API（schema v2）
 * GET /api/projects/[id]/items  返回项目全部内容条目（order 紧凑 0..n-1）
 */
import { NextRequest, NextResponse } from 'next/server';
import { ensureDefaultProject, isValidId, readProject } from '@/lib/project-store';

export const dynamic = 'force-dynamic';

const noStore = { 'Cache-Control': 'no-store' } as const;

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  if (!isValidId(id)) return NextResponse.json({ error: '无效的项目 id' }, { status: 400, headers: noStore });
  await ensureDefaultProject();
  const project = await readProject(id);
  return NextResponse.json(project.items, { headers: noStore });
}
