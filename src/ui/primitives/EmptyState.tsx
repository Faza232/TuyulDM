import type { ReactNode } from 'react';
import { cn } from '../cn';

export type EmptyStateProps = {
  icon?: ReactNode;
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
  className?: string;
};

export function EmptyState({ icon, title, body, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center text-center gap-3 py-16 px-6', className)}>
      {icon && <div className="text-[var(--color-text-dim)]">{icon}</div>}
      <div className="space-y-1">
        <h3 className="text-[14px] font-medium text-[var(--color-text)]">{title}</h3>
        {body && <p className="text-[12px] text-[var(--color-text-muted)] max-w-xs">{body}</p>}
      </div>
      {action}
    </div>
  );
}
