import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '../cn';

export type RowDensity = 'cozy' | 'compact';

export interface RowProps extends HTMLAttributes<HTMLDivElement> {
  density?: RowDensity;
  selected?: boolean;
  interactive?: boolean;
  children: ReactNode;
}

const DENSITY: Record<RowDensity, string> = {
  cozy: 'min-h-[52px] gap-3 px-3 py-2 text-[13px]',
  compact: 'min-h-[36px] gap-2 px-2.5 py-1.5 text-[12px]',
};

export const Row = forwardRef<HTMLDivElement, RowProps>(function Row(
  { density = 'cozy', selected, interactive = true, className, children, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      data-selected={selected || undefined}
      className={cn(
        'group flex items-center rounded-[var(--radius-sm)] border border-transparent',
        'transition-colors duration-[var(--motion-fast)] ease-[var(--motion-ease)]',
        DENSITY[density],
        interactive && 'hover:border-[var(--color-border-subtle)] hover:bg-white/5 cursor-pointer',
        selected && 'bg-white/5 border-[var(--color-border)]',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
});
