/**
 * 内容上传 API（视频、图片、单文件 HTML 或 zip 资源包；Step 8 起支持 ?project= 多项目）
 * POST /api/videos/upload[?project=id]  multipart: file=内容文件, slot=位置序号
 * kind 由服务端按 MIME + 扩展名双判（video / html / image；zip 解压为 bundle 型 html）；成功后返回最新清单
 */
import { NextRequest, NextResponse } from 'next/server';
import { deleteFile, saveBundle } from '@/lib/project-store';
import {
  readManifest,
  writeManifest,
  saveContentFile,
  validateUploadFile,
  withManifestLock,
} from '@/lib/video-store';
import { resolveProjectParam } from '@/lib/v1-project-param';
import { applyAutoIcon } from '@/lib/model-icon-store';
import { guessTitleFromFileName } from '@/lib/file-title';
import type { FileMeta } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const noStore = {
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
} as const;

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

    // zip 资源包（Step B）：解压校验 + 落盘在保存阶段完成，失败即整体拒绝
    let meta;
    try {
      meta = checked.bundle
        ? await saveBundle(p.id, file)
        : await saveContentFile(file, checked.kind, p.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'zip 包保存失败';
      return NextResponse.json({ error: message }, { status: 400, headers: noStore });
    }
    const target = manifest.slots[slot];
    target.video = null;
    target.html = null;
    target.image = null;
    if (checked.kind === 'html') {
      target.kind = 'html';
      target.html = meta;
      if (checked.bundle) target.bundle = true;
      else delete target.bundle;
    } else if (checked.kind === 'image') {
      target.kind = 'image';
      target.image = meta;
    } else {
      target.kind = 'video';
      target.video = meta;
    }
    // 标题为空时用文件名猜一个（「DeepSeek-V3.2-Exp.mp4」→「DeepSeek-V3.2-Exp」）；
    // 已有标题（用户手写过）一律不覆盖
    if (!target.title.trim()) {
      const guessed = guessTitleFromFileName(file.name);
      if (guessed) target.title = guessed;
    }
    // 标题有了就顺手匹配图标（手动设置/手动移除过的槽位不动）
    const newIcon: FileMeta | null = await applyAutoIcon(p.id, target);

    // 被替换条目的旧文件（视频或 HTML）由 writeManifest 集中清理，无需在此处理
    try {
      await writeManifest(manifest, p.id);
    } catch (err) {
      // 清单没写成：新落盘的图标无人引用，删掉避免孤儿；内容文件已由既有逻辑兜底
      if (newIcon) await deleteFile(p.id, newIcon.filename).catch(() => {});
      throw err;
    }

    // 重读返回：写入层会做紧凑序重排（v2 不变量），保证客户端视图与存储一致
    return NextResponse.json(await readManifest(p.id), { headers: noStore });
  });
}
