import { useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence } from 'motion/react';
import { Toast } from './Toast';
import type { ToastData } from './Toast';
import { cn } from '../cn';

const MAX_VISIBLE = 4;

export type ToastRegionProps = {
  toasts: ToastData[];
  onDismiss: (id: string) => void;
  className?: string;
};

// Stacked, dismissible toast region. Beyond MAX_VISIBLE the overflow collapses
// into an expandable "+N more" group.
export function ToastRegion({ toasts, onDismiss, className }: ToastRegionProps) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? toasts : toasts.slice(0, MAX_VISIBLE);
  const overflow = toasts.length - visible.length;

  return createPortal(
    <div
      className={cn('fixed bottom-4 right-4 z-[60] flex flex-col items-end gap-2', className)}
      role="region"
      aria-label="Notifications"
    >
      <AnimatePresence initial={false}>
        {visible.map((t) => (
          <Toast key={t.id} toast={t} onDismiss={onDismiss} />
        ))}
      </AnimatePresence>
      {overflow > 0 && (
        <button
          onClick={() => setExpanded(true)}
          className="text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] px-2 py-1"
        >
          +{overflow} more
        </button>
      )}
    </div>,
    document.body,
  );
}
