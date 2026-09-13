/**
 * v2 路由共享：路径参数 [id] 的项目解析
 *
 * 与 v1 的 `?project=` 解析（v1-project-param.ts）保持同一套语义：
 * - id 格式非法 → 400
 * - 默认项目 → 先跑一次幂等迁移，绝不 404（保证 v1 数据不被任何 v2 写路径绕过）
 * - 其余项目不存在 → 404
 *
 * 历史事故：v2 路由原先直接调用 readProject(id)，而 readProject 在清单缺失时会返回
 * 一份"空白默认项目"，随后的 writeProject 把它落盘 —— 于是
 *   1) 不存在的项目被凭空创建（幽灵项目，出现在项目列表里）；
 *   2) 默认项目的迁移判据被提前占用，v1 老数据永远迁不进来。
 * 所有 v2 路由必须先过这里，不允许再直接 readProject。
 */
import { NextResponse } from 'next/server';
import { ensureDefaultProject, isValidId, projectExists } from './project-store';
import { DEFAULT_PROJECT_ID } from './types';

const noStore = { 'Cache-Control': 'no-store' } as const;

export type ResolvedProject = { id: string; error?: never } | { id?: never; error: NextResponse };

export async function resolveProjectId(id: string): Promise<ResolvedProject> {
  if (!isValidId(id)) {
    return {
      error: NextResponse.json({ error: '无效的项目 id' }, { status: 400, headers: noStore }),
    };
  }
  if (id === DEFAULT_PROJECT_ID) {
    await ensureDefaultProject();
    return { id };
  }
  if (!(await projectExists(id))) {
    return {
      error: NextResponse.json({ error: '项目不存在或已删除' }, { status: 404, headers: noStore }),
    };
  }
  return { id };
}
