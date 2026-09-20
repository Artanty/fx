// H90 web frontend — end-to-end over the REAL browser against the LIVE h90
// backend (:3000), reaching it through the dev-server proxy (:4211 /api).
//
// Read-only by design: it drives the browse/detail/starters UI and the search/
// sort/filter/pager paths, but never writes to the pedal. The only
// "destructive-looking" flow (starters import) is intercepted at the HTTP
// layer with a synthetic 'done' SSE event, so it proves the browser UI wiring
// without touching Eventide Control or the H90 itself. Safety mirrors the
// lalady audits: skips cleanly when the web/backend stack is down.

import { expect, request, test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';

const WEB_URL = process.env.WEB_URL ?? 'http://localhost:4211';
const H90_API = `${WEB_URL}/api`; // browser path: web -> proxy -> :3000 backend

let api: APIRequestContext | null = null;
let backendOk = false;
let totals: { all: number; searchEchorec: number; titleFirst: string } | null = null;
let slotfulSlug = '';
let slotfulTitle = '';
let startersDelayCount = 0;
let duckedCount = 0;
let duckedFile = '';
let duckedName = '';
let slotfulSlots = 0;

const resultsBar = (page: Page) => page.locator('.results-bar span').first();

// The h90 backend occasionally dies natively (Node assert) mid-burst, and the
// supervisor restarts it within ~1s. Retry with backoff so a single dead
// request doesn't sink the whole suite.
async function apiJson(path: string, retries = 4): Promise<any | null> {
  if (!api) return null;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await api.get(path);
      const json = await res.json();
      if (json !== null && json !== undefined) return json;
    } catch (e) {
      // empty/truncated body: backend was mid-restart
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return null;
}

test.beforeAll(async () => {
  api = await request.newContext({ baseURL: WEB_URL });
  const health = await apiJson('/api/health', 2);
  backendOk = !!health?.ok;

  if (backendOk) {
    // truthful live values for the DOM assertions (paced to dodge the
    // native-crash window that prefers rapid-fire bursts)
    const all = await apiJson('/api/patches?per_page=24');
    const eco = await apiJson('/api/patches?q=Echorec&per_page=24');
    const t = await apiJson('/api/patches?sort=title&per_page=1');
    if (all && eco && t) {
      totals = { all: all.total, searchEchorec: eco.total, titleFirst: t.items[0].title };
    }
    await new Promise((r) => setTimeout(r, 300));

    // probe ONE known slotful preset (never clicked here) instead of scanning
    // the whole first page of the DB
    const known = 'twenty-five-h90-leslies-and-cathedral-tonewheel-organs-updated-1-5-25';
    const d = await apiJson(`/api/patches/${encodeURIComponent(known)}`);
    if (d?.slots?.length && d.slots[0].blob_index != null) {
      slotfulSlug = d.slug;
      slotfulTitle = d.title;
      slotfulSlots = d.slots.length;
    }
    await new Promise((r) => setTimeout(r, 300));

    const delay = await apiJson('/api/h90/starters?type=delay');
    const ducked = await apiJson('/api/h90/starters?q=Ducked');
    if (delay) startersDelayCount = delay.effects.length;
    if (ducked?.effects?.length) {
      duckedCount = ducked.effects.length;
      duckedFile = ducked.effects[0].file;
      duckedName = ducked.effects[0].name;
    }
  }
  // the backend occasionally dies natively (Node assert) mid-burst; the
  // supervisor restarts it, so let the freshly restarted process settle
  await new Promise((r) => setTimeout(r, 1000));
});

// The backend may still be restarting when a list page first loads; reload
// (bounded) until the listing actually renders instead of failing on an
// empty response.
async function gotoListPage(page: Page, path: string, h1: string): Promise<void> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    await page.goto(path);
    await expect(page.locator('h1')).toHaveText(h1, { timeout: 30_000 });
    // wait for the initial load to settle: 'Loading…' may hang for 30s if the
    // backend died mid-request, so bound it and fall through to a reload
    try {
      await expect(page.locator('.results-bar span.loading')).toHaveCount(0, { timeout: 10_000 });
    } catch {
      // backend likely crashed mid-request; reload hits the restarted instance
    }
    const t = await page.locator('.results-bar span').first().innerText();
    if (t.startsWith('0 ')) {
      await page.waitForTimeout(1200);
      continue;
    }
    return;
  }
}

test.afterAll(async () => {
  await api?.dispose();
  api = null;
});

