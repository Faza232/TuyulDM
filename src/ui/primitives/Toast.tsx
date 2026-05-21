import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X, ChevronUp, ChevronDown } from '../icons';
import { IconButton } from './IconButton';
import { cn } from '../cn';

export type ToastTone = 'info' | 'success' | 'warning' | 'danger';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastInput {
  id?: string;
  tone?: ToastTone;
  title: string;
  body?: ReactNode;
  duration?: number;
  action?: ToastAction;
}

export interface ToastEntry extends Required<Pick<ToastInput, 'id' | 'tone' | 'title' | 'duration'>> {
  body?: ReactNode;
  action?: ToastAction;
}

interface ToastContextValue {
  push: (input: ToastInput) => string;
  dismiss: (id: string) => void;
  clear: () => void;
  toasts: ToastEntry[];
}

const ToastContext = createContext<ToastContextValue | null>(null);

const ICON: Record<ToastTone, ReactNode> = {
  info: <Info />,
  success: <CheckCircle2 />,
  warning: <AlertTriangle />,
  danger: <AlertCircle />,
};

const TONE: Record<ToastTone, string> = {
  info: 'border-[#3B82F6]/30',
  success: 'border-[var(--color-success)]/30',
  warning: 'border-[var(--color-warning)]/30',
  danger: 'border-[var(--color-danger)]/30',
};

const TONE_ICON: Record<ToastTone, string> = {
  info: 'text-[#93C5FD]',
  success: 'text-[var(--color-success)]',
  warning: 'text-[var(--color-warning)]',
  danger: 'text-[var(--color-danger)]',
};

export interface ToastProviderProps {
  children: ReactNode;
}

export function ToastProvider({ children }: ToastProviderProps) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const counter = useRef(0);

  const dismiss = useCallback((id: string) => {
    setToasts(list => list.filter(t => t.id !== id));
  }, []);

  const push = useCallback((input: ToastInput): string => {
    counter.current += 1;
    const id = input.id ?? `t-${counter.current}`;
    const tone: ToastTone = input.tone ?? 'info';
    const duration = input.duration ?? (tone === 'danger' ? 0 : 6000);
    const entry: ToastEntry = { id, tone, title: input.title, body: input.body, duration, action: input.action };
    setToasts(list => [...list.filter(t => t.id !== id), entry]);
    return id;
  }, []);

  const clear = useCallback(() => setToasts([]), []);

  const ctx = useMemo<ToastContextValue>(() => ({ push, dismiss, clear, toasts }), [push, dismiss, clear, toasts]);

  return (
    <ToastContext.Provider value={ctx}>
      {children}
      <ToastRegion toasts={toasts} dismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

const MAX_STACK = 4;

function ToastRegion({ toasts, dismiss }: { toasts: ToastEntry[]; dismiss: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const hiddenCount = toasts.length > MAX_STACK ? toasts.length - MAX_STACK : 0;
  
  const visible = expanded ? toasts : toasts.slice(-MAX_STACK);
  
  return (
    <div
      aria-live="polite"
      role="region"
      className="pointer-events-none fixed bottom-3 right-3 z-50 flex w-[320px] flex-col gap-2"
    >
      <AnimatePresence initial={false}>
        {hiddenCount > 0 && !expanded && (
           <motion.div
              layout
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="pointer-events-auto flex items-center justify-center py-1 cursor-pointer bg-[var(--color-surface-raised)] border border-[var(--color-border-subtle)] rounded shadow text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
              onClick={() => setExpanded(true)}
           >
              +{hiddenCount} more
           </motion.div>
        )}
        {hiddenCount > 0 && expanded && (
           <motion.div
              layout
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="pointer-events-auto flex items-center justify-center py-1 cursor-pointer bg-[var(--color-surface-raised)] border border-[var(--color-border-subtle)] rounded shadow text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
              onClick={() => setExpanded(false)}
           >
              Collapse
           </motion.div>
        )}
        
        {visible.map(t => (
          <ToastItem key={t.id} entry={t} dismiss={dismiss} />
        ))}
      </AnimatePresence>
    </div>
  );
}

function ToastItem({ entry, dismiss }: { entry: ToastEntry; dismiss: (id: string) => void }) {
  useEffect(() => {
    if (!entry.duration) return;
    const t = window.setTimeout(() => dismiss(entry.id), entry.duration);
    return () => window.clearTimeout(t);
  }, [entry.duration, entry.id, dismiss]);

  return (
    <motion.div
      layout
      role="status"
      initial={{ opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
      className={cn(
        'pointer-events-auto flex items-start gap-2 rounded-[var(--radius-md)] border bg-[var(--color-surface-raised)]',
        'p-2.5 shadow-xl',
        TONE[entry.tone],
      )}
    >
      <span className={cn('mt-0.5 inline-flex shrink-0 [&_svg]:size-4', TONE_ICON[entry.tone])} aria-hidden>
        {ICON[entry.tone]}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium leading-tight text-[var(--color-text)]">{entry.title}</div>
        {entry.body ? (
          <div className="mt-0.5 text-[12px] leading-snug text-[var(--color-text-muted)]">{entry.body}</div>
        ) : null}
        {entry.action ? (
          <button
            type="button"
            onClick={() => {
              entry.action!.onClick();
              dismiss(entry.id);
            }}
            className="mt-1.5 text-[12px] font-medium text-[var(--color-accent)] hover:underline"
          >
            {entry.action.label}
          </button>
        ) : null}
      </div>
      <IconButton label="Dismiss" size="sm" onClick={() => dismiss(entry.id)}>
        <X />
      </IconButton>
    </motion.div>
  );
}
