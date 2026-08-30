/**
 * 内容上传 API（视频或单文件 HTML；Step 8 起支持 ?project= 多项目）
 * POST /api/videos/upload[?project=id]  multipart: file=内容文件, slot=位置序号
 * kind 由服务端按 MIME + 扩展名双判（video / html，HTML 限 ≤10MB）；成功后返回最新清单
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  readManifest,
  writeManifest,
  saveContentFile,
  validateUploadFile,
  withManifestLock,
} from '@/lib/video-store';
import { resolveProjectParam } from '@/lib/v1-project-param';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const noStore = { 'Cache-Control': 'no-store' } as const;

export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: '无法解析上传内容，请重试' },
      { status: 400, headers: noStore },
    );
  }

  const file = form.get('file');
  const slotRaw = form.get('slot');
  // 严格校验 slot：Number(null) === 0 会把缺失参数静默当成位置 0，必须先判字符串形态
  if (
    typeof slotRaw !== 'string' ||
    !/^\d{1,2}$/.test(slotRaw)
  ) {
    return NextResponse.json({ error: '缺少或无效的内容位置' }, { status: 400, headers: noStore });
  }
  const slot = Number(slotRaw);
  if (!(file instanceof File)) {
    return NextResponse.json({ error: '缺少内容文件' }, { status: 400, headers: noStore });
  }

  const checked = validateUploadFile(file.name, file.type, file.size);
  if ('error' in checked) {
    return NextResponse.json({ error: checked.error }, { status: 400, headers: noStore });
  }

  const p = await resolveProjectParam(req);
  if (p.error) return p.error;

  return withManifestLock(p.id, async () => {
    const manifest = await readManifest(p.id);
    if (!Number.isInteger(slot) || slot < 0 || slot >= manifest.count) {
      return NextResponse.json({ error: '无效的内容位置' }, { status: 400, headers: noStore });
    }

    const meta = await saveContentFile(file, checked.kind, p.id);
    const target = manifest.slots[slot];
    if (checked.kind === 'html') {
      target.kind = 'html';
      target.html = meta;
      target.video = null;
    } else {
      target.kind = 'video';
      target.video = meta;
      target.html = null;
    }
    // 被替换条目的旧文件（视频或 HTML）由 writeManifest 集中清理，无需在此处理
    await writeManifest(manifest, p.id);

    // 重读返回：写入层会做紧凑序重排（v2 不变量），保证客户端视图与存储一致
    return NextResponse.json(await readManifest(p.id), { headers: noStore });
  });
}
