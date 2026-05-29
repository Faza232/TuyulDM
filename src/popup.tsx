import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Popup } from './surfaces/popup/Popup';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Popup />
  </StrictMode>,
);
