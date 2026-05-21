import { ReactNode } from 'react';
import Dashboard from './surfaces/dashboard/Dashboard';
import { ToastProvider } from './ui/primitives';
import { MotionConfig } from 'motion/react';

type AppSurface = 'dashboard' | 'popup' | 'options';
interface AppProps { surface?: AppSurface; }

export default function App({ surface = 'dashboard' }: AppProps) {
  // Migration shim: Render Dashboard which for now acts as legacy App.tsx
  // This will be completely removed at the end of Phase AG.
  
  const content = (() => {
    if (surface === 'dashboard') return <Dashboard surface="dashboard" />;
    if (surface === 'popup') return <Dashboard surface="popup" />;
    if (surface === 'options') return <Dashboard surface="options" />;
    return null;
  })();

  return (
    <MotionConfig reducedMotion="user">
       <ToastProvider>
         {content}
       </ToastProvider>
    </MotionConfig>
  );
}
