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
      // If request has a file extension, check if the file exists in frontendDist first
      const ext = path.extname(_req.path);
      if (ext) {
        const filePath = path.join(frontendDist, _req.path);
        if (fs.existsSync(filePath)) {
          setFrontendStaticCacheHeaders(res, filePath);
          return res.sendFile(filePath);
        }
      }
      sendIndexNoCache(res, path.join(frontendDist, 'index.html'));
    });
    console.log(`Serving frontend from ${frontendDist}`);
  }
}
