/**
 * 条目上传 API（schema v2）
 * POST /api/projects/[id]/items/upload
 * multipart: file（必填）、order（可选 0..n，插入位置，缺省追加到末尾）、title（可选）
 * kind 由服务端按 MIME + 扩展名双判（video / html），HTML 限 ≤10MB
 */
import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import {
  ensureDefaultProject,
  isValidId,
  readProject,
  saveFile,
  validateUploadFile,
  withProjectLock,
  writeProject,
} from '@/lib/project-store';
import { ContentItem, TITLE_MAX } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const noStore = { 'Cache-Control': 'no-store' } as const;

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  if (!isValidId(id)) return NextResponse.json({ error: '无效的项目 id' }, { status: 400, headers: noStore });
  await ensureDefaultProject();

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
    const insertAt = hasOrder ? Math.min(Math.max(order, 0), project.items.length) : project.items.length;

    const meta = await saveFile(id, file, checked.kind);
    const now = new Date().toISOString();
    const item =
      checked.kind === 'html'
        ? ({
            id: randomUUID(),
            kind: 'html',
            title,
            order: insertAt,
            aspectRatio: null,
            createdAt: now,
            updatedAt: now,
            file: meta,
            status: 'ready',
          } as ContentItem)
        : ({
            id: randomUUID(),
            kind: 'video',
            title,
            order: insertAt,
            aspectRatio: null,
            createdAt: now,
            updatedAt: now,
            file: meta,
          } as ContentItem);

    project.items.splice(insertAt, 0, item);
    project.items = project.items.map((it, i) => (it.order === i ? it : { ...it, order: i }));
    project.updatedAt = now;
    await writeProject(project);

    return NextResponse.json({ item, items: project.items }, { status: 201, headers: noStore });
  });
}
