import React from 'react';
import ReactDOM from 'react-dom/client';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { initializeOfflineSupport } from './lib/offline';
import './index.css';

const App = React.lazy(() => import('./App'));

// Initialize Sentry for error monitoring
const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN;

if (SENTRY_DSN) {
  const initializeSentry = () => {
    void import('@sentry/react')
      .then((Sentry) => {
        Sentry.init({
          dsn: SENTRY_DSN,
          integrations: [
            Sentry.browserTracingIntegration(),
            Sentry.replayIntegration({
              maskAllText: false,
              blockAllMedia: false,
            }),
          ],
          // Keep full tracing in dev, but avoid high production overhead.
          tracesSampleRate: import.meta.env.PROD ? 0.1 : 1.0,
          // Session Replay
          replaysSessionSampleRate: 0.1,
          replaysOnErrorSampleRate: 1.0,
          environment: import.meta.env.MODE || 'development',
          release: import.meta.env.VITE_APP_VERSION || 'unknown',
        });
        console.log('[Sentry] Client-side error monitoring initialized');
      })
      .catch((error) => {
        console.error('[Sentry] Failed to initialize client-side monitoring:', error);
      });
  };

  window.requestAnimationFrame(() => {
    window.setTimeout(initializeSentry, 0);
  });
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
      <React.Suspense
        fallback={
          <div style={{ display: 'grid', minHeight: '100vh', placeItems: 'center', background: '#020617', color: '#cbd5e1' }}>
            Loading Entity...
          </div>
        }
      >
        <App />
      </React.Suspense>
    </AppErrorBoundary>
  </React.StrictMode>
);
