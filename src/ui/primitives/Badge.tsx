import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '../cn';

export type BadgeTone =
  | 'neutral'
  | 'accent'
  | 'info'
  | 'success'
  | 'warning'
  | 'danger';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  iconLeft?: ReactNode;
  mono?: boolean;
}

const TONE: Record<BadgeTone, string> = {
  neutral: 'bg-white/5 text-[var(--color-text-muted)] border-[var(--color-border-subtle)]',
  accent: 'bg-white/10 text-[var(--color-text)] border-[var(--color-border)]',
  info: 'bg-[#3B82F6]/15 text-[#93C5FD] border-[#3B82F6]/30',
  success: 'bg-[var(--color-success)]/15 text-[var(--color-success)] border-[var(--color-success)]/30',
  warning: 'bg-[var(--color-warning)]/15 text-[var(--color-warning)] border-[var(--color-warning)]/30',
  danger: 'bg-[var(--color-danger)]/15 text-[var(--color-danger)] border-[var(--color-danger)]/30',
};

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { tone = 'neutral', iconLeft, mono, className, children, ...rest },
  ref,
) {
  return (
    <span
      ref={ref}
      className={cn(
        'inline-flex items-center gap-1 rounded-[var(--radius-sm)] border px-1.5 py-0.5 text-[11px]',
        'leading-none whitespace-nowrap',
        mono && 'font-mono tracking-tight',
        TONE[tone],
        className,
      )}
      {...rest}
    >
      {iconLeft ? (
        <span className="inline-flex shrink-0 [&_svg]:size-3" aria-hidden>
          {iconLeft}
        </span>
      ) : null}
      {children}
    </span>
  );
});
