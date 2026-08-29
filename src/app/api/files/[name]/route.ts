/**
 * 视频文件流式服务（支持 HTTP Range 分段请求，保证进度条拖动与 iOS Safari 兼容）
 * GET /api/files/[name]
 */
import { NextRequest, NextResponse } from 'next/server';
import { promises as fsp } from 'fs';
import { createReadStream } from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { UPLOAD_DIR, isSafeFilename } from '@/lib/video-store';
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
  if (!isSafeFilename(name)) {
    return NextResponse.json({ error: '文件不存在' }, { status: 404 });
  }

  const filePath = path.join(UPLOAD_DIR, name);
  let stat;
  try {
    stat = await fsp.stat(filePath);
  } catch {
    return NextResponse.json({ error: '文件不存在' }, { status: 404 });
  }
  if (!stat.isFile() || stat.size === 0) {
    return NextResponse.json({ error: '文件不存在' }, { status: 404 });
  }

  const size = stat.size;
  const contentType = mimeFromExt(name);
  const baseHeaders: Record<string, string> = {
    'Content-Type': contentType,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=31536000, immutable',
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
    return new NextResponse(toWebStream(createReadStream(filePath, { start, end })), {
      status: 206,
      headers: {
        ...baseHeaders,
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Content-Length': String(end - start + 1),
      },
    });
  }

  return new NextResponse(toWebStream(createReadStream(filePath)), {
    status: 200,
    headers: { ...baseHeaders, 'Content-Length': String(size) },
  });
}
