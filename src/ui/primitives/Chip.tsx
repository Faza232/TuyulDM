import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../cn';
import type { BadgeTone } from './Badge';

export interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: BadgeTone;
  active?: boolean;
  iconLeft?: ReactNode;
}

const TONE: Record<BadgeTone, string> = {
  neutral: 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-white/5',
  accent: 'border-[var(--color-border)] text-[var(--color-text)] hover:bg-white/5',
  info: 'border-[#3B82F6]/30 text-[#93C5FD] hover:bg-[#3B82F6]/10',
  success: 'border-[var(--color-success)]/30 text-[var(--color-success)] hover:bg-[var(--color-success)]/10',
  warning: 'border-[var(--color-warning)]/30 text-[var(--color-warning)] hover:bg-[var(--color-warning)]/10',
  danger: 'border-[var(--color-danger)]/30 text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10',
};

const ACTIVE: Record<BadgeTone, string> = {
  neutral: 'bg-white/10 text-[var(--color-text)] border-[var(--color-border)]',
  accent: 'bg-white/15 text-[var(--color-text)] border-[var(--color-border)]',
  info: 'bg-[#3B82F6]/20 text-[#BFDBFE]',
  success: 'bg-[var(--color-success)]/20',
  warning: 'bg-[var(--color-warning)]/20',
  danger: 'bg-[var(--color-danger)]/20',
};

export const Chip = forwardRef<HTMLButtonElement, ChipProps>(function Chip(
  { tone = 'neutral', active, iconLeft, className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-pressed={active}
      className={cn(
        'inline-flex h-6 items-center gap-1 rounded-full border px-2 text-[11px]',
        'transition-colors duration-[var(--motion-fast)] ease-[var(--motion-ease)]',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        active ? ACTIVE[tone] : TONE[tone],
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
    </button>
  );
});
