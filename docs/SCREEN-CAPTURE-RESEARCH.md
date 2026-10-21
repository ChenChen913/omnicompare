# 屏幕录制清晰度调研报告：为什么 1618×910 做不出真 1080p/4K

> 调研日期：2026-10-21。方法：3 个并行子代理（ego-browser 浏览 GitHub、DeepSeek 搜索、GitHub 源码审计）+ 本机 Chromium/CDP 实测。
> 说明：DeepSeek 搜索接口在子代理环境中持续 `fetch failed`（127.0.0.1:3425），因此搜索代理改用官方文档/Twitter 以外的直接抓取；GitHub 结论以源码为准。

## 0. 先说结论

1. **当前应用内录屏的清晰度上限就是舞台的物理像素**。1080p/125% 缩放下舞台是 1294×728 CSS = **1618×910 物理像素**；任何 tab 捕获、编码、上采样都不能凭空造出 1920×1080 的细节。
2. **GitHub 上最火的浏览器录屏项目也受同一限制**。Screenity 源码里明确写着 *"Chrome won't upscale"*，并把捕获尺寸夹到 tab 可视区；它的 4K 档只在“源本身够大 + 硬件编码器通过探测”时生效。
3. **真正能做出 1080p/4K 1:1 的只有两类**：
   - **自己控制渲染目标**：用 Playwright/Puppeteer/CDP 把同一 1618×910 布局的 `deviceScaleFactor` 提到 1.187（→1920×1080）或 2.374（→3840×2160），再捕获帧。本机已验证截图尺寸与清晰度，见 §5。
   - **原生捕获 4K 窗口/屏幕**：Cap/OpenScreen 用 ScreenCaptureKit / Windows Graphics Capture，捕获的是窗口/屏幕的真实像素；窗口本身不是 4K 时同样不会更清晰。
4. **之前把“1:1 裁剪”说成“清晰度解决”是不准确的**：它只保证不再二次损失，但成片仍是 1618×910，播放器拉到 1080p/4K 时会被放大。要“完美复刻”，必须换渲染/采集路径。

## 1. GitHub 项目对照（2026-10-21）

