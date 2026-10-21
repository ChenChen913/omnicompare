# 录制舞台：16:9 / 9:16 无间隙 + 高质量录制

> 状态（2026-10-21）：Phase 2 录制舞台、Phase 3 应用内录屏、Phase 4 清晰度与标签/竖屏/停顿剪辑均已落地；真实项目验证通过。

## 1. 解决什么问题

Phase 1 解决了"页面能暂停/继续/重来"，但录屏画面里仍有管理 UI：顶栏、侧栏、文件信息行、HTML 角标、卡片圆角与间隙、提示词/水印层。用户拿 OBS 录窗口时还需要手动裁切，且 4 路内容起跑不同步。

录制舞台把"工作台"切换成"成品画布"：只留内容，固定 16:9，倒计时后视频与 HTML 同时开演。

## 2. 使用流程

1. 顶栏点「录制」（无内容时禁用）。
2. 自动请求全屏（扩大捕获源；失败则继续窗口模式），然后请求屏幕捕获。
3. 有 HTML 时先显示「页面备场中」：全部 iframe 以 `oc_hold=1` 重载，等运行时报告 ready；12 秒未齐则强制进入倒计时。
4. 显示 3-2-1 倒计时（每秒一跳）。
5. 归零瞬间：
   - HTML：广播统一的 `play`（`at = now + 100ms`），各卡在同一合成帧恢复；
   - 视频 / 背景音乐：`restartAndPlay` 归零后同步起播。
6. 进入 live：遮罩消失，画面只剩内容。
7. 录制中快捷键：

| 键 | 行为 |
|---|---|
| `Space` | 暂停/继续；默认同步 `MediaRecorder.pause()`，停顿不会进入成片 |
| `A` | 切换 16:9 → 9:16 → 1:1 |
| `L` | 显示/隐藏模型标签 |
| `P` | 开关「停顿剪辑」：关掉后暂停段会以冻结帧保留 |
| `R` | 重来（网页重载、视频归零） |
| `Esc` | 停止录制并下载 |

8. 右上角「停止并保存 · Esc」按钮默认透明，鼠标悬停才显现；悬停 title 会显示实际捕获规格（分辨率/帧率/目标码率）。

## 3. 视觉规则

- 舞台严格按所选比例：16:9 / 9:16 / 1:1，`width: min(100vw, 100vh*W/H)`、`height: min(100vh, 100vw*H/W)`；按 `A` 切换。
- 只渲染已填充内容位，不再显示空位/占位格。
- 紧凑矩阵：≤1 个 → 1 列；≤4 个 → 2 列（4 个正好 2×2）；更多 → 最多 3 列。
- `gap: 0`；`data-record-stage` 上的全局 CSS 去掉卡片圆角、边框与阴影。
- 13 类 UI 全部隐藏：顶栏、侧栏、专注按钮、提示词/署名、水印、信息行、标题、位置编号、HTML/图片角标、单卡暂停按钮、拖拽提示、退出按钮默认透明。
- 卡片内容按所选比例渲染；4 个内容正好铺满，2 个内容时居中留黑。
- 模型标签：录制态把每张卡的标题画在左下角（`L` 开关）；标题为空则不显示。

## 4. 实现位置

- `src/components/video/video-wall.tsx`
  - `recording` / `recPhase`（`idle | loading | countdown | live`）/ `recCount` 状态；
  - `handleEnterRecord` 与 `exitRecording`；
  - 备场 effect：`htmlReadySet.length >= htmlCount` → countdown；
  - 倒计时 effect：归零后 `sendHtmlCommand('play', ...)` + `restartAndPlay`；
  - 渲染：隐藏 TopBar/Sidebar/Focus 按钮，grid 改为舞台样式，卡片 props 覆盖。
- `src/components/video/wall/top-bar.tsx`：顶栏「录制」按钮（`aria-label="进入录制舞台"`）。
- `src/app/globals.css`：`[data-record-stage='true'] > *` 去圆角/边框/阴影。
- `src/components/video/video-card.tsx`：`showInfo=false` 时同时隐藏 HTML/图片角标，保证录制画面干净。

## 5. 应用内录屏（Phase 3）

点「录制」时浏览器会先请求屏幕捕获：

1. Chrome 通过 `preferCurrentTab` 默认选中当前标签页（也可手动改选）；
2. 授权后进入舞台备场/倒计时，**倒计时归零才开始写数据**，录到的第一帧就是动画起点；
3. 录制中右上角按钮变为「停止并保存 · Esc」（默认透明，悬停才显现）；
4. `Esc` 或点该按钮：停止 MediaRecorder，生成 WebM 并自动下载，文件名 `omnicompare-YYYYMMDD-HHmmss.webm`；
5. 拒绝授权/浏览器不支持：舞台照常进入，提示「未开启应用内录屏：仍可排练，或用 OBS 捕获本窗口」。

录制态快捷键：

| 键 | 行为 |
|---|---|
| `Space` | HTML 与视频同时暂停 / 继续（默认同步暂停录制器，停顿不入片） |
| `A` | 切换 16:9 / 9:16 / 1:1 |
| `L` | 显示/隐藏模型标签 |
| `P` | 开关「停顿剪辑」 |
| `R` | HTML 重载 + 视频/BGM 归零，从头开始 |
| `Esc` | 停止录制并保存、退出舞台 |

实现：

