import { describe, expect, it } from 'vitest';
import { validateSmtpBackendConfig, assessBackendHealth, type SmtpBackendConfig } from './backend-health';

describe('validateSmtpBackendConfig — reject plaintext SMTP auth (THE-932)', () => {
  it('rejects credentials over port 25 (plaintext) with a negative test', () => {
    const decision = validateSmtpBackendConfig({
      host: 'mail.example.com',
      port: 25,
      auth: { user: 'bot', pass: 'secret' },
    } as SmtpBackendConfig);
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.code).toBe('plaintext_auth_forbidden');
    }
  });

  it('rejects auth when secure=false and STARTTLS is not required', () => {
    const decision = validateSmtpBackendConfig({
      host: 'mail.example.com',
      port: 587,
      secure: false,
      requireTls: false,
      auth: { user: 'bot', pass: 'secret' },
    } as SmtpBackendConfig);
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.code).toBe('plaintext_auth_forbidden');
    }
  });

  it('accepts implicit TLS (port 465, secure=true) with credentials', () => {
    expect(
      validateSmtpBackendConfig({
        host: 'mail.example.com',
        port: 465,
        secure: true,
        auth: { user: 'bot', pass: 'secret' },
      } as SmtpBackendConfig).ok,
    ).toBe(true);
  });

  it('accepts opportunistic STARTTLS channel when requireTls is enforced', () => {
    expect(
      validateSmtpBackendConfig({
        host: 'mail.example.com',
        port: 587,
        secure: false,
        requireTls: true,
        auth: { user: 'bot', pass: 'secret' },
      } as SmtpBackendConfig).ok,
    ).toBe(true);
  });

  it('does not require TLS when no credentials are supplied', () => {
    expect(
      validateSmtpBackendConfig({ host: 'mail.example.com', port: 25 } as SmtpBackendConfig).ok,
    ).toBe(true);
  });

  it('rejects malformed config shapes', () => {
    expect(validateSmtpBackendConfig(null).ok).toBe(false);
    expect(validateSmtpBackendConfig({ port: '587' }).ok).toBe(false);
    expect(validateSmtpBackendConfig({ port: 99999, auth: { user: 'x' } }).ok).toBe(false);
  });
});

describe('assessBackendHealth — structured projection', () => {
  it('reports a healthy TLS SMTP backend as available with a redacted message', () => {
    const health = assessBackendHealth({
      host: 'mail.example.com',
      port: 465,
      secure: true,
      auth: { user: 'bot', pass: 'never-leak-me' },
    } as SmtpBackendConfig);
    expect(health.available).toBe(true);
    expect(JSON.stringify(health)).not.toContain('never-leak-me');
  });

  it('reports an invalid config as unavailable with a code, never throwing', () => {
    const health = assessBackendHealth({ port: 25, auth: { user: 'x', pass: 'y' } } as SmtpBackendConfig);
    expect(health.available).toBe(false);
    expect(typeof health.code).toBe('string');
  });
});
