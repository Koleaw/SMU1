export type TextSize = 'small' | 'base' | 'large' | 'xl' | '2xl';
export type TextWeight = 'normal' | 'medium' | 'semibold' | 'bold';
export type TextAlign = 'left' | 'center' | 'right';
export type TextLineHeight = 'compact' | 'normal' | 'relaxed';
export type TextColor = 'primary' | 'secondary' | 'white' | 'accent';
export type BlockWidth = 'narrow' | 'medium' | 'wide' | 'full';
export type BlockPosition = 'left' | 'center' | 'right';
export type BlockSpacing = 'compact' | 'normal' | 'large';

export interface TextStyleSettings {
  fontSize?: TextSize;
  fontWeight?: TextWeight;
  italic?: boolean;
  align?: TextAlign;
  lineHeight?: TextLineHeight;
  color?: TextColor;
}

export interface TextLayoutSettings {
  width?: BlockWidth;
  widthPercent?: number;
  maxWidth?: number;
  position?: BlockPosition;
  padding?: BlockSpacing;
  verticalPadding?: BlockSpacing;
}

interface LegacyTextSettings {
  textWidth?: string;
  textAlign?: string;
  titleSize?: string;
  textSize?: string;
  textWeight?: string | number;
  textItalic?: boolean;
  paddingTop?: string;
  paddingBottom?: string;
}

const TEXT_FONT_SIZES: Record<TextSize, string> = {
  small: '14px',
  base: '16px',
  large: '18px',
  xl: '22px',
  '2xl': '28px',
};

const TITLE_FONT_SIZES: Record<TextSize, string> = {
  small: '28px',
  base: '36px',
  large: '44px',
  xl: '54px',
  '2xl': '64px',
};

const FONT_WEIGHTS: Record<TextWeight, string> = {
  normal: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
};

const LINE_HEIGHTS: Record<TextLineHeight, string> = {
  compact: '1.28',
  normal: '1.55',
  relaxed: '1.75',
};

const TEXT_COLORS: Record<TextColor, string> = {
  primary: 'var(--color-text)',
  secondary: 'var(--color-muted)',
  white: '#ffffff',
  accent: 'var(--color-accent)',
};

const WIDTH_PRESETS: Record<BlockWidth, { width: string; maxWidth?: string }> = {
  narrow: { width: '50%', maxWidth: '560px' },
  medium: { width: '70%', maxWidth: '720px' },
  wide: { width: '90%', maxWidth: '960px' },
  full: { width: '100%' },
};

const POSITION_PRESETS: Record<BlockPosition, { justify: string; margin: string }> = {
  left: { justify: 'start', margin: '0 auto 0 0' },
  center: { justify: 'center', margin: '0 auto' },
  right: { justify: 'end', margin: '0 0 0 auto' },
};

const PADDING_PRESETS: Record<BlockSpacing, string> = {
  compact: '14px',
  normal: '22px',
  large: '32px',
};

const SECTION_PADDING_PRESETS: Record<BlockSpacing, string> = {
  compact: 'clamp(24px, 4vw, 36px)',
  normal: 'clamp(36px, 5vw, 56px)',
  large: 'clamp(56px, 7vw, 84px)',
};

const isOption = <T extends string>(value: unknown, options: readonly T[]): value is T =>
  typeof value === 'string' && options.includes(value as T);

const clampNumber = (value: unknown, min: number, max: number) => {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) return undefined;
  return Math.min(max, Math.max(min, number));
};

const safePx = (value: unknown, min: number, max: number) => {
  const text = String(value ?? '').trim();
  const match = text.match(/^(\d{1,4})(?:px)?$/);
  if (!match) return undefined;
  const number = clampNumber(match[1], min, max);
  return number === undefined ? undefined : `${Math.round(number)}px`;
};

const safeWidth = (value: unknown) => {
  const text = String(value ?? '').trim();
  const percent = text.match(/^(\d{1,3})%$/);
  if (percent) {
    const number = clampNumber(percent[1], 30, 100);
    return number === undefined ? undefined : `${Math.round(number)}%`;
  }
  return safePx(text, 280, 1200);
};

const safeWeight = (value: unknown) => {
  const text = String(value ?? '').trim();
  if (!text) return undefined;
  if (isOption(text, ['normal', 'medium', 'semibold', 'bold'] as const)) return FONT_WEIGHTS[text];
  const numeric = Number(text);
  return [400, 500, 600, 700].includes(numeric) ? String(numeric) : undefined;
};

const styleString = (styles: Array<string | undefined>) => {
  const safeStyles = styles.filter(Boolean);
  return safeStyles.length ? `${safeStyles.join(';')};` : undefined;
};

