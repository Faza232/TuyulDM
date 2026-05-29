import { forwardRef } from 'react';
import type { InputHTMLAttributes, ReactNode } from 'react';
import { cn } from '../cn';

export type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  iconLeft?: ReactNode;
  invalid?: boolean;
};

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { iconLeft, invalid, className, ...rest },
  ref,
) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 h-9 px-2.5 rounded-[var(--radius-sm)]',
        'bg-[var(--color-surface)] border transition-colors duration-[var(--motion-fast)]',
        'focus-within:border-[var(--color-accent)]',
        invalid ? 'border-[var(--color-danger)]' : 'border-[var(--color-border)]',
        className,
      )}
    >
      {iconLeft && <span className="text-[var(--color-text-dim)] shrink-0">{iconLeft}</span>}
      <input
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(
          'w-full bg-transparent outline-none text-[13px] text-[var(--color-text)]',
          'placeholder:text-[var(--color-text-dim)]',
        )}
        {...rest}
      />
    </div>
  );
});
