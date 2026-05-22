import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { AppRoot } from './AppRoot';
import Dashboard from './surfaces/dashboard/Dashboard';
import Dev from './ui/_dev';
import './index.css';

const params = new URLSearchParams(window.location.search);
const isDev = import.meta.env.DEV && params.get('dev') === '1';

const root = createRoot(document.getElementById('root')!);

root.render(
  <StrictMode>
    <AppRoot>{isDev ? <Dev /> : <Dashboard />}</AppRoot>
  </StrictMode>,
);
