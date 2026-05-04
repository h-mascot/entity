import * as Sentry from '@sentry/node';

// Initialize Sentry for error monitoring
// Set DSN in environment variables: SENTRY_DSN

const SENTRY_DSN = process.env.SENTRY_DSN;

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    // Performance monitoring
    tracesSampleRate: 1.0,
    // Environment
    environment: process.env.NODE_ENV || 'development',
    // Release tracking (update on deploy)
    release: process.env.npm_package_version || 'unknown',
    // Filter out certain errors
    ignoreErrors: [
      'ResizeObserver loop limit exceeded',
      'ResizeObserver loop completed with undelivered notifications',
    ],
    // Attach additional context
    beforeSend(event) {
      // Add user context if available
      return event;
    },
  });

  console.log('[Sentry] Error monitoring initialized');
}

export { Sentry };
