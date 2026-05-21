import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../cn';

export interface SwitchProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: ReactNode;
  description?: ReactNode;
}

export const Switch = forwardRef<HTMLInputElement, SwitchProps>(function Switch(
  { label, description, className, id: idProp, checked, ...rest },
  ref,
) {
  const autoId = useId();
  const id = idProp ?? autoId;
  return (
    <label htmlFor={id} className={cn('inline-flex items-start gap-3 cursor-pointer select-none', className)}>
      <span className="relative inline-flex shrink-0 mt-[2px]">
        <input
          ref={ref}
          id={id}
          type="checkbox"
          role="switch"
          checked={checked}
          className="peer sr-only"
          {...rest}
        />
        <span
          aria-hidden
          className={cn(
            'inline-flex h-4 w-7 items-center rounded-full border transition-colors duration-[var(--motion-fast)]',
            'border-[var(--color-border)] bg-[var(--color-surface)]',
            'peer-checked:bg-[var(--color-accent)] peer-checked:border-[var(--color-accent)]',
            'peer-focus-visible:outline peer-focus-visible:outline-1 peer-focus-visible:outline-[var(--color-accent)] peer-focus-visible:outline-offset-2',
            'peer-disabled:opacity-50 peer-disabled:cursor-not-allowed',
          )}
        >
          <span
            className={cn(
              'ml-[2px] block size-3 rounded-full bg-[var(--color-text-muted)]',
              'transition-transform duration-[var(--motion-fast)] ease-[var(--motion-ease)]',
              'peer-checked:translate-x-3 peer-checked:bg-[var(--color-bg)]',
            )}
          />
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
