import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import { CheckCircle2, AlertTriangle, AlertCircle, Info, X } from '../icons';
import { IconButton } from './IconButton';
import { motionSec } from '../tokens';
import { cn } from '../cn';

export type ToastTone = 'info' | 'success' | 'warning' | 'danger';

export type ToastData = {
  id: string;
  tone: ToastTone;
  title: string;
  body?: string;
  action?: { label: string; onClick: () => void };
};

const toneIcon: Record<ToastTone, ReactNode> = {
  info: <Info size={15} className="text-sky-300" />,
  success: <CheckCircle2 size={15} className="text-[var(--color-success)]" />,
  warning: <AlertTriangle size={15} className="text-[var(--color-warning)]" />,
  danger: <AlertCircle size={15} className="text-[var(--color-danger)]" />,
};

export type ToastProps = {
  toast: ToastData;
  onDismiss: (id: string) => void;
};

export function Toast({ toast, onDismiss }: ToastProps) {
  return (
    <motion.div
      layout
      role="status"
      aria-live={toast.tone === 'danger' ? 'assertive' : 'polite'}
      initial={{ opacity: 0, x: 16, scale: 0.98 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 16, scale: 0.98 }}
      transition={{ duration: motionSec.default }}
      className={cn(
        'flex items-start gap-2.5 w-[320px] p-3 rounded-[var(--radius-md)]',
        'bg-[var(--color-surface-raised)] border border-[var(--color-border)] shadow-2xl',
      )}
    >
      <span className="mt-px shrink-0">{toneIcon[toast.tone]}</span>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-medium text-[var(--color-text)]">{toast.title}</p>
        {toast.body && <p className="mt-0.5 text-[12px] text-[var(--color-text-muted)]">{toast.body}</p>}
        {toast.action && (
          <button
            onClick={toast.action.onClick}
            className="mt-1.5 text-[12px] font-medium text-[var(--color-text)] underline underline-offset-2 hover:opacity-80"
          >
            {toast.action.label}
          </button>
        )}
      </div>
      <IconButton icon={<X size={14} />} label="Dismiss" size="sm" tooltip={false} onClick={() => onDismiss(toast.id)} />
    </motion.div>
  );
}
