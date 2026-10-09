'use client';

/**
 * 墙设置域 hook：把原先散落在 VideoWall 里的 33 个 useState 收敛为单一 state 对象。
 *
 * 动机（重构前的结构性债务）：乐观更新的「快照 / 乐观 set / 回滚 set / 依赖数组」
 * 四处要同步维护同一份字段清单，applySettings 是第五处——新增一个设置字段要改
 * 五个地方，updateSettings 因此膨胀到 120 行。收敛后：
 * - 快照 = state 对象本身（一个引用）
 * - 乐观更新 = 一次浅合并
 * - 回滚 = setSettings(prev)（一行）
 * - updateSettings 的引用稳定性也不再依赖 33 个字段的值（ref 镜像读取），
 *   传给子组件的回调引用恒定，配合 memo 生效。
 */
import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  AspectRatio,
  FileMeta,
  LetterboxFill,
  Manifest,
  ManifestSettings,
  TitleAlign,
  TitlePosition,
  TitleWeight,
  WatermarkColor,
  WatermarkFamily,
  WatermarkSpeed,
  defaultSettings,
} from '@/lib/types';

/** 墙设置状态（字段名沿用组件内的短名，与服务端 ManifestSettings 的键名映射见 KEY_MAP） */
export interface WallSettings {
  aspect: AspectRatio;
  customRatio?: { w: number; h: number };
  showTitles: boolean;
  showInfo: boolean;
  showIndex: boolean;
  loop: boolean;
  mutedAll: boolean;
  rate: number;
  letterboxFill: LetterboxFill;
  wallScale: number;
  htmlScale: number;
  autoFit: boolean;
  titleAlign: TitleAlign;
  titleFontSize: number;
  titlePosition: TitlePosition;
  titleWeight: TitleWeight;
  titleColor: string;
  bgm: FileMeta | null;
  bgmVolume: number;
  promptText: string;
  showPrompt: boolean;
  bylineText: string;
  showByline: boolean;
  wmShow: boolean;
  wmText: string;
  wmFontSize: number;
  wmFamily: WatermarkFamily;
  wmColor: WatermarkColor;
  wmSpeed: WatermarkSpeed;
  wmWeight: 'normal' | 'bold';
  wmOpacity: number;
  /** 录屏模式（锁定控件）：开启后专注模式下悬停不再显示视频控件 */
  lockControls: boolean;
}

function defaultWallSettings(): WallSettings {
  const d = defaultSettings();
  return {
    aspect: d.aspectRatio,
    customRatio: undefined,
    showTitles: d.showTitles,
    showInfo: d.showInfo,
    showIndex: d.showIndex,
    loop: d.loop,
    mutedAll: d.muted,
    rate: d.playbackRate,
    letterboxFill: d.letterboxFill,
    wallScale: d.wallScale,
    htmlScale: d.htmlScale,
    autoFit: d.autoFit,
    titleAlign: d.titleAlign,
    titleFontSize: d.titleFontSize,
    titlePosition: d.titlePosition,
    titleWeight: d.titleWeight,
    titleColor: d.titleColor,
    bgm: null,
    bgmVolume: d.bgmVolume,
    promptText: d.promptText,
    showPrompt: d.showPrompt,
    bylineText: d.bylineText,
    showByline: d.showByline,
    wmShow: d.showWatermark,
    wmText: d.watermarkText,
    wmFontSize: d.watermarkFontSize,
    wmFamily: d.watermarkFontFamily,
    wmColor: d.watermarkColor,
    wmSpeed: d.watermarkSpeed,
    wmWeight: d.watermarkFontWeight,
    wmOpacity: d.watermarkOpacity,
    lockControls: d.lockControls,
  };
}

/**
 * 从任意清单响应中同步播放与展示设置（缺省字段回落默认值）。
 * 服务端响应是唯一事实源，全量覆盖本地 state。
 */
function wallSettingsFromManifest(s: ManifestSettings): WallSettings {
  const d = defaultSettings();
  return {
    aspect: s.aspectRatio ?? d.aspectRatio,
    customRatio: s.customRatio,
    showTitles: s.showTitles ?? d.showTitles,
    showInfo: s.showInfo ?? d.showInfo,
    showIndex: s.showIndex ?? d.showIndex,
    loop: s.loop ?? d.loop,
    mutedAll: s.muted ?? d.muted,
    rate: s.playbackRate ?? d.playbackRate,
    letterboxFill: s.letterboxFill ?? d.letterboxFill,
    wallScale: s.wallScale ?? d.wallScale,
    htmlScale: s.htmlScale ?? d.htmlScale,
    autoFit: s.autoFit ?? d.autoFit,
    titleAlign: s.titleAlign ?? d.titleAlign,
    titleFontSize: s.titleFontSize ?? d.titleFontSize,
    titlePosition: s.titlePosition ?? d.titlePosition,
    titleWeight: s.titleWeight ?? d.titleWeight,
    titleColor: s.titleColor ?? d.titleColor,
    bgm: s.bgm ?? null,
    bgmVolume: s.bgmVolume ?? d.bgmVolume,
    promptText: s.promptText ?? d.promptText,
    showPrompt: s.showPrompt ?? d.showPrompt,
    bylineText: s.bylineText ?? d.bylineText,
    showByline: s.showByline ?? d.showByline,
    wmShow: s.showWatermark ?? d.showWatermark,
    wmText: s.watermarkText ?? d.watermarkText,
    wmFontSize: s.watermarkFontSize ?? d.watermarkFontSize,
    wmFamily: s.watermarkFontFamily ?? d.watermarkFontFamily,
    wmColor: s.watermarkColor ?? d.watermarkColor,
    wmSpeed: s.watermarkSpeed ?? d.watermarkSpeed,
    wmWeight: s.watermarkFontWeight ?? d.watermarkFontWeight,
    wmOpacity: s.watermarkOpacity ?? d.watermarkOpacity,
    lockControls: s.lockControls ?? d.lockControls,
  };
}

