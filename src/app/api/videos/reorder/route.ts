/**
 * 内容排序 API（拖拽排序，蓝图 §14）
 * PATCH /api/videos/reorder  { order: number[] }
 * - order 为「新位置 → 旧位置」的映射数组，长度必须等于当前内容条目数，
 *   且为 0..n-1 的一个排列（服务端严格校验）
 * - 服务端按 id 锚点重排 items.order（不重建条目），文件与标题跟随内容移动
 * - 与其它 v1 写路径共用清单互斥锁，杜绝并发丢更新
 */
import { NextRequest, NextResponse } from 'next/server';
import { applyReorder, readProject, withProjectLock, writeProject } from '@/lib/project-store';
import { DEFAULT_PROJECT_ID } from '@/lib/types';
import { readManifest } from '@/lib/video-store';

export const dynamic = 'force-dynamic';

const noStore = { 'Cache-Control': 'no-store' } as const;

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400, headers: noStore });
}

export async function PATCH(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { order?: unknown } | null;
  if (!body || !Array.isArray(body.order)) {
    return badRequest('请求体需为 { order: number[] }');
  }
  const order = body.order;

  return withProjectLock(DEFAULT_PROJECT_ID, async () => {
    const project = await readProject(DEFAULT_PROJECT_ID);
    const items = project.items;

    // 严格排列校验：长度一致 + 元素为 0..n-1 的整数且互不重复
    if (order.length !== items.length) {
      return badRequest('排序数组长度与内容条目数不一致');
    }
    const seen = new Set<number>();
    for (const idx of order) {
      if (
        typeof idx !== 'number' ||
        !Number.isInteger(idx) ||
        idx < 0 ||
        idx >= items.length ||
        seen.has(idx)
      ) {
        return badRequest('排序数组必须是 0..n-1 的一个排列');
      }
      seen.add(idx);
    }
    if (items.length === 0) {
      // 空项目 + 空数组：无变化，直接返回当前视图
      return NextResponse.json(await readManifest(), { headers: noStore });
    }

    // 按 id 锚点重排：id 全生命周期不变，order 决定矩阵位置（蓝图 §6）
    const orderedIds = order.map((i) => items[i].id);
    project.items = applyReorder(items, orderedIds);
    project.updatedAt = new Date().toISOString();
    await writeProject(project);

    // 重读返回：保证客户端视图与存储一致
    return NextResponse.json(await readManifest(), { headers: noStore });
  });
}
