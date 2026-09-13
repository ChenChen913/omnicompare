/**
 * 条目上传 API（schema v2）
 * POST /api/projects/[id]/items/upload
 * multipart: file（必填）、order（可选 0..n，插入位置，缺省追加到末尾）、title（可选）
 * kind 由服务端按 MIME + 扩展名双判（video / html / image；zip 解压为 bundle 型 html）
 *
 * 数量上限：条目数不得超过 SLOT_MAX（与 v1 的"内容位 1-12"是同一个上限）。
 * 上传后会把 slotCount 抬到条目数，保证 v1 视图（按 slotCount 输出槽位）
 * 永远看得见全部条目 —— 否则尾部条目对 v1 不可见，会被 v1 写路径当成已删除内容清理掉。
 */
import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import {
  readProject,
  saveBundle,
  saveFile,
  validateUploadFile,
  withProjectLock,
  writeProject,
} from '@/lib/project-store';
import { resolveProjectId } from '@/lib/v2-project-param';
import { ContentItem, SLOT_MAX, TITLE_MAX } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const noStore = { 'Cache-Control': 'no-store' } as const;

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const resolved = await resolveProjectId(id);
  if (resolved.error) return resolved.error;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: '无法解析上传内容，请重试' }, { status: 400, headers: noStore });
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: '缺少文件' }, { status: 400, headers: noStore });
  }
  const checked = validateUploadFile(file.name, file.type, file.size);
  if ('error' in checked) {
    return NextResponse.json({ error: checked.error }, { status: 400, headers: noStore });
  }

  const orderRaw = form.get('order');
  let hasOrder = false;
  let order = -1;
  if (typeof orderRaw === 'string' && /^\d{1,3}$/.test(orderRaw)) {
    hasOrder = true;
    order = Number(orderRaw);
  }
  const titleRaw = form.get('title');
  const title = typeof titleRaw === 'string' ? titleRaw.trim().slice(0, TITLE_MAX) : '';

  return withProjectLock(id, async () => {
    const project = await readProject(id);
    if (project.items.length >= SLOT_MAX) {
      return NextResponse.json(
        { error: `内容条目已达上限 ${SLOT_MAX} 个` },
        { status: 400, headers: noStore },
      );
    }
    const insertAt = hasOrder ? Math.min(Math.max(order, 0), project.items.length) : project.items.length;

    // zip 资源包（Step B）：解压校验 + 落盘在保存阶段完成，失败即整体拒绝
    let meta;
    try {
      meta = checked.bundle ? await saveBundle(id, file) : await saveFile(id, file, checked.kind);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'zip 包保存失败';
      return NextResponse.json({ error: message }, { status: 400, headers: noStore });
    }
    const now = new Date().toISOString();
    const base = {
      id: randomUUID(),
      title,
      order: insertAt,
      aspectRatio: null,
      createdAt: now,
      updatedAt: now,
    } as const;
    const item: ContentItem =
      checked.kind === 'html'
        ? {
            ...base,
            kind: 'html',
            file: meta,
            status: 'ready',
            ...(checked.bundle ? { bundle: true as const } : {}),
          }
        : checked.kind === 'image'
          ? { ...base, kind: 'image', file: meta }
          : { ...base, kind: 'video', file: meta };

    project.items.splice(insertAt, 0, item);
    project.items = project.items.map((it, i) => (it.order === i ? it : { ...it, order: i }));
    // 窗格数跟随条目数（不超过 SLOT_MAX）：v1 视图按 slotCount 输出槽位，
    // 小于条目数会让尾部条目对 v1 不可见，进而被 v1 写路径误删
    project.slotCount = Math.max(project.slotCount, project.items.length);
    project.updatedAt = now;
    await writeProject(project);

    return NextResponse.json({ item, items: project.items }, { status: 201, headers: noStore });
  });
}
