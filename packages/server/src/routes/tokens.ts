import type express from 'express';
import { createTokenUsageRepository } from '../../../db/src/token-usage';
import { collectAllSources, startCollectionScheduler } from '../tokens/collector';

interface TokenRouteDependencies {
  app: express.Express;
}

function parseRange(value: unknown): { from: string; to: string; days: number } {
  const range = String(value ?? '30d').toLowerCase();
  const today = new Date();

  let days = 30;
  if (range.endsWith('d')) {
    days = parseInt(range.slice(0, -1)) || 30;
  } else if (range.endsWith('w')) {
    days = (parseInt(range.slice(0, -1)) || 4) * 7;
  } else if (range === '90d') {
    days = 90;
  } else if (range === '7d') {
    days = 7;
  }

  const from = new Date(today);
  from.setDate(from.getDate() - days);
  const to = new Date(today);

  return {
    from: from.toISOString().split('T')[0],
    to: to.toISOString().split('T')[0],
    days,
  };
}

export function registerTokenRoutes({ app }: TokenRouteDependencies): void {
  const repo = createTokenUsageRepository();

  app.get('/api/tokens/summary', (req, res) => {
    try {
      const { from, to } = parseRange(req.query.range);
      const summary = repo.getSummary(from, to);
      res.json(summary);
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to fetch token summary',
      });
    }
  });

  app.get('/api/tokens/daily', (req, res) => {
    try {
      const from = req.query.from as string;
      const to = req.query.to as string;

      if (!from || !to) {
        return res.status(400).json({ error: 'from and to query params are required' });
      }

      const daily = repo.getDailyBreakdown(from, to);
      res.json(daily);
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to fetch daily breakdown',
      });
    }
  });

  app.get('/api/tokens/sources', (req, res) => {
    try {
      const sources = repo.getSources();
      res.json(sources);
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to fetch sources',
      });
    }
  });

  app.get('/api/tokens/usage', (req, res) => {
    try {
      const source = req.query.source as string;
      const from = req.query.from as string;
      const to = req.query.to as string;
      const limit = parseInt(req.query.limit as string) || 100;

      const filters: {
        source?: 'openclaw' | 'codex' | 'claude-code' | 'hermes';
        from?: string;
        to?: string;
        limit?: number;
      } = { limit };

      if (source && ['openclaw', 'codex', 'claude-code', 'hermes'].includes(source)) {
        filters.source = source as 'openclaw' | 'codex' | 'claude-code' | 'hermes';
      }
      if (from) filters.from = from;
      if (to) filters.to = to;

      const usage = repo.listUsage(filters);
      res.json(usage);
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to fetch usage records',
      });
    }
  });

  app.post('/api/tokens/collect', (req, res) => {
    try {
      const result = collectAllSources();
      res.json(result);
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to collect tokens',
      });
    }
  });

  app.delete('/api/tokens/old', (req, res) => {
    try {
      const beforeDate = req.query.before as string;
      if (!beforeDate) {
        return res.status(400).json({ error: 'before query param is required (YYYY-MM-DD)' });
      }

      const deleted = repo.deleteOldRecords(beforeDate);
      res.json({ deleted });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to delete old records',
      });
    }
  });

  startCollectionScheduler(6 * 60 * 60 * 1000);
}
