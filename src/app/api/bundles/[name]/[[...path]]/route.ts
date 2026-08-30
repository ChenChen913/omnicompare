/**
 * zip 资源包静态服务（第二阶段 Step B）
 * GET /api/bundles/[name]/[...path]   name = 包目录名（[uuid].html），path = 包内相对路径
 * GET /api/bundles/[name]             等价于 path = index.html（包入口）
 *
 * 安全（延续 BLUEPRINT §11）：
 * - 包目录名经 isSafeFilename 白名单校验（uuid.html 形态），跨项目解析
 * - 包内路径逐段拒绝 .. / 空段，解析结果必须落在包目录内（防路径穿越）
 * - .html/.htm 响应强制 CSP sandbox + nosniff + no-store（与单文件 HTML 同级防护）；
 *   其余资产 nosniff + 不可变缓存（包内容随条目替换整体更换，目录名即版本）
 */
import { NextRequest, NextResponse } from 'next/server';
import { promises as fsp, createReadStream } from 'fs';
import path from 'path';
import { resolveBundleDir } from '@/lib/project-store';
import { mimeFromExt } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const noStore = { 'Cache-Control': 'no-store' } as const;

type Ctx = { params: Promise<{ name: string; path?: string[] }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { name, path: rawSegments } = await params;

  const dir = await resolveBundleDir(name);
  if (!dir) {
    return NextResponse.json({ error: '资源包不存在' }, { status: 404, headers: noStore });
  }

  // 包内路径逐段校验：拒绝 .. / 空字节等危险段；缺省 = 包入口
  const segments = rawSegments && rawSegments.length > 0 ? rawSegments : ['index.html'];
  for (const seg of segments) {
    if (!seg || seg === '.' || seg === '..' || seg.includes('\0')) {
      return NextResponse.json({ error: '非法的资源路径' }, { status: 400, headers: noStore });
    }
  }
  const target = path.resolve(dir, ...segments);
  if (target !== dir && !target.startsWith(dir + path.sep)) {
    return NextResponse.json({ error: '非法的资源路径' }, { status: 400, headers: noStore });
  }

  let stat;
  try {
    stat = await fsp.stat(target);
  } catch {
    return NextResponse.json({ error: '资源不存在' }, { status: 404, headers: noStore });
  }
  if (!stat.isFile()) {
    return NextResponse.json({ error: '资源不存在' }, { status: 404, headers: noStore });
  }
  const size = stat.size;

  const ext = path.extname(target).toLowerCase();
  const isHtmlEntry = ext === '.html' || ext === '.htm';

  const headers: Record<string, string> = isHtmlEntry
    ? {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': 'sandbox allow-scripts',
        'Content-Disposition': 'inline; filename="sandbox.html"',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
      }
    : {
        'Content-Type': mimeFromExt(path.basename(target)),
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'public, max-age=31536000, immutable',
      };

  // 包内资产为页面级小文件（html/css/js/img/字体），整文件响应即可；视频级大文件仍走 /api/files/
  const stream = createReadStream(target);
  return new NextResponse(stream as unknown as ReadableStream, {
    status: 200,
    headers: { ...headers, 'Content-Length': String(size) },
  });
}
