import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const distDir = resolve(import.meta.dirname, '..', 'dist');

await rm(distDir, { recursive: true, force: true });
console.log(`Cleaned ${distDir}`);
