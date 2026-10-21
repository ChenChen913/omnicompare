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

/** 创建录制器；不支持的浏览器返回 null */
export function createTabRecorder(stream: MediaStream): MediaRecorder | null {
  if (typeof MediaRecorder === 'undefined') return null;
  const mimeType = pickRecordingMime(stream.getAudioTracks().length > 0);
  try {
    return new MediaRecorder(stream, {
      ...(mimeType ? { mimeType } : {}),
      videoBitsPerSecond: 12_000_000,
      audioBitsPerSecond: 128_000,
    });
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
