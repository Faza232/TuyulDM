import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { X } from '../icons';
import { IconButton } from './IconButton';
import { useFocusTrap, useEscape, useBodyScrollLock } from './overlay';
import { motionSec, motion as motionTokens } from '../tokens';
import { cn } from '../cn';

export type DialogProps = {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
};

export function Dialog({ open, onClose, title, description, children, footer, className }: DialogProps) {
  const trapRef = useFocusTrap(open);
  useEscape(open, onClose);
  useBodyScrollLock(open);

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="presentation">
          <motion.div
            className="absolute inset-0 bg-black/60"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: motionSec.fast }}
          />
          <motion.div
            ref={trapRef}
            role="dialog"
            aria-modal="true"
            aria-label={typeof title === 'string' ? title : undefined}
            className={cn(
              'relative w-full max-w-md rounded-[var(--radius-lg)] z-10',
              'bg-[var(--color-surface)] border border-[var(--color-border)] shadow-2xl',
              className,
            )}
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: motionSec.default, ease: motionTokens.ease }}
          >
            {(title || description) && (
              <div className="flex items-start justify-between gap-3 p-4 pb-3">
                <div className="min-w-0">
                  {title && <h2 className="text-[14px] font-semibold text-[var(--color-text)]">{title}</h2>}
                  {description && <p className="mt-1 text-[12px] text-[var(--color-text-muted)]">{description}</p>}
                </div>
                <IconButton icon={<X size={15} />} label="Close" size="sm" tooltip={false} onClick={onClose} />
              </div>
            )}
            {children && <div className="px-4 pb-4 text-[13px] text-[var(--color-text)]">{children}</div>}
            {footer && (
              <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-[var(--color-border-subtle)]">
                {footer}
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
