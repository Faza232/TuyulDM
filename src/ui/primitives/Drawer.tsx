import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { X } from '../icons';
import { IconButton } from './IconButton';
import { useFocusTrap, useEscape, useBodyScrollLock } from './overlay';
import { motionSec, motion as motionTokens } from '../tokens';
import { cn } from '../cn';

export type DrawerProps = {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  side?: 'right' | 'left';
  width?: number;
  children?: ReactNode;
  className?: string;
};

export function Drawer({ open, onClose, title, side = 'right', width = 480, children, className }: DrawerProps) {
  const trapRef = useFocusTrap(open);
  useEscape(open, onClose);
  useBodyScrollLock(open);

  const off = side === 'right' ? width : -width;

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50" role="presentation">
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
            style={{ width }}
            className={cn(
              'absolute top-0 bottom-0 flex flex-col',
              side === 'right' ? 'right-0 border-l' : 'left-0 border-r',
              'bg-[var(--color-surface)] border-[var(--color-border)] shadow-2xl',
              className,
            )}
            initial={{ x: off }}
            animate={{ x: 0 }}
            exit={{ x: off }}
            transition={{ duration: motionSec.default, ease: motionTokens.ease }}
          >
            <div className="flex items-center justify-between gap-3 h-12 px-4 border-b border-[var(--color-border-subtle)] shrink-0">
              {typeof title === 'string'
                ? <h2 className="text-[13px] font-semibold text-[var(--color-text)] truncate">{title}</h2>
                : title}
              <IconButton icon={<X size={15} />} label="Close" size="sm" tooltip={false} onClick={onClose} />
            </div>
            <div className="flex-1 overflow-y-auto">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
