/**
 * 条目清单 API（schema v2）
 * GET /api/projects/[id]/items  返回项目全部内容条目（order 紧凑 0..n-1）
 */
import { NextRequest, NextResponse } from 'next/server';
import { readProject } from '@/lib/project-store';
import { resolveProjectId } from '@/lib/v2-project-param';

export const dynamic = 'force-dynamic';

const noStore = { 'Cache-Control': 'no-store' } as const;

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const resolved = await resolveProjectId(id);
  if (resolved.error) return resolved.error;

  const project = await readProject(id);
  return NextResponse.json(project.items, { headers: noStore });
}
