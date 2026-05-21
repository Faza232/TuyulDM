import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '../cn';

export interface ToolbarProps extends HTMLAttributes<HTMLDivElement> {
  ariaLabel?: string;
  children: ReactNode;
}

export const Toolbar = forwardRef<HTMLDivElement, ToolbarProps>(function Toolbar(
  { ariaLabel, className, children, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label={ariaLabel}
      className={cn(
        'flex h-12 items-center gap-2 border-b border-[var(--color-border-subtle)]',
        'bg-[var(--color-surface)] px-3',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
});

export function ToolbarSpacer() {
  return <span className="flex-1" />;
}

export function ToolbarDivider() {
  return <span aria-hidden className="h-5 w-px bg-[var(--color-border-subtle)]" />;
}
