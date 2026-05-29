// Design tokens — TS mirror of CSS @theme in src/index.css.
// CSS owns the rendered values; this file is for JS that needs the same
// numbers (motion configs, inline measurements). Keep in sync.

export const colors = {
  bg: '#0A0A0A',
  surface: '#111111',
  surfaceRaised: '#161616',
  border: 'rgba(255,255,255,0.10)',
  borderSubtle: 'rgba(255,255,255,0.06)',
  text: '#EDEDED',
  textMuted: 'rgba(255,255,255,0.55)',
  textDim: 'rgba(255,255,255,0.35)',
  accent: '#FAFAFA',
  danger: '#F87171',
  warning: '#FBBF24',
  success: '#34D399',
} as const;

export const radius = {
  sm: 6,
  md: 8,
  lg: 12,
} as const;

// Motion — milliseconds. `motion/react` wants seconds, so expose both.
export const motion = {
  fast: 120,
  default: 180,
  ease: [0.2, 0.8, 0.2, 1] as [number, number, number, number],
} as const;

export const motionSec = {
  fast: motion.fast / 1000,
  default: motion.default / 1000,
} as const;

export type Tone = 'neutral' | 'accent' | 'info' | 'success' | 'warning' | 'danger';

export type Density = 'cozy' | 'compact';

export const densityMetrics: Record<Density, { rowHeight: number; gap: number; labelSize: number }> = {
  cozy: { rowHeight: 52, gap: 12, labelSize: 13 },
  compact: { rowHeight: 36, gap: 8, labelSize: 12 },
};
