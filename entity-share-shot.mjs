import { chromium } from "playwright";

const out = "/tmp/entity-share-test.png";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
page.on("console", msg => console.log("[console]", msg.type(), msg.text()));
page.on("pageerror", err => console.log("[pageerror]", err.message));

await page.goto("http://127.0.0.1:3000", { waitUntil: "networkidle", timeout: 60000 });
await page.getByRole("button", { name: /files/i }).click();
await page.waitForTimeout(1500);

const sourceButton = page.locator("button").filter({ hasText: /ada|zora|spock/i }).first();
if (await sourceButton.count()) {
  await sourceButton.click();
  await page.waitForTimeout(800);
}

const fileButton = page.locator("button").filter({ hasText: /AGENTS\.md|README|MEMORY\.md|SOUL\.md/i }).first();
if (await fileButton.count()) {
  await fileButton.click();
  await page.waitForTimeout(1500);
}

const shareButton = page.getByRole("button", { name: /share/i }).first();
await shareButton.waitFor({ state: "visible", timeout: 15000 });
await shareButton.scrollIntoViewIfNeeded();
await page.screenshot({ path: out, fullPage: true });

console.log(JSON.stringify({ out, url: page.url(), hasShare: await shareButton.isVisible() }, null, 2));
await browser.close();
