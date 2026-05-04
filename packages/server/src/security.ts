import type { Express, NextFunction, Request, Response } from 'express';

const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "base-uri 'self'",
    "connect-src 'self' http: https: ws: wss:",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "img-src 'self' data: https:",
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
  ].join('; '),
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Origin-Agent-Cluster': '?1',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-Permitted-Cross-Domain-Policies': 'none',
};

const HTTPS_HEADER_VALUE = 'https';

function isHttpsRequest(req: Request): boolean {
  const forwardedProto = req.get('x-forwarded-proto');
  const firstForwardedProto = forwardedProto?.split(',')[0]?.trim().toLowerCase();
  return req.secure || firstForwardedProto === HTTPS_HEADER_VALUE;
}

export function securityHeaders(req: Request, res: Response, next: NextFunction): void {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    res.setHeader(name, value);
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
