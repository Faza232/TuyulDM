import { cn } from '../cn';

export type SwitchProps = {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
};

export function Switch({ checked, onChange, label, disabled, id, className }: SwitchProps) {
  return (
    <label className={cn('inline-flex items-center gap-2.5 cursor-pointer select-none', disabled && 'opacity-40 pointer-events-none', className)}>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative h-[18px] w-[32px] rounded-full transition-colors duration-[var(--motion-fast)] shrink-0',
          checked ? 'bg-[var(--color-accent)]' : 'bg-white/15',
        )}
      >
        <span
          aria-hidden
          className={cn(
            'absolute top-[2px] h-[14px] w-[14px] rounded-full bg-[var(--color-bg)] transition-transform duration-[var(--motion-fast)]',
            checked ? 'translate-x-[16px]' : 'translate-x-[2px]',
          )}
        />
      </button>
      {label && <span className="text-[13px] text-[var(--color-text)]">{label}</span>}
    </label>
  );
}
