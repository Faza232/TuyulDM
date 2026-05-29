import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Tooltip } from './Tooltip';
import { cn } from '../cn';

type Size = 'sm' | 'md';

export type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: ReactNode;
  label: string;
  size?: Size;
  tooltip?: boolean;
  active?: boolean;
};

const sizes: Record<Size, string> = {
  sm: 'h-7 w-7',
  md: 'h-9 w-9',
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, size = 'md', tooltip = true, active, className, ...rest },
  ref,
) {
  const btn = (
    <button
      ref={ref}
      aria-label={label}
      className={cn(
        'inline-flex items-center justify-center rounded-[var(--radius-sm)]',
        'transition-colors duration-[var(--motion-fast)]',
        'text-[var(--color-text-muted)] hover:bg-white/5 hover:text-[var(--color-text)]',
        'disabled:opacity-40 disabled:pointer-events-none',
        active && 'bg-[var(--color-surface-raised)] text-[var(--color-text)]',
        sizes[size],
        className,
      )}
      {...rest}
    >
      {icon}
    </button>
  );
  if (!tooltip) return btn;
  return <Tooltip label={label}>{btn}</Tooltip>;
});
