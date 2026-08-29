/**
 * 视频墙清单 API
 * GET    /api/videos        获取清单（count / layout / slots）
 * PATCH  /api/videos        更新某位置的标题 { slot, title }
 * DELETE /api/videos?slot=n 移除某位置的视频（连同文件）
 * DELETE /api/videos?all=1  清空全部视频（保留数量与矩阵设置）
 */
import { NextRequest, NextResponse } from 'next/server';
import { readManifest, writeManifest, deleteVideoFile, withManifestLock } from '@/lib/video-store';
import { TITLE_MAX } from '@/lib/types';

export const dynamic = 'force-dynamic';

const noStore = { 'Cache-Control': 'no-store' } as const;

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400, headers: noStore });
}

export async function GET() {
  const manifest = await readManifest();
  return NextResponse.json(manifest, { headers: noStore });
}

export async function PATCH(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as
    | { slot?: unknown; title?: unknown }
    | null;
  if (!body) return badRequest('请求体格式错误');
  const title = body.title;
  if (typeof title !== 'string') return badRequest('标题格式错误');

  return withManifestLock(async () => {
    const manifest = await readManifest();
    const slot = body.slot;
    if (
      typeof slot !== 'number' ||
      !Number.isInteger(slot) ||
      slot < 0 ||
      slot >= manifest.count
    ) {
      return badRequest('无效的视频位置');
    }

    manifest.slots[slot].title = title.trim().slice(0, TITLE_MAX);
    await writeManifest(manifest);
    return NextResponse.json(manifest, { headers: noStore });
  });
}

export async function DELETE(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;

  return withManifestLock(async () => {
    const manifest = await readManifest();

    if (searchParams.get('all') === '1') {
      await Promise.all(
        manifest.slots
          .filter((s) => s.video)
          .map((s) => deleteVideoFile(s.video!.filename)),
      );
      const cleared = {
        ...manifest,
        slots: manifest.slots.map((s) => ({ index: s.index, title: '', video: null })),
      };
      await writeManifest(cleared);
      return NextResponse.json(cleared, { headers: noStore });
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
      await deleteVideoFile(target.video.filename);
    }
    target.video = null;
    target.title = '';
    await writeManifest(manifest);
    return NextResponse.json(manifest, { headers: noStore });
  });
}
