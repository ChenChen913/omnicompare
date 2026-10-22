/**
 * 模型图标物化（服务端）：把 public/model-icons 里的内置图「搬」进项目 files/。
 *
 * 为什么复制而不是直接引用 /model-icons/x.png：
 * 卡片图标（items[].icon）在存储层只有一种形态——FileMeta + /api/files/[name]。
 * 复制一份后，渲染、缓存、手动替换、内容移除时的孤儿清理全部沿用既有链路，
 * 不需要在类型、渲染器、清理器里各加一个「外部图标」分支。
 * 单张 7-60KB，一个 12 格项目最多多几百 KB，代价可以忽略。
 */
import { promises as fsp } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { FileMeta, Slot } from './types';
import { projectFilesDir } from './project-store';
import { decideAutoIcon, MODEL_ICONS } from './model-icon-rules';

/** 内置图标目录（构建产物里 public 会被拷进 standalone 根，Docker 下同样成立） */
const MODEL_ICON_DIR = path.join(process.cwd(), 'public', 'model-icons');

/**
 * 把某个内置图标复制进项目的 files/，返回可直接挂到 slot.icon 的元数据。
 * 图库文件缺失、磁盘写入失败等一律返回 null（调用方跳过，绝不阻断标题保存）。
 */
export async function savePresetIcon(
  projectId: string,
  presetId: string,
): Promise<FileMeta | null> {
  // 白名单校验：presetId 会参与拼路径，必须来自规则表
  if (!MODEL_ICONS.some((preset) => preset.id === presetId)) return null;
  try {
    const data = await fsp.readFile(path.join(MODEL_ICON_DIR, `${presetId}.png`));
    const dir = projectFilesDir(projectId);
    await fsp.mkdir(dir, { recursive: true });
    const filename = `${randomUUID()}.png`;
    await fsp.writeFile(path.join(dir, filename), data);
    return {
      filename,
      // originalName 保留「[id].png」，客户端据此显示「已匹配 DeepSeek」之类的文案
      originalName: `${presetId}.png`,
      size: data.length,
      mimeType: 'image/png',
    };
  } catch {
    return null;
  }
}

/**
 * 按槽位标题决定要不要换图标并就地写入 slot。
 * 返回新落盘的图标（没动返回 null）——调用方据此在清单写入失败时回滚删文件。
 * 注意：旧图标文件的清理由 writeManifest 的集中孤儿扫描负责，这里不删。
 */
export async function applyAutoIcon(projectId: string, slot: Slot): Promise<FileMeta | null> {
  const preset = decideAutoIcon(slot, slot.title);
  if (!preset) return null;
  const meta = await savePresetIcon(projectId, preset.id);
  if (!meta) return null;
  slot.icon = meta;
  slot.iconMode = 'auto';
  slot.iconPreset = preset.id;
  return meta;
}
