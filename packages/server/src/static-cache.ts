import * as fs from 'fs';
import * as path from 'path';
import type { Request, Response } from 'express';

type HeaderWriter = {
  setHeader(name: string, value: string | number | readonly string[]): unknown;
};

const ONE_YEAR_SECONDS = 31_536_000;

export function resolveFrontendDist(
  cwd = process.cwd(),
  runtimeDir = __dirname,
  exists: (candidate: string) => boolean = fs.existsSync,
): string {
  const candidates = [
    path.resolve(cwd, 'packages/app/dist'),
    path.resolve(runtimeDir, '../../../../app/dist'),
    path.resolve(runtimeDir, '../../app/dist'),
  ];

  return candidates.find((candidate) => exists(path.join(candidate, 'index.html'))) ?? candidates[0];
}

export function setApiNoStoreHeaders(_req: Request, res: Response, next: () => void): void {
  res.setHeader('Cache-Control', 'no-store');
  next();
}

export function setFrontendStaticCacheHeaders(res: HeaderWriter, filePath: string): void {
  if (/[/\\]assets[/\\]/.test(filePath)) {
    res.setHeader('Cache-Control', `public, max-age=${ONE_YEAR_SECONDS}, immutable`);
    return;
  }

  if (/[/\\]index\.html$/i.test(filePath)) {
    res.setHeader('Cache-Control', 'no-cache');
  }
}

export function sendIndexNoCache(res: Response, indexPath: string): void {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(indexPath);
}
