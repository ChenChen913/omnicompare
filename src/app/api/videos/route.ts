/**
 * 视频墙清单 API（v1 视图，Step 8 起支持 ?project= 多项目）
 * GET    /api/videos[?project=id]        获取清单（count / layout / slots / settings）
 * PATCH  /api/videos[?project=id]        更新某位置 { slot, title?, aspectRatio? }（至少一项；
 *                           aspectRatio 为单卡比例覆盖，null = 恢复跟随全局，蓝图 §13）
 * DELETE /api/videos?slot=n[&project=id]  移除某位置的内容（连同文件）
 * DELETE /api/videos?all=1[&project=id]   清空全部内容（保留数量与矩阵设置）
 */
import { NextRequest, NextResponse } from 'next/server';
import { readManifest, writeManifest, deleteVideoFile, withManifestLock } from '@/lib/video-store';
import { resolveProjectParam } from '@/lib/v1-project-param';
import { AspectRatio, TITLE_MAX } from '@/lib/types';

export const dynamic = 'force-dynamic';

const noStore = { 'Cache-Control': 'no-store' } as const;

const ASPECTS: AspectRatio[] = ['16:9', '9:16', '1:1', 'original', 'custom'];

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400, headers: noStore });
}

export async function GET(req: NextRequest) {
  const p = await resolveProjectParam(req);
  if (p.error) return p.error;
  const manifest = await readManifest(p.id);
  return NextResponse.json(manifest, { headers: noStore });
}

export async function PATCH(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as
    | { slot?: unknown; title?: unknown; aspectRatio?: unknown }
    | null;
  if (!body) return badRequest('请求体格式错误');
  if (body.title === undefined && body.aspectRatio === undefined) {
    return badRequest('至少提供 title 或 aspectRatio 之一');
  }

  // 单卡比例覆盖：null = 恢复跟随全局；否则必须为合法比例选项
  let aspect: AspectRatio | null | undefined;
  if (body.aspectRatio !== undefined) {
    if (body.aspectRatio === null) {
      aspect = null;
    } else if (
      typeof body.aspectRatio === 'string' &&
      ASPECTS.includes(body.aspectRatio as AspectRatio)
    ) {
      aspect = body.aspectRatio as AspectRatio;
    } else {
      return badRequest('比例取值需为 16:9 / 9:16 / 1:1 / original / custom 或 null');
    }
  }

  const title = body.title;
  if (title !== undefined && typeof title !== 'string') return badRequest('标题格式错误');

  const p = await resolveProjectParam(req);
  if (p.error) return p.error;

  return withManifestLock(p.id, async () => {
    const manifest = await readManifest(p.id);
    const slot = body.slot;
    if (
      typeof slot !== 'number' ||
      !Number.isInteger(slot) ||
      slot < 0 ||
      slot >= manifest.count
    ) {
      return badRequest('无效的视频位置');
    }

    if (typeof title === 'string') {
      manifest.slots[slot].title = title.trim().slice(0, TITLE_MAX);
    }
    if (aspect !== undefined) {
      manifest.slots[slot].aspectRatio = aspect;
    }
    await writeManifest(manifest, p.id);
    // 重读返回：写入层会做紧凑序重排（v2 不变量），保证客户端视图与存储一致
    return NextResponse.json(await readManifest(p.id), { headers: noStore });
  });
}

export async function DELETE(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  const p = await resolveProjectParam(req);
  if (p.error) return p.error;

  return withManifestLock(p.id, async () => {
    const manifest = await readManifest(p.id);

    if (searchParams.get('all') === '1') {
      await Promise.all(
        manifest.slots
          .filter((s) => s.video)
          .map((s) => deleteVideoFile(s.video!.filename, p.id)),
      );
      const cleared = {
        ...manifest,
        slots: manifest.slots.map((s) => ({ index: s.index, title: '', video: null })),
      };
      await writeManifest(cleared, p.id);
      return NextResponse.json(await readManifest(p.id), { headers: noStore });
    }

    const slot = Number(searchParams.get('slot'));
    if (
      !Number.isInteger(slot) ||
      slot < 0 ||
      slot >= manifest.count
    ) {
      return badRequest('无效的视频位置');
    }

    const target = manifest.slots[slot];
    if (target.video) {
      await deleteVideoFile(target.video.filename, p.id);
    }
    // 整槽归一化（同时清除 v1.5 扩展的 kind/html 字段）；
    // 被移除条目的文件（含 v1 视图不可见的 HTML）由 writeManifest 集中清理
    manifest.slots[slot] = { index: slot, title: '', video: null };
    await writeManifest(manifest, p.id);
    return NextResponse.json(await readManifest(p.id), { headers: noStore });
  });
}
