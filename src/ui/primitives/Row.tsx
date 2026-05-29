import { forwardRef } from 'react';
import type { HTMLAttributes } from 'react';
import type { Density } from '../tokens';
import { densityMetrics } from '../tokens';
import { cn } from '../cn';

export type RowProps = HTMLAttributes<HTMLDivElement> & {
  density?: Density;
  selected?: boolean;
  interactive?: boolean;
};

export const Row = forwardRef<HTMLDivElement, RowProps>(function Row(
  { density = 'cozy', selected, interactive = true, className, style, children, ...rest },
  ref,
) {
  const m = densityMetrics[density];
  return (
    <div
      ref={ref}
      style={{ minHeight: m.rowHeight, paddingLeft: m.gap, paddingRight: m.gap, ...style }}
      className={cn(
        'flex items-center gap-3 rounded-[var(--radius-sm)] border border-transparent',
        'transition-colors duration-[var(--motion-fast)]',
        interactive && 'cursor-pointer hover:bg-white/5 hover:border-[var(--color-border)]',
        selected && 'bg-[var(--color-surface-raised)] border-[var(--color-border)]',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
});
