import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App';
import Dev from './ui/_dev';
import './index.css';

const params = new URLSearchParams(window.location.search);
const isDev = import.meta.env.DEV && params.get('dev') === '1';

const root = createRoot(document.getElementById('root')!);

root.render(
  <StrictMode>
    {isDev ? <Dev /> : <App surface="dashboard" />}
  </StrictMode>,
);