/** ManifestSettings 键 → WallSettings 字段（乐观更新时的映射） */
const KEY_MAP: Record<string, keyof WallSettings> = {
  aspectRatio: 'aspect',
  customRatio: 'customRatio',
  showTitles: 'showTitles',
  showInfo: 'showInfo',
  showIndex: 'showIndex',
  loop: 'loop',
  muted: 'mutedAll',
  playbackRate: 'rate',
  letterboxFill: 'letterboxFill',
  wallScale: 'wallScale',
  htmlScale: 'htmlScale',
  autoFit: 'autoFit',
  titleAlign: 'titleAlign',
  titleFontSize: 'titleFontSize',
  titlePosition: 'titlePosition',
  titleWeight: 'titleWeight',
  titleColor: 'titleColor',
  bgmVolume: 'bgmVolume',
  promptText: 'promptText',
  showPrompt: 'showPrompt',
  bylineText: 'bylineText',
  showByline: 'showByline',
  showWatermark: 'wmShow',
  watermarkText: 'wmText',
  watermarkFontSize: 'wmFontSize',
  watermarkFontFamily: 'wmFamily',
  watermarkColor: 'wmColor',
  watermarkSpeed: 'wmSpeed',
  lockControls: 'lockControls',
  watermarkFontWeight: 'wmWeight',
  watermarkOpacity: 'wmOpacity',
};

export function useWallSettings(withPid: (url: string) => string) {
  const [settings, setSettings] = useState<WallSettings>(defaultWallSettings);
  /** state 镜像 ref：回滚快照与闭包读取都不再依赖 33 个字段的值 */
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  /** 最近一次持久化的文本：失焦时对比决定是否 PATCH，避免无变更也发请求 */
  const promptSavedRef = useRef('');
  const bylineSavedRef = useRef('');

  /** 服务端清单响应 → 全量覆盖本地（任何携带 settings 的响应统一走这里） */
  const applySettings = useCallback((s?: ManifestSettings) => {
    const next = s ? wallSettingsFromManifest(s) : defaultWallSettings();
    setSettings(next);
    promptSavedRef.current = next.promptText;
    bylineSavedRef.current = next.bylineText;
  }, []);

  /** 本地即时更新（不发请求）：滑块拖动等「本地预览、松手才提交」的交互 */
  const patchLocal = useCallback((partial: Partial<WallSettings>) => {
    setSettings((s) => ({ ...s, ...partial }));
  }, []);

  /**
   * 全局设置更新：乐观更新 + PATCH 响应回填；失败整体回滚并提示（固定通道 id 不叠加）。
   * loop/muted/比例/标题与属性显隐/播放速度全部走服务端 Project.settings（蓝图 §7/§15）。
   */
  const updateSettings = useCallback(
    async (partial: Partial<ManifestSettings>) => {
      const prev = settingsRef.current;
      // 乐观回填（bgm 文件不在 PATCH 受理范围，忽略）
      setSettings((s) => {
        const next = { ...s } as Record<string, unknown>;
        for (const [k, v] of Object.entries(partial)) {
          if (v === undefined || !(k in KEY_MAP)) continue;
          next[KEY_MAP[k]] = v;
        }
        return next as unknown as WallSettings;
      });
      if (partial.promptText !== undefined) promptSavedRef.current = partial.promptText;
      if (partial.bylineText !== undefined) bylineSavedRef.current = partial.bylineText;
      try {
        const res = await fetch(withPid('/api/videos/settings'), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(partial),
        });
        const data = (await res.json().catch(() => null)) as (Manifest & { error?: string }) | null;
        if (!res.ok || !data?.slots) throw new Error(data?.error || '设置保存失败');
        applySettings(data.settings);
      } catch {
        // 回滚乐观更新：一个引用回到快照状态
        setSettings(prev);
        promptSavedRef.current = prev.promptText;
        bylineSavedRef.current = prev.bylineText;
        toast.error('设置保存失败，请重试', { id: 'settings' });
      }
    },
    [applySettings, withPid],
  );

  return {
    settings,
    settingsRef,
    promptSavedRef,
    bylineSavedRef,
    applySettings,
    patchLocal,
    updateSettings,
    /** 提示词/署名：失焦保存（对比 savedRef 决定是否发请求） */
    savePromptIfChanged: useCallback(() => {
      const text = settingsRef.current.promptText;
      if (text !== promptSavedRef.current) {
        promptSavedRef.current = text;
        void updateSettings({ promptText: text });
      }
    }, [settingsRef, updateSettings]),
    saveBylineIfChanged: useCallback(() => {
      const text = settingsRef.current.bylineText;
      if (text !== bylineSavedRef.current) {
        bylineSavedRef.current = text;
        void updateSettings({ bylineText: text });
      }
    }, [settingsRef, updateSettings]),
  };
}

export type WallSettingsApi = ReturnType<typeof useWallSettings>;
