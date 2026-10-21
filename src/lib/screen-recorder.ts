/**
 * 应用内录屏：捕获当前标签页 + MediaRecorder 生成 WebM。
 *
 * 为什么用 getDisplayMedia 而不是 DOM 录制：
 * - 浏览器没有"录制 DOM 节点"的标准 API；getDisplayMedia 是唯一能拿到
 *   包含 WebGL/iframe 合成结果的像素流的方式。
 * - preferCurrentTab 让 Chrome 直接选中当前标签页，用户少点一步。
 *
 * 兼容与降级：
 * - 非安全上下文（http + 局域网 IP）没有 mediaDevices，返回 null；
 * - 用户拒绝/浏览器不支持时返回 null，调用方继续进入录制舞台（用 OBS 兜底）。
 */

type CaptureOptions = DisplayMediaStreamOptions & {
  preferCurrentTab?: boolean;
  selfBrowserSurface?: 'include' | 'exclude';
  systemAudio?: 'include' | 'exclude';
};

/** 捕获当前标签页（含标签页音频）；失败/超时返回 null，不抛错 */
export async function requestTabCapture(timeoutMs = 10000): Promise<MediaStream | null> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getDisplayMedia) return null;

  const options: CaptureOptions = {
    // 不指定 width/height：MDN 明确说明这两个约束是对已选画面做缩放，而不是提高源分辨率。
    // 想要更清晰只能扩大源（全屏/放大窗口），所以这里只把帧率拉满，分辨率交给浏览器原生输出。
    video: { frameRate: { ideal: 60, max: 60 } },
    audio: true,
    preferCurrentTab: true,
    selfBrowserSurface: 'include',
    systemAudio: 'include',
  };

  let pending: Promise<MediaStream>;
  try {
    pending = navigator.mediaDevices.getDisplayMedia(options);
  } catch {
    return null;
  }

  const timeout = new Promise<null>((resolve) => {
    setTimeout(() => resolve(null), timeoutMs);
  });

  const result = await Promise.race([pending, timeout]);
  if (result === null) {
    // 超时后用户仍可能授权：拿到流立刻关掉，避免摄像头指示灯常亮
    pending
      .then((stream) => stream.getTracks().forEach((t) => t.stop()))
      .catch(() => {});
    return null;
  }
  return result;
}

/** 选一个当前浏览器支持的 WebM 编码（有音轨才带 opus，避免无音轨时报不支持） */
export function pickRecordingMime(hasAudio = true): string {
  if (typeof MediaRecorder === 'undefined') return '';
  const withAudio = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9',
    'video/webm',
  ];
  const videoOnly = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  return (hasAudio ? withAudio : videoOnly).find((type) => MediaRecorder.isTypeSupported(type)) ?? '';
}

/** 录制的实际参数（用于 UI 展示与清晰度诊断） */
export interface RecorderMeta {
  width: number;
  height: number;
  fps: number;
  bitrate: number;
  mimeType: string;
}

export interface CreatedRecorder {
  recorder: MediaRecorder;
  meta: RecorderMeta;
}

/** 创建录制器；不支持的浏览器返回 null */
export function createTabRecorder(stream: MediaStream): CreatedRecorder | null {
  if (typeof MediaRecorder === 'undefined') return null;
  const track = stream.getVideoTracks()[0];
  const settings = track?.getSettings();
  const width = Math.max(1, Number(settings?.width) || 1920);
  const height = Math.max(1, Number(settings?.height) || 1080);
  const fps = Math.min(60, Math.max(15, Number(settings?.frameRate) || 60));

  // 目标码率按像素率算：0.25 bit/像素/帧。Chrome 的 MediaRecorder 实际会低于目标，
  // 所以从 20Mbps 起、上限 80Mbps；1600×900@60 ≈ 21.6M，1080p60 ≈ 31M，4K60 封顶 80M。
  const target = width * height * fps * 0.25;
  const bitrate = Math.round(Math.min(80_000_000, Math.max(20_000_000, target)));
  const mimeType = pickRecordingMime(stream.getAudioTracks().length > 0);

  try {
    const recorder = new MediaRecorder(stream, {
      ...(mimeType ? { mimeType } : {}),
      videoBitsPerSecond: bitrate,
      audioBitsPerSecond: 192_000,
    });
    return { recorder, meta: { width, height, fps, bitrate, mimeType } };
  } catch {
    return null;
  }
}

/** 触发浏览器下载（WebM） */
export function downloadRecording(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** 录制文件名：omnicompare-20261021-093012.webm */
export function recordingFilename(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return [
    'omnicompare',
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`,
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`,
  ].join('-') + '.webm';
}
