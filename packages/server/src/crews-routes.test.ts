import { describe, expect, it, vi } from 'vitest';
import { registerCrewRoutes } from './crews-routes';
import type { CrewSubscriptionRecord } from '../../db/src';

function buildResponse() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
}

const sampleSubscription: CrewSubscriptionRecord = {
  id: 1,
  crew_id: 'crew-1',
  agent_id: 'agent-ada',
  created_at: '2026-04-11T00:00:00.000Z',
};

describe('registerCrewRoutes', () => {
  it('registers crew list and creation endpoints', () => {
    const handlers: Record<string, (req: any, res: any) => any> = {};
    const listCrews = vi.fn(() => [
      {
        id: 'crew-1',
        name: 'Alpha Crew',
        description: 'Exploration team',
        settings: '{"mode":"steady"}',
        created_at: '2026-03-25T00:00:00.000Z',
        updated_at: '2026-03-25T00:00:00.000Z',
      },
    ]);
    const createCrew = vi.fn((input) => ({
      id: 'crew-2',
      name: input.name,
      description: input.description ?? null,
      settings: input.settings ?? null,
      created_at: '2026-03-25T00:00:00.000Z',
      updated_at: '2026-03-25T00:00:00.000Z',
    }));

    registerCrewRoutes({
      app: {
        get: (route, handler) => { handlers[`GET ${route}`] = handler; },
        post: (route, handler) => { handlers[`POST ${route}`] = handler; },
        delete: (route, handler) => { handlers[`DELETE ${route}`] = handler; },
      },
      prefix: '/api',
      getCrews: listCrews,
      createCrew,
      subscribeToCrew: vi.fn(),
      unsubscribeFromCrew: vi.fn(),
      getSubscribersForCrew: vi.fn(() => []),
      getSubscriptionsForAgent: vi.fn(() => []),
      statusForError: () => 500,
    });

    const listResponse = buildResponse();
    handlers['GET /api/crews']({}, listResponse);
    expect(listCrews).toHaveBeenCalledOnce();
    expect(listResponse.json).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'crew-1', name: 'Alpha Crew' }),
    ]);

    const createResponse = buildResponse();
    handlers['POST /api/crews'](
      { body: { name: 'Bravo Crew', description: 'Builder crew', settings: '{"mode":"fast"}' } },
      createResponse,
    );
    expect(createCrew).toHaveBeenCalledWith({
      name: 'Bravo Crew',
      description: 'Builder crew',
      settings: '{"mode":"fast"}',
    });
    expect(createResponse.status).toHaveBeenCalledWith(201);
  });

  it('rejects invalid create payloads', () => {
    const handlers: Record<string, (req: any, res: any) => any> = {};

    registerCrewRoutes({
      app: {
        get: () => undefined,
        post: (route, handler) => { handlers[`POST ${route}`] = handler; },
        delete: () => undefined,
      },
      prefix: '/api',
      getCrews: () => [],
      createCrew: () => { throw new Error('should not be called'); },
      subscribeToCrew: vi.fn(),
      unsubscribeFromCrew: vi.fn(),
      getSubscribersForCrew: vi.fn(() => []),
      getSubscriptionsForAgent: vi.fn(() => []),
      statusForError: () => 500,
    });

    const missingNameResponse = buildResponse();
    handlers['POST /api/crews']({ body: { description: 'No name' } }, missingNameResponse);
    expect(missingNameResponse.status).toHaveBeenCalledWith(400);

    const badSettingsResponse = buildResponse();
    handlers['POST /api/crews']({ body: { name: 'Crew', settings: { mode: 'fast' } } }, badSettingsResponse);
    expect(badSettingsResponse.status).toHaveBeenCalledWith(400);
  });

  it('subscribes an agent to a crew', () => {
    const handlers: Record<string, (req: any, res: any) => any> = {};
    const subscribe = vi.fn(() => ({ ...sampleSubscription }));

    registerCrewRoutes({
      app: {
        get: () => undefined,
        post: (route, handler) => { handlers[`POST ${route}`] = handler; },
        delete: () => undefined,
      },
      prefix: '/api',
      getCrews: () => [],
      createCrew: vi.fn(),
      subscribeToCrew: subscribe,
      unsubscribeFromCrew: vi.fn(),
      getSubscribersForCrew: vi.fn(() => []),
      getSubscriptionsForAgent: vi.fn(() => []),
      statusForError: () => 500,
    });

    const res = buildResponse();
    handlers['POST /api/crews/:crewId/subscribers'](
      { params: { crewId: 'crew-1' }, body: { agent_id: 'agent-ada' } },
      res,
    );
    expect(subscribe).toHaveBeenCalledWith('crew-1', 'agent-ada');
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ crew_id: 'crew-1', agent_id: 'agent-ada' }));
  });

  it('rejects subscribe without agent_id', () => {
    const handlers: Record<string, (req: any, res: any) => any> = {};

    registerCrewRoutes({
      app: {
        get: () => undefined,
        post: (route, handler) => { handlers[`POST ${route}`] = handler; },
        delete: () => undefined,
      },
      prefix: '/api',
      getCrews: () => [],
      createCrew: vi.fn(),
      subscribeToCrew: vi.fn(),
      unsubscribeFromCrew: vi.fn(),
      getSubscribersForCrew: vi.fn(() => []),
      getSubscriptionsForAgent: vi.fn(() => []),
      statusForError: () => 500,
    });

    const res = buildResponse();
    handlers['POST /api/crews/:crewId/subscribers'](
      { params: { crewId: 'crew-1' }, body: {} },
      res,
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'agent_id required' });
  });

  it('returns 409 on duplicate subscription', () => {
    const handlers: Record<string, (req: any, res: any) => any> = {};
    const subscribe = vi.fn(() => { throw new Error('already subscribed'); });

    registerCrewRoutes({
      app: {
        get: () => undefined,
        post: (route, handler) => { handlers[`POST ${route}`] = handler; },
        delete: () => undefined,
      },
      prefix: '/api',
      getCrews: () => [],
      createCrew: vi.fn(),
      subscribeToCrew: subscribe,
      unsubscribeFromCrew: vi.fn(),
      getSubscribersForCrew: vi.fn(() => []),
      getSubscriptionsForAgent: vi.fn(() => []),
      statusForError: () => 500,
    });

    const res = buildResponse();
    handlers['POST /api/crews/:crewId/subscribers'](
      { params: { crewId: 'crew-1' }, body: { agent_id: 'agent-ada' } },
      res,
    );
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('unsubscribes an agent from a crew', () => {
    const handlers: Record<string, (req: any, res: any) => any> = {};
    const unsub = vi.fn(() => true);

    registerCrewRoutes({
      app: {
        get: () => undefined,
        post: () => undefined,
        delete: (route, handler) => { handlers[`DELETE ${route}`] = handler; },
      },
      prefix: '/api',
      getCrews: () => [],
      createCrew: vi.fn(),
      subscribeToCrew: vi.fn(),
      unsubscribeFromCrew: unsub,
      getSubscribersForCrew: vi.fn(() => []),
      getSubscriptionsForAgent: vi.fn(() => []),
      statusForError: () => 500,
    });

    const res = buildResponse();
    handlers['DELETE /api/crews/:crewId/subscribers/:agentId'](
      { params: { crewId: 'crew-1', agentId: 'agent-ada' } },
      res,
    );
    expect(unsub).toHaveBeenCalledWith('crew-1', 'agent-ada');
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });

  it('returns 404 when unsubscribing non-existent subscription', () => {
    const handlers: Record<string, (req: any, res: any) => any> = {};
    const unsub = vi.fn(() => false);

    registerCrewRoutes({
      app: {
        get: () => undefined,
        post: () => undefined,
        delete: (route, handler) => { handlers[`DELETE ${route}`] = handler; },
      },
      prefix: '/api',
      getCrews: () => [],
      createCrew: vi.fn(),
      subscribeToCrew: vi.fn(),
      unsubscribeFromCrew: unsub,
      getSubscribersForCrew: vi.fn(() => []),
      getSubscriptionsForAgent: vi.fn(() => []),
      statusForError: () => 500,
    });

    const res = buildResponse();
    handlers['DELETE /api/crews/:crewId/subscribers/:agentId'](
      { params: { crewId: 'crew-1', agentId: 'agent-ada' } },
      res,
    );
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('lists subscribers for a crew', () => {
    const handlers: Record<string, (req: any, res: any) => any> = {};
    const getSubs = vi.fn(() => [sampleSubscription]);

    registerCrewRoutes({
      app: {
        get: (route, handler) => { handlers[`GET ${route}`] = handler; },
        post: () => undefined,
        delete: () => undefined,
      },
      prefix: '/api',
      getCrews: () => [],
      createCrew: vi.fn(),
      subscribeToCrew: vi.fn(),
      unsubscribeFromCrew: vi.fn(),
      getSubscribersForCrew: getSubs,
      getSubscriptionsForAgent: vi.fn(() => []),
      statusForError: () => 500,
    });

    const res = buildResponse();
    handlers['GET /api/crews/:crewId/subscribers'](
      { params: { crewId: 'crew-1' } },
      res,
    );
    expect(getSubs).toHaveBeenCalledWith('crew-1');
    expect(res.json).toHaveBeenCalledWith([expect.objectContaining({ crew_id: 'crew-1' })]);
  });

  it('lists subscriptions for an agent', () => {
    const handlers: Record<string, (req: any, res: any) => any> = {};
    const getAgentSubs = vi.fn(() => [sampleSubscription]);

    registerCrewRoutes({
      app: {
        get: (route, handler) => { handlers[`GET ${route}`] = handler; },
        post: () => undefined,
        delete: () => undefined,
      },
      prefix: '/api',
      getCrews: () => [],
      createCrew: vi.fn(),
      subscribeToCrew: vi.fn(),
      unsubscribeFromCrew: vi.fn(),
      getSubscribersForCrew: vi.fn(() => []),
      getSubscriptionsForAgent: getAgentSubs,
      statusForError: () => 500,
    });

    const res = buildResponse();
    handlers['GET /api/crews/subscriptions/:agentId'](
      { params: { agentId: 'agent-ada' } },
      res,
    );
    expect(getAgentSubs).toHaveBeenCalledWith('agent-ada');
    expect(res.json).toHaveBeenCalledWith([expect.objectContaining({ agent_id: 'agent-ada' })]);
  });
});
