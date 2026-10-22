/**
 * 按标题重新匹配卡片图标（显式动作）
 * POST /api/videos/icon/auto?slot=n[&project=id]
 *
 * 与标题保存时的自动填充共用同一套规则（model-icon-rules.ts），区别只有两点：
 * - 无视 manual / off：用户点「根据标题自动匹配」就是要覆盖当前选择；
 * - 识别不到时返回 matched: null（200），由客户端给一句「没识别到模型」的提示。
 *
 * 文件与清单在同一互斥临界区内变更：新图标先落盘，写清单失败则删掉新文件；
 * 被替换的旧图标文件由 writeManifest 的集中孤儿清理删除。
 */
import { NextRequest, NextResponse } from 'next/server';
import { deleteFile } from '@/lib/project-store';
import { readManifest, writeManifest, withManifestLock } from '@/lib/video-store';
import { resolveProjectParam } from '@/lib/v1-project-param';
import { detectModelIcon } from '@/lib/model-icon-rules';
import { savePresetIcon } from '@/lib/model-icon-store';

export const dynamic = 'force-dynamic';

const noStore = {
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
} as const;

/** 解析并校验 slot 查询参数（与 icon/upload 路由同一防御：Number(null)===0 的坑） */
function parseSlot(raw: string | null): number | null {
  if (raw === null || !/^\d{1,2}$/.test(raw)) return null;
  return Number(raw);
}

export async function POST(req: NextRequest) {
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
    const target = manifest.slots[slot];
    if (!(target.video || target.html || target.image)) {
      return NextResponse.json(
        { error: '该位置暂无内容，请先上传视频 / 图片 / 网页' },
        { status: 400, headers: noStore },
      );
    }

    const preset = detectModelIcon(target.title);
    if (!preset) {
      // 没命中：清单原样返回，客户端据此提示「标题里没识别到模型」
      return NextResponse.json(
        { ...(await readManifest(p.id)), matched: null },
        { headers: noStore },
      );
    }
    // 已经是这张自动图：不重复复制文件
    if (target.iconMode === 'auto' && target.iconPreset === preset.id) {
      return NextResponse.json(
        { ...(await readManifest(p.id)), matched: preset.id, label: preset.label },
        { headers: noStore },
      );
    }

    const meta = await savePresetIcon(p.id, preset.id);
    if (!meta) {
      return NextResponse.json(
        { error: '图标文件缺失或写入失败，请检查 public/model-icons 目录' },
        { status: 500, headers: noStore },
      );
    }
    target.icon = meta;
    target.iconMode = 'auto';
    target.iconPreset = preset.id;

    try {
      await writeManifest(manifest, p.id);
    } catch (err) {
      await deleteFile(p.id, meta.filename).catch(() => {});
      throw err;
    }
    return NextResponse.json(
      { ...(await readManifest(p.id)), matched: preset.id, label: preset.label },
      { headers: noStore },
    );
  });
}
