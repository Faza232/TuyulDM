import { useState, useCallback } from 'react';

export type ToastTone = 'info' | 'success' | 'warning' | 'danger';

export interface ToastMessage {
  id: string;
  title: string;
  body?: string;
  tone: ToastTone;
}

let subscribers: ((toasts: ToastMessage[]) => void)[] = [];
let toasts: ToastMessage[] = [];

function notify() {
  subscribers.forEach(sub => sub([...toasts]));
}

let idCounter = 0;

export const toastClient = {
  push: (message: Omit<ToastMessage, 'id'>) => {
    const id = (++idCounter).toString();
    toasts = [...toasts, { ...message, id }];
    notify();
    
    if (message.tone !== 'danger') {
      setTimeout(() => toastClient.dismiss(id), 6000);
    }
  },
  dismiss: (id: string) => {
    toasts = toasts.filter(t => t.id !== id);
    notify();
  },
  subscribe: (callback: (toasts: ToastMessage[]) => void) => {
    subscribers.push(callback);
    callback([...toasts]);
    return () => {
      subscribers = subscribers.filter(sub => sub !== callback);
    };
  }
};

export function useToasts() {
  const [currentToasts, setCurrentToasts] = useState<ToastMessage[]>(toasts);

  useCallback(() => {
    // Only subscribe on mount
    const unsubscribe = toastClient.subscribe(setCurrentToasts);
    return unsubscribe;
  }, []);

  return { toasts: currentToasts, push: toastClient.push, dismiss: toastClient.dismiss };
}
