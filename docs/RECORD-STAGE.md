# 录制舞台：16:9 无间隙 + 倒计时同帧开演

> 状态（2026-10-21）：Phase 2 录制舞台 + Phase 3 应用内录屏均已落地；真实项目验证通过。

## 1. 解决什么问题

Phase 1 解决了"页面能暂停/继续/重来"，但录屏画面里仍有管理 UI：顶栏、侧栏、文件信息行、HTML 角标、卡片圆角与间隙、提示词/水印层。用户拿 OBS 录窗口时还需要手动裁切，且 4 路内容起跑不同步。

录制舞台把"工作台"切换成"成品画布"：只留内容，固定 16:9，倒计时后视频与 HTML 同时开演。

## 2. 使用流程

1. 顶栏点「录制」（无内容时禁用）。
2. 有 HTML 时先显示「页面备场中」：全部 iframe 以 `oc_hold=1` 重载，等运行时报告 ready；12 秒未齐则强制进入倒计时。
3. 显示 3-2-1 倒计时（每秒一跳）。
4. 归零瞬间：
   - HTML：广播统一的 `play`（`at = now + 100ms`），各卡在同一合成帧恢复；
   - 视频 / 背景音乐：`restartAndPlay` 归零后同步起播。
5. 进入 live：遮罩消失，画面只剩内容。
6. `Esc` 退出；右上角「退出录制 · Esc」按钮默认透明（opacity 0），鼠标悬停才显现，避免被录进去。

## 3. 视觉规则

- 舞台严格 16:9：`width: min(100vw, 100vh*16/9)`，`height: min(100vh, 100vw*9/16)`。
- 只渲染已填充内容位，不再显示空位/占位格。
- 紧凑矩阵：≤1 个 → 1 列；≤4 个 → 2 列（4 个正好 2×2）；更多 → 最多 3 列。
- `gap: 0`；`data-record-stage` 上的全局 CSS 去掉卡片圆角、边框与阴影。
- 13 类 UI 全部隐藏：顶栏、侧栏、专注按钮、提示词/署名、水印、信息行、标题、位置编号、HTML/图片角标、单卡暂停按钮、拖拽提示、退出按钮默认透明。
- 统一按 16:9 渲染卡片内容；2 个内容时上下留黑居中（16:9 输出里两个 16:9 面板无法同时铺满），4 个内容正好铺满。

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
| `Space` | HTML 与视频同时暂停 / 继续 |
| `R` | HTML 重载 + 视频/BGM 归零，从头开始 |
| `Esc` | 停止录制并保存、退出舞台 |

实现：

- `src/lib/screen-recorder.ts`：`requestTabCapture`（10s 超时、失败返回 null）、`createTabRecorder`（vp9+opus，回落 vp8/纯视频，12Mbps/128kbps）、`downloadRecording`、`recordingFilename`。
- `video-wall.tsx`：`recStreamRef` / `recorderRef` / `recChunksRef`；倒计时归零 `beginRecorder()`；`stopRecorder()` 在 `onstop` 里组装 Blob；捕获流 `ended` 时自动停止。

注意：

- 需要安全上下文：`localhost` 可以；局域网 `http://192.168.x.x` 浏览器会禁用 `mediaDevices`，此时自动降级到 OBS 方案。
- 标签页音频是否入轨取决于浏览器与共享选项；画面始终捕获。
- 自动下载可能触发浏览器的"允许多个文件下载"提示，允许一次即可。

## 6. 实测（2026-10-21，1600×900 浏览器视口）

| 场景 | 结果 |
|---|---|
| 4 个视频（`ds4.1-1017`） | 舞台 1585×892（比例 1.778）、4 格、gap 0、4 个 video 均 `paused=false`、顶栏/侧栏隐藏 |
| 2 个 HTML（`html-test`） | 2 格、16:9 面板居中、上下留黑、无角标、无管理 UI |
| 混合 2 HTML + 2 视频（临时项目） | 4 格 2×2、2 个 iframe + 2 个 video 同时在播、无顶栏/侧栏 |
| 退出 | `Esc` 后顶栏恢复、舞台属性消失 |
| 倒计时 | loading → 3 → 2 → 1 → live，HTML 在 live 前保持冻结 |
| 应用内录屏（canvas 流模拟标签页捕获） | 录制中按钮变「停止并保存」；Esc 后提示「录制已保存」，实际下载 `omnicompare-20261021-093140.webm`（257,395 字节） |
| 拒绝屏幕捕获 | 舞台正常进入，提示 OBS 兜底，无崩溃 |

临时混合项目验证后已删除，未污染用户项目。

## 7. 边界与后续

- 2 个内容时无法既保持 16:9 输出又让两个 16:9 面板铺满，当前选择"上下留黑居中"。
- 3 个内容为 2 列 × 2 行，右下角留一格黑；4 个是推荐配置。
- 录制舞台不显示标题/提示词/水印；若需要片头字幕，建议后期加。
- 应用内录屏依赖浏览器屏幕捕获授权：自动化只验证了 canvas 合成流与下载链路（257KB WebM），真实标签页捕获需要你手动点一次"允许"。
- 录制前请把浏览器切到前台：浏览器对后台标签页会把 rAF 限到约 20fps；进入录制时若 `document.hasFocus()` 为 false 会弹一次提醒。
- Safari / macOS 的屏幕捕获行为未实测。
