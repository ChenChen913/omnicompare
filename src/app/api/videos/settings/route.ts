/**
 * 项目级播放与展示设置 API（v1 视图，蓝图 §7/§9/§13）
 * PATCH /api/videos/settings  { aspectRatio?, showTitles?, showInfo?, loop?, muted?, playbackRate? }
 * - 全部字段可选，仅更新提供的字段；播放设置只作用于 kind=video 的内容
 * - 与其它 v1 写路径共用清单互斥锁，杜绝并发丢更新
 * - 成功返回更新后的完整 v1 清单视图（响应即回填）
 */
import { NextRequest, NextResponse } from 'next/server';
import { AspectRatio, DEFAULT_PROJECT_ID, ProjectSettings } from '@/lib/types';
import { ensureDefaultProject, readProject, withProjectLock, writeProject } from '@/lib/project-store';
import { readManifest } from '@/lib/video-store';

export const dynamic = 'force-dynamic';

const noStore = { 'Cache-Control': 'no-store' } as const;

const ASPECTS: AspectRatio[] = ['16:9', '9:16', '1:1', 'original', 'custom'];
const RATES = [0.5, 1, 1.25, 1.5, 2];

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400, headers: noStore });
}

export async function PATCH(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as
    | { aspectRatio?: unknown; showTitles?: unknown; showInfo?: unknown; loop?: unknown; muted?: unknown; playbackRate?: unknown }
    | null;
  if (!body) return badRequest('请求体格式错误');

  const patch: Partial<ProjectSettings> = {};
  if (body.aspectRatio !== undefined) {
    if (typeof body.aspectRatio !== 'string' || !ASPECTS.includes(body.aspectRatio as AspectRatio)) {
      return badRequest('比例取值需为 16:9 / 9:16 / 1:1 / original / custom');
    }
    patch.aspectRatio = body.aspectRatio as AspectRatio;
  }
  if (body.showTitles !== undefined) {
    if (typeof body.showTitles !== 'boolean') return badRequest('showTitles 需为布尔值');
    patch.showTitles = body.showTitles;
  }
  if (body.showInfo !== undefined) {
    if (typeof body.showInfo !== 'boolean') return badRequest('showInfo 需为布尔值');
    patch.showInfo = body.showInfo;
  }
  if (body.loop !== undefined) {
    if (typeof body.loop !== 'boolean') return badRequest('loop 需为布尔值');
    patch.loop = body.loop;
  }
  if (body.muted !== undefined) {
    if (typeof body.muted !== 'boolean') return badRequest('muted 需为布尔值');
    patch.muted = body.muted;
  }
  if (body.playbackRate !== undefined) {
    if (typeof body.playbackRate !== 'number' || !RATES.includes(body.playbackRate)) {
      return badRequest('播放速度需为 0.5 / 1 / 1.25 / 1.5 / 2');
    }
    patch.playbackRate = body.playbackRate;
  }
  if (Object.keys(patch).length === 0) {
    return badRequest('至少提供一个待更新字段');
  }

  return withProjectLock(DEFAULT_PROJECT_ID, async () => {
    await ensureDefaultProject();
    const project = await readProject(DEFAULT_PROJECT_ID);
    project.settings = { ...project.settings, ...patch };
    project.updatedAt = new Date().toISOString();
    await writeProject(project);
    return NextResponse.json(await readManifest(), { headers: noStore });
  });
}
