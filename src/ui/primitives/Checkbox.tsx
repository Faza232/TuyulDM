import { forwardRef } from 'react';
import type { InputHTMLAttributes } from 'react';
import { Check } from '../icons';
import { cn } from '../cn';

export type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  label?: string;
};

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, className, checked, ...rest },
  ref,
) {
  return (
    <label className={cn('inline-flex items-center gap-2 cursor-pointer select-none', className)}>
      <span className="relative inline-flex">
        <input
          ref={ref}
          type="checkbox"
          checked={checked}
          className="peer sr-only"
          {...rest}
        />
        <span
          aria-hidden
          className={cn(
            'h-4 w-4 rounded-[4px] border border-[var(--color-border)] bg-[var(--color-surface)]',
            'flex items-center justify-center transition-colors duration-[var(--motion-fast)]',
            'peer-checked:bg-[var(--color-accent)] peer-checked:border-[var(--color-accent)]',
            'peer-focus-visible:outline peer-focus-visible:outline-1 peer-focus-visible:outline-[var(--color-accent)] peer-focus-visible:outline-offset-2',
          )}
        >
          {checked && <Check size={11} strokeWidth={3} className="text-[var(--color-bg)]" />}
        </span>
      </span>
      {label && <span className="text-[13px] text-[var(--color-text)]">{label}</span>}
    </label>
  );
});
