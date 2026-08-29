/**
 * 项目集合 API（schema v2）
 * GET  /api/projects  项目列表
 * POST /api/projects  新建项目 { name? } → 201 + 项目
 */
import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { listProjectIds, readProject, writeProject, withProjectLock } from '@/lib/project-store';
import { SLOT_MAX, SLOT_MIN, defaultLayoutFor, defaultSettings } from '@/lib/types';

export const dynamic = 'force-dynamic';

const noStore = { 'Cache-Control': 'no-store' } as const;

export async function GET() {
  const ids = await listProjectIds();
  const projects = await Promise.all(ids.map((id) => readProject(id)));
  return NextResponse.json(projects, { headers: noStore });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { name?: unknown } | null;
  const name =
    typeof body?.name === 'string' && body.name.trim()
      ? body.name.trim().slice(0, 100)
      : '新建项目';

  const id = randomUUID();
  const now = new Date().toISOString();
  const slotCount = Math.min(Math.max(6, SLOT_MIN), SLOT_MAX);
  const project = await withProjectLock(id, async () => {
    const p = {
      id,
      name,
      status: 'active' as const,
      items: [],
      layout: defaultLayoutFor(slotCount),
      slotCount,
      settings: defaultSettings(),
      createdAt: now,
      updatedAt: now,
    };
    await writeProject(p);
    return p;
  });

  return NextResponse.json(project, { status: 201, headers: noStore });
}
