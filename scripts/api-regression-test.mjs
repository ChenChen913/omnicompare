#!/usr/bin/env node
/**
 * 回归测试：覆盖 2026-09 深度体检修复的全部问题。
 *
 * 与 scripts/api-*.sh 的区别：
 * - 零外部依赖（只用 Node + 项目自带的 fflate），Windows / macOS / Linux 都能跑；
 *   旧的 .sh 脚本需要 curl + jq + python3，缺 jq 直接失败。
 * - 断言的是"修复后的行为"，每一项都对应一个真实存在过的缺陷。
 *
 * 用法：
 *   bun run dev            # 另开一个终端
 *   node scripts/api-regression-test.mjs [BASE_URL]
 *   默认 BASE_URL = http://localhost:3000
 *
 * 退出码：全部通过 0，有失败 1。
 */
import { zipSync, strToU8 } from 'fflate';

const BASE = (process.argv[2] ?? 'http://localhost:3000').replace(/\/$/, '');

let passed = 0;
const failures = [];

function check(name, ok, detail = '') {
  if (ok) {
    passed += 1;
    console.log(`  ✅ ${name}`);
  } else {
    failures.push(name);
    console.log(`  ❌ ${name}${detail ? `\n       ${detail}` : ''}`);
  }
}

function section(title) {
  console.log(`\n=== ${title} ===`);
}

async function req(method, path, { json, form, raw } = {}) {
  const init = { method, redirect: 'manual' };
  if (json !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(json);
  } else if (form) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(form)) {
      if (v instanceof Blob) fd.append(k, v, v.name ?? 'file');
      else fd.append(k, String(v));
    }
    init.body = fd;
  }
  const res = await fetch(`${BASE}${path}`, init);
  if (raw) return res;
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body, headers: res.headers };
}

/** 造一个 zip 包（条目名 → 内容），用于上传测试 */
function makeZip(entries, level = 6) {
  return new Blob([zipSync(entries, { level })], { type: 'application/zip' });
}

function namedBlob(blob, name) {
  return Object.assign(blob, { name });
}

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);

