# HTML 动画播放控制：调研、决策与实施

> 状态（2026-10-21）：调研完成；v3 运行时在 24 页语料上验证通过；**服务端注入与前端控制 UI 均已落地**（`src/lib/html-control.ts` + `/api/files` + `/api/bundles` + 卡片/顶栏/专注模式控制）；真实项目 `html-test` 端到端验证通过。

## 1. 问题

OmniCompare 把多个 AI 生成的单文件动效网页放进 2×2 矩阵并行对比并录屏。iframe 使用 `sandbox="allow-scripts"`，页面是 opaque origin，父页面无法访问其 DOM/变量。AI 页面打开即自动播放，当前只能「刷新全部」重载，无法在录制现场暂停、继续或同帧起跑。

## 2. 调研结论

### 2.1 按"时间源"分类，而不是按库名

暂停/恢复的难度只取决于动画的时间由谁推进。规范层面至少有 9 类：

| 时间源 | 典型形态 | 控制 API | 关键限制 |
|---|---|---|---|
| 文档时间线 | CSS keyframes/transition、WAAPI | `document.getAnimations()`、`animation-play-state` | 集合只含这三类；只返回 in-effect 动画；对未开始的无限动画 `pause()` 可能抛 `InvalidStateError` |
| SVG 独立时钟 | SMIL | `svg.pauseAnimations()` / `setCurrentTime()` | 只对本文档 `<svg>` 有效，`<img src=svg>` 够不着 |
| 媒体管线 | video/audio | `pause()` / `currentTime` | 不覆盖 CSS；多路 `play()` 有几十毫秒偏差 |
| 滚动偏移 | `animation-timeline`、ScrollTrigger/Lenis | 冻结滚动位置 / 调库 API | CSS ScrollTimeline 非 Baseline |
| 主线程时钟 | Canvas、WebGL、Three.js、GSAP | 接管 rAF / 冻结时间源 | 着色器 `u_time` 在闭包内，外部改不了 |
| 定时器/墙钟 | setInterval、Date.now | 无原生暂停，只能替换时钟 | Playwright Clock 是唯一有文档的整页虚拟时钟，但不覆盖 CSS/SMIL/媒体 |
| 音频时钟 | Web Audio | `AudioContext.suspend()` | OfflineAudioContext 直接抛错 |
| 解码器 | GIF/APNG | 无任何 API | 比 Worker 更彻底 |
| Worker | Worker/OffscreenCanvas | 无暂停 API | `terminate()` 是终止，不可恢复 |

对称结论：`getAnimations()` 只含 CSS/WAAPI，所以"只接管 rAF"与"只接管 getAnimations"漏掉的是同一批（SMIL/视频/GIF/canvas/worker）。

### 2.2 包装方式决定可控性天花板

- 内联 `<svg>` 的 SMIL 可 `pauseAnimations()`；`<img src="x.svg">` 是独立文档，完全不可控。
- `<img>` 里的 GIF 至少能 `drawImage` 取当前帧做覆盖；CSS `background-image` 连取帧都做不到。
- Spline / YouTube 嵌入是嵌套 iframe，注入够不到，只能靠对方 API。

### 2.3 真实案例证据

- Apple.com 首页现场探针：`video 2 / svg 88 / SMIL 26 / WAAPI 7`，同一页堆叠多种载体。
- B 站 AI 案例主流是 Three.js 单文件大场景 + 自建 rAF/时间系统（如 8674 行 3D 陀飞轮），p5.js 为第二底座。
- YouTube 英文生态主流是 Three.js + GSAP ScrollTrigger + Lenis，"cinematic / Awwwards-level"。
- Playwright `animations: "disabled"` 会把有限动画快进到终态，**会静默跳过开场白色 fade**；截图确定性与动画录制必须两套策略。

## 3. 语料与测试

### 3.1 语料

项目外维护，24 页：

- 基础 14 类：CSS keyframes、WAAPI、SVG SMIL、Canvas2D、原生 WebGL、Three.js、GSAP、视频背景、GIF、setInterval、Date.now、Worker、滚动驱动、混合。
- P0 增补 10 类：shadow DOM + 延迟动画、Lottie、CSS transition、GIF background-image、SVG-in-img、3 秒 preloader、infinite、多 SVG + 视频、ScrollTrigger + Lenis、video + GIF 同页。

### 3.2 关键矩阵

| 类别 | v1（仅 rAF） | v2（分层） | v3（+shadow/重扫/warm） |
|---|---|---|---|
| CSS/WAAPI/SMIL | 失败 | 通过 | 通过 |
| Canvas/WebGL/Three/GSAP | 通过 | 通过 | 通过 |
| 视频 | 失败 | 通过 | 通过 |
| setInterval / Date.now | 失败 | 通过 | 通过 |
| GIF / `<img>` SVG | 失败 | 失败（硬边界） | 失败（硬边界） |
| shadow DOM | 未测 | 失败（0.55% 像素仍变） | **通过** |
| 暂停期间新建动画（preloader transition） | 失败 | 失败（99% 像素变化） | **通过**（冻在 0.79 透明度） |
| 多 SVG + 视频 | — | 通过 | 通过 |
| 滚动驱动 | — | 滚动仍响应（策略） | 同左 |

v3 修复验证：
- shadow 内动画与暂停期间新建的 WAAPI 动画：冻结前后探针完全一致；
- preloader 的 opacity transition（暂停后才创建）：被重扫捕获并冻结；
- Lottie/GSAP 回归：冻结/恢复正常；
- 多 SVG + 视频：12 个 SVG 与视频同时冻结。

### 3.3 两个产品级发现

