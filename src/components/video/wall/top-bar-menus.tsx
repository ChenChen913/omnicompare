'use client';

/**
 * 顶栏四个设置下拉菜单（从 top-bar.tsx 拆出，纯展示 + 回调）：
 * - PlaybackMenu：循环/静音/归零/倍速/背景音乐（仅视频项目）
 * - TitleMenu：标题显隐 + 位置/对齐/字号/粗细/颜色全局格式
 * - FillMenu：黑边填充方式（仅视频/图片项目）
 * - WatermarkMenu：防伪水印完整面板（启用/文字/字号/颜色/速度/不透明度/字重/字体）
 * 状态全部由 VideoWall 持有经 props 传入（s = WallSettings 快照）。
 */
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDownToLine,
  Bold,
  Crop,
  Droplets,
  Expand,
  Gauge,
  Minus,
  Music,
  Palette,
  Play,
  Plus,
  RotateCcw,
  Stamp,
  Type,
  Volume2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  LETTERBOX_FILLS,
  ManifestSettings,
  TITLE_ALIGNS,
  TITLE_COLOR_DEFAULT,
  TITLE_COLOR_PALETTE,
  TITLE_FONT_DEFAULT,
  TITLE_FONT_MAX,
  TITLE_FONT_MIN,
  TITLE_FONT_PRESETS,
  TITLE_POSITIONS,
  TITLE_WEIGHTS,
  WATERMARK_COLORS,
  WATERMARK_FONT_MAX,
  WATERMARK_FONT_MIN,
  WATERMARK_OPACITY_MAX,
  WATERMARK_OPACITY_MIN,
  WATERMARK_SPEEDS,
} from '@/lib/types';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ctlBtn } from './shared';
import { WallSettings } from './use-wall-settings';

/** 设置类菜单的公共 props（settings 快照 + 服务端提交通道） */
interface MenuBase {
  s: WallSettings;
  updateSettings: (partial: Partial<ManifestSettings>) => Promise<void>;
}

/* ============================== 播放下拉 ============================== */

