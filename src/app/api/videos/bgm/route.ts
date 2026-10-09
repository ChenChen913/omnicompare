/**
 * 背景音乐 API（v1 视图，Step 8 多项目：?project= 参数）
 * POST /api/videos/bgm[?project=id]  multipart: file —— 上传/替换背景音乐（每项目一轨）
 * DELETE /api/videos/bgm[?project=id] —— 移除背景音乐（连同文件一起删除）
 *
 * 文件与设置必须在同一互斥临界区内变更，并遵守「先写清单、后删文件」铁律
 * （与其余全部写路径一致）：写清单失败时磁盘上文件未删，最坏情况是可被
 * 清理的孤儿，而不是引用已删文件的死链音轨；上传失败时新落盘文件回滚删除。
 * 音频不进内容条目（items），只作为项目级全局音轨存于 settings.bgm。
 * 文件本体存 data/projects/[id]/files/，经既有 /api/files/[name] 路由流式服务（支持 Range）。
 */
import { NextRequest, NextResponse } from 'next/server';
import { isAudioFile, MAX_AUDIO_SIZE } from '@/lib/types';
import {
  deleteFile,
  readProject,
  saveFile,
  withProjectLock,
  writeProject,
} from '@/lib/project-store';
import { readManifest } from '@/lib/video-store';
import { resolveProjectParam } from '@/lib/v1-project-param';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const noStore = { 'Cache-Control': 'no-store' } as const;

export async function POST(req: NextRequest) {
  const p = await resolveProjectParam(req);
  if (p.error) return p.error;

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
  if (file.size === 0) {
    return NextResponse.json({ error: '文件内容为空' }, { status: 400, headers: noStore });
  }
  // 扩展名或 MIME 双判（与内容上传同策略）；MIME 明确是视频却改名成音频的拒收
  if (!isAudioFile(file.name, file.type) || file.type.startsWith('video/')) {
    return NextResponse.json(
      { error: '仅支持 MP3 / M4A / AAC / WAV / OGG / FLAC 音频文件' },
      { status: 400, headers: noStore },
    );
  }
  if (file.size > MAX_AUDIO_SIZE) {
    return NextResponse.json({ error: '音频文件超过 50MB 大小限制' }, { status: 400, headers: noStore });
  }

  return withProjectLock(p.id, async () => {
    const project = await readProject(p.id);
    // 新文件先落盘（uuid 不碰撞）；随后「先写清单、后删旧文件」：
    // 写清单失败时旧文件仍在（重试时再次清理），新文件回滚删除，不留死链
    let meta;
    try {
      meta = await saveFile(p.id, file, 'audio');
    } catch {
      return NextResponse.json({ error: '音频保存失败，请重试' }, { status: 500, headers: noStore });
    }
    const previous = project.settings.bgm;
    project.settings.bgm = meta;
    project.updatedAt = new Date().toISOString();
    try {
      await writeProject(project);
    } catch (err) {
      // 清单写失败：回滚新文件，旧文件与旧清单保持一致
      await deleteFile(p.id, meta.filename).catch(() => {});
      throw err;
    }
    if (previous) await deleteFile(p.id, previous.filename).catch(() => {});
    return NextResponse.json(await readManifest(p.id), { status: 201, headers: noStore });
  });
}

export async function DELETE(req: NextRequest) {
  const p = await resolveProjectParam(req);
  if (p.error) return p.error;

  return withProjectLock(p.id, async () => {
    const project = await readProject(p.id);
    const previous = project.settings.bgm;
    if (previous) {
      // 先写清单、后删文件：写清单失败时文件未删，最多是可清理的孤儿而非死链
      project.settings.bgm = null;
      project.updatedAt = new Date().toISOString();
      await writeProject(project);
      await deleteFile(p.id, previous.filename).catch(() => {});
    }
    return NextResponse.json(await readManifest(p.id), { headers: noStore });
  });
}
