/**
 * 项目级播放与展示设置 API（v1 视图，蓝图 §7/§9/§13；Step 8 起支持 ?project= 多项目）
 * PATCH /api/videos/settings[?project=id]  { aspectRatio?, showTitles?, ... 见 settings-schema 规格表 }
 * - 全部字段可选，仅更新提供的字段；播放设置只作用于 kind=video 的内容
 * - 与其它 v1 写路径共用清单互斥锁，杜绝并发丢更新
 * - 成功返回更新后的完整 v1 清单视图（响应即回填）
 *
 * 字段校验收口于 src/lib/settings-schema.ts（与 v2 路由、存储归一化共用同一份规格表）。
 */
import { NextRequest, NextResponse } from 'next/server';
import { readProject, withProjectLock, writeProject } from '@/lib/project-store';
import { readManifest } from '@/lib/video-store';
import { resolveProjectParam } from '@/lib/v1-project-param';
import { parseSettingsPatch } from '@/lib/settings-schema';

export const dynamic = 'force-dynamic';

const noStore = {
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
} as const;

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400, headers: noStore });
}

export async function PATCH(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return badRequest('请求体格式错误');

  const parsed = parseSettingsPatch(body);
  if ('error' in parsed) return badRequest(parsed.error);
  const { patch, clearCustomRatio } = parsed;

  const p = await resolveProjectParam(req);
  if (p.error) return p.error;

  return withProjectLock(p.id, async () => {
    // readProject 内部已保证默认项目的幂等迁移，这里无需重复调用
    const project = await readProject(p.id);
    project.settings = { ...project.settings, ...patch };
    if (clearCustomRatio) delete project.settings.customRatio;
    project.updatedAt = new Date().toISOString();
    await writeProject(project);
    return NextResponse.json(await readManifest(p.id), { headers: noStore });
  });
}
