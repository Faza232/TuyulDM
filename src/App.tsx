import { ReactNode } from 'react';
import Dashboard from './surfaces/dashboard/Dashboard';

type AppSurface = 'dashboard' | 'popup' | 'options';
interface AppProps { surface?: AppSurface; }

export default function App({ surface = 'dashboard' }: AppProps) {
  // Migration shim: Render Dashboard which for now acts as legacy App.tsx
  // This will be completely removed at the end of Phase AG.
  if (surface === 'dashboard') {
    return <Dashboard surface="dashboard" />;
  }
  if (surface === 'popup') {
    return <Dashboard surface="popup" />; // Legacy popup
  }
  if (surface === 'options') {
    return <Dashboard surface="options" />; // Legacy options
  }
  return null;
}
