import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../cn';

export interface KbdProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
}

export function Kbd({ className, children, ...rest }: KbdProps) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-[1.25rem] items-center justify-center gap-0.5 rounded-[4px]',
        'border border-[var(--color-border)] bg-[var(--color-surface-raised)]',
        'px-1 font-mono text-[10px] text-[var(--color-text-muted)] leading-none',
        className,
      )}
      {...rest}
    >
      {children}
    </kbd>
  );
}
