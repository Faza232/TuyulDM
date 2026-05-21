import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from '../icons';
import { cn } from '../cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
}

const VARIANT: Record<ButtonVariant, string> = {
  primary:
    'bg-[var(--color-accent)] text-[var(--color-bg)] hover:bg-white active:bg-white/90 border border-transparent',
  secondary:
    'bg-[var(--color-surface-raised)] text-[var(--color-text)] hover:bg-white/10 border border-[var(--color-border)]',
  ghost:
    'bg-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-white/5 border border-transparent',
  danger:
    'bg-transparent text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10 border border-[var(--color-danger)]/30',
};

const SIZE: Record<ButtonSize, string> = {
  sm: 'h-7 px-2.5 text-[12px] gap-1.5',
  md: 'h-8 px-3 text-[13px] gap-2',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    loading = false,
    disabled,
    iconLeft,
    iconRight,
    className,
    children,
    ...rest
  },
  ref,
) {
  const isDisabled = disabled || loading;
  return (
    <button
      ref={ref}
      disabled={isDisabled}
      data-loading={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center rounded-[var(--radius-sm)] font-medium tracking-tight',
        'transition-colors duration-[var(--motion-fast)] ease-[var(--motion-ease)]',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        VARIANT[variant],
        SIZE[size],
        className,
      )}
      {...rest}
    >
      {loading ? (
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
      ) : iconLeft ? (
        <span className="inline-flex shrink-0 [&_svg]:size-3.5" aria-hidden>
          {iconLeft}
        </span>
      ) : null}
      {children}
      {!loading && iconRight ? (
        <span className="inline-flex shrink-0 [&_svg]:size-3.5" aria-hidden>
          {iconRight}
        </span>
      ) : null}
    </button>
  );
});