export function PlaybackMenu({
  s,
  updateSettings,
  patchLocal,
  onResetAll,
  onBgmClick,
  bgmUploading,
  onRemoveBgm,
}: MenuBase & {
  patchLocal: (partial: Partial<WallSettings>) => void;
  onResetAll: (play: boolean) => void;
  onBgmClick: () => void;
  bgmUploading: boolean;
  onRemoveBgm: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(ctlBtn, 'border-border bg-card text-foreground/90 hover:bg-accent hover:text-accent-foreground')}
          title="循环播放、全部静音与播放速度"
          aria-label="播放设置"
        >
          <Play className="h-4 w-4" aria-hidden />
          <span className="hidden sm:inline">播放</span>
          <span className="inline-block min-w-[3ch] text-center text-[11px] font-semibold tabular-nums text-primary">
            {s.rate}×
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[12rem] border-border bg-card">
        <DropdownMenuCheckboxItem
          checked={s.loop}
          onCheckedChange={(v) => void updateSettings({ loop: v === true })}
          className="text-[13px]"
        >
          循环播放
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={s.mutedAll}
          onCheckedChange={(v) => void updateSettings({ muted: v === true })}
          className="text-[13px]"
        >
          全部静音
        </DropdownMenuCheckboxItem>
        {/* 一键重置：视频归零、网页重载、背景音乐归零；录屏前备场用 */}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => onResetAll(false)} className="text-[13px]">
          <RotateCcw className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          全部归零并暂停
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onResetAll(true)} className="text-[13px]">
          <Play className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          全部归零并播放
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="text-[13px]">
            <Gauge className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            播放速度
            <span className="ml-auto pl-2 text-[11px] tabular-nums text-muted-foreground">{s.rate}×</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="min-w-[8rem] border-border bg-card">
            {[0.5, 1, 1.25, 1.5, 2].map((r) => (
              <DropdownMenuItem
                key={r}
                onClick={() => void updateSettings({ playbackRate: r })}
                className={cn('text-[13px]', r === s.rate && 'font-semibold text-primary')}
              >
                {r === 1 ? '常速（1×）' : `${r}×`}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        {/* 背景音乐：上传/更换、移除与音量（全局唯一一轨，存项目 settings） */}
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="text-[13px]">
            <Music className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            背景音乐
            <span className="ml-auto max-w-[10rem] truncate pl-2 text-[11px] text-muted-foreground">
              {s.bgm ? s.bgm.originalName : '未设置'}
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="min-w-[13rem] border-border bg-card">
            {s.bgm ? (
              <>
                <div className="px-2 py-1.5 text-[11px] text-muted-foreground" title={s.bgm.originalName}>
                  <span className="block truncate">当前：{s.bgm.originalName}</span>
                </div>
                <div className="px-2 py-2">
                  <div className="mb-1 flex items-center justify-between text-[12px] text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Volume2 className="h-3.5 w-3.5" aria-hidden />
                      音量
                    </span>
                    <span className="tabular-nums">{s.bgmVolume}%</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={s.bgmVolume}
                    onChange={(e) => patchLocal({ bgmVolume: Number(e.target.value) })}
                    onPointerUp={() => void updateSettings({ bgmVolume: s.bgmVolume })}
                    onKeyUp={() => void updateSettings({ bgmVolume: s.bgmVolume })}
                    aria-label="背景音乐音量"
                    className="w-full accent-[var(--primary)]"
                  />
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={bgmUploading} onClick={onBgmClick} className="text-[13px]">
                  <Music className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                  {bgmUploading ? '上传中…' : '换一首'}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onRemoveBgm} className="text-[13px] text-destructive">
                  移除背景音乐
                </DropdownMenuItem>
              </>
            ) : (
              <DropdownMenuItem disabled={bgmUploading} onClick={onBgmClick} className="text-[13px]">
                <Music className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                {bgmUploading ? '上传中…' : '上传背景音乐'}
              </DropdownMenuItem>
            )}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* ============================== 标题下拉 ============================== */

export function TitleMenu({ s, updateSettings }: MenuBase) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(ctlBtn, 'border-border bg-card text-foreground/90 hover:bg-accent hover:text-accent-foreground')}
          title="标题与属性信息的显隐、位置、对齐、字号、粗细与颜色"
          aria-label="标题设置"
        >
          <Type className="h-4 w-4" aria-hidden />
          <span className="hidden sm:inline">标题</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[12rem] border-border bg-card">
        <DropdownMenuCheckboxItem
          checked={s.showTitles}
          onCheckedChange={(v) => void updateSettings({ showTitles: v === true })}
          className="text-[13px]"
        >
          显示标题
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={s.showInfo}
          onCheckedChange={(v) => void updateSettings({ showInfo: v === true })}
          className="text-[13px]"
        >
          显示属性信息
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={s.showIndex}
          onCheckedChange={(v) => void updateSettings({ showIndex: v === true })}
          className="text-[13px]"
        >
          显示位置编号
        </DropdownMenuCheckboxItem>
        {/* 提示词与署名（矩阵下方，录屏入镜用） */}
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem
          checked={s.showPrompt}
          onCheckedChange={(v) => void updateSettings({ showPrompt: v === true })}
          className="text-[13px]"
        >
          显示提示词
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={s.showByline}
          onCheckedChange={(v) => void updateSettings({ showByline: v === true })}
          className="text-[13px]"
        >
          显示署名
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        {/* 标题格式（全局同步） */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger disabled={!s.showTitles} className="text-[13px]">
            <AlignCenter className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            标题对齐
            <span className="ml-auto pl-2 text-[11px] text-muted-foreground">
              {s.titleAlign === 'left' ? '居左' : s.titleAlign === 'right' ? '居右' : '居中'}
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="min-w-[8rem] border-border bg-card">
            {TITLE_ALIGNS.map((a) => (
              <DropdownMenuItem
                key={a}
                onClick={() => void updateSettings({ titleAlign: a })}
                className={cn('text-[13px]', a === s.titleAlign && 'font-semibold text-primary')}
              >
                {a === 'left' ? (
                  <AlignLeft className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                ) : a === 'right' ? (
                  <AlignRight className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                ) : (
                  <AlignCenter className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                )}
                {a === 'left' ? '居左' : a === 'right' ? '居右' : '居中'}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger disabled={!s.showTitles} className="text-[13px]">
            <Type className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            标题字号
            <span className="ml-auto pl-2 text-[11px] tabular-nums text-muted-foreground">
              {s.titleFontSize}px
            </span>
          </DropdownMenuSubTrigger>
          {/* onSelect preventDefault 保持菜单展开，可连续点按微调 */}
          <DropdownMenuSubContent className="min-w-[12rem] border-border bg-card">
            {/* 常用字号快捷档：一键跳档（16→60 只需一点） */}
            <div className="grid grid-cols-3 gap-1 px-2 pb-1 pt-1" role="group" aria-label="常用字号快捷档">
              {TITLE_FONT_PRESETS.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => void updateSettings({ titleFontSize: n })}
                  aria-pressed={s.titleFontSize === n}
                  className={cn(
                    'rounded-md px-1 py-1 text-[12px] font-semibold tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
                    s.titleFontSize === n
                      ? 'bg-primary/15 text-primary'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                  )}
                >
                  {n}px
                </button>
              ))}
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                void updateSettings({ titleFontSize: Math.max(TITLE_FONT_MIN, s.titleFontSize - 1) });
              }}
              disabled={s.titleFontSize <= TITLE_FONT_MIN}
              className="text-[13px]"
            >
              <Minus className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              减小字号
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                void updateSettings({ titleFontSize: Math.min(TITLE_FONT_MAX, s.titleFontSize + 1) });
              }}
              disabled={s.titleFontSize >= TITLE_FONT_MAX}
              className="text-[13px]"
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              增大字号
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                void updateSettings({ titleFontSize: TITLE_FONT_DEFAULT });
              }}
              disabled={s.titleFontSize === TITLE_FONT_DEFAULT}
              className="text-[13px]"
            >
              恢复默认（{TITLE_FONT_DEFAULT}px）
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger disabled={!s.showTitles} className="text-[13px]">
            <ArrowDownToLine className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            标题位置
            <span className="ml-auto pl-2 text-[11px] text-muted-foreground">
              {s.titlePosition === 'overlay' ? '顶部叠加' : '内容下方'}
            </span>
          </DropdownMenuSubTrigger>
          {/* 两种位置排他显示：below = 下方编辑框；overlay = 内容顶部叠加（点击可编辑） */}
          <DropdownMenuSubContent className="min-w-[9rem] border-border bg-card">
            {TITLE_POSITIONS.map((p) => (
              <DropdownMenuItem
                key={p}
                onClick={() => void updateSettings({ titlePosition: p })}
                className={cn('text-[13px]', p === s.titlePosition && 'font-semibold text-primary')}
              >
                {p === 'overlay' ? '内容顶部叠加' : '内容下方（默认）'}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger disabled={!s.showTitles} className="text-[13px]">
            <Bold className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            标题粗细
            <span className="ml-auto pl-2 text-[11px] text-muted-foreground">
              {s.titleWeight === 'bold' ? '加粗' : s.titleWeight === 'medium' ? '中等' : '正常'}
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="min-w-[8rem] border-border bg-card">
            {TITLE_WEIGHTS.map((w) => (
              <DropdownMenuItem
                key={w}
                onClick={() => void updateSettings({ titleWeight: w })}
                className={cn('text-[13px]', w === s.titleWeight && 'font-semibold text-primary')}
              >
                <span className="mr-1" style={{ fontWeight: w === 'bold' ? 700 : w === 'medium' ? 500 : 400 }}>
                  Aa
                </span>
                {w === 'bold' ? '加粗' : w === 'medium' ? '中等' : '正常'}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger disabled={!s.showTitles} className="text-[13px]">
            <Palette className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            标题颜色
            <span
              aria-hidden
              className="ml-auto inline-block h-3.5 w-3.5 shrink-0 rounded-full border border-border"
              style={{
                background:
                  s.titleColor === TITLE_COLOR_DEFAULT
                    ? 'linear-gradient(135deg, #fff 0%, #fff 50%, #171717 50%, #171717 100%)'
                    : s.titleColor,
              }}
            />
          </DropdownMenuSubTrigger>
          {/* 色板白名单（防任意 CSS 注入）；跟随主题 = below 用前景色 / overlay 用白色+投影 */}
          <DropdownMenuSubContent className="min-w-[9rem] border-border bg-card">
            <DropdownMenuItem
              onClick={() => void updateSettings({ titleColor: TITLE_COLOR_DEFAULT })}
              className={cn('text-[13px]', s.titleColor === TITLE_COLOR_DEFAULT && 'font-semibold text-primary')}
            >
              跟随主题
            </DropdownMenuItem>
            {TITLE_COLOR_PALETTE.map((c) => (
              <DropdownMenuItem
                key={c}
                onClick={() => void updateSettings({ titleColor: c })}
                className={cn('text-[13px]', s.titleColor === c && 'font-semibold text-primary')}
              >
                <span
                  aria-hidden
                  className="mr-1.5 inline-block h-3.5 w-3.5 shrink-0 rounded-full border border-border"
                  style={{ background: c }}
                />
                {c}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* ============================== 填充下拉 ============================== */

export function FillMenu({ s, updateSettings }: MenuBase) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(ctlBtn, 'border-border bg-card text-foreground/90 hover:bg-accent hover:text-accent-foreground')}
          title="黑边填充方式：留黑边 / 模糊填充 / 铺满裁切（铺满会等比放大裁掉超出部分）"
          aria-label="黑边填充设置"
        >
          {s.letterboxFill === 'cover' ? (
            <Crop className="h-4 w-4" aria-hidden />
          ) : s.letterboxFill === 'blur' ? (
            <Droplets className="h-4 w-4" aria-hidden />
          ) : (
            <Expand className="h-4 w-4" aria-hidden />
          )}
          <span className="hidden sm:inline">填充</span>
          <span className="inline-block text-[11px] font-semibold text-primary">
            {s.letterboxFill === 'cover' ? '铺满' : s.letterboxFill === 'blur' ? '模糊' : '黑边'}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[13rem] border-border bg-card">
        {LETTERBOX_FILLS.map((f) => (
          <DropdownMenuItem
            key={f}
            onClick={() => void updateSettings({ letterboxFill: f })}
            className={cn('text-[13px]', f === s.letterboxFill && 'font-semibold text-primary')}
          >
            {f === 'cover' ? (
              <Crop className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            ) : f === 'blur' ? (
              <Droplets className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            ) : (
              <Expand className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            )}
            {f === 'cover' ? '铺满裁切（无黑边）' : f === 'blur' ? '模糊填充' : '留黑边（默认）'}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* ============================== 水印下拉 ============================== */

export function WatermarkMenu({
  s,
  updateSettings,
  patchLocal,
  onEditText,
}: MenuBase & {
  patchLocal: (partial: Partial<WallSettings>) => void;
  onEditText: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            ctlBtn,
            'border-violet-500/40 bg-violet-500/10 text-violet-600 hover:bg-violet-500/20 dark:text-violet-400',
          )}
          title="水印：防伪标志盖在视频区上方缓慢巡游（点击设置）"
          aria-label="水印设置"
        >
          <Stamp className="h-4 w-4" aria-hidden />
          <span>水印</span>
          {s.wmShow && <span className="h-1.5 w-1.5 rounded-full bg-violet-500 dark:bg-violet-400" aria-hidden />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64 border-border bg-card">
        <DropdownMenuCheckboxItem
          checked={s.wmShow}
          onCheckedChange={(v) => {
            void updateSettings({ showWatermark: v === true });
            /* 首次开启且还没设文字：直接带出文字编辑，避免空水印挂在屏幕上 */
            if (v === true && !s.wmText) onEditText();
          }}
          className="text-[13px]"
        >
          启用水印
        </DropdownMenuCheckboxItem>
        <DropdownMenuItem onClick={onEditText} className="text-[13px]">
          水印文字…
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <div className="px-2 py-2">
          <div className="mb-1 flex items-center justify-between text-[12px] text-muted-foreground">
            <span>字号</span>
            <span className="tabular-nums">{s.wmFontSize}px</span>
          </div>
          <input
            type="range"
            min={WATERMARK_FONT_MIN}
            max={WATERMARK_FONT_MAX}
            step={1}
            value={s.wmFontSize}
            onChange={(e) => patchLocal({ wmFontSize: Number(e.target.value) })}
            onPointerUp={() => void updateSettings({ watermarkFontSize: s.wmFontSize })}
            onKeyUp={() => void updateSettings({ watermarkFontSize: s.wmFontSize })}
            aria-label="水印字号"
            className="w-full accent-[var(--primary)]"
          />
          <div className="mb-1 mt-3 flex items-center justify-between text-[12px] text-muted-foreground">
            <span>颜色深浅</span>
          </div>
          <div className="flex gap-1" role="radiogroup" aria-label="水印颜色深浅">
            {WATERMARK_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={s.wmColor === c}
                onClick={() => void updateSettings({ watermarkColor: c })}
                className={cn(
                  'flex-1 rounded-md border px-1 py-1 text-[12px] transition-colors',
                  s.wmColor === c
                    ? 'border-violet-500/60 bg-violet-500/15 text-violet-600 dark:text-violet-300'
                    : 'border-border/60 text-muted-foreground hover:bg-muted/60',
                )}
              >
                {c === 'auto' ? '跟随主题' : c === 'white' ? '白' : '黑'}
              </button>
            ))}
          </div>
          <div className="mb-1 mt-3 flex items-center justify-between text-[12px] text-muted-foreground">
            <span>巡游速度</span>
          </div>
          <div className="flex gap-1" role="radiogroup" aria-label="水印巡游速度">
            {WATERMARK_SPEEDS.map((sp) => (
              <button
                key={sp}
                type="button"
                role="radio"
                aria-checked={s.wmSpeed === sp}
                onClick={() => void updateSettings({ watermarkSpeed: sp })}
                className={cn(
                  'flex-1 rounded-md border px-1 py-1 text-[12px] transition-colors',
                  s.wmSpeed === sp
                    ? 'border-violet-500/60 bg-violet-500/15 text-violet-600 dark:text-violet-300'
                    : 'border-border/60 text-muted-foreground hover:bg-muted/60',
                )}
              >
                {sp === 'slow' ? '慢' : sp === 'normal' ? '标准' : '快'}
              </button>
            ))}
          </div>
          <div className="mb-1 mt-3 flex items-center justify-between text-[12px] text-muted-foreground">
            <span>不透明度</span>
            <span className="tabular-nums">{s.wmOpacity}%</span>
          </div>
          <input
            type="range"
            min={WATERMARK_OPACITY_MIN}
            max={WATERMARK_OPACITY_MAX}
            step={1}
            value={s.wmOpacity}
            onChange={(e) => patchLocal({ wmOpacity: Number(e.target.value) })}
            onPointerUp={() => void updateSettings({ watermarkOpacity: s.wmOpacity })}
            onKeyUp={() => void updateSettings({ watermarkOpacity: s.wmOpacity })}
            aria-label="水印不透明度"
            className="w-full accent-[var(--primary)]"
          />
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem
          checked={s.wmWeight === 'bold'}
          onCheckedChange={(v) =>
            void updateSettings({ watermarkFontWeight: v === true ? 'bold' : 'normal' })
          }
          className="text-[13px]"
        >
          加粗
        </DropdownMenuCheckboxItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="text-[13px]">字体形式</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="min-w-[9rem] border-border bg-card">
            <DropdownMenuRadioGroup
              value={s.wmFamily}
              onValueChange={(v) => void updateSettings({ watermarkFontFamily: v as typeof s.wmFamily })}
            >
              <DropdownMenuRadioItem value="default" className="text-[13px]">
                默认
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="serif" className="text-[13px]">
                衬线
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="hand" className="text-[13px]">
                手写
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="mono" className="text-[13px]">
                等宽
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