export const mergeStyleStrings = (...styles: Array<string | undefined>) => {
  const merged = styles
    .filter(Boolean)
    .map((style) => String(style).replace(/;+$/g, ''))
    .filter(Boolean);
  return merged.length ? `${merged.join(';')};` : undefined;
};

export const getTextStyleVars = (
  style?: TextStyleSettings,
  legacy?: LegacyTextSettings,
  title = false,
) => {
  const fontSize = isOption(style?.fontSize, ['small', 'base', 'large', 'xl', '2xl'] as const)
    ? (title ? TITLE_FONT_SIZES : TEXT_FONT_SIZES)[style.fontSize]
    : undefined;
  const legacySize = !fontSize ? safePx(title ? legacy?.titleSize : legacy?.textSize, 10, title ? 96 : 48) : undefined;
  const fontWeight = isOption(style?.fontWeight, ['normal', 'medium', 'semibold', 'bold'] as const)
    ? FONT_WEIGHTS[style.fontWeight]
    : safeWeight(legacy?.textWeight);
  const fontStyle = typeof style?.italic === 'boolean'
    ? (style.italic ? 'italic' : 'normal')
    : legacy?.textItalic
      ? 'italic'
      : undefined;
  const align = isOption(style?.align, ['left', 'center', 'right'] as const)
    ? style.align
    : isOption(legacy?.textAlign, ['left', 'center', 'right'] as const)
      ? legacy?.textAlign
      : undefined;
  const lineHeight = isOption(style?.lineHeight, ['compact', 'normal', 'relaxed'] as const)
    ? LINE_HEIGHTS[style.lineHeight]
    : undefined;
  const color = isOption(style?.color, ['primary', 'secondary', 'white', 'accent'] as const)
    ? TEXT_COLORS[style.color]
    : undefined;

  return styleString([
    fontSize || legacySize ? `--text-block-font-size:${fontSize || legacySize}` : undefined,
    fontWeight ? `--text-block-font-weight:${fontWeight}` : undefined,
    fontStyle ? `--text-block-font-style:${fontStyle}` : undefined,
    lineHeight ? `--text-block-line-height:${lineHeight}` : undefined,
    color ? `--text-block-color:${color}` : undefined,
    color ? `color:${color}` : undefined,
    align ? `text-align:${align}` : undefined,
  ]);
};

export const getTextLayoutVars = (layout?: TextLayoutSettings, legacy?: LegacyTextSettings) => {
  const widthPreset = isOption(layout?.width, ['narrow', 'medium', 'wide', 'full'] as const)
    ? WIDTH_PRESETS[layout.width]
    : undefined;
  const widthPercent = clampNumber(layout?.widthPercent, 30, 100);
  const maxWidth = clampNumber(layout?.maxWidth, 280, 1200);
  const legacyWidth = !widthPreset && widthPercent === undefined ? safeWidth(legacy?.textWidth) : undefined;
  const position = isOption(layout?.position, ['left', 'center', 'right'] as const)
    ? POSITION_PRESETS[layout.position]
    : undefined;
  const padding = isOption(layout?.padding, ['compact', 'normal', 'large'] as const)
    ? PADDING_PRESETS[layout.padding]
    : undefined;

  return styleString([
    widthPercent !== undefined
      ? `--text-block-width:${Math.round(widthPercent)}%`
      : widthPreset?.width
        ? `--text-block-width:${widthPreset.width}`
        : legacyWidth
          ? `--text-block-width:${legacyWidth}`
          : undefined,
    maxWidth !== undefined
      ? `--text-block-max-width:${Math.round(maxWidth)}px`
      : widthPreset?.maxWidth
        ? `--text-block-max-width:${widthPreset.maxWidth}`
        : legacyWidth?.endsWith('px')
          ? `--text-block-max-width:${legacyWidth}`
          : undefined,
    position ? `--text-block-justify:${position.justify}` : undefined,
    position ? `--text-block-margin:${position.margin}` : undefined,
    padding ? `--text-block-padding:${padding}` : undefined,
  ]);
};

export const getSectionSpacingVars = (layout?: TextLayoutSettings, legacy?: LegacyTextSettings) => {
  const preset = isOption(layout?.verticalPadding, ['compact', 'normal', 'large'] as const)
    ? SECTION_PADDING_PRESETS[layout.verticalPadding]
    : undefined;
  const top = preset ?? safePx(legacy?.paddingTop, 0, 140);
  const bottom = preset ?? safePx(legacy?.paddingBottom, 0, 140);

  return styleString([
    top ? `--page-block-padding-top:${top}` : undefined,
    bottom ? `--page-block-padding-bottom:${bottom}` : undefined,
  ]);
};
