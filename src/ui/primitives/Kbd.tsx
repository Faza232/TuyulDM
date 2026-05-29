import type { ReactNode } from 'react';
import { cn } from '../cn';

export type KbdProps = {
  children: ReactNode;
  className?: string;
};

export function Kbd({ children, className }: KbdProps) {
  return (
    <kbd
      className={cn(
        'inline-flex items-center justify-center min-w-[18px] h-[18px] px-1',
        'rounded-[4px] border border-[var(--color-border)] bg-[var(--color-surface-raised)]',
        'font-mono text-[10px] text-[var(--color-text-muted)] leading-none',
        className,
      )}
    >
      {children}
    </kbd>
  );
}
