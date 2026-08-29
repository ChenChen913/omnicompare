/**
 * 项目设置 API（schema v2）
 * PATCH /api/projects/[id]/settings
 * body: { aspectRatio?, customRatio?, showTitles?, showInfo?, loop?, muted?, playbackRate? }
 * 全局比例 / 标题与属性信息显隐 / 批量播放设置（只作用于 kind=video 的条目，见 BLUEPRINT §9/§13）
 */
import { NextRequest, NextResponse } from 'next/server';
import { isValidId, readProject, withProjectLock, writeProject } from '@/lib/project-store';
import { AspectRatio } from '@/lib/types';

export const dynamic = 'force-dynamic';

const noStore = { 'Cache-Control': 'no-store' } as const;

type Ctx = { params: Promise<{ id: string }> };

const ASPECTS: AspectRatio[] = ['16:9', '9:16', '1:1', 'original', 'custom'];
const RATES = [0.5, 1, 1.25, 1.5, 2];

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  if (!isValidId(id)) return NextResponse.json({ error: '无效的项目 id' }, { status: 400, headers: noStore });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: '请求体格式错误' }, { status: 400, headers: noStore });

  return withProjectLock(id, async () => {
    const project = await readProject(id);
    const s = project.settings;

    if (body.aspectRatio !== undefined) {
      if (typeof body.aspectRatio !== 'string' || !ASPECTS.includes(body.aspectRatio as AspectRatio)) {
        return NextResponse.json({ error: '无效的比例值' }, { status: 400, headers: noStore });
      }
      s.aspectRatio = body.aspectRatio as AspectRatio;
    }
    if (body.customRatio !== undefined) {
      if (
        body.customRatio === null ||
        typeof body.customRatio !== 'object' ||
        Number((body.customRatio as Record<string, unknown>).w) <= 0 ||
        Number((body.customRatio as Record<string, unknown>).h) <= 0
      ) {
        return NextResponse.json({ error: '无效的自定义比例' }, { status: 400, headers: noStore });
      }
      const c = body.customRatio as Record<string, unknown>;
      s.customRatio = { w: Number(c.w), h: Number(c.h) };
    }
    if (body.showTitles !== undefined) {
      if (typeof body.showTitles !== 'boolean') {
        return NextResponse.json({ error: '标题显隐需为布尔值' }, { status: 400, headers: noStore });
      }
      s.showTitles = body.showTitles;
    }
    if (body.showInfo !== undefined) {
      if (typeof body.showInfo !== 'boolean') {
        return NextResponse.json({ error: '属性信息显隐需为布尔值' }, { status: 400, headers: noStore });
      }
      s.showInfo = body.showInfo;
    }
    if (body.loop !== undefined) {
      if (typeof body.loop !== 'boolean') {
        return NextResponse.json({ error: '循环开关需为布尔值' }, { status: 400, headers: noStore });
      }
      s.loop = body.loop;
    }
    if (body.muted !== undefined) {
      if (typeof body.muted !== 'boolean') {
        return NextResponse.json({ error: '静音开关需为布尔值' }, { status: 400, headers: noStore });
      }
      s.muted = body.muted;
    }
    if (body.playbackRate !== undefined) {
      if (typeof body.playbackRate !== 'number' || !RATES.includes(body.playbackRate)) {
        return NextResponse.json({ error: '播放速度仅支持 0.5 / 1 / 1.25 / 1.5 / 2' }, { status: 400, headers: noStore });
      }
      s.playbackRate = body.playbackRate;
    }

    project.updatedAt = new Date().toISOString();
    await writeProject(project);
    return NextResponse.json(project, { headers: noStore });
  });
}
