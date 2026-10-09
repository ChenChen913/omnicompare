'use client';

/**
 * 防伪水印蒙版层：位置/尺寸由 useAutoFit 的 effect 实时对齐视频墙
 * （巡游范围 = 墙的实际区域：单视频=单卡、多视频=整墙），水印在其上屏保式巡游（防搬运）。
 * z-30 压过所有视频卡片（卡片常态无 z、拖拽时才临时 z-30），水印永远在视频上层；
 * pointer-events-none 不挡视频点击/拖拽；绝对定位不占布局、不干扰 autoFit 测量。
 * 全部设置收在顶栏「水印」按钮。从 video-wall.tsx 拆出。
 */
import { cn } from '@/lib/utils';
import {
  WallSettings,
} from './use-wall-settings';
import { WATERMARK_SPEED_SECONDS } from '@/lib/types';

export function WatermarkLayer({
  settings,
  layerRef,
}: {
  settings: WallSettings;
  layerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const { wmFamily, wmColor, wmWeight, wmFontSize, wmOpacity, wmSpeed, wmText } = settings;
  return (
    <div ref={layerRef} aria-hidden className="pointer-events-none absolute z-30 overflow-hidden">
      <div className="flex h-full w-full items-start justify-center pt-[4%]">
        <span
          className={cn(
            'watermark-screensaver max-w-[80%] select-none whitespace-pre-wrap break-words text-center',
            wmFamily === 'serif' && 'font-serif',
            wmFamily === 'hand' && 'font-hand',
            wmFamily === 'mono' && 'font-mono',
            wmColor === 'white' ? 'text-white' : wmColor === 'black' ? 'text-black' : 'text-foreground',
            wmWeight === 'bold' ? 'font-bold' : 'font-normal',
          )}
          style={{
            fontSize: `${wmFontSize}px`,
            opacity: wmOpacity / 100,
            animationDuration: `${WATERMARK_SPEED_SECONDS[wmSpeed]}s`,
            /* 双向描影保证明暗视频上都可辨 */
            textShadow: '0 1px 3px rgb(0 0 0 / 0.25), 0 0 1px rgb(255 255 255 / 0.18)',
          }}
        >
          {wmText}
        </span>
      </div>
    </div>
  );
}
