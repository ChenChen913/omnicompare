/**
 * 项目设置 API（schema v2）
 * PATCH /api/projects/[id]/settings
 * body: 任意 settings 字段（aspectRatio / customRatio / showTitles / ... 见 settings-schema 规格表）
 * 全局比例 / 标题与属性信息显隐 / 批量播放设置（只作用于 kind=video 的条目，见 BLUEPRINT §9/§13）
 *
 * 字段校验收口于 src/lib/settings-schema.ts（与 v1 路由、存储归一化共用同一份规格表）。
 */
import { NextRequest, NextResponse } from 'next/server';
import { readProject, withProjectLock, writeProject } from '@/lib/project-store';
import { resolveProjectId } from '@/lib/v2-project-param';
import { parseSettingsPatch } from '@/lib/settings-schema';

export const dynamic = 'force-dynamic';

const noStore = {
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
} as const;

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const resolved = await resolveProjectId(id);
  if (resolved.error) return resolved.error;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: '请求体格式错误' }, { status: 400, headers: noStore });

  const parsed = parseSettingsPatch(body);
  if ('error' in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400, headers: noStore });
  }
  const { patch, clearCustomRatio } = parsed;

  return withProjectLock(id, async () => {
    const project = await readProject(id);
    project.settings = { ...project.settings, ...patch };
    if (clearCustomRatio) delete project.settings.customRatio;
    project.updatedAt = new Date().toISOString();
    await writeProject(project);
    return NextResponse.json(project, { headers: noStore });
  });
}
