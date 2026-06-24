const { test, expect } = require('playwright/test');
test('THE-68 owner inbox proof', async ({ page }) => {
  const baseUrl = process.env.ENTITY_E2E_BASE_URL || 'http://127.0.0.1:3000/?tab=tasks';
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.setItem('entity.sidebar.tab', 'tasks'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-testid="owner-accountability-inbox"]')).toBeVisible({ timeout: 15000 });
  const text = await page.locator('[data-testid="owner-accountability-inbox"]').innerText();
  await page.screenshot({ path: 'output/entity-phase-2/browser-proof/THE-68-owner-accountability-inbox.png', fullPage: true });
  require('fs').writeFileSync('output/entity-phase-2/browser-proof/THE-68-dom-proof.json', JSON.stringify({ issue: 'THE-68', text, screenshot: 'output/entity-phase-2/browser-proof/THE-68-owner-accountability-inbox.png', assertions: { hasOwnerInbox: text.includes('Owner accountability inbox'), hasState: text.includes('Receipt failed') || text.includes('Escalated') || text.includes('Migration warning') || text.includes('Stalled'), hasCanonicalLink: text.includes('/tasks/') } }, null, 2) + '\n');
  expect(text).toContain('Owner accountability inbox');
  expect(text).toContain('/tasks/');
});
