import type { Express, NextFunction, Request, Response } from 'express';

const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "base-uri 'self'",
    "connect-src 'self' http: https: ws: wss:",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: https:",
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  ].join('; '),
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-Permitted-Cross-Domain-Policies': 'none',
};

const ISOLATION_HEADERS: Record<string, string> = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Origin-Agent-Cluster': '?1',
};

const HTTPS_HEADER_VALUE = 'https';

function isHttpsRequest(req: Request): boolean {
  const forwardedProto = req.get('x-forwarded-proto');
  const firstForwardedProto = forwardedProto?.split(',')[0]?.trim().toLowerCase();
  return req.secure || firstForwardedProto === HTTPS_HEADER_VALUE;
}

function isLocalhostRequest(req: Request): boolean {
  const hostHeader = req.get('host') ?? req.hostname ?? '';
  const host = hostHeader.replace(/^\[/, '').replace(/\]$/, '').split(':')[0]?.toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

function isPotentiallyTrustworthyRequest(req: Request): boolean {
  return isHttpsRequest(req) || isLocalhostRequest(req);
}

export function securityHeaders(req: Request, res: Response, next: NextFunction): void {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    res.setHeader(name, value);
  }

  if (isPotentiallyTrustworthyRequest(req)) {
    for (const [name, value] of Object.entries(ISOLATION_HEADERS)) {
      res.setHeader(name, value);
    }
  }

  if (isHttpsRequest(req)) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  next();
}

export function applySecurityHardening(app: Express): void {
  app.disable('x-powered-by');
  app.use(securityHeaders);
}
