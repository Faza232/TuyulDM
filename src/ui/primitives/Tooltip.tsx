import { useId, useState, cloneElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { cn } from '../cn';

type Side = 'top' | 'bottom' | 'left' | 'right';

export type TooltipProps = {
  label: ReactNode;
  children: ReactElement;
  side?: Side;
  className?: string;
};

const sides: Record<Side, string> = {
  top: 'bottom-full left-1/2 -translate-x-1/2 mb-1.5',
  bottom: 'top-full left-1/2 -translate-x-1/2 mt-1.5',
  left: 'right-full top-1/2 -translate-y-1/2 mr-1.5',
  right: 'left-full top-1/2 -translate-y-1/2 ml-1.5',
};

export function Tooltip({ label, children, side = 'top', className }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const id = useId();

  const trigger = cloneElement(children, {
    'aria-describedby': open ? id : undefined,
    onMouseEnter: () => setOpen(true),
    onMouseLeave: () => setOpen(false),
    onFocus: () => setOpen(true),
    onBlur: () => setOpen(false),
  } as Partial<React.HTMLAttributes<HTMLElement>>);

  return (
    <span className="relative inline-flex">
      {trigger}
      {open && (
        <span
          role="tooltip"
          id={id}
          className={cn(
            'absolute z-50 px-1.5 py-1 rounded-[var(--radius-sm)] whitespace-nowrap pointer-events-none',
            'bg-[var(--color-surface-raised)] border border-[var(--color-border)]',
            'text-[11px] text-[var(--color-text)] shadow-lg',
            sides[side],
            className,
          )}
        >
          {label}
        </span>
      )}
    </span>
  );
}
