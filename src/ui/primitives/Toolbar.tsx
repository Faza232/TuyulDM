import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../cn';

export type ToolbarProps = HTMLAttributes<HTMLDivElement> & {
  left?: ReactNode;
  center?: ReactNode;
  right?: ReactNode;
  height?: number;
};

export function Toolbar({ left, center, right, height = 48, className, children, style, ...rest }: ToolbarProps) {
  if (children) {
    return (
      <div
        style={{ height, ...style }}
        className={cn('flex items-center gap-2 px-3 border-b border-[var(--color-border-subtle)] bg-[var(--color-surface)]', className)}
        {...rest}
      >
        {children}
      </div>
    );
  }
  return (
    <div
      style={{ height, ...style }}
      className={cn('flex items-center gap-3 px-3 border-b border-[var(--color-border-subtle)] bg-[var(--color-surface)]', className)}
      {...rest}
    >
      <div className="flex items-center gap-2 min-w-0">{left}</div>
      <div className="flex-1 flex items-center justify-center min-w-0">{center}</div>
      <div className="flex items-center gap-2 min-w-0">{right}</div>
    </div>
  );
}
