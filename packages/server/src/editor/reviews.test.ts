import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerEditorReviewWebhookRoutes, shouldAllowOpenClawWebhookWithoutToken } from './reviews';

const originalWebhookToken = process.env.ENTITY_OPENCLAW_WEBHOOK_TOKEN;
const originalAllowInsecure = process.env.ENTITY_ALLOW_INSECURE;

function restoreEnv(): void {
  if (typeof originalWebhookToken === 'undefined') {
    delete process.env.ENTITY_OPENCLAW_WEBHOOK_TOKEN;
  } else {
    process.env.ENTITY_OPENCLAW_WEBHOOK_TOKEN = originalWebhookToken;
  }
  if (typeof originalAllowInsecure === 'undefined') {
    delete process.env.ENTITY_ALLOW_INSECURE;
  } else {
    process.env.ENTITY_ALLOW_INSECURE = originalAllowInsecure;
  }
}

function createResponse() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
}

describe('OpenClaw review webhook auth', () => {
  afterEach(() => {
    restoreEnv();
    vi.restoreAllMocks();
  });

  it('does not allow tokenless callbacks unless insecure mode is explicit', () => {
    expect(shouldAllowOpenClawWebhookWithoutToken({ allowInsecure: undefined })).toBe(false);
  });

  it('logs a loud warning when tokenless callbacks are explicitly allowed', () => {
    const logger = { warn: vi.fn() };

    expect(shouldAllowOpenClawWebhookWithoutToken({ allowInsecure: '1', logger })).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('WARNING'));
  });

  it('rejects OpenClaw callbacks when no webhook token is configured', () => {
    delete process.env.ENTITY_OPENCLAW_WEBHOOK_TOKEN;
    delete process.env.ENTITY_ALLOW_INSECURE;
    const handlers: Record<string, (req: any, res: any) => void> = {};
    const service = { receiveReviewResult: vi.fn() };

    registerEditorReviewWebhookRoutes(
      {
        post: (route: string, handler: (req: any, res: any) => void) => {
          handlers[route] = handler;
        },
      } as any,
      { service: service as any },
    );

    const response = createResponse();
    handlers['/api/webhooks/openclaw/review-result'](
      {
        header: vi.fn(() => undefined),
        body: { runId: 'review-1' },
      },
      response,
    );

    expect(response.status).toHaveBeenCalledWith(503);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'WEBHOOK_TOKEN_REQUIRED' }));
    expect(service.receiveReviewResult).not.toHaveBeenCalled();
  });
});
