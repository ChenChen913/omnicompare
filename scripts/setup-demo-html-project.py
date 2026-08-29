#!/usr/bin/env python3
"""创建「测试项目」并导入 6 个模仿 HTML 页面（自包含单文件，无外部依赖）。

流程：检查/删除同名旧项目 → 新建项目 → 显式设置 3×2 布局 → 逐位上传 HTML → 写标题 → 校验。
幂等：重复执行会先删除旧的「测试项目」，保证最终状态一致。
"""

import json
import os
import tempfile
import urllib.error
import urllib.request

BASE = os.environ.get("BASE_URL", "http://localhost:3000")
PROJECT_NAME = "测试项目"

# ---------------------------------------------------------------- HTTP 助手

def request(method: str, path: str, *, body=None, form=None, expect_json=True):
    data = None
    headers = {}
    if form is not None:
        data = form
    elif body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(f"{BASE}{path}", data=data, method=method, headers=headers)
    with urllib.request.urlopen(req, timeout=60) as res:
        payload = res.read()
        return json.loads(payload) if expect_json and payload else None


def list_projects():
    return request("GET", "/api/projects")


def create_project(name: str):
    return request("POST", "/api/projects", body={"name": name})


def delete_project(pid: str):
    return request("DELETE", f"/api/projects/{pid}", expect_json=False)


def set_layout(pid: str, count: int, rows: int, cols: int):
    return request(
        "PATCH",
        f"/api/videos/layout?project={pid}",
        body={"count": count, "rows": rows, "cols": cols},
    )


