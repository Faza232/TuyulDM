import React from 'react';
import ReactDOM from 'react-dom/client';
import { AppRoot } from './AppRoot';
import Options from './surfaces/options/Options';
import './index.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <AppRoot>
      <Options />
    </AppRoot>
  </React.StrictMode>,
);
