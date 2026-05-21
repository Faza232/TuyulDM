import type { ReactNode } from 'react';
import { cn } from '../cn';

export interface EmptyStateProps {
  icon?: ReactNode;
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, body, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 px-6 py-12 text-center',
        className,
      )}
    >
      {icon ? (
        <span className="mb-1 inline-flex text-[var(--color-text-dim)] [&_svg]:size-6" aria-hidden>
          {icon}
        </span>
      ) : null}
      <div className="text-[14px] font-medium text-[var(--color-text)]">{title}</div>
      {body ? <div className="max-w-sm text-[12px] text-[var(--color-text-muted)]">{body}</div> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
