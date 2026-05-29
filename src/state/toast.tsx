import { createContext, useCallback, useContext, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ToastRegion } from '../ui/primitives';
import type { ToastData, ToastTone } from '../ui/primitives';

const AUTO_DISMISS_MS = 6000;

export type ToastInput = {
  tone: ToastTone;
  title: string;
  body?: string;
  action?: { label: string; onClick: () => void };
};

interface ToastContextValue {
  push: (toast: ToastInput) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastData[]>([]);
  const counter = useRef(0);
  const timers = useRef<Record<string, number>>({});

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current[id];
    if (timer) { window.clearTimeout(timer); delete timers.current[id]; }
  }, []);

  const push = useCallback((toast: ToastInput) => {
    counter.current += 1;
    const id = `toast-${counter.current}`;
    setToasts((prev) => [...prev, { id, ...toast }]);
    // danger toasts persist until acknowledged
    if (toast.tone !== 'danger') {
      timers.current[id] = window.setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
    }
    return id;
  }, [dismiss]);

  return (
    <ToastContext.Provider value={{ push, dismiss }}>
      {children}
      <ToastRegion toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToasts(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Allow hooks that optionally toast to run outside a provider (e.g. popup).
    return { push: () => '', dismiss: () => {} };
  }
  return ctx;
}
