/**
 * THE-933 — canonical grant semantics for task handoff targets.
 *
 * An org-wide task (team_id === null) must NOT accept a team-restricted grant to
 * an unrelated (or any) team. An org-wide grant and a matching-team grant remain
 * valid. This is the negative test the review required alongside the positives.
 */
import { describe, expect, it } from 'vitest';
import { grantCoversTaskTarget } from './tasks';

const ORG = 'default-org';
const TEAM = 'default-team';
const OTHER_TEAM = 'other-team';

describe('grantCoversTaskTarget — canonical org/team semantics (THE-933)', () => {
  describe('org-wide task (team_id === null)', () => {
    const orgWideTask = { org_id: ORG, team_id: null };

    it('rejects a team-restricted grant (THE-933 negative)', () => {
      // A contributor scoped to default-team must not own an org-wide task.
      expect(grantCoversTaskTarget({ org_id: ORG, team_id: TEAM, role: 'contributor' }, orgWideTask)).toBe(false);
      // ...nor a contributor scoped to a different team.
      expect(grantCoversTaskTarget({ org_id: ORG, team_id: OTHER_TEAM, role: 'manager' }, orgWideTask)).toBe(false);
    });

    it('accepts an org-wide grant (team_id === null)', () => {
      expect(grantCoversTaskTarget({ org_id: ORG, team_id: null, role: 'contributor' }, orgWideTask)).toBe(true);
      expect(grantCoversTaskTarget({ org_id: ORG, team_id: null, role: 'admin' }, orgWideTask)).toBe(true);
    });

    it('rejects read-only / none roles even when org-wide', () => {
      expect(grantCoversTaskTarget({ org_id: ORG, team_id: null, role: 'viewer' }, orgWideTask)).toBe(false);
      expect(grantCoversTaskTarget({ org_id: ORG, team_id: null, role: 'none' }, orgWideTask)).toBe(false);
    });

    it('rejects a different-org grant', () => {
      expect(grantCoversTaskTarget({ org_id: 'other-org', team_id: null, role: 'admin' }, orgWideTask)).toBe(false);
    });
  });

  describe('team-scoped task (team_id !== null)', () => {
    const teamTask = { org_id: ORG, team_id: TEAM };

    it('accepts an org-wide grant (covers any team in the org)', () => {
      expect(grantCoversTaskTarget({ org_id: ORG, team_id: null, role: 'contributor' }, teamTask)).toBe(true);
    });

    it('accepts a matching-team grant', () => {
      expect(grantCoversTaskTarget({ org_id: ORG, team_id: TEAM, role: 'manager' }, teamTask)).toBe(true);
    });

    it('rejects a different-team grant', () => {
      expect(grantCoversTaskTarget({ org_id: ORG, team_id: OTHER_TEAM, role: 'contributor' }, teamTask)).toBe(false);
    });

    it('rejects a different-org grant even with matching team id', () => {
      expect(grantCoversTaskTarget({ org_id: 'other-org', team_id: TEAM, role: 'admin' }, teamTask)).toBe(false);
    });
  });

  it('treats a null-org task as coverable only by a null-org grant', () => {
    // Defensive: a task missing org_id is only matched by an equally unscoped grant.
    expect(grantCoversTaskTarget({ org_id: null, team_id: null, role: 'admin' }, { org_id: null, team_id: null })).toBe(true);
    expect(grantCoversTaskTarget({ org_id: ORG, team_id: null, role: 'admin' }, { org_id: null, team_id: null })).toBe(false);
  });
});
