/**
 * 项目集合 API（schema v2）
 * GET  /api/projects  项目列表（摘要：id/name/status/时间/内容构成计数，不含 items 明细）
 * POST /api/projects  新建项目 { name? } → 201 + 项目
 */
import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { listProjectIds, readProject, writeProject, withProjectLock } from '@/lib/project-store';
import { SLOT_MIN, defaultLayoutFor, defaultSettings, toProjectSummary } from '@/lib/types';

export const dynamic = 'force-dynamic';

const noStore = {
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
} as const;

export async function GET() {
  const ids = await listProjectIds();
  const projects = await Promise.all(ids.map((id) => readProject(id)));
  // 返回摘要而非完整项目：列表消费方（切换器徽标 / 库卡片 / 幽灵项目校验）
  // 只需要名称、状态与内容构成计数；完整 items 逐条归一化的读放大随项目数增长
  return NextResponse.json(projects.map(toProjectSummary), { headers: noStore });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { name?: unknown } | null;
  const name =
    typeof body?.name === 'string' && body.name.trim()
      ? body.name.trim().slice(0, 100)
      : '新建项目';

  const id = randomUUID();
  const now = new Date().toISOString();
  // 新项目从 1 个空框开始：上传几个内容，前端自动扩到几格（用户预期「上传几个显示几个」，
  // 不再一上来就摆 6 个空框）；后续上传由前端 distributeFiles 按需扩容
  const slotCount = SLOT_MIN;
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
