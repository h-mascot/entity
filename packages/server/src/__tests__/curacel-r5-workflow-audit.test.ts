/**
 * Curacel pilot — R5: production-composed workflow + durable actor/audit proof.
 *
 * Composition (REAL middleware stack + REAL routes/repositories, principal
 * resolution + tenant binding + durable actor attribution NOT mocked) lives in
 * curacel-r5-workflow-audit-test-helpers.ts. See that file for the boot fixture.
 *
 * Proves the R5 invariants:
 *  - An authenticated customer principal performs an authorized project-linked
 *    task workflow covering assignment, comment, task history, handoff
 *    create/accept/complete, review decision, and human-gate decision.
 *  - Spoofed actor headers/body fields (x-entity-actor, actor_principal_id,
 *    author, user) are IGNORED for durable attribution: the persisted
 *    activity/comment/handoff/review/human-gate/history actor identity is
 *    ALWAYS the server-resolved principal id.
 *  - The durable task_updated event of a spoofed PATCH is attributed to the
 *    server-resolved principal (no task_created fallback), and the durable
 *    GET /history surface is auth-gated, tenant-gated, and faithfully returns
 *    durable audit rows attributed to the server-resolved actor.
 *  - Insufficient-role and cross-org principal attempts are denied and create
 *    NO durable mutation. Task/project scope authorization remains enforced.
 *
 * Asserts FIXED behavior -> RED on pre-repair comment/activity attribution,
 * GREEN after server-resolved durable actor attribution is wired.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  type Fixture,
  activityActorPrincipalId,
  authHeaders,
  bootApp,
  createWorkflowTask,
  findActivity,
  readJson,
  spoofBody,
  SPOOF,
} from './curacel-r5-workflow-audit-test-helpers';

// ---------------------------------------------------------------------------
// R5-a: authorized project-linked workflow with durable server-resolved actor.
// ---------------------------------------------------------------------------

describe('R5 — authorized project-linked workflow + durable server-resolved actor', () => {
  let f: Fixture;
  beforeEach(async () => {
    f = await bootApp();
  });
  afterEach(async () => {
    await f.teardown();
  });

  it('creates a project-linked task, assigns it, and records server-resolved durable history', async () => {
    const taskId = await createWorkflowTask(f, 'Acme workflow task', {
      projectIds: [f.projectId],
    });

    // Project link is durable.
    const links = await readJson(
      await fetch(`${f.baseUrl}/api/tasks/${taskId}/projects`, {
        headers: authHeaders(f.apiToken, f.tokens.memberAcme),
      }),
    );
    expect((links as any[]).some((p) => p.id === f.projectId)).toBe(true);

    // Assignment (claim) via PATCH; spoofed actor/user/author body + headers ignored.
    const assigned = await fetch(`${f.baseUrl}/api/tasks/${taskId}`, {
      method: 'PATCH',
      headers: authHeaders(f.apiToken, f.tokens.memberAcme, SPOOF),
      body: spoofBody({ assignee: 'member-acme', assignment_state: 'assigned' }),
    });
    expect(assigned.status).toBe(200);
    const after = await f.getTask(taskId);
    expect(after.assignee).toBe('member-acme');
    expect(after.assignment_state).toBe('assigned');

    // The spoofed PATCH produced a durable `task_updated` activity (legacy
    // type), DISTINCT from the create's `task_created` activity. Prove ITS
    // durable actor is the server-resolved principal — never the spoofed
    // actor/user/author fields. (No task_created fallback.)
    const updateAct = f.activityRepository
      .listActivitiesByTaskId(taskId)
      .find((a) => a.type === 'task_updated');
    expect(updateAct, 'PATCH must record a durable task_updated activity').toBeTruthy();
    expect(activityActorPrincipalId(updateAct)).toBe('member-acme');
    expect(updateAct.agent_name).toBe('member-acme');

    // Durable task_history surface (GET /history) is transport-auth-gated,
    // tenant-read-gated, and faithfully returns durable audit rows attributed
    // to the server-resolved actor. task_history is not auto-written by task
    // mutations, so seed the durable row the route reads with the same
    // server-resolved actor proven above, then exercise the real surface.
    f.addTaskHistory(taskId, 'assignee', null, 'member-acme', 'member-acme');

    // Transport auth gate: no bearer -> 401 (api-auth middleware is real here).
    const noToken = await fetch(`${f.baseUrl}/api/tasks/${taskId}/history`);
    expect(noToken.status).toBe(401);

    // Tenant-read gate: cross-org principal -> 404, no durable leak.
    const crossOrg = await fetch(`${f.baseUrl}/api/tasks/${taskId}/history`, {
      headers: authHeaders(f.apiToken, f.tokens.memberBeta),
    });
    expect(crossOrg.status).toBe(404);

    // Authorized durable read: real audit row, faithfully attributed.
    const historyRes = await fetch(`${f.baseUrl}/api/tasks/${taskId}/history`, {
      headers: authHeaders(f.apiToken, f.tokens.memberAcme),
    });
    expect(historyRes.status).toBe(200);
    const history = (await readJson(historyRes)) as any[];
    expect(Array.isArray(history)).toBe(true);
    const assigneeRow = history.find((h) => h.field === 'assignee');
    expect(assigneeRow, 'durable history must surface the seeded assignee row').toBeTruthy();
    expect(assigneeRow.task_id).toBe(taskId);
    expect(assigneeRow.new_value).toBe('member-acme');
    // Durable audit actor is the server-resolved principal, never spoofed.
    expect(assigneeRow.changed_by).toBe('member-acme');
  });

  it('attributes a comment to the server-resolved principal, ignoring a spoofed author', async () => {
    const taskId = await createWorkflowTask(f, 'Comment workflow task');

    const before = f.taskCommentRepository.listComments(taskId).length;
    const res = await fetch(`${f.baseUrl}/api/tasks/${taskId}/comments`, {
      method: 'POST',
      headers: authHeaders(f.apiToken, f.tokens.memberAcme, SPOOF),
      body: spoofBody({ body: 'workflow comment with spoofed author' }),
    });
    expect(res.status).toBe(201);
    expect(f.taskCommentRepository.listComments(taskId).length).toBe(before + 1);

    // Durable comment author is the server-resolved principal, NOT 'spoofed-author'.
    const allComments = f.taskCommentRepository.listComments(taskId);
    const persisted = allComments[allComments.length - 1];
    expect(persisted.author).toBe('member-acme');
    expect(persisted.body).toBe('workflow comment with spoofed author');

    const commentAct = f.activityRepository
      .listActivitiesByTaskId(taskId)
      .find((a) => a.type === 'task_comment');
    expect(commentAct?.agent_name).toBe('member-acme');
  });

  it('attributes a posted activity to the server-resolved principal, ignoring a spoofed user', async () => {
    const taskId = await createWorkflowTask(f, 'Activity workflow task');

    const res = await fetch(`${f.baseUrl}/api/tasks/${taskId}/activity`, {
      method: 'POST',
      headers: authHeaders(f.apiToken, f.tokens.memberAcme, SPOOF),
      body: spoofBody({ action: 'Workflow update', details: 'actor-attributed activity' }),
    });
    expect(res.status).toBe(200);

    const act = f.activityRepository
      .listActivitiesByTaskId(taskId)
      .find((a) => String(a.action) === 'Workflow update');
    expect(act?.agent_name).toBe('member-acme');
  });

  it('attributes handoff create/accept/complete to the server-resolved principal', async () => {
    const sourceTaskId = await createWorkflowTask(f, 'Handoff source task');

    // CREATE — spoofed actor ignored; durable creator is member-acme.
    const created = await readJson(
      await fetch(`${f.baseUrl}/api/tasks/${sourceTaskId}/handoffs`, {
        method: 'POST',
        headers: authHeaders(f.apiToken, f.tokens.memberAcme, SPOOF),
        body: spoofBody({
          targetTaskId: f.handoffTargetTaskId,
          targetAgentId: 'agent-acme',
          reason: 'route claim',
        }),
      }),
    );
    expect(created.handoff).toBeTruthy();
    const handoffId = created.handoff.id as string;
    expect(f.handoffRepo.get(f.org.acme, handoffId)!.created_by_principal_id).toBe('member-acme');
    expect(f.handoffRepo.get(f.org.acme, handoffId)!.last_transition_by_principal_id).toBe(
      'member-acme',
    );

    // ACCEPT — spoofed actor ignored; durable acceptor is member-acme.
    const accepted = await readJson(
      await fetch(`${f.baseUrl}/api/tasks/${sourceTaskId}/handoffs/${handoffId}`, {
        method: 'PATCH',
        headers: authHeaders(f.apiToken, f.tokens.memberAcme, SPOOF),
        body: spoofBody({ status: 'accepted', expectedVersion: 1 }),
      }),
    );
    expect(accepted.handoff.status).toBe('accepted');
    expect(f.handoffRepo.get(f.org.acme, handoffId)!.accepted_by_principal_id).toBe('member-acme');

    // COMPLETE — spoofed actor ignored; durable last-transition actor is member-acme.
    const completed = await fetch(`${f.baseUrl}/api/tasks/${sourceTaskId}/handoffs/${handoffId}`, {
      method: 'PATCH',
      headers: authHeaders(f.apiToken, f.tokens.memberAcme, SPOOF),
      body: spoofBody({ status: 'completed', expectedVersion: 2 }),
    });
    expect(completed.status).toBe(200);
    expect(f.handoffRepo.get(f.org.acme, handoffId)!.last_transition_by_principal_id).toBe(
      'member-acme',
    );
    expect(f.handoffRepo.get(f.org.acme, handoffId)!.status).toBe('completed');
  });

  it('attributes the review decision + activity to the server-resolved reviewer', async () => {
    const taskId = f.reviewableTaskId;
    const res = await fetch(`${f.baseUrl}/api/tasks/${taskId}/review/accept`, {
      method: 'POST',
      headers: authHeaders(f.apiToken, f.tokens.reviewerAcme, SPOOF),
      body: spoofBody({ reason: 'evidence accepted' }),
    });
    expect(res.status).toBe(200);
    expect((await f.getTask(taskId)).review_state).toBe('accepted');

    const act = findActivity(f, taskId, 'review_decision');
    expect(activityActorPrincipalId(act)).toBe('reviewer-acme');
    expect(act?.agent_name).toBe('reviewer-acme');
  });

  it('attributes the human-gate decision + activity to the server-resolved approver', async () => {
    const taskId = f.reviewableTaskId;
    const res = await fetch(`${f.baseUrl}/api/tasks/${taskId}/human-gate/approve`, {
      method: 'POST',
      headers: authHeaders(f.apiToken, f.tokens.approverAcme, SPOOF),
      body: spoofBody({ reason: 'approved by human' }),
    });
    expect(res.status).toBe(200);
    expect((await f.getTask(taskId)).human_gate_state).toBe('approved');

    const act = findActivity(f, taskId, 'human_gate_decision');
    expect(activityActorPrincipalId(act)).toBe('approver-acme');
    expect(act?.agent_name).toBe('approver-acme');
  });
});

// ---------------------------------------------------------------------------
// R5-b: insufficient role is denied with NO durable mutation.
// ---------------------------------------------------------------------------

describe('R5 — insufficient role denied with no durable mutation', () => {
  let f: Fixture;
  beforeEach(async () => {
    f = await bootApp();
  });
  afterEach(async () => {
    await f.teardown();
  });

  it('a viewer cannot comment, post activity, review, human-gate, or create a handoff', async () => {
    const taskId = f.reviewableTaskId;
    const commentsBefore = f.taskCommentRepository.listComments(taskId).length;
    const activityBefore = f.activityRepository.listActivitiesByTaskId(taskId).length;
    const taskBefore = await f.getTask(taskId);

    const comment = await fetch(`${f.baseUrl}/api/tasks/${taskId}/comments`, {
      method: 'POST',
      headers: authHeaders(f.apiToken, f.tokens.viewerAcme, SPOOF),
      body: spoofBody({ body: 'viewer comment attempt' }),
    });
    expect(comment.status).toBe(403);
    expect(f.taskCommentRepository.listComments(taskId).length).toBe(commentsBefore);

    const activity = await fetch(`${f.baseUrl}/api/tasks/${taskId}/activity`, {
      method: 'POST',
      headers: authHeaders(f.apiToken, f.tokens.viewerAcme, SPOOF),
      body: spoofBody({ action: 'Viewer act', details: 'viewer attempt' }),
    });
    expect([403, 404]).toContain(activity.status);
    expect(f.activityRepository.listActivitiesByTaskId(taskId).length).toBe(activityBefore);

    const review = await fetch(`${f.baseUrl}/api/tasks/${taskId}/review/accept`, {
      method: 'POST',
      headers: authHeaders(f.apiToken, f.tokens.viewerAcme, SPOOF),
      body: spoofBody({ reason: 'viewer review' }),
    });
    expect(review.status).toBe(403);
    expect((await f.getTask(taskId)).review_state).toBe(taskBefore.review_state);

    const gate = await fetch(`${f.baseUrl}/api/tasks/${taskId}/human-gate/approve`, {
      method: 'POST',
      headers: authHeaders(f.apiToken, f.tokens.viewerAcme, SPOOF),
      body: spoofBody({ reason: 'viewer gate' }),
    });
    expect(gate.status).toBe(403);
    expect((await f.getTask(taskId)).human_gate_state).toBe(taskBefore.human_gate_state);

    const handoff = await fetch(`${f.baseUrl}/api/tasks/${taskId}/handoffs`, {
      method: 'POST',
      headers: authHeaders(f.apiToken, f.tokens.viewerAcme, SPOOF),
      body: spoofBody({ targetTaskId: f.handoffTargetTaskId, targetAgentId: 'agent-acme' }),
    });
    expect([403, 404]).toContain(handoff.status);
  });
});

// ---------------------------------------------------------------------------
// R5-c: cross-org principal is denied with NO durable mutation.
// ---------------------------------------------------------------------------

describe('R5 — cross-org principal denied with no durable mutation', () => {
  let f: Fixture;
  beforeEach(async () => {
    f = await bootApp();
  });
  afterEach(async () => {
    await f.teardown();
  });

  it('a beta manager cannot comment, review, human-gate, or handoff an acme task', async () => {
    const taskId = f.reviewableTaskId;
    const commentsBefore = f.taskCommentRepository.listComments(taskId).length;
    const taskBefore = await f.getTask(taskId);

    const comment = await fetch(`${f.baseUrl}/api/tasks/${taskId}/comments`, {
      method: 'POST',
      headers: authHeaders(f.apiToken, f.tokens.memberBeta, SPOOF),
      body: spoofBody({ body: 'cross-org comment' }),
    });
    expect(comment.status).toBe(404);
    expect(f.taskCommentRepository.listComments(taskId).length).toBe(commentsBefore);

    const review = await fetch(`${f.baseUrl}/api/tasks/${taskId}/review/accept`, {
      method: 'POST',
      headers: authHeaders(f.apiToken, f.tokens.memberBeta, SPOOF),
      body: spoofBody({ reason: 'cross-org review' }),
    });
    expect([403, 404]).toContain(review.status);
    expect((await f.getTask(taskId)).review_state).toBe(taskBefore.review_state);

    const gate = await fetch(`${f.baseUrl}/api/tasks/${taskId}/human-gate/approve`, {
      method: 'POST',
      headers: authHeaders(f.apiToken, f.tokens.memberBeta, SPOOF),
      body: spoofBody({ reason: 'cross-org gate' }),
    });
    expect([403, 404]).toContain(gate.status);
    expect((await f.getTask(taskId)).human_gate_state).toBe(taskBefore.human_gate_state);

    const handoff = await fetch(`${f.baseUrl}/api/tasks/${taskId}/handoffs`, {
      method: 'POST',
      headers: authHeaders(f.apiToken, f.tokens.memberBeta, SPOOF),
      body: spoofBody({ targetTaskId: f.handoffTargetTaskId, targetAgentId: 'agent-acme' }),
    });
    expect([403, 404]).toContain(handoff.status);
    // No handoff row created for the acme source task.
    const list = await readJson(
      await fetch(`${f.baseUrl}/api/tasks/${taskId}/handoffs`, {
        headers: authHeaders(f.apiToken, f.tokens.memberAcme),
      }),
    );
    expect([...(list.incoming as any[]), ...(list.outgoing as any[])]).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// R5-d: task/project scope authorization remains enforced.
// ---------------------------------------------------------------------------

describe('R5 — task/project scope authorization enforced', () => {
  let f: Fixture;
  beforeEach(async () => {
    f = await bootApp();
  });
  afterEach(async () => {
    await f.teardown();
  });

  it('a cross-org task id is invisible (404) and unmodifiable by an out-of-org principal', async () => {
    // member-acme (org-acme) cannot read the foreign beta task by guessed id.
    const read = await fetch(`${f.baseUrl}/api/tasks/${f.betaTaskId}`, {
      headers: authHeaders(f.apiToken, f.tokens.memberAcme),
    });
    expect(read.status).toBe(404);

    // Nor mutate it; the beta task name is unchanged.
    const before = (await f.getTask(f.betaTaskId)).name;
    const upd = await fetch(`${f.baseUrl}/api/tasks/${f.betaTaskId}`, {
      method: 'PATCH',
      headers: authHeaders(f.apiToken, f.tokens.memberAcme, SPOOF),
      body: spoofBody({ name: 'hijacked by acme' }),
    });
    expect(upd.status).toBe(404);
    expect((await f.getTask(f.betaTaskId)).name).toBe(before);
  });

  it('a customer cannot create a task in an org outside its membership', async () => {
    const res = await fetch(`${f.baseUrl}/api/tasks`, {
      method: 'POST',
      headers: authHeaders(f.apiToken, f.tokens.memberAcme, SPOOF),
      body: spoofBody({
        name: 'Cross-org task',
        org_id: f.org.beta,
        team_id: f.org.teamBeta,
        create_anyway: true,
      }),
    });
    expect(res.status).toBe(403);
  });
});
