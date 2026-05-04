import type { Express, Request, Response } from 'express';
import { EditorServiceError, type DocumentReviewWebhookPayload, type EditorService } from './service';

interface EditorReviewWebhookErrorBody {
  code: string;
  error: string;
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
}

function mapWebhookError(error: unknown): { status: number; body: EditorReviewWebhookErrorBody } {
  if (error instanceof EditorServiceError) {
    return {
      status: error.status,
      body: {
        code: error.code,
        error: error.message,
      },
    };
  }

  const message = error instanceof Error ? error.message : 'Unknown error';
  return {
    status: 500,
    body: {
      code: 'INTERNAL_ERROR',
      error: message,
    },
  };
}

export interface RegisterEditorReviewWebhookRoutesOptions {
  service: EditorService;
}

/**
 * Receives OpenClaw review results and persists them into the document review run record.
 *
 * Optional auth:
 * - If `ENTITY_OPENCLAW_WEBHOOK_TOKEN` is set, requires `Authorization: Bearer <token>`.
 */
export function registerEditorReviewWebhookRoutes(app: Express, options: RegisterEditorReviewWebhookRoutesOptions): void {
  app.post('/api/webhooks/openclaw/review-result', (req: Request, res: Response) => {
    const expected = normalizeOptionalString(process.env.ENTITY_OPENCLAW_WEBHOOK_TOKEN);
    if (expected) {
      const header = normalizeOptionalString(req.header('authorization'));
      const token = header?.toLowerCase().startsWith('bearer ') ? header.slice('bearer '.length).trim() : null;
      if (!token || token !== expected) {
        res.status(401).json({
          code: 'WEBHOOK_UNAUTHORIZED',
          error: 'Webhook token is missing or invalid.',
        } satisfies EditorReviewWebhookErrorBody);
        return;
      }
    }

    try {
      const payload = req.body as DocumentReviewWebhookPayload;
      res.json(options.service.receiveReviewResult(payload));
    } catch (error) {
      const mapped = mapWebhookError(error);
      res.status(mapped.status).json(mapped.body);
    }
  });
}

