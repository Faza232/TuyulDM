import { useRef, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { X } from '../icons';
import { IconButton } from './IconButton';
import { useBodyScrollLock, useFocusTrap } from './_focus';
import { cn } from '../cn';

export type DrawerSide = 'right' | 'left';

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  side?: DrawerSide;
  width?: number;
  title?: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  closeOnOverlay?: boolean;
  className?: string;
  children?: ReactNode;
}

export function Drawer({
  open,
  onClose,
  side = 'right',
  width = 480,
  title,
  description,
  footer,
  closeOnOverlay = true,
  className,
  children,
}: DrawerProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  useFocusTrap(ref, open, onClose);
  useBodyScrollLock(open);

  const isRight = side === 'right';
  const offscreen = isRight ? '100%' : '-100%';

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-40"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
        >
          <div
            aria-hidden
            className="absolute inset-0 bg-black/50"
            onClick={closeOnOverlay ? onClose : undefined}
          />
          <motion.div
            ref={ref}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? 'drawer-title' : undefined}
            tabIndex={-1}
            initial={{ x: offscreen }}
            animate={{ x: 0 }}
            exit={{ x: offscreen }}
            transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
            style={{ width }}
            className={cn(
              'absolute top-0 bottom-0 flex h-full flex-col',
              'border-l border-[var(--color-border)] bg-[var(--color-surface)]',
              'shadow-2xl outline-none',
              isRight ? 'right-0' : 'left-0 border-l-0 border-r border-[var(--color-border)]',
              className,
            )}
          >
            {(title || description) && (
              <header className="flex items-start justify-between gap-4 border-b border-[var(--color-border-subtle)] px-4 py-3">
                <div className="flex min-w-0 flex-col gap-1">
                  {title ? (
                    <h2 id="drawer-title" className="truncate text-[14px] font-semibold tracking-tight text-[var(--color-text)]">
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
            <div className="flex-1 overflow-auto px-4 py-4">{children}</div>
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
