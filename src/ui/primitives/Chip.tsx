import type { ReactNode } from 'react';
import type { Tone } from '../tokens';
import { cn } from '../cn';

export type ChipProps = {
  children: ReactNode;
  tone?: Tone;
  icon?: ReactNode;
  className?: string;
};

const tones: Record<Tone, string> = {
  neutral: 'bg-[var(--color-surface-raised)] text-[var(--color-text-muted)] border-[var(--color-border)]',
  accent: 'bg-white/10 text-[var(--color-text)] border-[var(--color-border)]',
  info: 'bg-sky-400/10 text-sky-300 border-sky-400/20',
  success: 'bg-[var(--color-success)]/10 text-[var(--color-success)] border-[var(--color-success)]/20',
  warning: 'bg-[var(--color-warning)]/10 text-[var(--color-warning)] border-[var(--color-warning)]/20',
  danger: 'bg-[var(--color-danger)]/10 text-[var(--color-danger)] border-[var(--color-danger)]/20',
};

export function Chip({ children, tone = 'neutral', icon, className }: ChipProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 h-6 rounded-[var(--radius-md)] border text-[11px] font-medium',
        tones[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}
