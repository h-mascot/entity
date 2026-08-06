/**
 * Terra R1 — centralized route classification invariant.
 *
 * The deployment-wide `ENTITY_API_TOKEN` is TRANSPORT ONLY. Customer
 * data-plane routes additionally require a valid per-principal
 * `x-entity-access-token`. This unit test locks the classification that the
 * production-mounted `createDataPlaneCredentialGuard` relies on, so the
 * invariant is explicit and fail-closed: the ONLY protected API paths that
 * bypass the customer credential are (a) the existing public surface and
 * (b) the narrow `/api/admin` control boundary. Everything else — including
 * onboarding/config/runtime/db-mode/operations/plugins, which a prior
 * rejected candidate wrongly carved out as control — is DATA-PLANE.
 */
import { describe, expect, it } from 'vitest';

import { classifyRoute, isControlPlanePath, type RoutePlane } from './route-classifier';

describe('route-classifier (R1 data-plane invariant)', () => {
  describe('public surface (no auth)', () => {
    const cases: Array<[string, string]> = [
      ['health', '/api/health'],
      ['version', '/api/version'],
      ['clickclack proxy', '/api/clickclack/anything'],
      ['onboarding agent-session manifest', '/api/onboarding/agent-session/abc/manifest'],
      ['onboarding agent-session bundle', '/api/onboarding/agent-session/abc/bundle'],
    ];
    for (const [name, path] of cases) {
      it(`public: ${name} (${path})`, () => {
        expect(classifyRoute(path)).toBe<'public'>('public');
        expect(isControlPlanePath(path)).toBe(false);
      });
    }

    it('static / SPA shell is public (never blocked by the data-plane guard)', () => {
      for (const p of ['/', '/index.html', '/assets/app.hash.js', '/docs/some/markdown']) {
        expect(classifyRoute(p)).toBe<'public'>('public');
        expect(isControlPlanePath(p)).toBe(false);
      }
    });

    it('self-authenticated /api/documents (document-token surface) follows api-auth public classification', () => {
      // /api/documents self-authenticates via document tokens (agent-native
      // editor default); it tracks the transport public classification.
      expect(classifyRoute('/api/documents')).toBe<'public'>('public');
      expect(isControlPlanePath('/api/documents')).toBe(false);
    });

    it('unprefixed routes outside the protected surface are public (consistent with transport auth)', () => {
      // /worktype-registry (unprefixed) is not in api-auth's protected surface,
      // so it is public to both layers. /api/worktype-registry remains
      // data-plane (asserted below). This pairing mirrors transport auth.
      expect(classifyRoute('/worktype-registry')).toBe<'public'>('public');
      expect(isControlPlanePath('/worktype-registry')).toBe(false);
    });
  });

  describe('control-plane: ONLY the narrow /api/admin boundary', () => {
    const cases: Array<[string, string]> = [
      ['admin root', '/api/admin'],
      ['admin root trailing slash', '/api/admin/'],
      ['admin settings', '/api/admin/settings/accessControl'],
      ['principal collection', '/api/admin/principals'],
      ['principal grant', '/api/admin/principals/p-1/grants'],
      ['principal disable', '/api/admin/principals/p-1/disable'],
    ];
    for (const [name, path] of cases) {
      it(`control: ${name} (${path})`, () => {
        expect(classifyRoute(path)).toBe<'control'>('control');
        expect(isControlPlanePath(path)).toBe(true);
      });
    }

    it('control set is EXHAUSTIVELY narrow: no other known prefix is control', () => {
      // The prior rejected candidate treated onboarding/config/runtime/db-mode/
      // operations/plugins as control. They are all data-plane now.
      const formerlyBroad = [
        '/api/onboarding/state',
        '/api/onboarding/business/start',
        '/api/onboarding/complete',
        '/api/onboarding/modules',
        '/api/onboarding/readiness',
        '/api/onboarding/resolve-selection',
        '/api/onboarding/dry-run',
        '/api/onboarding/agent-session',
        '/api/config/effective',
        '/api/config',
        '/api/runtime',
        '/api/runtime/admin-settings',
        '/api/db-mode',
        '/runtime',
        '/db-mode',
        '/api/migration-cleanup-queues',
        '/api/migration-cleanup-queues/queue-1',
        '/api/node-operations',
        '/api/node-operations/restart',
        '/api/plugins',
        '/api/plugins/installed',
      ];
      for (const path of formerlyBroad) {
        expect(classifyRoute(path), path).toBe<'data-plane'>('data-plane');
        expect(isControlPlanePath(path), path).toBe(false);
      }
    });
  });

  describe('data-plane (transport bearer + customer credential required; fail-closed)', () => {
    const cases: Array<[string, string]> = [
      // Core customer objects.
      ['task list', '/api/tasks'],
      ['task read', '/api/tasks/42'],
      ['task comment', '/api/tasks/42/comments'],
      ['task activity', '/api/tasks/42/activity'],
      ['task review', '/api/tasks/42/review/accept'],
      ['task handoff', '/api/tasks/42/handoffs'],
      ['task stale', '/api/tasks/stale'],
      ['unprefixed task mirror', '/tasks'],
      ['document objects', '/api/document-objects'],
      ['evidence artifacts', '/api/document-objects/evidence-artifacts'],
      ['unprefixed documents (protected legacy mirror)', '/documents'],
      ['search', '/api/search'],
      ['scoped search', '/api/scoped-search'],
      ['worktype registry', '/api/worktype-registry'],
      ['workspace', '/api/workspace/scope'],
      ['workspace orgs', '/api/orgs'],
      ['activity events', '/api/activity-events'],
      ['activity spine events', '/api/activity-spine-events'],
      ['task master claims', '/api/task-master-claims'],
      ['activity recent', '/api/activity/recent'],
      ['chat channels', '/api/chat/channels'],
      ['chat messages', '/api/chat/channels/c-1/messages'],
      ['chat setup', '/api/chat/setup'],
      ['swarm', '/api/swarm/jobs'],
      ['crews', '/api/crews'],
      ['unprefixed crews', '/crews'],
      ['agents', '/api/agents'],
      ['agent trigger', '/agent/trigger'],
      ['agent registry', '/api/agent-registry'],
      ['notifications', '/api/notifications'],
      ['doc intelligence', '/api/doc-intelligence'],
      ['unprefixed doc-intelligence', '/doc-intelligence'],
      ['projects', '/api/projects/3'],
      ['unprefixed projects', '/projects/3'],
      ['roadmaps', '/api/roadmaps'],
      ['unprefixed roadmaps', '/roadmaps'],
      ['activities', '/activities'],
      ['tts', '/api/tts'],
      ['terminal', '/api/terminal'],
    ];
    for (const [name, path] of cases) {
      it(`data-plane: ${name} (${path})`, () => {
        const plane = classifyRoute(path) as RoutePlane;
        expect(plane).toBe('data-plane');
        expect(isControlPlanePath(path)).toBe(false);
      });
    }

    it('every legacy unprefixed protected root is data-plane (no transport-only leak)', () => {
      // These mirror the /api/* surface and must be protected at both layers.
      for (const root of [
        '/tasks',
        '/activities',
        '/agent',
        '/crews',
        '/db-mode',
        '/doc-intelligence',
        '/documents',
        '/projects',
        '/roadmaps',
        '/roadmap-items',
        '/runtime',
      ]) {
        expect(classifyRoute(root), root).toBe<'data-plane'>('data-plane');
      }
    });
  });

  describe('fail-closed boundaries', () => {
    it('unknown /api path defaults to data-plane (fail-closed)', () => {
      for (const p of [
        '/api/something-not-inventoried',
        '/api/brand-new-customer-object',
        '/api/whatever/sub/path',
      ]) {
        expect(classifyRoute(p), p).toBe<'data-plane'>('data-plane');
        expect(isControlPlanePath(p), p).toBe(false);
      }
    });

    it('control carve-out never matches a partial prefix token (no /api/administrivia leak)', () => {
      // '/api/admin' must not match '/api/administrivia' or '/api/adminx' via a
      // naive startsWith bug. Near-prefix tricks must fall through to data-plane.
      for (const p of [
        '/api/administrivia/things',
        '/api/adminx',
        '/api/adminxyz',
        '/api/onboardingxyz',
        '/api/configx',
        '/api/admin-config',
      ]) {
        expect(classifyRoute(p), p).toBe<'data-plane'>('data-plane');
        expect(isControlPlanePath(p), p).toBe(false);
      }
    });

    it('empty / non-string input is public (defensive, never blocks static shell)', () => {
      expect(classifyRoute('')).toBe<'public'>('public');
      // @ts-expect-error -- defensive against unexpected input shapes
      expect(classifyRoute(undefined)).toBe<'public'>('public');
      // @ts-expect-error -- defensive against unexpected input shapes
      expect(classifyRoute(null)).toBe<'public'>('public');
    });
  });
});
