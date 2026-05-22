import { ReactNode } from 'react';
import { MotionConfig } from 'motion/react';
import { ToastProvider } from './ui/primitives';

export function AppRoot({ children }: { children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">
      <ToastProvider>{children}</ToastProvider>
    </MotionConfig>
  );
}
