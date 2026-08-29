/**
 * 内容数量与排列矩阵 API
 * PATCH /api/videos/layout  { count, rows, cols } 或 { count, layout: 'auto' }
 * - count: 1-12；rows × cols 为矩阵，容量需 >= count（多出的格子留空）
 * - layout='auto'：交给系统按 count 自动排近方形矩阵（蓝图 §12），后续 count
 *   变化时矩阵自动跟随；显式行列则固定为手动模式
 * - 缩减数量时自动删除被移除位置上的内容文件
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
import { SLOT_MAX, SLOT_MIN, autoLayoutFor } from '@/lib/types';
import { resolveProjectParam } from '@/lib/v1-project-param';

export const dynamic = 'force-dynamic';

const noStore = { 'Cache-Control': 'no-store' } as const;

export async function PATCH(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as
    | { count?: unknown; rows?: unknown; cols?: unknown; layout?: unknown }
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
      { error: `内容数量需为 ${SLOT_MIN}-${SLOT_MAX} 之间的整数` },
      { status: 400, headers: noStore },
    );
  }

  // 两种模式二选一：layout='auto'（自动矩阵）或显式 rows+cols（手动矩阵）
  const wantAuto = body.layout === 'auto';
  const layout = wantAuto ? autoLayoutFor(count) : { rows: body.rows as number, cols: body.cols as number };
  if (!wantAuto && !isValidLayout(layout, count)) {
    return NextResponse.json(
      { error: '排列矩阵不合法：行列需为整数且容量不小于内容数量' },
      { status: 400, headers: noStore },
    );
  }

  const p = await resolveProjectParam(req);
  if (p.error) return p.error;

  return withManifestLock(p.id, async () => {
    const current = await readManifest(p.id);
    const { manifest: next, removedFilenames } = applyCountAndLayout(current, count, layout);
    next.layoutMode = wantAuto ? 'auto' : 'manual';
    await writeManifest(next, p.id);

    if (removedFilenames.length > 0) {
      await Promise.all(removedFilenames.map((f) => deleteVideoFile(f, p.id)));
    }
    // 重读返回：写入层会做紧凑序重排（v2 不变量），保证客户端视图与存储一致
    return NextResponse.json(await readManifest(p.id), { headers: noStore });
  });
}
