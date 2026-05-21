import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { Check } from '../icons';
import { cn } from '../cn';

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: ReactNode;
  description?: ReactNode;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, description, className, id: idProp, checked, ...rest },
  ref,
) {
  const autoId = useId();
  const id = idProp ?? autoId;
  return (
    <label htmlFor={id} className={cn('inline-flex items-start gap-2 cursor-pointer select-none', className)}>
      <span className="relative inline-flex shrink-0 mt-[2px]">
        <input
          ref={ref}
          id={id}
          type="checkbox"
          checked={checked}
          className="peer sr-only"
          {...rest}
        />
        <span
          aria-hidden
          className={cn(
            'inline-flex size-4 items-center justify-center rounded-[4px] border bg-[var(--color-surface)]',
            'border-[var(--color-border)] transition-colors duration-[var(--motion-fast)]',
            'peer-checked:bg-[var(--color-accent)] peer-checked:border-[var(--color-accent)]',
            'peer-focus-visible:outline peer-focus-visible:outline-1 peer-focus-visible:outline-[var(--color-accent)] peer-focus-visible:outline-offset-2',
            'peer-disabled:opacity-50 peer-disabled:cursor-not-allowed',
          )}
        >
          {checked ? <Check className="size-3 text-[var(--color-bg)]" /> : null}
        </span>
      </span>
      {(label || description) && (
        <span className="flex flex-col gap-0.5">
          {label ? <span className="text-[13px] text-[var(--color-text)] leading-tight">{label}</span> : null}
          {description ? (
            <span className="text-[12px] text-[var(--color-text-muted)] leading-snug">{description}</span>
          ) : null}
        </span>
      )}
    </label>
  );
});
