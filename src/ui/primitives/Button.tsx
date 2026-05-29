import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Loader2 } from '../icons';
import { cn } from '../cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
};

const base =
  'inline-flex items-center justify-center gap-1.5 font-medium rounded-[var(--radius-sm)] ' +
  'transition-colors duration-[var(--motion-fast)] select-none ' +
  'disabled:opacity-40 disabled:pointer-events-none whitespace-nowrap';

const variants: Record<Variant, string> = {
  primary:
    'bg-[var(--color-accent)] text-[var(--color-bg)] hover:bg-white',
  secondary:
    'bg-[var(--color-surface-raised)] text-[var(--color-text)] border border-[var(--color-border)] hover:bg-white/10',
  ghost:
    'bg-transparent text-[var(--color-text-muted)] hover:bg-white/5 hover:text-[var(--color-text)]',
  danger:
    'bg-[var(--color-danger)] text-[var(--color-bg)] hover:brightness-110',
};

const sizes: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-[12px]',
  md: 'h-9 px-3.5 text-[13px]',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, iconLeft, iconRight, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(base, variants[variant], sizes[size], className)}
      {...rest}
    >
      {loading ? <Loader2 size={14} className="animate-spin" /> : iconLeft}
      {children}
      {!loading && iconRight}
    </button>
  );
});
