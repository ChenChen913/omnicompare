/**
 * 视频上传 API
 * POST /api/videos/upload  multipart: file=视频文件, slot=位置序号
 * 成功后返回最新清单
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  readManifest,
  writeManifest,
  saveVideoFile,
  deleteVideoFile,
  validateVideoFile,
  withManifestLock,
} from '@/lib/video-store';

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
    return NextResponse.json({ error: '缺少或无效的视频位置' }, { status: 400, headers: noStore });
  }
  const slot = Number(slotRaw);
  if (!(file instanceof File)) {
    return NextResponse.json({ error: '缺少视频文件' }, { status: 400, headers: noStore });
  }

  const invalid = validateVideoFile(file.name, file.type, file.size);
  if (invalid) {
    return NextResponse.json({ error: invalid }, { status: 400, headers: noStore });
  }

  return withManifestLock(async () => {
    const manifest = await readManifest();
    if (!Number.isInteger(slot) || slot < 0 || slot >= manifest.count) {
      return NextResponse.json({ error: '无效的视频位置' }, { status: 400, headers: noStore });
    }

    const previous = manifest.slots[slot].video;
    const video = await saveVideoFile(file);
    manifest.slots[slot].video = video;
    await writeManifest(manifest);

    // 替换场景：清理被替换掉的旧文件
    if (previous && previous.filename !== video.filename) {
      await deleteVideoFile(previous.filename);
    }

    return NextResponse.json(manifest, { headers: noStore });
  });
}