- `src/lib/screen-recorder.ts`：`requestTabCapture`（10s 超时、失败返回 null；只约束 60fps，不请求 width/height）、`createTabRecorder`（按实际捕获分辨率动态算码率：0.25 bit/像素/帧，20–80Mbps；VP9+Opus WebM，192kbps 音频）、`downloadRecording`、`recordingFilename`。
- `video-wall.tsx`：`recStreamRef` / `recorderRef` / `recChunksRef`；倒计时归零 `beginRecorder()`；`stopRecorder()` 在 `onstop` 里组装 Blob；捕获流 `ended` 时自动停止。

注意：

- 需要安全上下文：`localhost` 可以；局域网 `http://192.168.x.x` 浏览器会禁用 `mediaDevices`，此时自动降级到 OBS 方案。
- 标签页音频是否入轨取决于浏览器与共享选项；画面始终捕获。
- 自动下载可能触发浏览器的"允许多个文件下载"提示，允许一次即可。

## 6. 清晰度（Phase 4）

先给结论：**标签页捕获的清晰度上限由「源分辨率 × 编码码率」决定，请求 4K 不会增加细节**。

- MDN 明确说明：`getDisplayMedia` 的 `width` / `height` 约束是**在用户选完源之后对画面做缩放**，不会限制或提升源的分辨率（[MDN](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Capture_API/Using_Screen_Capture)）。所以运行时**不请求 width/height**，只约束 `frameRate: 60`，分辨率交给浏览器原生输出。
- 提高清晰度的两个有效杠杆：
  1. **全屏**：进入录制时自动 `requestFullscreen()`，视口从 1600×900 变成屏幕大小，标签页捕获的源分辨率随之提高；失败则继续窗口模式。
  2. **码率**：旧版固定 12Mbps 是画面发软的主因。新版按 `width × height × fps × 0.25` 动态计算，下限 20Mbps、上限 80Mbps；1600×900@60 ≈ 21.6M，1080p60 ≈ 31M，4K60 封顶 80M。音频 192kbps。
- 实测 MediaRecorder 的实际码率通常只有目标的 60–80%：真实 1872×896@30 视频、目标 25Mbps，VP9 实际约 16Mbps；所以目标值必须往上给。
- 编码仍用 **VP9 + Opus WebM**。浏览器虽然支持 `video/mp4;codecs=avc1,...`，但实测录出的 MP4 里没有 `mp4a` 音轨（BGM 丢失），因此不默认 MP4；需要 MP4 时建议后期转码。
- 录制开始后读取 `videoTrack.getSettings()`，把真实捕获的 `宽×高@fps` 和目标码率显示在「停止并保存」按钮的 title 里；若捕获宽度明显小于窗口，会提示"全屏或放大窗口可提升清晰度"。

4K 的边界：标签页捕获不可能超过捕获源的物理像素。想在应用内录 4K，需要 **4K 显示器 + 全屏**（或系统缩放 100%），否则只能录到窗口/屏幕的实际分辨率；要稳定 4K/60，仍建议 OBS 捕获 4K 窗口。

## 7. 实测（2026-10-21，1600×900 浏览器视口）

| 场景 | 结果 |
|---|---|
| 4 个视频（`ds4.1-1017`） | 舞台 1585×892（比例 1.778）、4 格、gap 0、4 个 video 均 `paused=false`、顶栏/侧栏隐藏 |
| 2 个 HTML（`html-test`） | 2 格、16:9 面板居中、上下留黑、无角标、无管理 UI |
| 混合 2 HTML + 2 视频（临时项目） | 4 格 2×2、2 个 iframe + 2 个 video 同时在播、无顶栏/侧栏 |
| 退出 | `Esc` 后顶栏恢复、舞台属性消失 |
| 倒计时 | loading → 3 → 2 → 1 → live，HTML 在 live 前保持冻结 |
| 应用内录屏（canvas 流模拟标签页捕获） | 录制中按钮变「停止并保存」；Esc 后提示「录制已保存」，实际下载 `omnicompare-20261021-093140.webm`（257,395 字节） |
| 1920×1080@30 合成流 | `data-rec-meta=1920x1080@30:20000000`（20Mbps 下限生效），4 个模型标签可见 |
| `A` 比例切换 | 16:9 → 1.778、9:16 → 0.563、1:1 → 1.000，舞台即时重排 |
| `L` 标签开关 | 开：4 个模型名可见；关：全部隐藏 |
| 空格停顿剪辑 | 暂停时 `data-rec-paused=true`、4 路视频 paused；恢复后 false、全部在播 |
| 退出 | `Esc` 后顶栏恢复、舞台属性消失、提示「录制已保存」 |
| 拒绝屏幕捕获 | 舞台正常进入，提示 OBS 兜底，无崩溃 |

临时混合项目验证后已删除，未污染用户项目。

## 8. 边界与后续

- 2 个内容时按所选比例居中留黑；4 个是推荐配置。
- 3 个内容为 2 列 × 2 行，右下角留一格黑。
- 录制舞台不显示信息行/提示词/水印；模型标签可按 `L` 显示卡片标题，需要片头字幕建议后期加。
- 应用内录屏依赖浏览器屏幕捕获授权：自动化只验证了 canvas 合成流与下载链路，真实标签页捕获需要你手动点一次"允许"。
- 4K：需要 4K 显示器 + 全屏（或系统缩放 100%）；标签页捕获不能超过源像素，无法在 1080p 窗口里凭空录出 4K。
- 编码为 WebM（VP9+Opus）；Chrome 的 MP4 录制实测会丢音轨，需要 MP4 建议后期转码。
- 录制前请把浏览器切到前台：浏览器对后台标签页会把 rAF 限到约 20fps；进入录制时若 `document.hasFocus()` 为 false 会弹一次提醒。
- Safari / macOS 的屏幕捕获行为未实测。
