import type { HTMLAttributes } from 'react';
import { cn } from '../cn';

export type ProgressTone = 'accent' | 'success' | 'warning' | 'danger';

export interface ProgressBarProps extends HTMLAttributes<HTMLDivElement> {
  value?: number;
  max?: number;
  tone?: ProgressTone;
  indeterminate?: boolean;
  label?: string;
}

const TONE: Record<ProgressTone, string> = {
  accent: 'bg-[var(--color-accent)]',
  success: 'bg-[var(--color-success)]',
  warning: 'bg-[var(--color-warning)]',
  danger: 'bg-[var(--color-danger)]',
};

export function ProgressBar({
  value = 0,
  max = 100,
  tone = 'accent',
  indeterminate,
  label,
  className,
  ...rest
}: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(max, value));
  const pct = max > 0 ? (clamped / max) * 100 : 0;
  return (
    <div
      role="progressbar"
      aria-valuenow={indeterminate ? undefined : clamped}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-label={label}
      className={cn(
        'relative h-0.5 w-full overflow-hidden rounded-full bg-white/5',
        className,
      )}
      {...rest}
    >
      {indeterminate ? (
        <span
          aria-hidden
          className={cn(
            'absolute inset-y-0 left-0 w-1/3 rounded-full',
            TONE[tone],
            'animate-[progress-indeterminate_1.4s_ease-in-out_infinite]',
          )}
          style={{ animationName: 'progress-indeterminate' }}
        />
      ) : (
        <span
          aria-hidden
          className={cn('block h-full rounded-full transition-[width] duration-200 ease-[var(--motion-ease)]', TONE[tone])}
          style={{ width: `${pct}%` }}
        />
      )}
      <style>
        {`@keyframes progress-indeterminate { 0% { transform: translateX(-100%); } 100% { transform: translateX(300%); } }`}
      </style>
    </div>
  );
}
