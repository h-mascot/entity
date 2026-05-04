import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('server entrypoint portability defaults', () => {
  const readServerEntrypoint = () => fs.readFileSync(path.resolve(__dirname, '../index.ts'), 'utf-8');

  it('does not use a private Tailnet OpenClaw URL as the product default', () => {
    const source = readServerEntrypoint();
    const privateOpenClawBaseUrl = ['http://100', '106', '69', '9:18789'].join('.');

    expect(source).not.toContain(`process.env.OPENCLAW || '${privateOpenClawBaseUrl}'`);
    expect(source).toContain("process.env.OPENCLAW || 'http://127.0.0.1:18789'");
  });

  it('does not use private Tailnet agent health endpoints as product defaults', () => {
    const source = readServerEntrypoint();
    const privateHealthHosts = [
      ['100', '106', '69', '9'].join('.'),
      ['100', '68', '207', '75'].join('.'),
      ['100', '86', '150', '96'].join('.'),
    ];

    for (const host of privateHealthHosts) {
      expect(source).not.toContain(`http://${host}:18789/health`);
      expect(source).not.toContain(`http://${host}:18789/api/health`);
      expect(source).not.toContain(`http://${host}:18791/health`);
      expect(source).not.toContain(`http://${host}:18791/api/health`);
    }
  });
});
