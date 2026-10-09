/**
 * 健康检查端点
 * GET /api → 200 { ok, service, time }
 * 供 Docker 健康探测、回归测试与服务存活断言使用（此前为 Hello World 占位）。
 */
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json(
    {
      ok: true,
      service: 'omnicompare',
      time: new Date().toISOString(),
    },
    {
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json; charset=utf-8',
      },
    },
  );
}