def upload_html(pid: str, slot: int, tmp_path: str, filename: str):
    boundary = "----OmniDemoBoundary8f2a1c"
    with open(tmp_path, "rb") as f:
        file_bytes = f.read()
    body = b"".join(
        [
            f"--{boundary}\r\n".encode(),
            f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'.encode(),
            b"Content-Type: text/html\r\n\r\n",
            file_bytes,
            f"\r\n--{boundary}\r\n".encode(),
            f'Content-Disposition: form-data; name="slot"\r\n\r\n{slot}\r\n'.encode(),
            f"--{boundary}--\r\n".encode(),
        ]
    )
    req = urllib.request.Request(
        f"{BASE}/api/videos/upload?project={pid}",
        data=body,
        method="POST",
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    with urllib.request.urlopen(req, timeout=120) as res:
        return json.loads(res.read())


def patch_slot(pid: str, slot: int, title: str):
    return request("PATCH", f"/api/videos?project={pid}", body={"slot": slot, "title": title})


# ---------------------------------------------------------------- 页面模板
# 每个页面：自包含（零外部资源）、中文界面、100vh 自适应、适合 iframe 缩放展示。

HTML_CLOCK = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>模拟时钟</title>
<style>
  * { box-sizing: border-box; margin: 0; }
  body { height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 22px;
         background: linear-gradient(145deg, #1e1b4b, #312e81 55%, #1e1b4b); color: #e0e7ff;
         font-family: system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; overflow: hidden; }
  .face { position: relative; width: min(46vh, 260px); aspect-ratio: 1; border-radius: 50%;
          background: radial-gradient(circle at 35% 30%, #4338ca, #1e1b4b 70%);
          border: 6px solid rgba(165,180,252,.35); box-shadow: 0 24px 60px rgba(0,0,0,.45), inset 0 0 30px rgba(99,102,241,.25); }
  .tick { position: absolute; left: 50%; top: 6px; width: 2px; height: 10px; background: rgba(199,210,254,.55);
          transform-origin: 50% calc(min(23vh, 124px)); border-radius: 2px; }
  .tick.major { height: 15px; width: 3px; background: #c7d2fe; }
  .hand { position: absolute; left: 50%; bottom: 50%; transform-origin: 50% 100%; border-radius: 6px; }
  .hour   { width: 7px; height: 27%; margin-left: -3.5px; background: #e0e7ff; }
  .minute { width: 5px; height: 38%; margin-left: -2.5px; background: #a5b4fc; }
  .second { width: 2px; height: 43%; margin-left: -1px; background: #f472b6; }
  .pin { position: absolute; left: 50%; top: 50%; width: 14px; height: 14px; margin: -7px 0 0 -7px;
         border-radius: 50%; background: #f472b6; box-shadow: 0 0 0 4px rgba(244,114,182,.25); }
  .digital { text-align: center; }
  .time { font-size: clamp(26px, 5vh, 38px); font-weight: 700; letter-spacing: 4px; font-variant-numeric: tabular-nums; }
  .date { margin-top: 6px; font-size: clamp(12px, 2.2vh, 15px); color: rgba(199,210,254,.75); letter-spacing: 2px; }
</style>
</head>
<body>
  <div class="face" id="face">
    <div class="hand hour" id="h"></div>
    <div class="hand minute" id="m"></div>
    <div class="hand second" id="s"></div>
    <div class="pin"></div>
  </div>
  <div class="digital">
    <div class="time" id="time">--:--:--</div>
    <div class="date" id="date"></div>
  </div>
<script>
  const face = document.getElementById("face");
  for (let i = 0; i < 60; i++) {
    const t = document.createElement("div");
    t.className = "tick" + (i % 5 === 0 ? " major" : "");
    t.style.transform = "rotate(" + i * 6 + "deg)";
    face.appendChild(t);
  }
  const wd = ["日","一","二","三","四","五","六"];
  function render() {
    const n = new Date();
    const ms = n.getMilliseconds();
    const sec = n.getSeconds() + ms / 1000;
    const min = n.getMinutes() + sec / 60;
    const hr = (n.getHours() % 12) + min / 60;
    document.getElementById("s").style.transform = "rotate(" + sec * 6 + "deg)";
    document.getElementById("m").style.transform = "rotate(" + min * 6 + "deg)";
    document.getElementById("h").style.transform = "rotate(" + hr * 30 + "deg)";
    const p = (v) => String(v).padStart(2, "0");
    document.getElementById("time").textContent = p(n.getHours()) + ":" + p(n.getMinutes()) + ":" + p(n.getSeconds());
    document.getElementById("date").textContent = n.getFullYear() + " 年 " + (n.getMonth() + 1) + " 月 " + n.getDate() + " 日 · 星期" + wd[n.getDay()];
    requestAnimationFrame(render);
  }
  render();
</script>
</body>
</html>
"""

HTML_DASHBOARD = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>营收数据看板</title>
<style>
  * { box-sizing: border-box; margin: 0; }
  body { height: 100vh; display: flex; align-items: center; justify-content: center; padding: 3vh 4vw;
         background: #0f172a; color: #e2e8f0; font-family: system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; overflow: hidden; }
  .board { width: min(92%, 780px); }
  .head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 2.4vh; }
  .head h1 { font-size: clamp(16px, 3vh, 22px); letter-spacing: 1px; }
  .head span { font-size: clamp(10px, 1.8vh, 12px); color: #64748b; }
  .cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
  .card { background: linear-gradient(160deg, #1e293b, #172033); border: 1px solid rgba(148,163,184,.14);
          border-radius: 14px; padding: 2vh 1.2vw; }
  .card p { font-size: clamp(10px, 1.9vh, 12px); color: #94a3b8; }
  .card .v { margin-top: 6px; font-size: clamp(18px, 3.6vh, 28px); font-weight: 700; font-variant-numeric: tabular-nums; }
  .delta { margin-top: 4px; font-size: clamp(10px, 1.9vh, 12px); font-weight: 600; }
  .up { color: #34d399; } .down { color: #f87171; }
  .chart { margin-top: 2.4vh; background: #1e293b80; border: 1px solid rgba(148,163,184,.14); border-radius: 14px; padding: 2vh 1.4vw; }
  .chart h2 { font-size: clamp(11px, 2vh, 13px); color: #94a3b8; font-weight: 500; margin-bottom: 1.6vh; }
  .bars { display: flex; align-items: flex-end; gap: 2.2%; height: min(20vh, 130px); }
  .bar { flex: 1; border-radius: 5px 5px 2px 2px; background: linear-gradient(180deg, #818cf8, #4f46e5);
         animation: grow 1.1s cubic-bezier(.2,.7,.3,1) backwards; position: relative; }
  .bar:nth-child(6) { background: linear-gradient(180deg, #fbbf24, #f59e0b); }
  .bar i { position: absolute; left: 0; right: 0; bottom: -18px; font-style: normal; font-size: 9px; color: #64748b; text-align: center; }
  @keyframes grow { from { height: 0; } }
  .x { margin-top: 22px; display: flex; gap: 2.2%; }
  .x span { flex: 1; text-align: center; font-size: 9px; color: #64748b; }
</style>
</head>
<body>
  <div class="board">
    <div class="head"><h1>营收数据看板</h1><span>数据更新于 09:41 · 近 30 天</span></div>
    <div class="cards">
      <div class="card"><p>今日访问（UV）</p><div class="v">128,654</div><div class="delta up">▲ 12.4% 环比</div></div>
      <div class="card"><p>支付转化率</p><div class="v">4.86%</div><div class="delta up">▲ 0.6 个百分点</div></div>
      <div class="card"><p>退款率</p><div class="v">1.92%</div><div class="delta down">▼ 0.3 个百分点</div></div>
    </div>
    <div class="chart">
      <h2>近 12 周成交额（万元）</h2>
      <div class="bars" id="bars"></div>
      <div class="x" id="x"></div>
    </div>
  </div>
<script>
  const vals = [42, 55, 48, 63, 71, 58, 76, 69, 84, 79, 92, 105];
  const bars = document.getElementById("bars");
  const xs = document.getElementById("x");
  vals.forEach((v, i) => {
    const b = document.createElement("div");
    b.className = "bar";
    b.style.height = (v / 105 * 100) + "%";
    b.style.animationDelay = (i * 0.07) + "s";
    b.title = "第 " + (i + 1) + " 周：" + v + " 万";
    bars.appendChild(b);
    const t = document.createElement("span");
    t.textContent = "W" + (i + 1);
    xs.appendChild(t);
  });
</script>
</body>
</html>
"""

HTML_WEATHER = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>今日天气</title>
<style>
  * { box-sizing: border-box; margin: 0; }
  body { height: 100vh; display: flex; align-items: center; justify-content: center;
         background: linear-gradient(180deg, #38bdf8 0%, #7dd3fc 45%, #bae6fd 100%);
         color: #0c4a6e; font-family: system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; overflow: hidden; }
  .wrap { width: min(88%, 620px); }
  .top { display: flex; align-items: center; justify-content: space-between; }
  .city { font-size: clamp(14px, 2.6vh, 18px); font-weight: 600; letter-spacing: 2px; }
  .temp { font-size: clamp(52px, 12vh, 88px); font-weight: 200; line-height: 1; font-variant-numeric: tabular-nums; }
  .temp sup { font-size: .38em; font-weight: 400; }
  .desc { margin-top: 4px; font-size: clamp(12px, 2.2vh, 15px); color: #075985; }
  .sun { position: relative; width: min(16vh, 96px); aspect-ratio: 1; }
  .core { position: absolute; inset: 18%; border-radius: 50%; background: radial-gradient(circle at 35% 32%, #fef9c3, #fbbf24);
          box-shadow: 0 0 40px rgba(251,191,36,.8); animation: pulse 4s ease-in-out infinite; }
  .ray { position: absolute; left: 50%; top: 50%; width: 3px; height: 46%; transform-origin: 50% 0;
         background: linear-gradient(180deg, rgba(251,191,36,.9), transparent); border-radius: 3px;
         animation: spin 22s linear infinite; }
  .cloud { position: absolute; background: rgba(255,255,255,.92); border-radius: 999px; filter: blur(1px);
           box-shadow: 0 10px 24px rgba(2,132,199,.18); animation: drift 9s ease-in-out infinite alternate; }
  .c1 { width: 130px; height: 34px; right: 6%; bottom: 16%; }
  .c1::after { content: ""; position: absolute; left: 22%; top: -60%; width: 46%; height: 150%; background: inherit; border-radius: 50%; }
  .c2 { width: 90px; height: 24px; left: 10%; top: 8%; opacity: .75; animation-duration: 13s; }
  .week { margin-top: 4.5vh; display: grid; grid-template-columns: repeat(7, 1fr); gap: 8px; }
  .day { background: rgba(255,255,255,.5); border: 1px solid rgba(255,255,255,.65); backdrop-filter: blur(4px);
         border-radius: 12px; padding: 1.4vh 0; text-align: center; }
  .day b { display: block; font-size: clamp(10px, 1.9vh, 12px); font-weight: 600; }
  .day span { display: block; margin-top: 4px; font-size: clamp(10px, 1.9vh, 12px); color: #0369a1; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes pulse { 50% { transform: scale(1.06); } }
  @keyframes drift { from { transform: translateX(-10px); } to { transform: translateX(14px); } }
</style>
</head>
<body>
  <div class="wrap">
    <div class="top">
      <div>
        <div class="city">杭州 · 西湖区</div>
        <div class="temp">27<sup>°C</sup></div>
        <div class="desc">晴间多云 · 空气质量 优 · 东南风 3 级</div>
      </div>
      <div class="sun">
        <div class="core"></div>
        <div class="ray" style="transform:rotate(0deg)"></div>
        <div class="ray" style="transform:rotate(45deg)"></div>
        <div class="ray" style="transform:rotate(90deg)"></div>
        <div class="ray" style="transform:rotate(135deg)"></div>
        <div class="ray" style="transform:rotate(180deg)"></div>
        <div class="ray" style="transform:rotate(225deg)"></div>
        <div class="ray" style="transform:rotate(270deg)"></div>
        <div class="ray" style="transform:rotate(315deg)"></div>
      </div>
    </div>
    <div class="cloud c1"></div>
    <div class="cloud c2"></div>
    <div class="week">
      <div class="day"><b>周一</b><span>28° 21°</span></div>
      <div class="day"><b>周二</b><span>29° 22°</span></div>
      <div class="day"><b>周三</b><span>26° 20°</span></div>
      <div class="day"><b>周四</b><span>24° 19°</span></div>
      <div class="day"><b>周五</b><span>25° 20°</span></div>
      <div class="day"><b>周六</b><span>27° 21°</span></div>
      <div class="day"><b>周日</b><span>28° 22°</span></div>
    </div>
  </div>
</body>
</html>
"""

HTML_MUSIC = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>正在播放</title>
<style>
  * { box-sizing: border-box; margin: 0; }
  body { height: 100vh; display: flex; align-items: center; justify-content: center; gap: clamp(18px, 5vw, 52px); padding: 4vh 5vw;
         background: linear-gradient(150deg, #17111f, #2a1a3e 60%, #17111f); color: #f3e8ff;
         font-family: system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; overflow: hidden; }
  .cover { position: relative; width: min(30vh, 190px); aspect-ratio: 1; border-radius: 22px; overflow: hidden;
           background: conic-gradient(from 210deg, #a855f7, #6366f1, #ec4899, #a855f7);
           box-shadow: 0 26px 70px rgba(168,85,247,.4); animation: spin 16s linear infinite; }
  .cover::after { content: ""; position: absolute; left: 50%; top: 50%; width: 26%; height: 26%;
                  transform: translate(-50%,-50%); border-radius: 50%; background: #17111f; border: 5px solid rgba(243,232,255,.25); }
  .cover .note { position: absolute; right: 12%; top: 10%; font-size: clamp(22px, 5vh, 34px); color: rgba(255,255,255,.85); }
  .info { min-width: 0; width: min(46%, 330px); }
  .kicker { font-size: clamp(10px, 1.8vh, 12px); letter-spacing: 3px; color: rgba(243,232,255,.6); }
  .song { margin-top: 8px; font-size: clamp(20px, 4.2vh, 30px); font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .artist { margin-top: 6px; font-size: clamp(12px, 2.3vh, 15px); color: rgba(243,232,255,.72); }
  .bar { margin-top: 3vh; height: 5px; border-radius: 999px; background: rgba(243,232,255,.18); overflow: hidden; }
  .bar i { display: block; height: 100%; width: 38%; border-radius: 999px;
           background: linear-gradient(90deg, #c084fc, #f0abfc); animation: sweep 8.5s linear infinite; }
  .times { display: flex; justify-content: space-between; margin-top: 8px; font-size: clamp(10px, 1.8vh, 12px);
           color: rgba(243,232,255,.55); font-variant-numeric: tabular-nums; }
  .ctrl { margin-top: 3vh; display: flex; align-items: center; gap: 18px; }
  .ctrl button { all: unset; cursor: pointer; display: grid; place-items: center; border-radius: 50%; }
  .side { width: 44px; height: 44px; border: 1.5px solid rgba(243,232,255,.3); color: #f3e8ff; transition: background .2s; }
  .side:hover { background: rgba(243,232,255,.12); }
  .main { width: 58px; height: 58px; background: #f3e8ff; color: #2a1a3e; box-shadow: 0 12px 30px rgba(240,171,252,.45); }
  .main::before { content: ""; width: 0; height: 0; border-left: 16px solid currentColor; border-top: 10px solid transparent; border-bottom: 10px solid transparent; margin-left: 4px; }
  .side.prev::before { content: ""; width: 0; height: 0; border-right: 11px solid currentColor; border-top: 7px solid transparent; border-bottom: 7px solid transparent; }
  .side.next::before { content: ""; width: 0; height: 0; border-left: 11px solid currentColor; border-top: 7px solid transparent; border-bottom: 7px solid transparent; }
  .eq { margin-top: 3vh; display: flex; align-items: flex-end; gap: 4px; height: 34px; }
  .eq i { width: 4px; border-radius: 2px; background: #c084fc; animation: bounce 1s ease-in-out infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes sweep { from { width: 6%; } to { width: 96%; } }
  @keyframes bounce { 0%,100% { height: 30%; } 50% { height: 96%; } }
</style>
</head>
<body>
  <div class="cover"><span class="note">♪</span></div>
  <div class="info">
    <div class="kicker">NOW PLAYING</div>
    <div class="song">星河入梦</div>
    <div class="artist">云屿乐队 · 专辑《夜航西飞》</div>
    <div class="bar"><i></i></div>
    <div class="times"><span>01:26</span><span>03:45</span></div>
    <div class="ctrl">
      <button class="side prev" aria-label="上一首"></button>
      <button class="main" aria-label="播放"></button>
      <button class="side next" aria-label="下一首"></button>
    </div>
    <div class="eq" aria-hidden="true">
      <i style="animation-delay:0s"></i><i style="animation-delay:.15s"></i><i style="animation-delay:.3s"></i>
      <i style="animation-delay:.45s"></i><i style="animation-delay:.2s"></i><i style="animation-delay:.5s"></i>
      <i style="animation-delay:.1s"></i><i style="animation-delay:.35s"></i>
    </div>
  </div>
</body>
</html>
"""

HTML_CHAT = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>项目讨论组</title>
<style>
  * { box-sizing: border-box; margin: 0; }
  body { height: 100vh; display: flex; align-items: center; justify-content: center; padding: 3vh 4vw;
         background: #eef2f7; color: #0f172a; font-family: system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; overflow: hidden; }
  .phone { width: min(88%, 400px); height: min(92%, 560px); display: flex; flex-direction: column;
           background: #f8fafc; border-radius: 24px; overflow: hidden; border: 1px solid #e2e8f0;
           box-shadow: 0 30px 80px rgba(15,23,42,.18); }
  .top { display: flex; align-items: center; gap: 12px; padding: 2vh 18px; background: #fff; border-bottom: 1px solid #e2e8f0; }
  .avatar { width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center; color: #fff; font-weight: 700;
            background: linear-gradient(135deg, #34d399, #059669); }
  .who b { display: block; font-size: 15px; }
  .who span { font-size: 11px; color: #10b981; }
  .msgs { flex: 1; padding: 2.2vh 16px; display: flex; flex-direction: column; gap: 10px; overflow: hidden; }
  .row { display: flex; gap: 8px; align-items: flex-end; }
  .row.me { flex-direction: row-reverse; }
  .mini { width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; font-size: 11px; color: #fff; flex: none; }
  .bubble { max-width: 72%; padding: 9px 13px; border-radius: 16px; font-size: 13px; line-height: 1.55; }
  .them { background: #fff; border: 1px solid #e2e8f0; border-bottom-left-radius: 5px; }
  .mine { background: linear-gradient(135deg, #10b981, #059669); color: #fff; border-bottom-right-radius: 5px; }
  .sys { align-self: center; font-size: 10px; color: #94a3b8; background: #eef2f7; padding: 3px 10px; border-radius: 999px; }
  .typing { display: inline-flex; gap: 4px; align-items: center; }
  .typing i { width: 5px; height: 5px; border-radius: 50%; background: #94a3b8; animation: blink 1.2s infinite; }
  .typing i:nth-child(2) { animation-delay: .2s; } .typing i:nth-child(3) { animation-delay: .4s; }
  .input { display: flex; gap: 10px; padding: 1.6vh 14px 2.2vh; background: #fff; border-top: 1px solid #e2e8f0; }
  .input .field { flex: 1; background: #f1f5f9; border-radius: 999px; padding: 10px 16px; font-size: 13px; color: #94a3b8; }
  .send { width: 38px; height: 38px; border-radius: 50%; display: grid; place-items: center; background: #10b981; color: #fff; }
  .send::before { content: ""; width: 0; height: 0; border-left: 12px solid currentColor; border-top: 7px solid transparent; border-bottom: 7px solid transparent; margin-left: 3px; }
  @keyframes blink { 0%,100% { opacity: .25; transform: translateY(0); } 50% { opacity: 1; transform: translateY(-3px); } }
</style>
</head>
<body>
  <div class="phone">
    <div class="top">
      <div class="avatar">陈</div>
      <div class="who"><b>项目讨论组（5）</b><span>● 3 人在线</span></div>
    </div>
    <div class="msgs">
      <div class="sys">今天 09:30</div>
      <div class="row"><div class="mini" style="background:#6366f1">林</div><div class="bubble them">早，v2 的布局方案我放到看板了，帮忙看下 3×2 那版。</div></div>
      <div class="row me"><div class="bubble mine">收到，矩阵间距我再调大一点，对比起来更舒服。</div></div>
      <div class="row"><div class="mini" style="background:#f59e0b">王</div><div class="bubble them">HTML 页面的沙箱策略确认过了，脚本可以跑，跨域被隔离，安全。</div></div>
      <div class="row me"><div class="bubble mine">👍 那下午就按这个出演示。</div></div>
      <div class="row"><div class="mini" style="background:#6366f1">林</div><div class="bubble them"><span class="typing"><i></i><i></i><i></i></span></div></div>
    </div>
    <div class="input">
      <div class="field">输入消息…</div>
      <div class="send" aria-hidden="true"></div>
    </div>
  </div>
</body>
</html>
"""

HTML_MONITOR = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>系统运行监控</title>
<style>
  * { box-sizing: border-box; margin: 0; }
  body { height: 100vh; display: flex; align-items: center; justify-content: center; padding: 3vh 4vw;
         background: #05080f; color: #9ae6b4; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "PingFang SC", monospace; overflow: hidden; }
  .panel { width: min(94%, 700px); }
  .head { display: flex; align-items: center; gap: 10px; margin-bottom: 2.2vh; }
  .dot { width: 9px; height: 9px; border-radius: 50%; background: #22c55e; box-shadow: 0 0 12px #22c55e; animation: blink 2s infinite; }
  .head h1 { font-size: clamp(13px, 2.4vh, 16px); letter-spacing: 2px; color: #d1fae5; font-weight: 600; }
  .head span { margin-left: auto; font-size: clamp(9px, 1.8vh, 11px); color: #4ade8088; }
  .grid { display: grid; grid-template-columns: 1.6fr 1fr; gap: 12px; }
  .box { border: 1px solid #14532d66; background: #07130b; border-radius: 12px; padding: 1.8vh 1vw; }
  .box h2 { font-size: clamp(10px, 1.9vh, 12px); color: #4ade80aa; font-weight: 500; margin-bottom: 1.2vh; letter-spacing: 1px; }
  svg { width: 100%; height: min(21vh, 150px); display: block; }
  .metric { margin-top: 1.4vh; }
  .metric .lbl { display: flex; justify-content: space-between; font-size: clamp(9px, 1.8vh, 11px); color: #86efaccc; }
  .track { margin-top: 5px; height: 7px; background: #14532d55; border-radius: 999px; overflow: hidden; }
  .fill { height: 100%; border-radius: 999px; background: linear-gradient(90deg, #16a34a, #4ade80); transition: width .8s ease; }
  .fill.warn { background: linear-gradient(90deg, #ca8a04, #facc15); }
  .kvs { margin-top: 1.2vh; font-size: clamp(9px, 1.8vh, 11px); line-height: 1.9; color: #86efacaa; }
  .kvs b { color: #bbf7d0; font-weight: 600; }
  @keyframes blink { 50% { opacity: .35; } }
</style>
</head>
<body>
  <div class="panel">
    <div class="head"><span class="dot"></span><h1>系统运行监控 · NODE-07</h1><span id="clock"></span></div>
    <div class="grid">
      <div class="box">
        <h2>请求吞吐（req/s · 近 60 秒）</h2>
        <svg viewBox="0 0 300 120" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stop-color="#22c55e" stop-opacity=".45"/>
              <stop offset="1" stop-color="#22c55e" stop-opacity="0"/>
            </linearGradient>
          </defs>
          <polyline id="line" fill="none" stroke="#4ade80" stroke-width="1.6" points=""/>
          <polygon id="area" fill="url(#g)" points=""/>
        </svg>
      </div>
      <div class="box">
        <h2>资源占用</h2>
        <div class="metric"><div class="lbl"><span>CPU</span><span id="cpuV">--%</span></div><div class="track"><div class="fill" id="cpu" style="width:0%"></div></div></div>
        <div class="metric"><div class="lbl"><span>内存</span><span id="memV">--%</span></div><div class="track"><div class="fill" id="mem" style="width:0%"></div></div></div>
        <div class="metric"><div class="lbl"><span>磁盘</span><span id="dskV">--%</span></div><div class="track"><div class="fill" id="dsk" style="width:0%"></div></div></div>
        <div class="kvs">运行时长 <b id="up">--</b> · 活跃连接 <b id="conn">--</b></div>
      </div>
    </div>
  </div>
<script>
  const N = 60;
  const data = Array.from({ length: N }, () => 30 + Math.random() * 35);
  const line = document.getElementById("line");
  const area = document.getElementById("area");
  const p = (v) => String(v).padStart(2, "0");

  function draw() {
    const pts = data.map((v, i) => (i * (300 / (N - 1))).toFixed(1) + "," + (118 - v).toFixed(1));
    line.setAttribute("points", pts.join(" "));
    area.setAttribute("points", "0,118 " + pts.join(" ") + " 300,118");
  }
  function tick() {
    data.shift();
    data.push(28 + Math.random() * 46);
    draw();
    const cpu = 22 + Math.random() * 55, mem = 40 + Math.random() * 32, dsk = 61 + Math.random() * 6;
    const set = (id, v) => {
      document.getElementById(id).style.width = v + "%";
      document.getElementById(id + "V").textContent = v.toFixed(1) + "%";
    };
    set("cpu", cpu); set("mem", mem); set("dsk", dsk);
    document.getElementById("cpu").classList.toggle("warn", cpu > 70);
    document.getElementById("conn").textContent = (820 + Math.floor(Math.random() * 160));
    const s = Math.floor(performance.now() / 1000) + 3600 * 42 + 735;
    document.getElementById("up").textContent = p(Math.floor(s / 86400)) + "d " + p(Math.floor(s % 86400 / 3600)) + "h " + p(Math.floor(s % 3600 / 60)) + "m";
    const n = new Date();
    document.getElementById("clock").textContent = p(n.getHours()) + ":" + p(n.getMinutes()) + ":" + p(n.getSeconds());
  }
  draw();
  tick();
  setInterval(tick, 1200);
</script>
</body>
</html>
"""

PAGES = [
    ("clock.html", "模拟时钟（实时走针）", HTML_CLOCK),
    ("dashboard.html", "营收数据看板", HTML_DASHBOARD),
    ("weather.html", "今日天气", HTML_WEATHER),
    ("music.html", "音乐播放器", HTML_MUSIC),
    ("chat.html", "项目讨论组", HTML_CHAT),
    ("monitor.html", "系统运行监控", HTML_MONITOR),
]


def main():
    projects = list_projects()
    old = next((p for p in projects if p["name"] == PROJECT_NAME), None)
    if old:
        print(f"发现同名项目 {old['id']}，先删除重建以保证幂等")
        delete_project(old["id"])

    proj = create_project(PROJECT_NAME)
    pid = proj["id"]
    print(f"已创建项目「{PROJECT_NAME}」 id={pid}")

    manifest = set_layout(pid, 6, 2, 3)
    assert manifest["count"] == 6 and manifest["layout"] == {"rows": 2, "cols": 3}, manifest
    print("布局已设为 3×2（6 位）")

    with tempfile.TemporaryDirectory() as tmp:
        for slot, (filename, title, content) in enumerate(PAGES):
            path = os.path.join(tmp, filename)
            with open(path, "w", encoding="utf-8") as f:
                f.write(content)
            res = upload_html(pid, slot, path, filename)
            slot_view = res["slots"][slot]
            assert slot_view.get("html"), f"slot {slot} 上传后未出现 html 字段: {slot_view}"
            patch_slot(pid, slot, title)
            print(f"  位 {slot + 1}: {filename} → 「{title}」（{len(content.encode('utf-8'))} 字节）")

    final = next(p for p in list_projects() if p["id"] == pid)
    assert len(final["items"]) == 6, final
    kinds = {it["kind"] for it in final["items"]}
    assert kinds == {"html"}, kinds
    print(f"完成：「{PROJECT_NAME}」共 {len(final['items'])} 个条目，全部为 HTML")


if __name__ == "__main__":
    main()
