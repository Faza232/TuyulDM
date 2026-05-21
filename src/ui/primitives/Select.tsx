import { forwardRef, type SelectHTMLAttributes } from 'react';
import { ChevronDown } from '../icons';
import { cn } from '../cn';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
  options: SelectOption[];
  placeholder?: string;
  invalid?: boolean;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { options, placeholder, invalid, className, ...rest },
  ref,
) {
  return (
    <div
      className={cn(
        'relative inline-flex h-8 items-center rounded-[var(--radius-sm)] border bg-[var(--color-surface)]',
        'transition-colors duration-[var(--motion-fast)] ease-[var(--motion-ease)]',
        'focus-within:border-[var(--color-accent)]/60',
        invalid ? 'border-[var(--color-danger)]/60' : 'border-[var(--color-border)]',
        className,
      )}
    >
      <select
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(
          'appearance-none bg-transparent pl-2.5 pr-7 text-[13px] text-[var(--color-text)] outline-none',
          'w-full h-full cursor-pointer disabled:cursor-not-allowed disabled:opacity-50',
        )}
        {...rest}
      >
        {placeholder ? (
          <option value="" disabled hidden>
            {placeholder}
          </option>
        ) : null}
        {options.map(opt => (
          <option key={opt.value} value={opt.value} disabled={opt.disabled}>
            {opt.label}
          </option>
        ))}
      </select>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute right-2 size-3.5 text-[var(--color-text-dim)]"
      />
    </div>
  );
});
