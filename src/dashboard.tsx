import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Dashboard } from './surfaces/dashboard/Dashboard';
import { ToastProvider } from './state/toast';
import { PreferencesProvider } from './state/preferences';
import { StateProvider } from './state/store';
import './index.css';

async function mount() {
  const root = createRoot(document.getElementById('root')!);
  if (import.meta.env.DEV && new URLSearchParams(location.search).get('dev') === 'ui') {
    const { DevShowcase } = await import('./ui/_dev.tsx');
    root.render(<StrictMode><DevShowcase /></StrictMode>);
    return;
  }
  root.render(
    <StrictMode>
      <ToastProvider>
        <PreferencesProvider>
          <StateProvider>
            <Dashboard />
          </StateProvider>
        </PreferencesProvider>
      </ToastProvider>
    </StrictMode>,
  );
}

void mount();
