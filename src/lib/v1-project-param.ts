/**
 * v1 路由共享：?project= 查询参数解析（Step 8 多项目支持）
 * - 缺省/空值 = 默认项目（旧客户端零改动兼容）
 * - 非法 id（格式）→ 400；id 不存在 → 404（默认项目除外，由存储层幂等迁移兜底）
 */
import { NextRequest, NextResponse } from 'next/server';
import { isValidId, projectExists } from './project-store';
import { DEFAULT_PROJECT_ID } from './types';

const noStore = { 'Cache-Control': 'no-store' } as const;

export type ResolvedProject = { id: string; error?: never } | { id?: never; error: NextResponse };

export async function resolveProjectParam(req: NextRequest): Promise<ResolvedProject> {
  const raw = req.nextUrl.searchParams.get('project');
  const id = raw === null || raw === '' ? DEFAULT_PROJECT_ID : raw;
  if (!isValidId(id)) {
    return { error: NextResponse.json({ error: '无效的项目 id' }, { status: 400, headers: noStore }) };
  }
  if (id !== DEFAULT_PROJECT_ID && !(await projectExists(id))) {
    return { error: NextResponse.json({ error: '项目不存在或已删除' }, { status: 404, headers: noStore }) };
  }
  return { id };
}
