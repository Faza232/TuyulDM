import type { ReactNode } from 'react';
import type { Tone } from '../tokens';
import { cn } from '../cn';

export type BadgeProps = {
  children: ReactNode;
  tone?: Tone;
  className?: string;
};

const tones: Record<Tone, string> = {
  neutral: 'bg-white/5 text-[var(--color-text-muted)] border-[var(--color-border)]',
  accent: 'bg-white/10 text-[var(--color-text)] border-[var(--color-border)]',
  info: 'bg-sky-400/10 text-sky-300 border-sky-400/20',
  success: 'bg-[var(--color-success)]/10 text-[var(--color-success)] border-[var(--color-success)]/20',
  warning: 'bg-[var(--color-warning)]/10 text-[var(--color-warning)] border-[var(--color-warning)]/20',
  danger: 'bg-[var(--color-danger)]/10 text-[var(--color-danger)] border-[var(--color-danger)]/20',
};

export function Badge({ children, tone = 'neutral', className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-1.5 h-[18px] rounded-[var(--radius-sm)] border',
        'font-mono text-[10px] uppercase tracking-wide leading-none',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
