/**
 * 项目级播放与展示设置 API（v1 视图，蓝图 §7/§9/§13；Step 8 起支持 ?project= 多项目）
 * PATCH /api/videos/settings[?project=id]  { aspectRatio?, showTitles?, showInfo?, loop?, muted?, playbackRate?, letterboxFill? }
 * - 全部字段可选，仅更新提供的字段；播放设置只作用于 kind=video 的内容
 * - 与其它 v1 写路径共用清单互斥锁，杜绝并发丢更新
 * - 成功返回更新后的完整 v1 清单视图（响应即回填）
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  ASPECT_RATIOS,
  AspectRatio,
  CUSTOM_RATIO_MAX,
  PLAYBACK_RATES,
  ProjectSettings,
  parseCustomRatio,
} from '@/lib/types';
import { readProject, withProjectLock, writeProject } from '@/lib/project-store';
import { readManifest } from '@/lib/video-store';
import { resolveProjectParam } from '@/lib/v1-project-param';

export const dynamic = 'force-dynamic';

const noStore = {
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
} as const;

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400, headers: noStore });
}

export async function PATCH(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as
    | { aspectRatio?: unknown; customRatio?: unknown; showTitles?: unknown; showInfo?: unknown; loop?: unknown; muted?: unknown; playbackRate?: unknown; letterboxFill?: unknown }
    | null;
  if (!body) return badRequest('请求体格式错误');

  const patch: Partial<ProjectSettings> = {};
  /** customRatio=null 的"显式清除"标记：undefined 无法区分"未提供"与"清除" */
  let clearCustomRatio = false;
  if (body.aspectRatio !== undefined) {
    if (
      typeof body.aspectRatio !== 'string' ||
      !(ASPECT_RATIOS as readonly string[]).includes(body.aspectRatio)
    ) {
      return badRequest(`比例取值需为 ${ASPECT_RATIOS.join(' / ')}`);
    }
    patch.aspectRatio = body.aspectRatio as AspectRatio;
  }
  if (body.customRatio !== undefined) {
    if (body.customRatio === null) {
      // null = 显式清除自定义比例
      patch.customRatio = undefined;
      clearCustomRatio = true;
    } else {
      const parsed = parseCustomRatio(body.customRatio);
      if (!parsed) return badRequest(`自定义比例需为 0-${CUSTOM_RATIO_MAX} 之间的正数宽高`);
      patch.customRatio = parsed;
    }
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
    if (
      typeof body.playbackRate !== 'number' ||
      !(PLAYBACK_RATES as readonly number[]).includes(body.playbackRate)
    ) {
      return badRequest(`播放速度需为 ${PLAYBACK_RATES.join(' / ')}`);
    }
    patch.playbackRate = body.playbackRate;
  }
  if (body.letterboxFill !== undefined) {
    if (body.letterboxFill !== 'base' && body.letterboxFill !== 'blur') {
      return badRequest('留白填充需为 base / blur');
    }
    patch.letterboxFill = body.letterboxFill;
  }
  if (Object.keys(patch).length === 0 && !clearCustomRatio) {
    return badRequest('至少提供一个待更新字段');
  }

  const p = await resolveProjectParam(req);
  if (p.error) return p.error;

  return withProjectLock(p.id, async () => {
    // readProject 内部已保证默认项目的幂等迁移，这里无需重复调用
    const project = await readProject(p.id);
    project.settings = { ...project.settings, ...patch };
    if (clearCustomRatio) delete project.settings.customRatio;
    project.updatedAt = new Date().toISOString();
    await writeProject(project);
    return NextResponse.json(await readManifest(p.id), { headers: noStore });
  });
}
