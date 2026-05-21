import { useRef, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { X } from '../icons';
import { IconButton } from './IconButton';
import { useBodyScrollLock, useFocusTrap } from './_focus';
import { cn } from '../cn';

export type DialogSize = 'sm' | 'md' | 'lg';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  size?: DialogSize;
  footer?: ReactNode;
  closeOnOverlay?: boolean;
  className?: string;
  children?: ReactNode;
}

const SIZE: Record<DialogSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
};

export function Dialog({
  open,
  onClose,
  title,
  description,
  size = 'md',
  footer,
  closeOnOverlay = true,
  className,
  children,
}: DialogProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  useFocusTrap(ref, open, onClose);
  useBodyScrollLock(open);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
        >
          <div
            aria-hidden
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={closeOnOverlay ? onClose : undefined}
          />
          <motion.div
            ref={ref}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? 'dialog-title' : undefined}
            tabIndex={-1}
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
            className={cn(
              'relative w-full rounded-[var(--radius-lg)] border border-[var(--color-border)]',
              'bg-[var(--color-surface)] shadow-2xl outline-none',
              SIZE[size],
              className,
            )}
          >
            {(title || description) && (
              <header className="flex items-start justify-between gap-4 border-b border-[var(--color-border-subtle)] px-4 py-3">
                <div className="flex flex-col gap-1">
                  {title ? (
                    <h2 id="dialog-title" className="text-[14px] font-semibold tracking-tight text-[var(--color-text)]">
                      {title}
                    </h2>
                  ) : null}
                  {description ? (
                    <p className="text-[12px] text-[var(--color-text-muted)]">{description}</p>
                  ) : null}
                </div>
                <IconButton label="Close" onClick={onClose} size="sm">
                  <X />
                </IconButton>
              </header>
            )}
            <div className="px-4 py-4">{children}</div>
            {footer ? (
              <footer className="flex items-center justify-end gap-2 border-t border-[var(--color-border-subtle)] px-4 py-3">
                {footer}
              </footer>
            ) : null}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