| 项目 | Stars | 形态 | 捕获 API | 真实上限 | 码率/质量控制 | 光标/浏览器 UI | 能否从 1618×910 产出真 1080p/4K |
|---|---:|---|---|---|---|---|---|
| [Screenity](https://github.com/alyssaxuu/screenity) | 18.8k | Chrome MV3 扩展 | `chrome.tabCapture` streamId → `getUserMedia({chromeMediaSource:'tab', min/maxWidth...})` | tab 可视区物理像素；源码注释 "Chrome won't upscale" | MediaRecorder 8–16Mbps；WebCodecs H.264 路径；4K 需硬件探测+开关 | 扩展录屏，自定义光标覆盖；源码未请求系统光标 | **否** |
| [Cap](https://github.com/CapSoftware/Cap) | 23.5k | Tauri + Rust 原生 | macOS ScreenCaptureKit；Windows D3D11/WGC | 原生窗口/屏幕像素；H.264 硬上限 4096 | `H264_MAX_DIMENSION=4096`；QUALITY_BPP 0.3 | 原生光标单独捕获，可隐藏/改样式 | 仅当窗口是 4K |
| [OpenScreen](https://github.com/siddharthvaddem/openscreen) | 39.9k（已归档） | Electron 原生 | ScreenCaptureKit / WGC；Linux 回落 `getDisplayMedia` | 请求 3840×2160，实际取 `getSettings()` | 45Mbps（4K）；导出 80/50/30Mbps | `cursor:'never'/'always'`、`hideSystemCursor` | 仅当窗口是 4K |
| [puppeteer-screen-recorder](https://github.com/prasanaworld/puppeteer-screen-recorder) | 457 | Node + 无头 Chrome | CDP `Page.startScreencast` → ffmpeg | **调用方 viewport**，可 4K | JPEG quality 0–100；ffmpeg CRF23 / minrate=maxrate | 无光标、无浏览器 UI | **是**（自己控制渲染目标） |
| [rrweb](https://github.com/rrweb-io/rrweb) | 20.3k | JS DOM 录制 | 无像素，序列化 DOM 变更 | 回放时任意 viewport/DPR | 事件流 | 光标是合成事件 | 结构上可以，但**录不了 WebGL/iframe 真实像素** |
| [RecordRTC](https://github.com/muaz-khan/RecordRTC) | 6.9k | JS 库 | MediaRecorder 包装 | 继承 track | 只有 `videoBitsPerSecond` | N/A | 否 |
| [Kap](https://github.com/wulkano/Kap) | 19.4k | Electron | `desktopCapturer` | 原生窗口/屏幕像素 | MediaRecorder | 原生窗口，无浏览器 UI | 仅当窗口是 4K |
| [OBS](https://github.com/obsproject/obs-studio) | 77.8k | C/C++ 原生 | Desktop Duplication / WGC | 显示器原生像素 | CBR/VBR/CQP 可调 | 原生光标开关 | 仅当屏幕/窗口是 4K |

## 2. Screenity：最接近我们的浏览器方案，但也没有魔法

关键源码（`alyssaxuu/screenity`，master）：

- `src/pages/Recorder/Recorder.jsx:3977-4015`：
  > "Chrome's tab capture defaults to a 1920x1080 frame and pillarboxes narrower tabs to fit. Match the constraint box to the tab's real aspect ratio so the captured frame has no padding."
  > `fitScale = Math.min(width / tabW, height / tabH, 1)`；注释 "Chrome won't upscale, so for tabs smaller than the cap the request resolves to native size."
  也就是说：**它把捕获尺寸夹到 tab 可视区，绝不放大**。4K 档只是“上限”，tab 小于 4K 时就按原生尺寸录。
- `src/pages/Recorder/recorderConfig.js`：本地档位 1080p 8Mbps、4K 40Mbps（不同分支/版本有 12/20Mbps 变体）。
- `src/pages/CloudRecorder/cloudEncodeCap.js`：云端默认 1080p/16Mbps；4K 需要 `cloud4kRecording` 开关 + 硬件编码器探测通过，4K 24Mbps（60fps ×1.5）。
- `src/media/fastRecorderGate.ts`：用 WebCodecs `VideoEncoder` 探测 1440p/4K；`src/pages/CloudRecorder/encoder/WebCodecsTrackRecorder.js` 默认 `maxWidth=1920,maxHeight=1080`，注释 "WCR fits the source inside, never upscales"。
- `src/pages/utils/captureResolution.js`：`OVERSAMPLE_FACTOR=2`、上限 3840×2160，先 2× 捕获再缩小（"1.315x more detail"）。这是超采样抗锯齿，前提是源真的能重栅格化；不是从 1618 变 4K 的魔法。
- 捕获路径：`chrome.tabCapture.getMediaStreamId` → offscreen document → `getUserMedia`；扩展录屏没有网页的 "sharing this tab" infobar，光标由自定义 overlay 处理。

**对我们的启示**：Screenity 的清晰度来自“原生尺寸 + 高码率 + WebCodecs + 超采样”，不是请求 4K。它的 4K 只在源够大时成立。

## 3. Cap / OpenScreen：原生捕获，清晰度的另一条路

- Cap：`crates/scap-screencapturekit` / `scap-direct3d` 直接拿 ScreenCaptureKit / D3D11 纹理；`resolution_limits.rs` 有 `H264_MAX_DIMENSION = 4096`，只降不升；`QUALITY_BPP = 0.3`。
- OpenScreen：`src/hooks/useScreenRecorder.ts` 请求 3840×2160、45Mbps，`cursor:'never'`；`electron/native/screencapturekit` 和 `wgc-capture` 是原生 helper；导出 80/50/30Mbps。
- 它们的“4K”是**捕获 4K 窗口/屏幕**，不是把 1080p 页面变 4K。好处是：没有浏览器 chrome/infobar、光标可单独处理、性能更好。

## 4. 规范与 Chromium 的关键事实

- W3C Screen Capture：捕获输出**不得上采样**；`width/height` 是上限/降采样提示，`max` 反映源尺寸。[spec](https://w3c.github.io/mediacapture-screen-share/)
- MDN：`getDisplayMedia` 的 width/height 是**选完源之后的缩放**，不改变源。[MDN](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Capture_API/Using_Screen_Capture)
- 本机实测（Chrome，1536×728 CSS，DPR1.25）：原生捕获 **1904×984 / 1920×910**；舞台 1618×910。
- 请求 4K 约束：一次得到 3840×1820，另一次只得到 1904×984，且 `devicePixelRatio` 变为 2.5——说明 Chromium 可能做了重栅格化，但行为不稳定；`exact` 约束直接报 "exact constraints are not supported"。
- 子代理在 Chromium 源码找到 `WebContentsAutoScaler::kMaxCaptureScaleOverride = 2.0f` 和 `is_high_dpi_enabled`，即 tab 捕获最高可 2× 重栅格化；但布局被屏幕边界夹住，运行时是否稳定未证实。**这是待验证线索，不作为结论。**

## 5. 决定性实测：同一布局，提高 deviceScaleFactor

用 CDP 在**不改布局**的前提下，把 viewport 固定为 1618×910，只改 `deviceScaleFactor`：

| DSF | 截图尺寸 | 结果 |
|---:|---|---|
| 1.187 | **1921×1080** | 同一 1618×910 布局，1:1 真 1080p 栅格 |
| 2.374 | **3841×2160** | 同一布局，1:1 真 4K 栅格 |

截图文字 9–16px 全部清晰（文件：`capture-test/captures/shot-1080.png` / `shot-4k.png`）。这证明：**不需要把页面重排成 1920×1080；只要控制渲染目标的 DSF，就能在 1618×910 布局上得到真 1080p/4K 像素。**

限制：这是**静态截图**验证，不是视频。`Page.startScreencast` 应该走同一渲染表面，但还需原型确认 30/60fps、音频混流、4 路 WebGL 在 4K 下的负载。普通浏览器 tab 的 DSF 由操作系统/浏览器决定（本机 1.25），网页不能改；只有 Puppeteer/Playwright/CDP、Electron/WebView2 或原生容器能设置。

## 6. 对 OmniCompare 的方案对比

| 方案 | 真实分辨率 | 能否 1080p/4K | 光标 | 复杂度 | 结论 |
|---|---|---|---|---|---|
| 当前应用内 tab 捕获 + canvas 裁剪 | 1618×910 | 否 | 会入镜 | 已实现 | 保留为“原生尺寸”模式，不要声称 1080p |
| Chrome 扩展 tabCapture + WebCodecs（Screenity 路线） | tab 可视区 | 否（源不够大时） | 可能可去（扩展 overlay） | 中 | 可去掉 infobar/改善光标，但分辨率不涨 |
| 原生 Electron/Tauri 捕获（Cap/OpenScreen 路线） | 窗口/屏幕原生像素 | 仅 4K 窗口 | 可单独处理 | 高 | 桌面端最佳性能，但要重写外壳 |
| **无头 Chromium + 高 DSF 渲染**（Puppeteer/CDP + ffmpeg） | 1618×910 布局，DSF 1.187/2.374 | **是** | 无 | 中高 | **唯一能在这台 1080p 机器上产出真 1080p/4K 的路径** |
| rrweb DOM 回放 | 矢量 | 是 | 合成 | 中 | 录不了 WebGL/iframe，不适合 |

## 7. 建议

**如果目标是“发布级 1080p/4K、完美复刻 UI”**：

1. 做 **“高清录制（无头渲染）”**：服务端用 Playwright/Puppeteer 启动系统 Chrome，打开同一项目的录制舞台，viewport 固定 **1618×910**，`deviceScaleFactor=1.187`（1080p）或 `2.374`（4K）；用 CDP `Page.startScreencast`（PNG/JPEG）或截图序列抓帧，ffmpeg 编码 H.264；BGM 单独混音。
2. 这样没有浏览器 chrome、没有 infobar、没有光标，布局与现在完全一致，只是栅格更密；本机截图已验证尺寸与清晰度。
3. 先做 1080p（DSF1.187）跑通 30/60fps，再做 4K（DSF2.374）；4 路 WebGL 在 4K 下可能掉帧，需要压测。

**如果坚持在浏览器内录**：

- 保留当前 canvas 裁剪（1:1、无黑边、H.264/AAC），但明确标注“输出 = 舞台物理尺寸（如 1618×910）”，不要承诺 1080p/4K。
- 可加 WebCodecs H.264（Screenity 同款）提升码率控制，但不会增加分辨率。

**如果要做桌面产品**：Electron/Tauri + ScreenCaptureKit/WGC，捕获 4K 窗口；这是 Cap/OpenScreen 的路线。

## 8. 参考

- Screenity: https://github.com/alyssaxuu/screenity （Recorder.jsx / recorderConfig.js / cloudEncodeCap.js / fastRecorderGate.ts）
- Cap: https://github.com/CapSoftware/Cap （crates/recording/src/resolution_limits.rs、sources/screen_capture/macos.rs）
- OpenScreen: https://github.com/siddharthvaddem/openscreen （src/hooks/useScreenRecorder.ts、native SCK/WGC）
- puppeteer-screen-recorder: https://github.com/prasanaworld/puppeteer-screen-recorder （pageVideoStreamCollector.ts / pageVideoStreamWriter.ts）
- rrweb: https://github.com/rrweb-io/rrweb
- W3C Screen Capture: https://w3c.github.io/mediacapture-screen-share/
- MDN Screen Capture: https://developer.mozilla.org/en-US/docs/Web/API/Screen_Capture_API/Using_Screen_Capture
- Chromium auto scaler（子代理源码线索）: `content/browser/media/capture/web_contents_auto_scaler.cc`
