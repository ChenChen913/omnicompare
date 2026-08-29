/**
 * 单条目 API（schema v2）
 * PATCH  /api/projects/[id]/items/[itemId]  { title?, aspectRatio?, order? }
 * DELETE /api/projects/[id]/items/[itemId]  删除条目并清理文件，其余条目紧凑重排
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  deleteFile,
  ensureDefaultProject,
  isValidId,
  readProject,
  withProjectLock,
  writeProject,
} from '@/lib/project-store';
import { AspectRatio, TITLE_MAX } from '@/lib/types';

export const dynamic = 'force-dynamic';

const noStore = { 'Cache-Control': 'no-store' } as const;

type Ctx = { params: Promise<{ id: string; itemId: string }> };

const ASPECTS: AspectRatio[] = ['16:9', '9:16', '1:1', 'original', 'custom'];

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { id, itemId } = await params;
  if (!isValidId(id)) return NextResponse.json({ error: '无效的项目 id' }, { status: 400, headers: noStore });

  const body = (await req.json().catch(() => null)) as
    | { title?: unknown; aspectRatio?: unknown; order?: unknown }
    | null;
  if (!body) return NextResponse.json({ error: '请求体格式错误' }, { status: 400, headers: noStore });

  return withProjectLock(id, async () => {
    const project = await readProject(id);
    const item = project.items.find((it) => it.id === itemId);
    if (!item) return NextResponse.json({ error: '条目不存在' }, { status: 404, headers: noStore });

    if (typeof body.title === 'string') {
      item.title = body.title.trim().slice(0, TITLE_MAX);
    }
    if (body.aspectRatio !== undefined) {
      if (body.aspectRatio === null) {
        item.aspectRatio = null;
      } else if (
        typeof body.aspectRatio === 'string' &&
        ASPECTS.includes(body.aspectRatio as AspectRatio)
      ) {
        item.aspectRatio = body.aspectRatio as AspectRatio;
      } else {
        return NextResponse.json({ error: '无效的比例值' }, { status: 400, headers: noStore });
      }
    }
    if (body.order !== undefined) {
      if (
        typeof body.order !== 'number' ||
        !Number.isInteger(body.order) ||
        body.order < 0 ||
        body.order >= project.items.length
      ) {
        return NextResponse.json({ error: '无效的排序位置' }, { status: 400, headers: noStore });
      }
      const others = project.items.filter((it) => it.id !== itemId);
      others.splice(body.order, 0, item);
      project.items = others.map((it, i) => (it.order === i ? it : { ...it, order: i }));
    } else {
      item.updatedAt = new Date().toISOString();
    }

    project.updatedAt = new Date().toISOString();
    await writeProject(project);
    // 重排会以浅拷贝替换元素，回查最新引用，避免返回重排前的旧对象
    const updated = project.items.find((it) => it.id === itemId) ?? item;
    return NextResponse.json({ item: updated, items: project.items }, { headers: noStore });
  });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { id, itemId } = await params;
  if (!isValidId(id)) return NextResponse.json({ error: '无效的项目 id' }, { status: 400, headers: noStore });

  return withProjectLock(id, async () => {
    const project = await readProject(id);
    const index = project.items.findIndex((it) => it.id === itemId);
    if (index === -1) return NextResponse.json({ error: '条目不存在' }, { status: 404, headers: noStore });

    const [removed] = project.items.splice(index, 1);
    project.items = project.items.map((it, i) => (it.order === i ? it : { ...it, order: i }));
    project.updatedAt = new Date().toISOString();
    await writeProject(project);

    // 清单已落盘后再删文件：即便删除失败也不产生死链（下次写入自会校正）
    await deleteFile(id, removed.file.filename);
    return NextResponse.json({ items: project.items }, { headers: noStore });
  });
}
