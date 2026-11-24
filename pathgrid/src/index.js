import React from 'react';
import ReactDOM from 'react-dom/client';
import './tailwind.output.css';
import App from './App';
import reportWebVitals from './reportWebVitals';
import { registerServiceWorker } from './services/serviceWorkerRegistration';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Offline support (PRD 5.3). Only registers in production builds; a no-op in
// development so the dev server never serves stale cached code.
registerServiceWorker({
  onError: (error) => {
    // eslint-disable-next-line no-console
    console.warn('[PathGrid] Service worker registration failed; offline mode unavailable.', error);
  },
});

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
