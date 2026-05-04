import type { Request, Response } from 'express';
import type { CreateCrewInput, CrewRecord, CrewSubscriptionRecord } from '../../db/src';

type MinimalApp = {
  get: (path: string, handler: (req: Request, res: Response) => unknown) => void;
  post: (path: string, handler: (req: Request, res: Response) => unknown) => void;
  delete: (path: string, handler: (req: Request, res: Response) => unknown) => void;
};

interface RegisterCrewRoutesOptions {
  app: MinimalApp;
  prefix: '' | '/api';
  getCrews: () => CrewRecord[];
  createCrew: (input: CreateCrewInput) => CrewRecord;
  subscribeToCrew: (crewId: string, agentId: string) => CrewSubscriptionRecord;
  unsubscribeFromCrew: (crewId: string, agentId: string) => boolean;
  getSubscribersForCrew: (crewId: string) => CrewSubscriptionRecord[];
  getSubscriptionsForAgent: (agentId: string) => CrewSubscriptionRecord[];
  statusForError: (message: string) => number;
}

export function registerCrewRoutes({
  app,
  prefix,
  getCrews,
  createCrew,
  subscribeToCrew,
  unsubscribeFromCrew,
  getSubscribersForCrew,
  getSubscriptionsForAgent,
  statusForError,
}: RegisterCrewRoutesOptions): void {
  const crewsBase = `${prefix}/crews`;

  // List crews
  app.get(crewsBase, (_req, res) => {
    try {
      return res.json(getCrews());
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return res.status(statusForError(message)).json({ error: message });
    }
  });

  // Create crew
  app.post(crewsBase, (req, res) => {
    const { name, description, settings } = req.body as {
      name?: unknown;
      description?: unknown;
      settings?: unknown;
    };

    if (typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'name required' });
    }

    if (typeof description !== 'undefined' && description !== null && typeof description !== 'string') {
      return res.status(400).json({ error: 'description must be a string' });
    }

    if (typeof settings !== 'undefined' && settings !== null && typeof settings !== 'string') {
      return res.status(400).json({ error: 'settings must be a string' });
    }

    try {
      const crew = createCrew({
        name,
        description: typeof description === 'string' ? description : undefined,
        settings: typeof settings === 'string' ? settings : undefined,
      });
      return res.status(201).json(crew);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return res.status(statusForError(message)).json({ error: message });
    }
  });

  // Subscribe agent to crew
  app.post(`${crewsBase}/:crewId/subscribers`, (req, res) => {
    const { crewId } = req.params as { crewId: string };
    const { agent_id } = req.body as { agent_id?: unknown };

    if (typeof agent_id !== 'string' || !agent_id.trim()) {
      return res.status(400).json({ error: 'agent_id required' });
    }

    try {
      const sub = subscribeToCrew(crewId, agent_id);
      return res.status(201).json(sub);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      const status = message === 'already subscribed' ? 409 : statusForError(message);
      return res.status(status).json({ error: message });
    }
  });

  // Unsubscribe agent from crew
  app.delete(`${crewsBase}/:crewId/subscribers/:agentId`, (req, res) => {
    const { crewId, agentId } = req.params as { crewId: string; agentId: string };

    try {
      const removed = unsubscribeFromCrew(crewId, agentId);
      if (!removed) {
        return res.status(404).json({ error: 'subscription not found' });
      }
      return res.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return res.status(statusForError(message)).json({ error: message });
    }
  });

  // List subscribers for a crew
  app.get(`${crewsBase}/:crewId/subscribers`, (req, res) => {
    const { crewId } = req.params as { crewId: string };

    try {
      const subs = getSubscribersForCrew(crewId);
      return res.json(subs);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return res.status(statusForError(message)).json({ error: message });
    }
  });

  // List subscriptions for an agent
  app.get(`${crewsBase}/subscriptions/:agentId`, (req, res) => {
    const { agentId } = req.params as { agentId: string };

    try {
      const subs = getSubscriptionsForAgent(agentId);
      return res.json(subs);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return res.status(statusForError(message)).json({ error: message });
    }
  });
}
