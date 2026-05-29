import type { Tone } from '../tokens';
import { cn } from '../cn';

export type ProgressBarProps = {
  // 0..1 determinate, or omit / null for indeterminate.
  value?: number | null;
  tone?: Extract<Tone, 'accent' | 'success' | 'warning' | 'danger'>;
  height?: number;
  className?: string;
};

const fills: Record<NonNullable<ProgressBarProps['tone']>, string> = {
  accent: 'bg-[var(--color-accent)]',
  success: 'bg-[var(--color-success)]',
  warning: 'bg-[var(--color-warning)]',
  danger: 'bg-[var(--color-danger)]',
};

export function ProgressBar({ value, tone = 'accent', height = 2, className }: ProgressBarProps) {
  const indeterminate = value == null;
  const pct = indeterminate ? 0 : Math.max(0, Math.min(1, value)) * 100;
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : Math.round(pct)}
      style={{ height }}
      className={cn('relative w-full overflow-hidden rounded-full bg-white/10', className)}
    >
      {indeterminate ? (
        <div
          className={cn('absolute inset-y-0 w-1/3 rounded-full', fills[tone])}
          style={{ animation: 'tuyul-indeterminate 1.2s var(--motion-ease) infinite' }}
        />
      ) : (
        <div
          className={cn('h-full rounded-full transition-[width] duration-[var(--motion-default)]', fills[tone])}
          style={{ width: `${pct}%` }}
        />
      )}
    </div>
  );
}
