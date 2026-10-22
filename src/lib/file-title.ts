/**
 * 由上传文件名推断卡片标题（纯函数，服务端上传路由使用；不依赖 Node API）
 *
 * 用户把「DeepSeek-V3.2-Exp_1080p.mp4」拖进来时，标题不必再手打一遍。
 * 规则保持保守：只做去扩展名 / 去副本后缀 / 去分辨率尾巴 / 下划线转空格，
 * 绝不做大小写或拼写改写（模型名大小写千差万别，乱改比不改更糟）。
 * 明显是设备导出/录屏的垃圾文件名直接判为「猜不出」，保持标题为空。
 */

/** 标题长度上限（与 types.ts 的 TITLE_MAX 一致；此处内联避免把纯函数绑定到别的模块） */
const TITLE_MAX = 100;

/** 完全是噪音的文件名（保留小写比较） */
const NOISE_NAMES = new Set([
  'video', 'download', 'untitled', 'unnamed', 'output', 'final', 'clip', 'movie',
  '未命名', '录屏', '屏幕录制', '新建文本文档', '无标题',
]);

/** 去掉扩展名、副本后缀（(1) / -copy）、分辨率/帧率尾巴，下划线转空格 */
export function titleFromFileName(name: string): string {
  const base = name.replace(/^.*[\\/]/, '');
  const stem = base.replace(/\.[A-Za-z0-9]{1,8}$/, '').replace(/_+/g, ' ');
  return stem
    .replace(/[\s._-]*[（(]\d{1,3}[)）]$/, '')
    .replace(/[\s._-]+(?:1080p|720p|480p|2160p|4k|8k|60fps|30fps|hdr)$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 这个标题是否值得填进标题框（过滤纯数字、哈希、设备导出名等） */
export function isMeaningfulTitle(title: string): boolean {
  const text = title.trim();
  if (text.length < 2) return false;
  if (!/[\p{L}]/u.test(text)) return false;
  if (NOISE_NAMES.has(text.toLowerCase())) return false;
  // uuid / 32 位哈希
  if (/^[0-9a-f]{16,}$/i.test(text.replace(/[\s_-]/g, ''))) return false;
  // 纯数字、时间戳
  if (/^[\d\s._-]+$/.test(text)) return false;
  // 抖音/快手导出：lv_0_20251022163000、vid_20251022...
  if (/^(?:lv|vid|vlog)[\s_-]?0?[\s_-]?\d{8,}/i.test(text)) return false;
  // 相机/截图：IMG_1234、DSC01234、Screenshot 2025、截屏2025
  if (/^(?:img|dsc|dji|pxl|screenshot|screen shot|截图|截屏)[\s_-]?\d+/i.test(text)) return false;
  return true;
}

/** 猜测标题：猜不出返回 null（调用方据此保持标题为空） */
export function guessTitleFromFileName(name: string): string | null {
  const title = titleFromFileName(name);
  return isMeaningfulTitle(title) ? title.slice(0, TITLE_MAX) : null;
}
