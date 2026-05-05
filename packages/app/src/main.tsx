import React from 'react';
import ReactDOM from 'react-dom/client';
import * as Sentry from '@sentry/react';
import App from './App';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { initializeOfflineSupport } from './lib/offline';
import './index.css';

// Initialize Sentry for error monitoring
const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN;

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({
        maskAllText: false,
        blockAllMedia: false,
      }),
    ],
    // Performance Monitoring
    tracesSampleRate: 1.0,
    // Session Replay
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
    environment: import.meta.env.MODE || 'development',
    release: import.meta.env.VITE_APP_VERSION || 'unknown',
  });
  console.log('[Sentry] Client-side error monitoring initialized');
}

const THEME_KEY = 'entity.theme.v1';
let initialTheme = 'dark';
try {
  const storedTheme = window.localStorage.getItem(THEME_KEY);
  if (storedTheme === 'crew') {
    initialTheme = 'kitz';
  } else if (
    storedTheme === 'light' ||
    storedTheme === 'kitz' ||
    storedTheme === 'nebula' ||
    storedTheme === 'aurora' ||
    storedTheme === 'paper' ||
    storedTheme === 'dark'
  ) {
    initialTheme = storedTheme;
  }
} catch {
  initialTheme = 'dark';
}
document.documentElement.setAttribute('data-theme', initialTheme);
initializeOfflineSupport();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>
);
