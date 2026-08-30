/**
 * 文件流式服务（支持 HTTP Range 分段请求，保证进度条拖动与 iOS Safari 兼容）
 * GET /api/files/[name]
 *
 * schema v2：文件按项目存放 data/projects/[id]/files/，此路由按文件名跨项目解析
 * （文件名为 uuid 全局唯一）；v1 遗留目录与迁移备份目录作兜底。
 * 安全（BLUEPRINT §11）：.html 响应强制 CSP sandbox + nosniff + no-store，
 * 防止用户上传页面在主域上下文执行脚本或读取主站数据。
 */
import { NextRequest, NextResponse } from 'next/server';
import { promises as fsp, createReadStream } from 'fs';
import { Readable } from 'stream';
import { resolveFileAnyProject } from '@/lib/project-store';
import { mimeFromExt } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface Range {
  start: number;
  end: number;
}

/** 解析 Range 头（bytes=start-end / bytes=start- / bytes=-suffix）；'invalid' 表示需要返回 416 */
function parseRange(header: string, size: number): Range | 'invalid' {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return 'invalid';
  const [, startStr, endStr] = match;
  if (startStr === '' && endStr === '') return 'invalid';

  if (startStr === '') {
    // 后缀形式 bytes=-N：取末尾 N 字节
    const suffix = Number(endStr);
    if (!Number.isInteger(suffix) || suffix <= 0) return 'invalid';
    if (suffix >= size) return { start: 0, end: size - 1 };
    return { start: size - suffix, end: size - 1 };
  }

  const start = Number(startStr);
  if (!Number.isInteger(start) || start >= size) return 'invalid';
  const end = endStr === '' ? size - 1 : Math.min(Number(endStr), size - 1);
  if (end < start) return 'invalid';
  return { start, end };
}

function toWebStream(nodeStream: ReturnType<typeof createReadStream>): ReadableStream {
  return Readable.toWeb(nodeStream) as unknown as ReadableStream;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;

  const resolved = await resolveFileAnyProject(name);
  if (!resolved) {
    return NextResponse.json({ error: '文件不存在' }, { status: 404 });
  }

  let stat;
  try {
    stat = await fsp.stat(resolved.absolutePath);
  } catch {
    return NextResponse.json({ error: '文件不存在' }, { status: 404 });
  }
  const size = stat.size;

  // HTML / SVG：一律走沙箱安全响应头（即使嵌入 iframe/img 也维持最小权限），且禁止缓存。
  // SVG 可内嵌脚本，直接在主域打开会执行；CSP sandbox 使其降级为不透明源、脚本不运行
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
  const isSvg = ext === '.svg';
  const sandboxed = resolved.isHtml || isSvg;
  const sandboxHeaders: Record<string, string> = sandboxed
    ? {
        'Content-Type': isSvg ? 'image/svg+xml' : 'text/html; charset=utf-8',
        'Content-Security-Policy': 'sandbox allow-scripts',
        'Content-Disposition': `inline; filename="${isSvg ? 'sandbox.svg' : 'sandbox.html'}"`,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
      }
    : {};

  const baseHeaders: Record<string, string> = {
    ...sandboxHeaders,
    'Content-Type': sandboxed
      ? sandboxHeaders['Content-Type']
      : mimeFromExt(name),
    'Accept-Ranges': 'bytes',
    ...(sandboxed ? {} : { 'Cache-Control': 'public, max-age=31536000, immutable' }),
  };

  const rangeHeader = _req.headers.get('range');
  if (rangeHeader) {
    const parsed = parseRange(rangeHeader, size);
    if (parsed === 'invalid') {
      return new NextResponse(null, {
        status: 416,
        headers: { 'Content-Range': `bytes */${size}` },
      });
    }
    const { start, end } = parsed;
    return new NextResponse(
      toWebStream(createReadStream(resolved.absolutePath, { start, end })),
      {
        status: 206,
        headers: {
          ...baseHeaders,
          'Content-Range': `bytes ${start}-${end}/${size}`,
          'Content-Length': String(end - start + 1),
        },
      },
    );
  }

  return new NextResponse(toWebStream(createReadStream(resolved.absolutePath)), {
    status: 200,
    headers: { ...baseHeaders, 'Content-Length': String(size) },
  });
}