test('h90 browse: grid loads with live totals, search/sort/pager round-trip', async ({ page }) => {
  test.skip(!backendOk || !totals, `h90 backend not reachable at ${H90_API}`);
  const t = totals!;

  await test.step('presets grid renders the live total and first page cards', async () => {
    await gotoListPage(page, '/h90', 'Patch Explorer');
    await expect(resultsBar(page)).toContainText(`${t.all} result`, { timeout: 30_000 });
    const cards = page.locator('.grid .card');
    await expect(cards.first()).toBeVisible({ timeout: 30_000 });
    const n = await cards.count();
    expect(n).toBeGreaterThanOrEqual(1);
  });

  await test.step('search filters to the live count', async () => {
    await page.locator('input[aria-label="Search"]').fill('Echorec');
    await expect(resultsBar(page)).toContainText(`${t.searchEchorec} result`, { timeout: 30_000 });
    await expect(page.locator('.grid .card .title').first()).toHaveText('Echorec');
    await page.locator('input[aria-label="Search"]').fill('');
    await expect(resultsBar(page)).toContainText(`${t.all} result`, { timeout: 30_000 });
  });

  await test.step('sort=A-Z shows the API first title', async () => {
    await page.locator('select[aria-label="Sort"]').selectOption('title');
    await expect(page.locator('.grid .card .title').first()).toHaveText(t.titleFirst, { timeout: 30_000 });
  });

  await test.step('pager advances to page 2', async () => {
    const firstTitle = await page.locator('.grid .card .title').first().innerText();
    await page.locator('.pager button').last().click();
    await expect(page.locator('.pager button.active')).toHaveText('2', { timeout: 30_000 });
    const nextFirst = await page.locator('.grid .card .title').first().innerText();
    expect(nextFirst).not.toBe(firstTitle);
  });
});

test('h90 detail: preset page renders file/knob surface', async ({ page }) => {
  test.skip(!backendOk || !slotfulSlug, `h90 backend not reachable (no slotful preset found) at ${H90_API}`);
  const slug = slotfulSlug;

  await test.step('preset detail loads from browse', async () => {
    await page.goto(`/h90/preset/${encodeURIComponent(slug)}`);
    await expect(page.locator('.page-head h1')).toHaveText(slotfulTitle, { timeout: 30_000 });
    await expect(page.locator('.panel h2', { hasText: 'File' }).first()).toBeVisible();
    await expect(page.locator('.download-btn')).toBeVisible();
  });

  await test.step('slots surface with knob grid + assign UI', async () => {
    const slots = page.locator('.slot');
    await expect(slots.first()).toBeVisible({ timeout: 30_000 });
    expect(await slots.count()).toBe(slotfulSlots);
    await expect(slots.first().locator('.knob-cell').first()).toBeVisible();
    await expect(slots.first().locator('.assign-program')).toHaveValue('1');
    await expect(slots.first().locator('button', { hasText: 'Slot A' })).toBeVisible();
    await expect(slots.first().locator('button', { hasText: 'Slot B' })).toBeVisible();
  });

  await test.step('knob controller surface present, Turn-all disabled until scan', async () => {
    await expect(page.locator('.knob-panel button', { hasText: 'Scan knobs' })).toBeVisible();
    await expect(page.locator('.knob-panel button', { hasText: 'Turn all' })).toBeDisabled();
  });
});

test('h90 starters: family/search filtering + intercepted import round-trip', async ({ page }) => {
  test.skip(!backendOk, `h90 backend not reachable at ${H90_API}`);

  await test.step('starters list loads with live totals + delay family filter', async () => {
    await gotoListPage(page, '/h90/starters', 'Effect Starters');
    await expect(page.locator('.topbar .subtitle')).toContainText('141 total', { timeout: 30_000 });
    await page.locator('select[aria-label="Effect family"]').selectOption('delay');
    await expect(resultsBar(page)).toContainText(`${startersDelayCount} result`, { timeout: 30_000 });
    const fams = await page.locator('.list .row .family').allInnerTexts();
    expect(fams.length).toBeGreaterThan(0);
    expect([...new Set(fams)]).toEqual(['DELAY']);
  });

  await test.step('name search narrows to the live Ducked count', async () => {
    await page.locator('input[aria-label="Search name"]').fill('Ducked');
    await expect(resultsBar(page)).toContainText(`${duckedCount} result`, { timeout: 30_000 });
    const names = await page.locator('.list .row .name').allInnerTexts();
    expect(names.every((n) => n.includes('Ducked'))).toBe(true);
  });

  await test.step('intercepted import proves the Slot A UI wiring', async () => {
    expect(duckedFile).toBeTruthy();
    let seen: { file?: string; slot?: string; program?: number } | null = null;
    await page.route('**/api/h90/import', async (route) => {
      seen = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body:
          'data: {"line":"import started","ok":true,"code":0}\n\n' +
          'event: done\ndata: {"ok":true,"code":0}\n\n',
      });
    });
    page.on('dialog', (d) => d.accept());
    await page.locator('input[aria-label="Program number"]').fill('50');
    await page.locator('.list .row').filter({ hasText: duckedName }).first().locator('.slot.slot-a').click();
    await expect(page.locator('.log')).toContainText('DONE.', { timeout: 30_000 });
    await expect(page.locator('.busy')).toHaveCount(0, { timeout: 30_000 });

    const requiredFile = duckedFile.toLowerCase();
    expect(seen?.file?.toLowerCase()).toBe(requiredFile);
    expect(seen?.slot).toBe('A');
    expect(seen?.program).toBe(50);
  });
});