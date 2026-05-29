import { forwardRef } from 'react';
import type { SelectHTMLAttributes } from 'react';
import { ChevronDown } from '../icons';
import { cn } from '../cn';

export type SelectOption = { value: string; label: string; disabled?: boolean };

export type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> & {
  options: SelectOption[];
  invalid?: boolean;
};

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { options, invalid, className, ...rest },
  ref,
) {
  return (
    <div
      className={cn(
        'relative flex items-center h-9 rounded-[var(--radius-sm)]',
        'bg-[var(--color-surface)] border transition-colors duration-[var(--motion-fast)]',
        'focus-within:border-[var(--color-accent)]',
        invalid ? 'border-[var(--color-danger)]' : 'border-[var(--color-border)]',
        className,
      )}
    >
      <select
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(
          'w-full h-full bg-transparent outline-none appearance-none',
          'pl-2.5 pr-8 text-[13px] text-[var(--color-text)] cursor-pointer',
          '[&>option]:bg-[var(--color-surface)] [&>option]:text-[var(--color-text)]',
        )}
        {...rest}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown
        size={14}
        className="absolute right-2.5 pointer-events-none text-[var(--color-text-dim)]"
      />
    </div>
  );
});
