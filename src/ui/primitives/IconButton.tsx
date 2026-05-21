import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Tooltip } from './Tooltip';
import { cn } from '../cn';

export type IconButtonSize = 'sm' | 'md';

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  tone?: 'default' | 'danger';
  size?: IconButtonSize;
  tooltip?: boolean;
  children: ReactNode;
}

const SIZE: Record<IconButtonSize, string> = {
  sm: 'size-6 [&_svg]:size-3.5',
  md: 'size-7 [&_svg]:size-4',
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, tone = 'default', size = 'md', tooltip = true, className, children, disabled, ...rest },
  ref,
) {
  const button = (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      disabled={disabled}
      className={cn(
        'inline-flex items-center justify-center rounded-[var(--radius-sm)] border border-transparent',
        'transition-colors duration-[var(--motion-fast)] ease-[var(--motion-ease)]',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        tone === 'danger'
          ? 'text-[var(--color-text-muted)] hover:text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10'
          : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-white/5',
        SIZE[size],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );

  if (!tooltip || disabled) return button;
  return <Tooltip content={label}>{button}</Tooltip>;
});
