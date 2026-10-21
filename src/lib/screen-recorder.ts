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
  video?: MediaTrackConstraints & { cursor?: 'always' | 'motion' | 'never' };
};

/** 捕获当前标签页（含标签页音频）；失败/超时返回 null，不抛错 */
export async function requestTabCapture(timeoutMs = 10000): Promise<MediaStream | null> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getDisplayMedia) return null;

  const options: CaptureOptions = {
    // 不指定 width/height：MDN 明确说明这两个约束是对已选画面做缩放，而不是提高源分辨率。
    // 想要更清晰只能扩大源（全屏/放大窗口），所以这里只把帧率拉满，分辨率交给浏览器原生输出。
    video: { frameRate: { ideal: 60, max: 60 }, cursor: 'never' },
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
  // 部分 Chrome 版本会忽略 getDisplayMedia 里的 cursor 约束，捕获后再 apply 一次
  try {
    await result.getVideoTracks()[0]?.applyConstraints({ cursor: 'never' } as unknown as MediaTrackConstraints);
  } catch {}
  return result;
}

/**
 * 选一个当前浏览器支持的编码。
 *
 * 默认 H.264/AAC MP4：真实标签页实测同目标码率下，H.264 的实际输出约为
 * VP9 的 2–3 倍（1080p60 目标 15Mbps → 实际 35Mbps），且 MP4 带 mp4a 音轨，
 * 剪辑软件兼容性也更好。只有 MP4 不可用时才回落 WebM VP9/Opus。
 */
export function pickRecordingMime(hasAudio = true): string {
  if (typeof MediaRecorder === 'undefined') return '';
  const mp4WithAudio = [
    'video/mp4;codecs=avc1.640033,mp4a.40.2',
    'video/mp4;codecs=avc1.64002A,mp4a.40.2',
    'video/mp4;codecs=avc1.640028,mp4a.40.2',
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  ];
  const mp4VideoOnly = [
    'video/mp4;codecs=avc1.640033',
    'video/mp4;codecs=avc1.64002A',
    'video/mp4;codecs=avc1.640028',
    'video/mp4;codecs=avc1.42E01E',
  ];
  const webmWithAudio = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9',
    'video/webm',
  ];
  const webmVideoOnly = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  const candidates = hasAudio
    ? [...mp4WithAudio, ...webmWithAudio]
    : [...mp4VideoOnly, ...webmVideoOnly];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? '';
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

/** 目标码率：H.264 硬件编码器实际会明显高于目标，所以按 0.12 bpp 给；
 *  VP9 实际只有目标的 30–50%，按 0.25 bpp 给。 */
export function recordingBitrate(width: number, height: number, fps: number, mimeType: string): number {
  const isMp4 = mimeType.includes('mp4') || mimeType.includes('avc1');
  const bpp = isMp4 ? 0.2 : 0.25;
  const min = isMp4 ? 20_000_000 : 20_000_000;
  const max = isMp4 ? 50_000_000 : 80_000_000;
  return Math.round(Math.min(max, Math.max(min, width * height * fps * bpp)));
}

/** 根据流参数推导录制规格；预览和真正创建录制器共用，避免两处公式漂移 */
export function estimateRecorderMeta(stream: MediaStream): RecorderMeta {
  const settings = stream.getVideoTracks()[0]?.getSettings();
  const width = Math.max(1, Number(settings?.width) || 1920);
  const height = Math.max(1, Number(settings?.height) || 1080);
  const fps = Math.min(60, Math.max(15, Number(settings?.frameRate) || 60));
  const mimeType = pickRecordingMime(stream.getAudioTracks().length > 0);
  return { width, height, fps, bitrate: recordingBitrate(width, height, fps, mimeType), mimeType };
}

/** 创建录制器；不支持的浏览器返回 null */
export function createTabRecorder(stream: MediaStream): CreatedRecorder | null {
  if (typeof MediaRecorder === 'undefined') return null;
  const meta = estimateRecorderMeta(stream);
  try {
    const recorder = new MediaRecorder(stream, {
      ...(meta.mimeType ? { mimeType: meta.mimeType } : {}),
      videoBitsPerSecond: meta.bitrate,
      audioBitsPerSecond: 192_000,
    });
    return { recorder, meta };
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

/** 录制文件名：omnicompare-20261021-093012.mp4 / .webm（按实际编码选择扩展名） */
export function recordingFilename(mimeType = 'video/webm', now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
  return [
    'omnicompare',
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`,
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`,
  ].join('-') + `.${ext}`;
}