async function main() {
  console.log(`OmniCompare 回归测试 → ${BASE}\n`);

  const health = await req('GET', '/api');
  if (health.status !== 200) {
    console.error(`服务不可达（GET /api → ${health.status}）。请先启动：bun run dev`);
    process.exit(2);
  }

  /* ---------------------------------------------------------------- */
  section('P3-11 JSON 响应显式声明 UTF-8');
  {
    const r = await req('GET', '/api/projects', { raw: true });
    const ct = r.headers.get('content-type') ?? '';
    check('Content-Type 含 charset=utf-8', /charset=utf-8/i.test(ct), `实际：${ct}`);
    const cc = r.headers.get('cache-control') ?? '';
    check('仍带 no-store', /no-store/.test(cc), `实际：${cc}`);
  }

  /* ---------------------------------------------------------------- */
  section('P1-5 不存在的项目必须 404，且不得凭空创建');
  {
    const ghost = `ghost-${Date.now().toString(36)}`;
    const cases = [
      ['GET', `/api/projects/${ghost}-1`],
      ['PATCH', `/api/projects/${ghost}-2/layout`, { json: { mode: 'auto' } }],
      ['PATCH', `/api/projects/${ghost}-3/settings`, { json: { loop: true } }],
      ['GET', `/api/projects/${ghost}-4/items`],
      ['PATCH', `/api/projects/${ghost}-5/items/reorder`, { json: { orderedIds: [] } }],
      ['DELETE', `/api/projects/${ghost}-6`],
    ];
    for (const [method, path, opts] of cases) {
      const r = await req(method, path, opts);
      check(`${method} ${path.replace(ghost, '<ghost>')} → 404`, r.status === 404, `实际：${r.status}`);
    }
    const list = await req('GET', '/api/projects');
    const leaked = (list.body ?? []).filter((p) => String(p.id).startsWith(ghost));
    check('幽灵项目未出现在项目列表中', leaked.length === 0, `泄漏：${leaked.map((p) => p.id).join(', ')}`);
    const bad = await req('GET', '/api/projects/..%2F..%2Fetc');
    check('非法 id 仍返回 400', bad.status === 400, `实际：${bad.status}`);
  }

  /* ---------------------------------------------------------------- */
  section('P1-4 v2 条目数上限与 slotCount 联动（不再静默丢内容）');
  let tmpProjectId = null;
  {
    const created = await req('POST', '/api/projects', { json: { name: 'regression-tmp' } });
    tmpProjectId = created.body?.id ?? null;
    check('创建临时项目', created.status === 201 && !!tmpProjectId, `实际：${created.status}`);

    if (tmpProjectId) {
      let lastStatus = 0;
      let accepted = 0;
      for (let i = 1; i <= 14; i += 1) {
        const r = await req('POST', `/api/projects/${tmpProjectId}/items/upload`, {
          form: { file: namedBlob(new Blob([PNG_1PX], { type: 'image/png' }), 'px.png'), title: `item${i}` },
        });
        lastStatus = r.status;
        if (r.status === 201) accepted += 1;
      }
      check('超过 SLOT_MAX 的上传被拒绝', lastStatus === 400, `第 14 次返回：${lastStatus}`);
      check('恰好接受 12 个条目', accepted === 12, `实际接受：${accepted}`);

      const proj = await req('GET', `/api/projects/${tmpProjectId}`);
      const itemCount = proj.body?.items?.length ?? 0;
      check('items 数量 = 12', itemCount === 12, `实际：${itemCount}`);
      check(
        'slotCount 已抬到条目数（v1 视图看得见全部）',
        (proj.body?.slotCount ?? 0) >= itemCount,
        `slotCount=${proj.body?.slotCount} items=${itemCount}`,
      );

      const v1 = await req('GET', `/api/videos?project=${tmpProjectId}`);
      const visible = (v1.body?.slots ?? []).filter((s) => s.video || s.html || s.image).length;
      check('v1 视图可见内容数 = v2 条目数', visible === itemCount, `v1 可见 ${visible}，v2 有 ${itemCount}`);

      // 关键回归：一次**不涉及缩减**的普通 v1 写操作，不得删除任何条目或文件。
      // （注意：PATCH /api/videos/layout 且 count 变小是"缩减"，语义上就该删内容，
      //   那是前端弹确认框的路径，不在这里断言。）
      const before = await req('GET', `/api/projects/${tmpProjectId}`);
      const titleRes = await req('PATCH', `/api/videos?project=${tmpProjectId}`, {
        json: { slot: 0, title: '改个标题' },
      });
      check('v1 改标题成功', titleRes.status === 200, `实际：${titleRes.status}`);
      const after = await req('GET', `/api/projects/${tmpProjectId}`);
      check(
        '普通 v1 写操作不丢条目（历史缺陷：范围外条目被静默清理）',
        after.body?.items?.length === before.body?.items?.length,
        `前 ${before.body?.items?.length} → 后 ${after.body?.items?.length}`,
      );
      check('标题确已写入', after.body?.items?.[0]?.title === '改个标题', `实际：${after.body?.items?.[0]?.title}`);

      // 显式缩减：语义上就该移除范围外内容（前端会弹确认框），断言数量确实收敛
      const shrink = await req('PATCH', `/api/videos/layout?project=${tmpProjectId}`, {
        json: { count: 6, layout: 'auto' },
      });
      check('显式缩减窗格数成功', shrink.status === 200, `实际：${shrink.status}`);
      const shrunk = await req('GET', `/api/projects/${tmpProjectId}`);
      check(
        '显式缩减按语义移除范围外条目',
        shrunk.body?.items?.length === 6,
        `实际：${shrunk.body?.items?.length}`,
      );
    }
  }

  /* ---------------------------------------------------------------- */
  section('P0-1 zip 包内 SVG 与 HTML 同级沙箱');
  {
    const bundleName = `bundle-${Date.now().toString(36)}.zip`;
    const zip = makeZip({
      'index.html': strToU8('<html><body>ok</body></html>'),
      'evil.svg': strToU8('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
      'style.css': strToU8('body{color:red}'),
    });
    const up = await req('POST', '/api/videos/upload', {
      form: { file: namedBlob(zip, bundleName), slot: '0' },
    });
    check(
      'zip 包上传成功且标记为 bundle',
      up.status === 200 && up.body?.slots?.[0]?.bundle === true,
      `状态 ${up.status}，bundle=${up.body?.slots?.[0]?.bundle}，错误=${up.body?.error ?? '无'}`,
    );
    const dir = up.body?.slots?.[0]?.html?.filename;

    if (dir) {
      const svg = await req('GET', `/api/bundles/${dir}/evil.svg`, { raw: true });
      const svgCsp = svg.headers.get('content-security-policy') ?? '';
      check('包内 .svg 带 CSP sandbox（历史缺陷：裸奔）', /sandbox/.test(svgCsp), `实际：${svgCsp || '(空)'}`);
      check('包内 .svg 禁缓存', /no-store/.test(svg.headers.get('cache-control') ?? ''));
      check('包内 .svg 保持 image/svg+xml', /image\/svg\+xml/.test(svg.headers.get('content-type') ?? ''));

      const html = await req('GET', `/api/bundles/${dir}/index.html`, { raw: true });
      check('包内 .html 仍带 CSP sandbox', /sandbox/.test(html.headers.get('content-security-policy') ?? ''));

      const css = await req('GET', `/api/bundles/${dir}/style.css`, { raw: true });
      check('普通资产不带沙箱头、走长缓存', (css.headers.get('content-security-policy') ?? '') === ''
        && /immutable/.test(css.headers.get('cache-control') ?? ''));

      const trav = await req('GET', `/api/bundles/${dir}/..%2F..%2Fpackage.json`);
      check('包内路径穿越被拒', trav.status === 400 || trav.status === 404, `实际：${trav.status}`);
    }
  }

  /* ---------------------------------------------------------------- */
  section('P0-3 zip 解包限额（流式，越限即拒）');
  {
    // 解压后 ~40MB（低于 120MB 上限，应成功）——顺带确认正常包没被误伤
    const okZip = makeZip({
      'index.html': strToU8('<html>ok</html>'),
      'data.txt': new Uint8Array(8 * 1024 * 1024),
    });
    const upOk = await req('POST', '/api/videos/upload', {
      form: { file: namedBlob(okZip, 'sized-ok.zip'), slot: '1' },
    });
    check('8MB 载荷的 zip 正常通过', upOk.status === 200, `实际：${upOk.status}`);

    // 解压后 300MB，远超 120MB 上限
    const bomb = makeZip({
      'index.html': strToU8('<html>bomb</html>'),
      'data.txt': new Uint8Array(300 * 1024 * 1024),
    });
    const t0 = Date.now();
    const upBomb = await req('POST', '/api/videos/upload', {
      form: { file: namedBlob(bomb, 'bomb.zip'), slot: '2' },
    });
    const ms = Date.now() - t0;
    check('zip 炸弹被拒绝', upBomb.status === 400, `实际：${upBomb.status}`);
    check(
      '拒绝原因指向解压大小上限',
      /120MB|解压/.test(String(upBomb.body?.error ?? '')),
      `实际：${upBomb.body?.error}`,
    );
    check('提前中止（未把整包解完）', ms < 5000, `耗时 ${ms}ms`);

    const stillAlive = await req('GET', '/api/videos');
    check('服务在炸弹攻击后仍存活', stillAlive.status === 200, `实际：${stillAlive.status}`);
  }

  /* ---------------------------------------------------------------- */
  section('P0-3 zip 路径与类型白名单');
  {
    const cases = [
      ['路径穿越 ../', { 'index.html': strToU8('x'), '../evil.css': strToU8('a') }],
      ['绝对路径 /etc', { 'index.html': strToU8('x'), '/etc/passwd': strToU8('a') }],
      ['Windows 设备名 CON', { 'index.html': strToU8('x'), 'CON.css': strToU8('a') }],
      ['非白名单扩展 .exe', { 'index.html': strToU8('x'), 'evil.exe': strToU8('a') }],
    ];
    for (const [label, entries] of cases) {
      const r = await req('POST', '/api/videos/upload', {
        form: { file: namedBlob(makeZip(entries), 'bad.zip'), slot: '3' },
      });
      check(`拒收：${label}`, r.status === 400, `实际：${r.status}`);
    }
    const noEntry = await req('POST', '/api/videos/upload', {
      form: { file: namedBlob(makeZip({ 'other.html': strToU8('x') }), 'noentry.zip'), slot: '3' },
    });
    check('拒收：缺少根级 index.html', noEntry.status === 400, `实际：${noEntry.status}`);

    // 类型与扩展名不一致：zip 二进制挂着 .html 扩展名（MIME + 扩展名双判的一致性检查）
    const mislabeled = await req('POST', '/api/videos/upload', {
      form: { file: namedBlob(makeZip({ 'index.html': strToU8('x') }), 'mislabeled.html'), slot: '3' },
    });
    check(
      '拒收：zip 内容却用 .html 命名（双判不一致）',
      mislabeled.status === 400,
      `实际：${mislabeled.status}，错误=${mislabeled.body?.error ?? '无'}`,
    );
  }

  /* ---------------------------------------------------------------- */
  section('P3-9 customRatio 真正生效且严格校验');
  {
    const ok = await req('PATCH', '/api/videos/settings', {
      json: { aspectRatio: 'custom', customRatio: { w: 21, h: 9 } },
    });
    check('自定义比例保存成功', ok.status === 200, `实际：${ok.status}`);
    check(
      '响应回读 customRatio',
      ok.body?.settings?.customRatio?.w === 21 && ok.body?.settings?.customRatio?.h === 9,
      `实际：${JSON.stringify(ok.body?.settings?.customRatio)}`,
    );
    check('aspectRatio = custom', ok.body?.settings?.aspectRatio === 'custom');

    const bad = [
      ['零宽', { w: 0, h: 9 }],
      ['负高', { w: 16, h: -1 }],
      ['超上限', { w: 999999, h: 9 }],
      ['非数字', { w: 'x', h: 9 }],
    ];
    for (const [label, customRatio] of bad) {
      const r = await req('PATCH', '/api/videos/settings', { json: { customRatio } });
      check(`拒收自定义比例：${label}`, r.status === 400, `实际：${r.status}`);
    }
    const cleared = await req('PATCH', '/api/videos/settings', { json: { customRatio: null } });
    check('customRatio=null 可显式清除', cleared.status === 200 && !cleared.body?.settings?.customRatio);
    await req('PATCH', '/api/videos/settings', { json: { aspectRatio: 'original' } });
  }

  /* ---------------------------------------------------------------- */
  section('v1 视图设置：未知字段与非法值不污染存储');
  {
    const r = await req('PATCH', '/api/videos/settings', { json: { letterboxFill: 'nope' } });
    check('非法 letterboxFill 被拒', r.status === 400, `实际：${r.status}`);
    const r2 = await req('PATCH', '/api/videos/settings', { json: { playbackRate: 3 } });
    check('非法播放倍速被拒', r2.status === 400, `实际：${r2.status}`);
    const r3 = await req('PATCH', '/api/videos/settings', { json: {} });
    check('空 patch 被拒', r3.status === 400, `实际：${r3.status}`);
  }

  /* ---------------------------------------------------------------- */
  section('P3-11 文件服务与 Range');
  {
    const cur = await req('GET', '/api/videos');
    const svgSlot = (cur.body?.slots ?? []).find((s) => s.kind === 'image' && s.image);
    if (svgSlot) {
      const r = await req('GET', `/api/files/${svgSlot.image.filename}`, { raw: true });
      check('图片流可访问', r.status === 200, `实际：${r.status}`);
    }
    // 用已上传的 bundle 目录当"大文件"测 Range 不适用，改测 404 与穿越
    const missing = await req('GET', '/api/files/does-not-exist-0000.mp4');
    check('不存在的文件 404', missing.status === 404, `实际：${missing.status}`);
    const trav = await req('GET', '/api/files/..%2F..%2Fpackage.json');
    check('文件路径穿越 404', trav.status === 404, `实际：${trav.status}`);
  }

  /* ---------------------------------------------------------------- */
  section('清理与收尾');
  {
    if (tmpProjectId) {
      const del = await req('DELETE', `/api/projects/${tmpProjectId}`);
      check('临时项目已删除', del.status === 200, `实际：${del.status}`);
      const gone = await req('GET', `/api/projects/${tmpProjectId}`);
      check('删除后再访问返回 404', gone.status === 404, `实际：${gone.status}`);
    }
    const defDel = await req('DELETE', '/api/projects/default');
    check('默认项目受保护（403）', defDel.status === 403, `实际：${defDel.status}`);
    const clear = await req('DELETE', '/api/videos?all=1');
    check('清空全部内容成功', clear.status === 200, `实际：${clear.status}`);
    const emptied = await req('GET', '/api/videos');
    const filled = (emptied.body?.slots ?? []).filter((s) => s.video || s.html || s.image).length;
    check('清空后无残留内容', filled === 0, `仍有 ${filled} 个`);
  }

  /* ---------------------------------------------------------------- */
  console.log(`\n${'='.repeat(52)}`);
  const total = passed + failures.length;
  if (failures.length === 0) {
    console.log(`✅ 全部通过：${passed}/${total}`);
    process.exit(0);
  }
  console.log(`❌ 失败 ${failures.length} 项 / 共 ${total} 项：`);
  for (const f of failures) console.log(`   - ${f}`);
  process.exit(1);
}

main().catch((err) => {
  console.error('\n测试执行异常：', err);
  process.exit(2);
});
