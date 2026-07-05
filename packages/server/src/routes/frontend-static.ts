import express from "express";
import fs from "fs";
import path from "path";
import type { Express } from "express";
import {
  resolveFrontendDist,
  sendIndexNoCache,
  setFrontendStaticCacheHeaders,
} from "../static-cache";

export function registerFrontendStaticRoutes(app: Express): void {
  const frontendDist = resolveFrontendDist();
  if (fs.existsSync(frontendDist)) {
    app.use(express.static(frontendDist, { setHeaders: setFrontendStaticCacheHeaders }));
    app.get('*', (_req, res, next) => {
      if (_req.path.startsWith('/api/')) return next();
      const ext = path.extname(_req.path);
      if (ext) {
        const filePath = path.join(frontendDist, _req.path);
        if (fs.existsSync(filePath)) {
          setFrontendStaticCacheHeaders(res, filePath);
          return res.sendFile(filePath);
        }
        // Never serve index.html for missing asset files: stale clients asking
        // for old hashed chunks must get a 404 (a clean reload) rather than an
        // HTML body that fails module MIME checks and wedges the app shell.
        return res.status(404).type('text/plain').send('Not found');
      }
      sendIndexNoCache(res, path.join(frontendDist, 'index.html'));
    });
    console.log(`Serving frontend from ${frontendDist}`);
  }
}
