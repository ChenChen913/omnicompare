/**
 * 项目设置 API（schema v2）
 * PATCH /api/projects/[id]/settings
 * body: { aspectRatio?, customRatio?, showTitles?, showInfo?, loop?, muted?, playbackRate?, letterboxFill?, titleAlign?, titleFontSize? }
 * 全局比例 / 标题与属性信息显隐 / 批量播放设置（只作用于 kind=video 的条目，见 BLUEPRINT §9/§13）
 */
import { NextRequest, NextResponse } from 'next/server';
import { readProject, withProjectLock, writeProject } from '@/lib/project-store';
import { resolveProjectId } from '@/lib/v2-project-param';
import {
  ASPECT_RATIOS,
  CUSTOM_RATIO_MAX,
  PLAYBACK_RATES,
  AspectRatio,
  ProjectSettings,
  TITLE_ALIGNS,
  TITLE_FONT_MAX,
  TITLE_FONT_MIN,
  parseCustomRatio,
  parseTitleFontSize,
} from '@/lib/types';

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

  return withProjectLock(id, async () => {
    const project = await readProject(id);
    const s = project.settings;

    if (body.aspectRatio !== undefined) {
      if (
        typeof body.aspectRatio !== 'string' ||
        !(ASPECT_RATIOS as readonly string[]).includes(body.aspectRatio)
      ) {
        return NextResponse.json(
          { error: `比例取值需为 ${ASPECT_RATIOS.join(' / ')}` },
          { status: 400, headers: noStore },
        );
      }
      s.aspectRatio = body.aspectRatio as AspectRatio;
    }
    if (body.customRatio !== undefined) {
      if (body.customRatio === null) {
        delete s.customRatio;
      } else {
        const parsed = parseCustomRatio(body.customRatio);
        if (!parsed) {
          return NextResponse.json(
            { error: `自定义比例需为 0-${CUSTOM_RATIO_MAX} 之间的正数宽高` },
            { status: 400, headers: noStore },
          );
        }
        s.customRatio = parsed;
      }
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
      if (
        typeof body.playbackRate !== 'number' ||
        !(PLAYBACK_RATES as readonly number[]).includes(body.playbackRate)
      ) {
        return NextResponse.json(
          { error: `播放速度仅支持 ${PLAYBACK_RATES.join(' / ')}` },
          { status: 400, headers: noStore },
        );
      }
      s.playbackRate = body.playbackRate;
    }
    if (body.letterboxFill !== undefined) {
      if (body.letterboxFill !== 'base' && body.letterboxFill !== 'blur') {
        return NextResponse.json({ error: '留白填充需为 base / blur' }, { status: 400, headers: noStore });
      }
      s.letterboxFill = body.letterboxFill;
    }
    if (body.titleAlign !== undefined) {
      if (
        typeof body.titleAlign !== 'string' ||
        !(TITLE_ALIGNS as readonly string[]).includes(body.titleAlign)
      ) {
        return NextResponse.json(
          { error: `标题对齐需为 ${TITLE_ALIGNS.join(' / ')}` },
          { status: 400, headers: noStore },
        );
      }
      s.titleAlign = body.titleAlign as ProjectSettings['titleAlign'];
    }
    if (body.titleFontSize !== undefined) {
      const size = parseTitleFontSize(body.titleFontSize);
      if (size === null) {
        return NextResponse.json(
          { error: `标题字号需为 ${TITLE_FONT_MIN}-${TITLE_FONT_MAX} 之间的数字` },
          { status: 400, headers: noStore },
        );
      }
      s.titleFontSize = size;
    }

    project.updatedAt = new Date().toISOString();
    await writeProject(project);
    return NextResponse.json(project, { headers: noStore });
  });
}
