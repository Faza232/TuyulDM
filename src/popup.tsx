import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App';
import Dev from './ui/_dev';
import Popup from './surfaces/popup/Popup'; // Direct usage if needed later, but using App for now
import './index.css';

const params = new URLSearchParams(window.location.search);
const isDev = import.meta.env.DEV && params.get('dev') === '1';

const root = createRoot(document.getElementById('root')!);

root.render(
  <StrictMode>
    {isDev ? <Dev /> : <App surface="popup" />} 
  </StrictMode>,
);
