/**
 * 视频数量与排列矩阵 API
 * PATCH /api/videos/layout  { count, rows, cols }
 * - count: 1-12；rows × cols 为矩阵，容量需 >= count（多出的格子留空）
 * - 缩减数量时自动删除被移除位置上的视频文件
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  applyCountAndLayout,
  deleteVideoFile,
  isValidLayout,
  readManifest,
  withManifestLock,
  writeManifest,
} from '@/lib/video-store';
import { SLOT_MAX, SLOT_MIN } from '@/lib/types';

export const dynamic = 'force-dynamic';

const noStore = { 'Cache-Control': 'no-store' } as const;

export async function PATCH(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as
    | { count?: unknown; rows?: unknown; cols?: unknown }
    | null;
  if (!body) {
    return NextResponse.json({ error: '请求体格式错误' }, { status: 400, headers: noStore });
  }

  const count = body.count;
  if (
    typeof count !== 'number' ||
    !Number.isInteger(count) ||
    count < SLOT_MIN ||
    count > SLOT_MAX
  ) {
    return NextResponse.json(
      { error: `视频数量需为 ${SLOT_MIN}-${SLOT_MAX} 之间的整数` },
      { status: 400, headers: noStore },
    );
  }

  const layout = { rows: body.rows as number, cols: body.cols as number };
  if (!isValidLayout(layout, count)) {
    return NextResponse.json(
      { error: '排列矩阵不合法：行列需为整数且容量不小于视频数量' },
      { status: 400, headers: noStore },
    );
  }

  return withManifestLock(async () => {
    const current = await readManifest();
    const { manifest: next, removedFilenames } = applyCountAndLayout(current, count, layout);
    await writeManifest(next);

    if (removedFilenames.length > 0) {
      await Promise.all(removedFilenames.map((f) => deleteVideoFile(f)));
    }
    // 重读返回：写入层会做紧凑序重排（v2 不变量），保证客户端视图与存储一致
    return NextResponse.json(await readManifest(), { headers: noStore });
  });
}
