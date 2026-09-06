// DIAGNOSTIC scan (not part of the suite): read bass + treble + a few other
// control displays on the REAL web while dragging OTHER knobs, with the observe
// mirror both OFF and ON. Reports every display value per step so a "jump" in
// the bass byte 32 family is visible if it exists.

import { expect, request, test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import { knobRoot, knobValue } from './lalady-common';

const API_URL = process.env.API_URL ?? 'http://localhost:3111';

let api: APIRequestContext | null = null;

async function selValue(page: Page, name: string): Promise<string | number> {
  const root = knobRoot(page, name);
  if ((await root.count()) !== 1) return `MISSING(${await root.count()})`;
  if (await root.locator('.ctl-select').count()) return await root.locator('.ctl-select').inputValue();
  if (await root.locator('.ctl-toggle').count()) return String(await root.locator('.ctl-toggle input').isChecked());
  if (await root.locator('.ctl-seg-btn').count()) return (await root.locator('.ctl-seg-btn.on').innerText()).trim();
  if (await root.locator('.kvalue').count()) return Math.round((await knobValue(root)) * 10) / 10;
  return 'NO-VALUE-DOM';
}

async function drag(page: Page, name: string, dy: number): Promise<void> {
  const kbody = knobRoot(page, name).locator('.kbody');
  await kbody.scrollIntoViewIfNeeded();
  const box = await kbody.boundingBox();
  if (!box) throw new Error(`${name}: no geometry`);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx, cy - Math.abs(dy), { steps: 8 });
  await page.mouse.up();
}

const WATCH = ['Treble Cut Filter', 'Treble Boost Rolloff', 'Bass Cut Filter', 'Bass Shelf Slope', 'Bass Boost Rolloff', 'Mid A Frequency', 'Left Drive'];

function report(label: string, v: Record<string, string | number>): void {
  console.log(`[scan] ${label}:`);
  for (const k of WATCH) console.log(`        ${k.padEnd(22)} = ${v[k]}`);
}

test('diagnostic: bass 32 display under other-knob drags (mirror off/on)', async ({ page }) => {
  api = await request.newContext({ baseURL: API_URL });
  const dev = await (await api.get('/api/device')).json().catch(() => null);
  test.skip(!dev?.found, 'device not found');

  await page.goto('/');
  await expect(page.locator('.badge.ok').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.panel.workbench .kbody').first()).toBeVisible({ timeout: 30_000 });

  const snap: Record<string, string | number> = {};
  for (const k of WATCH) snap[k] = await selValue(page, k);
  report('snapshot (mirror off)', snap);

  // 1) mirror OFF: drag Mid A Frequency (an "other knob"), then Left Drive.
  await drag(page, 'Mid A Frequency', 30);
  await page.waitForTimeout(500);
  const v1: Record<string, string | number> = {};
  for (const k of WATCH) v1[k] = await selValue(page, k);
  report('after drag MidA(33) mirror OFF', v1);

  await drag(page, 'Left Drive', 24);
  await page.waitForTimeout(500);
  const v2: Record<string, string | number> = {};
  for (const k of WATCH) v2[k] = await selValue(page, k);
  report('after drag LeftDrive mirror OFF', v2);

  // 2) mirror ON: same drags again, letting two observe polls run between.
  const toggle = page.locator('.mirror-toggle');
  if ((await toggle.getAttribute('class').then((c) => (c || '').includes('on')))) {
    await toggle.click();
    await page.waitForTimeout(250);
  }
  await toggle.click();
  await page.waitForTimeout(2600);

  const v3: Record<string, string | number> = {};
  for (const k of WATCH) v3[k] = await selValue(page, k);
  report('mirror ON after 1 poll (idle)', v3);

  await drag(page, 'Mid A Frequency', -24);
  await page.waitForTimeout(2400);
  const v4: Record<string, string | number> = {};
  for (const k of WATCH) v4[k] = await selValue(page, k);
  report('after drag MidA mirror ON', v4);

  await drag(page, 'Left Drive', -18);
  await page.waitForTimeout(2400);
  const v5: Record<string, string | number> = {};
  for (const k of WATCH) v5[k] = await selValue(page, k);
  report('after drag LeftDrive mirror ON', v5);

  // byte 32 flash truth right now
  const sp = await (await api.get('/api/slot-params?idx=4')).json();
  const body = sp.params.map((p: { value: number }) => p.value);
  console.log(`[scan] flash b30=0x${body[30].toString(16)} b32=0x${body[32].toString(16)} DOM b30 rolloff=${v5['Treble Boost Rolloff']} b32 rolloff=${v5['Bass Boost Rolloff']}`);

  const log = await page.evaluate(() => (window as unknown as { __laladyActions?: string[] }).__laladyActions ?? []);
  console.log('[scan] action-log lines:');
  for (const l of log.slice(-36)) console.log('        ' + l);

  await page.locator('.mirror-toggle').click();
  await api.dispose();
});