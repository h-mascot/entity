#!/usr/bin/env node
/**
 * Hardened browser e2e: Admin Users & Roles (RBAC) + Document Convert.
 *
 * This exists because the prior browser QA falsely passed the sandbox
 * "Failed to load principals (403)" regression by asserting only that the
 * Users & Roles panel was visible. This suite hardens coverage so that ANY
 * 4xx on /api/admin/* or /api/fs/documents/convert, ANY red [role=alert]
 * error text, ANY empty-success false positive (e.g. "created" but list is
 * empty), or ANY failed CRUD / grant / revoke / disable / convert action
 * fails the run with a non-zero exit code and a JSON receipt.
 *
 * Run (Node 22):
 *   node e2e/admin-rbac-convert.cjs
 *
 * Env:
 *   QA_BASE       target origin            (default http://127.0.0.1:4399)
 *   QA_TOKEN      ENTITY_API_TOKEN value   (default qa-test-token)
 *   QA_TOKEN_HEADER  header used by app    (default entity-api-token / Bearer)
 *   QA_OUT        receipt dir              (default ./output/runner-receipts/admin-rbac-403-glm52/browser-qa)
 *   QA_SOURCE_PATH  writable doc to convert (default synthetic-convert-source.md)
 *   PW_EXEC       chromium executablePath  (auto-detected from ms-playwright cache)
 *   QA_SKIP_CONVERT  "1" to skip convert leg
 *
 * Playwright is resolved from the local node_modules, then the npx cache.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

function loadPlaywright() {
  try { return require('playwright'); } catch { /* fall through */ }
  const os = require('node:os');
  const npxDir = path.join(os.homedir(), '.npm/_npx');
  let dirs = [];
  try {
    if (fs.existsSync(npxDir)) dirs = fs.readdirSync(npxDir);
  } catch { /* ignore — handled by the not-installed error below */ }
  for (const d of dirs) {
    const candidate = path.join(npxDir, d, 'node_modules', 'playwright');
    if (fs.existsSync(candidate)) {
      const { createRequire } = require('node:module');
      const req = createRequire(path.join(candidate, 'package.json'));
      try { return req('playwright'); } catch { /* try next */ }
    }
  }
  throw new Error('playwright is not installed. Run: npm i -D playwright@1.62.1 && npx playwright install chromium');
}

