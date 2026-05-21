import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../cn';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { iconLeft, iconRight, invalid, className, ...rest },
  ref,
) {
  return (
    <div
      className={cn(
        'inline-flex h-8 items-center gap-2 rounded-[var(--radius-sm)] border bg-[var(--color-surface)] px-2.5',
        'transition-colors duration-[var(--motion-fast)] ease-[var(--motion-ease)]',
        'focus-within:border-[var(--color-accent)]/60',
        invalid
          ? 'border-[var(--color-danger)]/60'
          : 'border-[var(--color-border)] hover:border-[var(--color-border)]',
        className,
      )}
    >
      {iconLeft ? (
        <span className="inline-flex shrink-0 text-[var(--color-text-dim)] [&_svg]:size-3.5" aria-hidden>
          {iconLeft}
        </span>
      ) : null}
      <input
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(
          'w-full bg-transparent text-[13px] text-[var(--color-text)] outline-none',
          'placeholder:text-[var(--color-text-dim)] disabled:cursor-not-allowed disabled:opacity-50',
        )}
        {...rest}
      />
      {iconRight ? (
        <span className="inline-flex shrink-0 text-[var(--color-text-dim)] [&_svg]:size-3.5" aria-hidden>
          {iconRight}
        </span>
      ) : null}
    </div>
  );
});
