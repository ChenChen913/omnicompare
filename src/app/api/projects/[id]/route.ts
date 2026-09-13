/**
 * 单项目 API（schema v2）
 * GET    /api/projects/[id]  项目详情（含 items）
 * PATCH  /api/projects/[id]  { name?, status? }（status: active | draft | archived）
 * DELETE /api/projects/[id]  删除项目（默认项目受保护，禁止删除）
 *
 * 项目必须已存在（默认项目走幂等迁移）——不存在的 id 一律 404，
 * 绝不因为 readProject 的兜底默认值而凭空造出项目目录。
 */
import { NextRequest, NextResponse } from 'next/server';
import { promises as fsp } from 'fs';
import { projectDir, readProject, withProjectLock, writeProject } from '@/lib/project-store';
import { resolveProjectId } from '@/lib/v2-project-param';
import { DEFAULT_PROJECT_ID } from '@/lib/types';

export const dynamic = 'force-dynamic';

const noStore = { 'Cache-Control': 'no-store' } as const;

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const resolved = await resolveProjectId(id);
  if (resolved.error) return resolved.error;

  const project = await readProject(id);
  return NextResponse.json(project, { headers: noStore });
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const resolved = await resolveProjectId(id);
  if (resolved.error) return resolved.error;

  const body = (await req.json().catch(() => null)) as
    | { name?: unknown; status?: unknown }
    | null;
  if (!body) return NextResponse.json({ error: '请求体格式错误' }, { status: 400, headers: noStore });

  return withProjectLock(id, async () => {
    const project = await readProject(id);
    if (typeof body.name === 'string') {
      const name = body.name.trim().slice(0, 100);
      if (!name) return NextResponse.json({ error: '项目名不能为空' }, { status: 400, headers: noStore });
      project.name = name;
    }
    if (body.status !== undefined) {
      if (body.status !== 'active' && body.status !== 'draft' && body.status !== 'archived') {
        return NextResponse.json({ error: '无效的项目状态' }, { status: 400, headers: noStore });
      }
      project.status = body.status;
    }
    project.updatedAt = new Date().toISOString();
    await writeProject(project);
    return NextResponse.json(project, { headers: noStore });
  });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  if (id === DEFAULT_PROJECT_ID) {
    return NextResponse.json({ error: '默认项目不可删除' }, { status: 403, headers: noStore });
  }
  const resolved = await resolveProjectId(id);
  if (resolved.error) return resolved.error;

  await withProjectLock(id, async () => {
    await fsp.rm(projectDir(id), { recursive: true, force: true });
  });
  return NextResponse.json({ ok: true }, { headers: noStore });
}