1. **沙箱 iframe 是 opaque origin，所有 `fetch`/XHR 都变成跨源。**
   Lottie 用 `path` 加载 JSON 时 `data_failed`，改成内联 `animationData` 才正常。
   → `/api/files` 与 `/api/bundles` 必须补 `Access-Control-Allow-Origin`，否则 bundle 内 JSON/GLTF/贴图读不到。
2. **MIME 决定"能不能动"**：SVG 以 `application/octet-stream` 返回时 `<img>` 不渲染/不动；`image/svg+xml` 才正常。`mimeFromExt` 已覆盖 svg/json/js/css。

## 4. 决策

| 编号 | 决策 | 理由 |
|---|---|---|
| D1 | 注入分层运行时，不放开 sandbox | 安全模型是基石；页面是不可信的 AI 生成内容 |
| D2 | 暂停 = 时间暂停，不锁滚动 | 滚动是用户输入；滚动驱动内容应继续跟随。需要完全静止时用「重来 + 不滚动」 |
| D3 | 就绪 = `load` + 可配置 warmup（默认 1200ms） | 覆盖绝大多数页面；3 秒白幕需要更长 warm 或后续做可见性探测 |
| D4 | 重来 = reload iframe | 命令式页面（Canvas/WebGL/Worker）的累积状态无法用归零 API 回滚 |
| D5 | GIF / `<img>` SVG / 嵌套 iframe 只承诺「重来」 | 无 API，假暂停会误导用户；用能力探测标注 |
| D6 | 文件/包资产补 CORS 与正确 MIME | opaque origin 下 XHR 跨源；MIME 影响渲染 |

## 5. 运行时设计（v3）

注入到每个 HTML 的第一个 `<script>`（字节级插入 `<head>` 后，不破坏 GBK 编码）：

```
freeze:  rAF 队列 → shadow 遍历 getAnimations → SMIL → 媒体 → Lottie → GSAP
         并每 250ms 重扫（覆盖暂停期间新建的动画/媒体/SVG）
thaw:    恢复上述每一层；rAF 用统一墙钟 at 对齐到同一合成帧
reset:   父页面重载 iframe（oc_hold=1 时先备场再释放）
```

协议：

- 父 → 子：`{ __oc: 1, token, action: 'pause' | 'play', at?: number }`
- 子 → 父：`{ __oc: 1, token, type: 'ready' | 'paused' | 'resumed' | 'capabilities' | 'error', data }`
- token 每次挂载随机生成；子页面校验 `source === parent && token`，父页面校验 `source === iframe.contentWindow && token`。
- `capabilities` 上报 canvas/media/SMIL/animations/shadow/gif/svgImage，用于 UI 标注"不可暂停"。

## 6. 服务端改动（已落地）

- `src/lib/html-control.ts`：运行时脚本 + 字节级注入器（幂等、GBK 安全）。
- `/api/files/[name]`：HTML 注入后整文件返回，`Accept-Ranges: none`，补 `Access-Control-Allow-Origin: *`；视频 Range 仍为 206。
- `/api/bundles/[name]/[...path]`：HTML 入口注入；资产补 ACAO。

实测（dev server）：HTML 响应 `200`、`205895` 字节（原文 `198188` + 运行时 `7707`）、CSP 保留、marker 位于 `<head>` 后；MP4 Range 仍 `206`。

## 7. 前端接入（已落地）

- 卡片 `video-card.tsx`：`useId` token、iframe 消息监听（source + token 双重校验）、卡片悬浮暂停/继续、`ready/paused/resumed/capabilities` 状态、能力角标「仅重来」。
- 顶栏 `top-bar.tsx`：纯 HTML 与混合项目显示 `同步开始` / `暂停·继续` / `重来`。
- `video-wall.tsx`：`syncStart` 先让全部卡片以 `oc_hold=1` 重载并备场，收齐 `ready` 后广播同一 `at` 释放（12 秒兜底）；暂停/继续走命令广播；专注模式空格/R 同时作用于 HTML。
- 单卡暂停只影响该卡；混合项目的视频组与 HTML 组各管各的内容类型。

真实 UI 实测（项目 `html-test`，两张 Three.js 页面）：
- 点「同步开始」后两个 iframe 的 `src` 均切为 `oc_hold=1`；
- 点「暂停全部页面」后，1.6 秒内两帧截图 **0.000%** 像素变化；
- 点「继续」后同一区域 11.7% 像素变化，确认恢复；
- 同步前/暂停后画面 9.98% 差异，确认暂停确实发生在动画中途。

## 8. 验收

- 4 路异构（CSS/Canvas/Three/视频）恢复帧时间差 ≤1ms（已由第一阶段验证：0ms）。
- 暂停 30 秒后恢复，虚拟时间前进 ≤2 帧（已验证 10.8–20.5ms）。
- 暂停后画面逐像素不变（已验证 0.000%）。
- preloader：全屏遮罩淡出到 opacity ≤0.15 后才冻结；生产运行时实测 `ready` 时幕布 0.04、1.5 秒内探针完全不变。
- 能力标注与实际行为一致。
- `lint` / `tsc` / `build` 通过；HTML 安全响应头不变。

## 9. 风险与未验证

- Safari / macOS 未测。
- 4K 下 4 路 WebGL + 录屏的 GPU 上限未测。
- 3 秒以上 preloader 的自动就绪判定：已在运行时加入"全屏遮罩检测"，遮罩淡出到 opacity ≤ 0.15 才冻结（样本：ready 1.2s → 3.98s，幕布 0.047）。
- Rive / Spline / Web Audio / APNG 未单独建样本。
- Worker 驱动动画仍只支持重来。
- `getAnimations()` 对 CSS `animation-delay` 阶段的覆盖已在样本中验证可暂停，但不同浏览器可能不同。