function resolveExec() {
  if (process.env.PW_EXEC) return process.env.PW_EXEC;
  const cacheDir = path.join(require('node:os').homedir(), 'Library/Caches/ms-playwright');
  if (!fs.existsSync(cacheDir)) return undefined;
  // Prefer the highest chromium headless shell build available.
  const shells = fs.readdirSync(cacheDir)
    .filter((name) => name.startsWith('chromium_headless_shell-'))
    .map((name) => ({ name, rev: Number(name.split('-').pop()) }))
    .sort((a, b) => b.rev - a.rev);
  for (const { name } of shells) {
    const base = path.join(cacheDir, name, 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell');
    if (fs.existsSync(base)) return base;
  }
  return undefined;
}

const BASE = process.env.QA_BASE || 'http://127.0.0.1:4399';
const TOKEN = process.env.QA_TOKEN || 'qa-test-token';
const SOURCE_PATH = process.env.QA_SOURCE_PATH || 'synthetic-convert-source.md';
const OUT = path.resolve(process.env.QA_OUT || path.join(__dirname, '..', 'output', 'runner-receipts', 'admin-rbac-403-glm52', 'browser-qa'));
const SHOTS = path.join(OUT, 'screenshots');

fs.mkdirSync(SHOTS, { recursive: true });

// NOTE: Playwright resolution is deferred into main() so that a missing
// Playwright install is recorded as a violation with a JSON receipt, rather
// than throwing at module load with no artifact.

function stamp() {
  return new Date().toISOString();
}

// --- Hardening: every violation recorded here fails the run. ---
const violations = [];
function fail(rule, detail) {
  violations.push({ rule, detail, at: stamp() });
  console.error(`FAIL [${rule}] ${detail}`);
}

async function main() {
  const receipt = {
    schema: 'entity.admin-rbac-convert.browser-qa.v1',
    observedAt: stamp(),
    baseUrl: BASE,
    sourcePath: SOURCE_PATH,
    skipConvert: process.env.QA_SKIP_CONVERT === '1',
    results: {},
    screenshots: [],
    violations,
  };

  // Browser launch + setup live INSIDE the main try so that a launch failure
  // (missing executable, sandbox error, etc.) is still recorded as a violation
  // and a JSON receipt is written, rather than crashing with no artifact.
  let browser;
  let context;
  let page;
  try {
    // Resolve Playwright inside the try so a missing install is a recorded
    // violation with a receipt instead of an unrecoverable module-load crash.
    const { chromium } = loadPlaywright();
    const EXEC = resolveExec();
    browser = await chromium.launch({ headless: true, executablePath: EXEC });
    context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    page = await context.newPage();

  // The real UI path stores the API token in localStorage and withApiToken()
  // attaches it as `Authorization: Bearer <token>` to every admin fetch.
  await page.addInitScript((token) => {
    localStorage.setItem('entity-api-token', token);
  }, TOKEN);

  // Hardening collectors ---------------------------------------------------
  // Monitored paths: every admin RBAC path (principals CRUD + grants +
  // disable), admin settings (Save/Reset), and document convert. The regex is
  // intentionally explicit so coverage is obvious, and every monitored
  // request URL is recorded so the suite can assert the principal CRUD paths
  // were actually exercised (not just relied on UI state).
  const monitoredUrl = /\/api\/(admin\/(?:principals|settings|runtime)|fs\/documents\/convert)/;
  const monitoredRequests = [];
  page.on('response', (res) => {
    const url = res.url();
    if (!monitoredUrl.test(url)) return;
    const status = res.status();
    monitoredRequests.push(`${res.request().method()} ${status} ${url.replace(BASE, '')}`);
    if (status >= 400) {
      // Record the violation SYNCHRONOUSLY so it can never be lost to a late
      // res.text() resolution racing with browser.close()/process exit. The
      // body is captured best-effort for the diagnostic, never on the critical
      // path of the failure.
      fail('no-4xx-admin-or-convert', `${res.request().method()} ${status} ${url.replace(BASE, '')}`);
      res.text().then((body) => {
        // Augment the most recent matching violation with the body if still pending.
        const v = violations.find((x) => x.rule === 'no-4xx-admin-or-convert' && x.detail.includes(`${status} ${url.replace(BASE, '')}`));
        if (v && body) v.detail += ` ${String(body).slice(0, 200)}`;
      }).catch(() => { /* ignore */ });
    }
  });
  page.on('pageerror', (err) => fail('no-pageerror', err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      // Ignore generic network 401/4xx log lines that non-fatal shell polls emit;
      // the response collector above is authoritative for admin/convert 4xx.
      if (/Failed to load resource.*4\d\d/.test(text) && !/admin|convert/.test(text)) return;
      if (/the server responded with a status of/.test(text)) return;
      fail('no-console-error', text.slice(0, 240));
    }
  });

  const shot = async (name) => {
    const p = path.join(SHOTS, name);
    await page.screenshot({ path: p, fullPage: true }).catch(() => {});
    receipt.screenshots.push(name);
    return p;
  };

  // Assert no red [role="alert"] is currently visible within `scope`.
  const assertNoAlert = async (scopeLabel, scope = page) => {
    const count = await scope.locator('[role="alert"]:visible').count().catch(() => 0);
    if (count > 0) {
      const text = await scope.locator('[role="alert"]:visible').first().innerText().catch(() => '');
      fail('no-red-alert', `${scopeLabel}: ${text.trim().slice(0, 200)}`);
    }
  };

  // -------------------------------------------------------------------
  // 1. Load app + navigate to Admin > Access Control > Users & Roles.
  // -------------------------------------------------------------------
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2500);
    await shot('01-home.png');

    await page.locator('button', { hasText: /^admin$/ }).first().click();
    await page.waitForTimeout(1200);
    await shot('02-admin.png');

    await page.locator('button', { hasText: 'Access control' }).first().click();
    await page.waitForTimeout(1500);
    await shot('03-access-users.png');

    // The panel must render AND the principals GET must have been 200 (collector
    // fails the run on any 4xx). Also assert no "Failed to load" red text.
    const panelText = await page.locator('body').innerText();
    if (/Failed to load principals/i.test(panelText)) fail('no-failed-to-load', 'Users & Roles shows "Failed to load principals"');
    await assertNoAlert('users-roles-initial');

    const initiallyEmpty = /No principals yet/i.test(panelText);
    receipt.results.rbacInitialLoad = {
      status: violations.length ? 'FAIL' : 'PASS',
      evidence: initiallyEmpty ? 'empty bootstrap state loaded without 403' : 'principal list loaded without 403',
    };

    // -------------------------------------------------------------------
    // 2. If empty, bootstrap a dedicated admin principal first. This principal
    //    receives the bootstrap global-admin grant, which means a SECOND
    //    synthetic principal can later be disabled (the "last global admin"
    //    guard only blocks disabling the final remaining admin).
    // -------------------------------------------------------------------
    if (initiallyEmpty) {
      await page.locator('button', { hasText: 'Add user' }).first().click();
      await page.waitForTimeout(400);
      const adminName = `QA Admin ${Date.now()}`;
      await page.locator('label', { hasText: 'Display name' }).locator('input').first().fill(adminName);
      await page.locator('button', { hasText: 'Create principal' }).first().click();
      await page.locator('li button', { hasText: adminName }).first().waitFor({ state: 'visible', timeout: 10000 });
      await page.waitForTimeout(800);
      await assertNoAlert('bootstrap-admin');
      receipt.results.rbacBootstrapAdmin = {
        status: violations.length ? 'FAIL' : 'PASS',
        evidence: `bootstrapped admin "${adminName}" (global-admin grant + apiPrincipalId persisted)`,
      };
    }

    // -------------------------------------------------------------------
    // 3. Create the synthetic human principal under test via real UI controls.
    // -------------------------------------------------------------------
    await page.locator('button', { hasText: 'Add user' }).first().click();
    await page.waitForTimeout(400);
    const principalName = `QA Human ${Date.now()}`;
    await page.locator('label', { hasText: 'Display name' }).locator('input').first().fill(principalName);
    await page.locator('button', { hasText: 'Create principal' }).first().click();
    // Wait for the principal to appear in the list (NOT an empty-success).
    await page.locator('li button', { hasText: principalName }).first().waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForTimeout(500);
    await shot('04-principal-created.png');
    await assertNoAlert('create-principal');
    // Empty-success guard: the list must actually contain the new principal.
    const listHasPrincipal = await page.locator('li button', { hasText: principalName }).count();
    if (listHasPrincipal === 0) fail('no-empty-success', 'create reported success but principal not in list');
    receipt.results.rbacCreatePrincipal = {
      status: violations.length ? 'FAIL' : 'PASS',
      evidence: `created "${principalName}" and verified it appears in the list`,
    };

    // Select the principal to manage its grants.
    await page.locator('li button', { hasText: principalName }).first().click();
    await page.waitForTimeout(500);

    // -------------------------------------------------------------------
    // 4. Add a scoped grant via real UI controls and verify it renders.
    // -------------------------------------------------------------------
    const orgId = `org-qa-${Date.now()}`;
    await page.locator('label', { hasText: 'Org ID' }).locator('input').first().fill(orgId);
    await page.locator('button', { hasText: 'Add grant' }).first().click();
    await page.waitForTimeout(800);
    await shot('05-grant-added.png');
    await assertNoAlert('add-grant');
    const grantVisible = await page.locator('text=org:' + orgId).first().isVisible().catch(() => false);
    if (!grantVisible) fail('grant-rendered', `scoped grant org:${orgId} not rendered after add`);
    receipt.results.rbacAddGrant = {
      status: violations.length ? 'FAIL' : 'PASS',
      evidence: grantVisible ? `scoped grant org:${orgId} rendered` : 'grant not rendered',
    };

    // -------------------------------------------------------------------
    // 4. Reload and verify the principal + grant persist (no data loss).
    // -------------------------------------------------------------------
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    // Re-open Access control (reload returns to default tab).
    const acAfter = page.locator('button', { hasText: 'Access control' }).first();
    if (await acAfter.count()) { await acAfter.click(); await page.waitForTimeout(1200); }
    // After reload the first principal is auto-selected; re-select QA Human so
    // its grant detail renders before we assert persistence.
    const reloadedPrincipal = await page.locator('li button', { hasText: principalName }).count();
    if (reloadedPrincipal > 0) {
      await page.locator('li button', { hasText: principalName }).first().click();
      await page.waitForTimeout(600);
    }
    await shot('06-after-reload.png');
    await assertNoAlert('after-reload');
    const persistedPrincipal = reloadedPrincipal;
    const persistedGrant = await page.locator('text=org:' + orgId).first().isVisible().catch(() => false);
    if (persistedPrincipal === 0) fail('persistence', 'principal missing after reload');
    if (!persistedGrant) fail('persistence', `scoped grant org:${orgId} missing after reload`);
    receipt.results.rbacReloadPersistence = {
      status: violations.length ? 'FAIL' : 'PASS',
      evidence: `principal=${persistedPrincipal > 0}; grant=${persistedGrant}`,
    };

    // Ensure QA Human is selected for revoke/disable.
    await page.locator('li button', { hasText: principalName }).first().click();
    await page.waitForTimeout(500);

    // -------------------------------------------------------------------
    // 5. Revoke the scoped grant and verify it disappears.
    // -------------------------------------------------------------------
    const grantRow = page.locator('li', { hasText: 'org:' + orgId }).first();
    await grantRow.locator('button', { hasText: 'Revoke' }).first().click();
    await page.waitForTimeout(300);
    // The confirm "Revoke" button replaces the trigger within the same row.
    await grantRow.locator('button', { hasText: 'Revoke' }).last().click();
    await page.waitForTimeout(800);
    await shot('07-grant-revoked.png');
    await assertNoAlert('revoke-grant');
    const grantGone = !(await page.locator('text=org:' + orgId).first().isVisible().catch(() => false));
    if (!grantGone) fail('revoke', `scoped grant org:${orgId} still visible after revoke`);
    receipt.results.rbacRevokeGrant = {
      status: violations.length ? 'FAIL' : 'PASS',
      evidence: grantGone ? `grant org:${orgId} removed` : 'grant still present',
    };

    // -------------------------------------------------------------------
    // 6. Disable the principal and verify status is reflected.
    // -------------------------------------------------------------------
    // The disable flow may be blocked if this is the only active global admin.
    // We created it WITHOUT a global admin grant (only a scoped org grant that
    // we just revoked), so disabling a non-admin principal is always allowed.
    const disableBtn = page.locator('button', { hasText: /^Disable$/ }).first();
    if (await disableBtn.isVisible().catch(() => false)) {
      await disableBtn.click();
      await page.waitForTimeout(300);
      await page.locator('button', { hasText: 'Confirm disable' }).first().click();
      await page.waitForTimeout(800);
      await shot('08-principal-disabled.png');
      await assertNoAlert('disable-principal');
      // Deterministic disabled-state assertion: the principal's list row must
      // now show "disabled" in its status line. Failing to reflect the mutation
      // is a hard failure, not a soft "disable submitted".
      const rowShowsDisabled = await page
        .locator('li button', { hasText: principalName })
        .filter({ hasText: /disabled/i })
        .count();
      if (rowShowsDisabled === 0) fail('disable-reflected', 'principal row does not show disabled status after disable');
      receipt.results.rbacDisablePrincipal = {
        status: violations.length ? 'FAIL' : 'PASS',
        evidence: rowShowsDisabled > 0 ? 'principal row reflects disabled status' : 'disabled state NOT reflected',
      };
    } else {
      // The synthetic principal has no global-admin grant, so the Disable
      // control MUST be present. A missing control is a hard failure, not a
      // skip — the goal requires disable to be exercised and reflected.
      fail('disable-control', 'Disable control not available for an active non-admin principal');
      receipt.results.rbacDisablePrincipal = {
        status: 'FAIL',
        evidence: 'Disable control missing (non-admin principal should be disableable)',
      };
    }

    // Assert the response collector actually observed each RBAC CRUD path
    // (independent of UI rendering), so a swallowed/stale alert can never mask
    // a 4xx from create/grant/revoke/disable.
    const observed = monitoredRequests.join('\n');
    // `m` flag: $ matches end of each line so the patterns match anywhere in
    // the joined multi-line log, not only the final line.
    const expectedPaths = [
      { label: 'list/create principals', re: /(GET|POST) \d+ .*\/principals(?:\?|$)/m },
      { label: 'create grant', re: /POST \d+ .*\/principals\/[^/]+\/grants$/m },
      { label: 'revoke grant', re: /DELETE \d+ .*\/principals\/[^/]+\/grants\// },
      { label: 'disable principal', re: /POST \d+ .*\/principals\/[^/]+\/disable/ },
    ];
    for (const { label, re } of expectedPaths) {
      if (!re.test(observed)) fail('rbac-path-observed', `expected monitored ${label} request not seen by collector`);
    }

    // -------------------------------------------------------------------
    // 7. Document conversion via REAL UI controls (not page.evaluate API).
    // -------------------------------------------------------------------
    if (!receipt.skipConvert) {
      // Open the writable synthetic doc and activate the convert tool via its
      // URL-addressable route (?tool=convert), then drive the dialog controls.
      const docRoute = `${BASE}/?file=${encodeURIComponent(SOURCE_PATH)}&source=workspace&tool=convert`;
      await page.goto(docRoute, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(1500);
      await shot('09-convert-dialog.png');

      const dialog = page.locator('[role="dialog"]', { hasText: 'Convert document' }).first();
      const dialogOpen = await dialog.isVisible().catch(() => false);
      if (!dialogOpen) {
        fail('convert-dialog-open', 'Convert dialog did not open for the writable doc');
      } else {
        // Capture source content hash BEFORE convert to prove it is unchanged.
        const before = await page.evaluate(async (p) => {
          const token = localStorage.getItem('entity-api-token') || '';
          const res = await fetch(`/api/fs/file?sourceId=workspace&path=${encodeURIComponent(p)}`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          });
          const body = await res.json();
          const text = typeof body.content === 'string' ? body.content : JSON.stringify(body);
          return { status: res.status, text };
        }, SOURCE_PATH);
        const beforeText = before.text || '';

        for (const target of ['prd', 'blog']) {
          await dialog.locator('label', { hasText: 'Target type' }).locator('select').selectOption(target);
          const targetName = `qa-ui-${target}-${Date.now()}`;
          await dialog.locator('label', { hasText: 'Target name' }).locator('input').first().fill(targetName);
          await dialog.locator('button', { hasText: 'Convert' }).click();
          // Deterministically wait for a RESULT, not a fixed delay: success
          // closes the dialog (onConverted -> onClose), failure surfaces a
          // [role=alert] inside the dialog while it stays open. The first of
          // those two observable outcomes resolves; a timeout is a hard fail.
          const alertLoc = dialog.locator('[role="alert"]');
          await Promise.race([
            dialog.waitFor({ state: 'hidden', timeout: 15000 }),
            alertLoc.first().waitFor({ state: 'visible', timeout: 15000 }),
          ]).catch(() => {});
          const alertNow = await alertLoc.count();
          const dialogStillOpen = await dialog.isVisible().catch(() => false);
          if (dialogStillOpen && alertNow === 0) {
            fail('convert-no-result', `${target}: Convert produced no dialog-close and no error within timeout`);
          }
          await shot(`10-convert-${target}.png`);
          await assertNoAlert(`convert-${target}`);
          // Verify the target was actually written with provenance + correct type.
          // The in-page fetch must attach the bearer token (raw fetch does not).
          const verify = await page.evaluate(async ({ name, ty }) => {
            const token = localStorage.getItem('entity-api-token') || '';
            const targetPath = `converted/${name}.${ty}.md`;
            const res = await fetch(`/api/fs/file?sourceId=workspace&path=${encodeURIComponent(targetPath)}`, {
              headers: token ? { Authorization: `Bearer ${token}` } : {},
            });
            const body = await res.json();
            const text = typeof body.content === 'string' ? body.content : JSON.stringify(body);
            return { status: res.status, text, targetPath };
          }, { name: targetName, ty: target });
          if (verify.status !== 200) {
            fail('convert-target-created', `${target}: target read returned ${verify.status}`);
          } else {
            const hasProvenance = /entity_converter:\s*entity-doc-convert-v1/.test(verify.text) || /entity-doc-convert-v1/.test(verify.text);
            const hasType = new RegExp(`entity_document_type:\\s*${target}`).test(verify.text);
            if (!hasProvenance) fail('convert-provenance', `${target}: provenance missing in target`);
            if (!hasType) fail('convert-type', `${target}: target type frontmatter missing`);
          }
          // Re-open the dialog for the next target (convert closes it on success).
          await page.goto(docRoute, { waitUntil: 'domcontentloaded', timeout: 60000 });
          await page.waitForTimeout(1200);
        }

        // Prove source unchanged after both conversions.
        const after = await page.evaluate(async (p) => {
          const token = localStorage.getItem('entity-api-token') || '';
          const res = await fetch(`/api/fs/file?sourceId=workspace&path=${encodeURIComponent(p)}`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          });
          const body = await res.json();
          return typeof body.content === 'string' ? body.content : JSON.stringify(body);
        }, SOURCE_PATH);
        if (after !== beforeText) fail('convert-source-unchanged', 'source document text changed after conversion');

        receipt.results.docConvert = {
          status: violations.length ? 'FAIL' : 'PASS',
          evidence: `PRD + Blog targets created via real Convert controls; provenance+type verified; source unchanged (${beforeText.length}==${after.length} chars)`,
        };
      }
    }

    // -------------------------------------------------------------------
    // 8. Narrow viewport QA at 390x844.
    //    Run BEFORE the sections Save/Reset leg: that leg resets Access
    //    control last, which restores defaults and clears the persisted
    //    apiPrincipalId binding. Once cleared, fail-closed RBAC (correctly)
    //    refuses every admin read with two principals present, and the binding
    //    cannot be re-established via the UI. So any check that needs the
    //    binding must precede the accessControl reset.
    // -------------------------------------------------------------------
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(1000);
    await shot('12-narrow-home.png');
    await page.locator('button', { hasText: /^admin$/ }).first().click().catch(() => {});
    await page.waitForTimeout(800);
    await shot('13-narrow-admin.png');
    await page.locator('button', { hasText: 'Access control' }).first().click().catch(() => {});
    await page.waitForTimeout(1000);
    await shot('14-narrow-access-users.png');
    await assertNoAlert('narrow-viewport');
    receipt.results.narrowViewport = {
      status: violations.length ? 'FAIL' : 'PASS',
      evidence: 'screenshots 12-14 at 390x844; no red alerts',
    };

    // -------------------------------------------------------------------
    // 9. Seven configurable Admin sections: Save + Reset via real UI.
    //    Hardened: the response collector fails on any 4xx PATCH/POST.
    // -------------------------------------------------------------------
    const SECTIONS = [
      'Business onboarding', 'Engineering', 'Workplanes',
      'Strategic roadmap', 'Scoped search', 'Channels',
      // Access control is exercised LAST and IS the final step of the whole
      // suite: its Reset restores defaults which clears the persisted
      // apiPrincipalId binding. With two principals present the UI cannot
      // re-establish that binding afterward (fail-closed), so nothing that
      // requires an authorized principal may run after this reset.
      'Access control',
    ];
    const sectionEvidence = [];
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(1500);
    await page.locator('button', { hasText: /^admin$/ }).first().click();
    await page.waitForTimeout(1000);
    for (const label of SECTIONS) {
      const beforeViolations = violations.length;
      // Hard fail (not silent skip) if the section or its Save/Reset controls
      // are absent — that previously let a broken/missing section PASS vacuously.
      const sectionBtn = page.locator('button', { hasText: label }).first();
      if ((await sectionBtn.count()) === 0) {
        fail('section-present', `section "${label}" button not found`);
        sectionEvidence.push(`${label}:missing`);
        continue;
      }
      await sectionBtn.click();
      await page.waitForTimeout(700);
      // Scope to the AdminSettingsForm card: the mc-shell-card that contains a
      // Save button. For accessControl this avoids grabbing checkboxes from the
      // Users & Roles panel that renders above the settings form.
      const settingsCard = page.locator('div.mc-shell-card')
        .filter({ has: page.locator('button', { hasText: /^Save$/ }) })
        .first();
      const saveBtn = settingsCard.locator('button', { hasText: /^Save$/ }).first();
      const resetBtn = settingsCard.locator('button', { hasText: /^Reset$/ }).first();
      if ((await saveBtn.count()) === 0 || (await resetBtn.count()) === 0) {
        fail('section-controls', `section "${label}" missing Save/Reset controls`);
        sectionEvidence.push(`${label}:no-controls`);
        continue;
      }
      // Make the form dirty so Save enables. Every section schema has at least
      // one boolean checkbox; if none is present that is a hard failure, not a
      // skip. Then Save MUST become enabled (fail otherwise) and Reset MUST be
      // enabled (fail otherwise) — a section that cannot be saved/reset is a
      // failure rather than a vacuous PASS.
      const checkbox = settingsCard.locator('input[type="checkbox"]').first();
      if (!(await checkbox.isVisible().catch(() => false))) {
        fail('section-checkbox', `section "${label}" has no visible checkbox to dirty the form`);
        sectionEvidence.push(`${label}:no-checkbox`);
        continue;
      }
      await checkbox.click();
      await page.waitForTimeout(300);
      if (!(await saveBtn.isEnabled().catch(() => false))) {
        fail('section-save-enabled', `section "${label}" Save stayed disabled after dirtying the form`);
        sectionEvidence.push(`${label}:save-disabled`);
        continue;
      }
      await saveBtn.click();
      await page.waitForTimeout(700);
      if (!(await resetBtn.isEnabled().catch(() => false))) {
        fail('section-reset-enabled', `section "${label}" Reset not enabled after Save`);
        sectionEvidence.push(`${label}:reset-disabled`);
        continue;
      }
      await resetBtn.click();
      await page.waitForTimeout(700);
      await assertNoAlert(`section-${label}`);
      sectionEvidence.push(`${label}:${violations.length === beforeViolations ? 'ok' : 'fail'}`);
    }
    await shot('11-sections-save-reset.png');
    receipt.results.adminSettingsSevenSections = {
      status: violations.length ? 'FAIL' : 'PASS',
      evidence: sectionEvidence.join('; '),
    };
   } catch (err) {
    fail('uncaught', err && err.message ? err.message : String(err));
    try { await shot('error-state.png'); } catch { /* ignore */ }
  } finally {
    receipt.violations = violations;
    receipt.overall = violations.length ? 'FAIL' : 'PASS';
    // Version SHA (best-effort).
    try {
      const ver = await page.evaluate(async () => {
        const res = await fetch('/api/version');
        return res.json();
      });
      receipt.runtimeSha = ver && ver.gitSha;
      receipt.runtimeEnvironment = ver && ver.environment;
    } catch { /* ignore */ }
    try { await browser.close(); } catch { /* ignore */ }
  }

  fs.mkdirSync(OUT, { recursive: true });
  const receiptPath = path.join(OUT, 'browser-qa-results.json');
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n', 'utf8');
  console.log(`\n${receipt.overall} — ${violations.length} violation(s) — receipt: ${receiptPath}`);
  process.exit(receipt.overall === 'PASS' ? 0 : 1);
}

main().catch((err) => {
  console.error('fatal', err);
  process.exit(2);
});
