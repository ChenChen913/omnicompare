/**
 * 项目设置 API（schema v2）
 * PATCH /api/projects/[id]/settings
 * body: { aspectRatio?, customRatio?, showTitles?, showInfo?, loop?, muted?, playbackRate?, letterboxFill?, wallScale?, htmlScale?, autoFit?, titleAlign?, titleFontSize?, titlePosition?, titleWeight?, titleColor? }
 * 全局比例 / 标题与属性信息显隐 / 批量播放设置（只作用于 kind=video 的条目，见 BLUEPRINT §9/§13）
 */
import { NextRequest, NextResponse } from 'next/server';
import { readProject, withProjectLock, writeProject } from '@/lib/project-store';
import { resolveProjectId } from '@/lib/v2-project-param';
import {
  ASPECT_RATIOS,
  CUSTOM_RATIO_MAX,
  LETTERBOX_FILLS,
  PLAYBACK_RATES,
  AspectRatio,
  ProjectSettings,
  SCALE_STEPS,
  TITLE_ALIGNS,
  TITLE_FONT_MAX,
  TITLE_FONT_MIN,
  TITLE_POSITIONS,
  TITLE_WEIGHTS,
  parseCustomRatio,
  parseScaleOption,
  parseTitleColor,
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
    if (body.showIndex !== undefined) {
      if (typeof body.showIndex !== 'boolean') {
        return NextResponse.json({ error: '编号显隐需为布尔值' }, { status: 400, headers: noStore });
      }
      s.showIndex = body.showIndex;
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
      if (
        typeof body.letterboxFill !== 'string' ||
        !(LETTERBOX_FILLS as readonly string[]).includes(body.letterboxFill)
      ) {
        return NextResponse.json(
          { error: `留白填充需为 ${LETTERBOX_FILLS.join(' / ')}` },
          { status: 400, headers: noStore },
        );
      }
      s.letterboxFill = body.letterboxFill as ProjectSettings['letterboxFill'];
    }
    if (body.wallScale !== undefined) {
      const scale = parseScaleOption(body.wallScale);
      if (scale === null) {
        return NextResponse.json(
          { error: `整体大小需为 ${SCALE_STEPS.join(' / ')} 之一` },
          { status: 400, headers: noStore },
        );
      }
      s.wallScale = scale;
    }
    if (body.htmlScale !== undefined) {
      const scale = parseScaleOption(body.htmlScale);
      if (scale === null) {
        return NextResponse.json(
          { error: `页面缩放需为 ${SCALE_STEPS.join(' / ')} 之一` },
          { status: 400, headers: noStore },
        );
      }
      s.htmlScale = scale;
    }
    if (body.autoFit !== undefined) {
      if (typeof body.autoFit !== 'boolean') {
        return NextResponse.json({ error: '自动适配需为布尔值' }, { status: 400, headers: noStore });
      }
      s.autoFit = body.autoFit;
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
    if (body.titlePosition !== undefined) {
      if (
        typeof body.titlePosition !== 'string' ||
        !(TITLE_POSITIONS as readonly string[]).includes(body.titlePosition)
      ) {
        return NextResponse.json(
          { error: `标题位置需为 ${TITLE_POSITIONS.join(' / ')}` },
          { status: 400, headers: noStore },
        );
      }
      s.titlePosition = body.titlePosition as ProjectSettings['titlePosition'];
    }
    if (body.titleWeight !== undefined) {
      if (
        typeof body.titleWeight !== 'string' ||
        !(TITLE_WEIGHTS as readonly string[]).includes(body.titleWeight)
      ) {
        return NextResponse.json(
          { error: `标题字重需为 ${TITLE_WEIGHTS.join(' / ')}` },
          { status: 400, headers: noStore },
        );
      }
      s.titleWeight = body.titleWeight as ProjectSettings['titleWeight'];
    }
    if (body.titleColor !== undefined) {
      const color = parseTitleColor(body.titleColor);
      if (color === null) {
        return NextResponse.json(
          { error: '标题颜色需为 default 或色板内颜色值' },
          { status: 400, headers: noStore },
        );
      }
      s.titleColor = color;
    }

    project.updatedAt = new Date().toISOString();
    await writeProject(project);
    return NextResponse.json(project, { headers: noStore });
  });
}
