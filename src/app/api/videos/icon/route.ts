/**
 * 卡片图标 API（v1 视图，above 标题带头像/图标）
 * POST   /api/videos/icon?slot=n[&project=id]  multipart: file —— 上传/替换该位置的内容图标
 * DELETE /api/videos/icon?slot=n[&project=id] —— 移除该位置的图标（连同文件一起删除）
 *
 * 图标依附于内容条目（items[i].icon）：空位不可设置图标（先上传内容）；
 * 替换内容不清除图标（模型头像跨视频保留），移除内容/清空/缩减时图标随条目下线。
 * 文件与清单在同一互斥临界区内变更，遵守「先写清单、后删文件」铁律
 * （旧图标文件的清理由 writeManifest 的集中孤儿扫描统一执行）；
 * 上传失败（写清单抛错）时回滚删除新落盘文件，不留孤儿。
 * 文件本体存 data/projects/[id]/files/，经既有 /api/files/[name] 路由服务。
 */
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { IMAGE_EXTS, MAX_ICON_SIZE } from '@/lib/types';
import { deleteFile, saveFile } from '@/lib/project-store';
import { readManifest, writeManifest, withManifestLock } from '@/lib/video-store';
import { resolveProjectParam } from '@/lib/v1-project-param';

export const dynamic = 'force-dynamic';

const noStore = {
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
} as const;

/** 解析并校验 slot 查询参数（与 upload 路由同一防御：Number(null)===0 的坑） */
function parseSlot(raw: string | null): number | null {
  if (raw === null || !/^\d{1,2}$/.test(raw)) return null;
  return Number(raw);
}

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
  const slot = parseSlot(req.nextUrl.searchParams.get('slot'));
  if (slot === null) {
    return NextResponse.json({ error: '缺少或无效的内容位置' }, { status: 400, headers: noStore });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: '缺少图标文件' }, { status: 400, headers: noStore });
  }

  // 图标判别（与内容上传的图片分支同策略：扩展名白名单或 image/* MIME 双判）；
  // 明显的类型错配直接拒收（与 bgm 路由同哲学：MIME 明确是视频/音频/zip 却挂着
  // 图片扩展名，说明上传方标错了类型，放行只会得到一张打不开的占位图）
  const ext = path.extname(file.name).toLowerCase();
  const isImageExt = (IMAGE_EXTS as readonly string[]).includes(ext);
  const clearlyNotImage =
    file.type.startsWith('video/') ||
    file.type.startsWith('audio/') ||
    file.type === 'application/zip' ||
    file.type === 'application/x-zip-compressed';
  if (clearlyNotImage) {
    return NextResponse.json(
      { error: '文件类型与扩展名不一致：这不是图片文件，请检查后重传' },
      { status: 400, headers: noStore },
    );
  }
  if (!(isImageExt || file.type.startsWith('image/'))) {
    return NextResponse.json(
      { error: '仅支持 PNG / JPG / GIF / WebP / SVG / BMP / AVIF 图标图片' },
      { status: 400, headers: noStore },
    );
  }
  if (!isImageExt) {
    return NextResponse.json(
      { error: '图标扩展名需为 .png / .jpg / .jpeg / .gif / .webp / .svg / .bmp / .avif' },
      { status: 400, headers: noStore },
    );
  }
  if (file.size > MAX_ICON_SIZE) {
    return NextResponse.json(
      { error: '图标文件超过 5MB 大小限制' },
      { status: 400, headers: noStore },
    );
  }

  const p = await resolveProjectParam(req);
  if (p.error) return p.error;

  return withManifestLock(p.id, async () => {
    const manifest = await readManifest(p.id);
    if (slot >= manifest.count) {
      return NextResponse.json({ error: '无效的内容位置' }, { status: 400, headers: noStore });
    }
    const target = manifest.slots[slot];
    // 图标依附于内容：空位没有条目可挂载（writeManifest 对空位不生成条目，设置了也会丢）
    if (!(target.video || target.html || target.image)) {
      return NextResponse.json(
        { error: '该位置暂无内容，请先上传视频 / 图片 / 网页' },
        { status: 400, headers: noStore },
      );
    }

    // 新文件先落盘（uuid 不碰撞）；写清单失败时回滚删除新文件（旧图标保持一致）
    let meta;
    try {
      meta = await saveFile(p.id, file, 'image');
    } catch {
      return NextResponse.json({ error: '图标保存失败，请重试' }, { status: 500, headers: noStore });
    }
    target.icon = meta;
    try {
      await writeManifest(manifest, p.id);
    } catch (err) {
      await deleteFile(p.id, meta.filename).catch(() => {});
      throw err;
    }
    // 旧图标文件由 writeManifest 的集中孤儿清理删除（先清单后文件铁律）
    return NextResponse.json(await readManifest(p.id), { status: 201, headers: noStore });
  });
}

export async function DELETE(req: NextRequest) {
  const slot = parseSlot(req.nextUrl.searchParams.get('slot'));
  if (slot === null) {
    return NextResponse.json({ error: '缺少或无效的内容位置' }, { status: 400, headers: noStore });
  }

  const p = await resolveProjectParam(req);
  if (p.error) return p.error;

  return withManifestLock(p.id, async () => {
    const manifest = await readManifest(p.id);
    if (slot >= manifest.count) {
      return NextResponse.json({ error: '无效的内容位置' }, { status: 400, headers: noStore });
    }
    // null = 显式清除（undefined 才是"视图未携带、保留原值"）
    if (manifest.slots[slot].icon) {
      manifest.slots[slot].icon = null;
      await writeManifest(manifest, p.id);
    }
    return NextResponse.json(await readManifest(p.id), { headers: noStore });
  });
}
