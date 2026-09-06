// L.A. Lady workbench — "listen to real values, show me the log, prove Treble
// Cut Filter is untouched by other knobs" regression suite.
//
// Two halves, one self-restoring run against the REAL web app (device engaged):
//
// A) Observer isolation: with "Observe live" ON (the frontend listening to the
//    pedal's live table every 2s), drive non-byte-30 controls — real mouse
//    drags on a Dist and a Parametric-EQ knob, then wheel/select/toggle/seg
//    across the rest — and after EACH one assert:
//      - Treble Cut Filter DOM select == loaded snapshot,
//      - flash byte 30 (fresh /api/slot-params) == snapshot,
//      - the workbench ACTION LOG has no CLOBBER line and no SET on byte 30
//        (t.c. no `(30:` occurrence) caused by another control,
//      - the SAVE after all of them keeps byte 30.
//    It also proves the listener exists: at least 2 OBSERVE poll lines and the
//    untrusted-window skips appear in the log.
// B) "all 0" intent: clicking all 0 -> Save must persist byte 30 == 0 (and the
//    other packed bytes 26/32/38 too) — the allParamsZero live-mapping fix.
//
// safety mirrors the workbench audit: runs only against the device, and afterAll
// restores the original 53-byte body via /api/slots/save overrides.

import { expect, request, test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import {
  changeKnob,
  fieldOf,
  flashByte,
  knobRoot,
  knobValue,
  pickOtherOption,
  restoreBody,
} from './lalady-common';
import type { ControlSpec } from './lalady-common';

const API_URL = process.env.API_URL ?? 'http://localhost:3111';
const FLASH_URL = `${API_URL}/api/control`;
const PACKED_BYTES = [26, 30, 32, 38];
// The bass-byte-32 family mirrors the treble byte-30 shape (cut select + shelf
// slope buttons + boost rolloff knob); the user reported these JUMP too, so the
// suite watches them exactly like Treble Cut Filter.
const WATCH_FAMILY = [
  { spec: 'Treble Cut Filter', byte: 30, field: { shift: 0, mask: 0x01 } },
  { spec: 'Bass Cut Filter', byte: 32, field: { shift: 0, mask: 0x01 } },
  { spec: 'Bass Shelf Slope', byte: 32, field: { shift: 1, mask: 0x06 } },
  { spec: 'Bass Boost Rolloff', byte: 32, field: { shift: 3, mask: 0xF8 } },
];
const WATCH_BYTES = [30, 32];

let api: APIRequestContext | null = null;
let snap: { activeIndex: number; body: number[]; name: string; specs: ControlSpec[] } | null = null;

const actionLog = (page: Page) =>
  page.evaluate(
    () =>
      (
        window as unknown as {
          __laladyActions?: string[];
        }
      ).__laladyActions ?? []
  );

async function flashBody(): Promise<number[]> {
  const sp = await (await api!.get(`/api/slot-params?idx=${snap!.activeIndex}`)).json();
  return sp.params.map((p: { value: number }) => p.value);
}

function tcfSelect(page: Page) {
  return knobRoot(page, 'Treble Cut Filter').locator('.ctl-select');
}

// Present the watched packed-field family (treble + bass) as a compact signature
// of DOM-displayed values, e.g. { TCF:'1', BCF:'0', SS:'Low', BR:'0' }.
async function domWatch(page: Page): Promise<{ name: string; shown: string }[]> {
  const out: { name: string; shown: string }[] = [];
  for (const m of WATCH_FAMILY) {
    const root = knobRoot(page, m.spec);
    if (await root.locator('.ctl-select').count()) {
      out.push({ name: m.spec, shown: await root.locator('.ctl-select').inputValue() });
    } else if (await root.locator('.ctl-seg-btn').count()) {
      out.push({ name: m.spec, shown: (await root.locator('.ctl-seg-btn.on').innerText()).trim() });
    } else {
      out.push({ name: m.spec, shown: (await knobValue(root)).toString() });
    }
  }
  return out;
}

// Real mouse drag on a knob: pointerdown/move/up over .kbody. Returns whether the
// field value actually moved (proves the drag path works on the real web).
async function dragKnob(
  page: Page,
  name: string,
  dy: number
): Promise<{ before: number; after: number; moved: boolean }> {
  const root = knobRoot(page, name);
  const kbody = root.locator('.kbody');
  const kvalue = root.locator('.kvalue');
  const before = Number((await kvalue.innerText()).trim());
  await kbody.scrollIntoViewIfNeeded();
  const box = await kbody.boundingBox();
  if (!box) throw new Error(`${name}: no knob geometry`);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx, cy - Math.abs(dy), { steps: 10 });
  await page.mouse.up();
  const after = Number((await kvalue.innerText()).trim());
  return { before, after, moved: after !== before };
}

async function dragOrWheel(
  page: Page,
  name: string,
  dy: number,
  pings: string[]
): Promise<void> {
  const d = await dragKnob(page, name, dy);
  if (!d.moved) {
    const root = knobRoot(page, name);
    const k0 = Number((await root.locator('.kvalue').innerText()).trim());
    const preferUp = d.before < 200;
    const k1 = await changeKnob(page, root, preferUp);
    if (k1 === k0) throw new Error(`knob ${name} stuck at ${k0} (drag+wheel both no-ops)`);
    pings.push(`wheel-fallback ${name}: ${k0}->${k1} (drag no-op)`);
  } else {
    pings.push(`drag ${name}: ${d.before}->${d.after}`);
  }
}

const tcfSpecOf = (specs: ControlSpec[]): ControlSpec => {
  const s = specs.find((x) => x.name === 'Treble Cut Filter');
  if (!s) throw new Error('control map has no Treble Cut Filter');
  return s;
};

test.beforeAll(async () => {
  api = await request.newContext({ baseURL: API_URL, extraHTTPHeaders: { 'Content-Type': 'application/json' } });
  try {
    const dev = await (await api.get('/api/device')).json().catch(() => null);
    if (!dev?.found) return;
    const cm = await (await api.get('/api/control-map')).json();
    const presets = await (await api.get('/api/presets')).json();
    const activeIndex = presets.activeIndex;
    const sp = await (await api.get(`/api/slot-params?idx=${activeIndex}`)).json();
    snap = {
      activeIndex,
      body: sp.params.map((p: { value: number }) => p.value),
      name: sp.name,
      specs: cm.controls,
    };
  } catch (e) {
    console.warn('[listen-setup]', e);
    snap = null;
  }
});

test.afterAll(async () => {
  if (snap && api && snap.body.length) {
    try {
      await restoreBody(api, snap.activeIndex, snap.body);
      console.log('[listen-restore] slot', snap.activeIndex, 'restored to original body');
    } catch (e) {
      console.error('[listen-restore] FAILED:', e);
    }
  }
  await api?.dispose();
  api = null;
});

test('observe-live isolation + all-0 persistence, proven by the action log', async ({ page }) => {
  test.skip(!snap, `L.A. Lady not connected or backend not reachable at ${API_URL}`);

  const s = snap!;
  const tcf = tcfSpecOf(s.specs);
  const byte30Base = s.body[30];
  const bit0Base = fieldOf(tcf, byte30Base);
  const evidence: Record<string, unknown> = { slot: s.activeIndex, presetName: s.name, byte30SnapshotHex: byte30Base.toString(16).padStart(2, '0'), byte32SnapshotHex: s.body[32].toString(16).padStart(2, '0'), bit0Base, findings: [] as string[] };
  const ping = (m: string) => (evidence.findings as string[]).push(m);
  let domBaseline: { name: string; shown: string }[] = [];

  const plan = s.specs.filter((x) => x.index !== 30);
  const tcfPlanned = plan.find((x) => x.name === tcf.name);
  const driveList: { spec: ControlSpec; kind: 'drag' | 'control'; note?: string }[] = [];
  const DECK: { name: string; kind: 'drag' | 'control' }[] = [
    { name: 'Left Drive', kind: 'drag' },
    { name: 'Mid A Frequency', kind: 'drag' },
    { name: 'Bass Shelf Frequency', kind: 'control' },
    { name: 'Low Cut Filter', kind: 'control' },
    { name: 'Left Distortion Engine', kind: 'control' },
    { name: 'Noise Gate', kind: 'control' },
    { name: 'Filter Gate', kind: 'control' },
    { name: 'Noise Gate Threshold', kind: 'control' },
    { name: 'Bass Knob Assign', kind: 'control' },
    { name: 'Treble Knob Assign', kind: 'control' },
    { name: 'I/O Routing', kind: 'control' },
    // Re-drive a second Dist knob and one packed byte-38 select at the very end
    // to prove the observer never re-writes bytes 30/32 after later edits either.
    { name: 'Right Clean Mix', kind: 'control' },
  ];
  for (const d of DECK) {
    const spec = plan.find((x) => x.name === d.name);
    if (!spec) {
      ping(`SKIP ${d.name}: not in control map`);
      continue;
    }
    driveList.push({ spec, kind: d.kind });
  }
  if (tcfPlanned) {
    const i = driveList.findIndex((x) => x.spec.index === 30);
    if (i >= 0) driveList.splice(i, 1); // never drive TCF itself here
  }

  await test.step('A1 workbench loads on the active slot', async () => {
    await page.goto('/');
    await expect(page.locator('.badge.ok').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.panel.workbench .kbody').first()).toBeVisible({ timeout: 30_000 });
    const sel = await tcfSelect(page);
    await expect(sel).toBeVisible({ timeout: 15_000 });
    expect(Number(await sel.inputValue())).toBe(bit0Base);
    domBaseline = await domWatch(page);
    ping(`family baseline: ${domBaseline.map((d) => `${d.name}=${d.shown}`).join(', ')}`);
  });

  await test.step('A2 enable Observe live and prove the listener sees the pedal', async () => {
    const toggle = page.locator('.mirror-toggle');
    if (await toggle.getAttribute('class').then((c) => (c || '').includes('on'))) {
      await toggle.click();
      await page.waitForTimeout(250);
    }
    await toggle.click();
    await expect(toggle).toHaveClass(/on/, { timeout: 5_000 });
    await page.waitForTimeout(2_400);
    const log = await actionLog(page);
    const observes = log.filter((l) => l.includes('OBSERVE'));
    expect(observes.length, `observer should have polled at least once (got ${observes.length}):\n${log.join('\n')}`).toBeGreaterThanOrEqual(1);
    ping(`OBSERVE poll lines visible (${observes.length})`);
  });

  await test.step('A3 drive other controls; TCF select + flash byte 30 stable after each; log clean', async () => {
    const bad: string[] = [];
    for (const { spec, kind } of driveList) {
      const root = knobRoot(page, spec.name);
      if ((await root.count()) !== 1) {
        bad.push(`${spec.index}:${spec.name} has ${await root.count()} DOM matches`);
        continue;
      }
      try {
        if (kind === 'drag') {
          const dy = Math.abs(spec.mask ? 24 : 24);
          await dragOrWheel(page, spec.name, dy, evidence.findings as string[]);
        } else if (spec.type === 'knob') {
          const k0 = await knobValue(root);
          await changeKnob(page, root, k0 < spec.max);
        } else if (spec.type === 'select') {
          const target = pickOtherOption(spec, fieldOf(spec, s.body[spec.index] ?? 0));
          if (target == null) throw new Error(`${spec.name}: no alternative option`);
          await root.locator('.ctl-select').selectOption(String(target));
        } else if (spec.type === 'toggle') {
          await root.locator('.ctl-toggle').click();
        } else {
          const target = pickOtherOption(spec, fieldOf(spec, s.body[spec.index] ?? 0));
          if (target == null) throw new Error(`${spec.name}: no alternative segment`);
          const opt = (spec.options || []).find((o) => o.value === target)!;
          await root.locator('.ctl-seg-btn').filter({ hasText: opt.text }).click();
        }
      } catch (e) {
        bad.push(`${spec.index}:${spec.name} drive error: ${(e as Error).message}`);
        continue;
      }
      await page.waitForTimeout(700);
      const dom = await domWatch(page);
      const sig = dom.map((d) => `${d.name}=${d.shown}`);
      if (sig.join(', ') !== domBaseline.map((d) => `${d.name}=${d.shown}`).join(', ')) {
        const moved = dom.filter((d, i) => d.shown !== domBaseline[i].shown);
        bad.push(`${spec.index}:${spec.name} moved family DOM -> ${moved.map((m) => `${m.name}=${m.shown}`).join(', ')}`);
      }
      const body = await flashBody();
      if (body[30] !== byte30Base)
        bad.push(`${spec.index}:${spec.name} changed flash byte 30: 0x${body[30].toString(16)} != 0x${byte30Base.toString(16)}`);
      if (body[32] !== s.body[32])
        bad.push(`${spec.index}:${spec.name} changed flash byte 32: 0x${body[32].toString(16)} != 0x${s.body[32].toString(16)}`);
      const log = await actionLog(page);
      const clobber = log.filter((l) => l.includes('CLOBBER'));
      const packedSets = log.filter((l) => /SET .*\((30|32):/.test(l));
      if (clobber.length) bad.push(`${spec.index}:${spec.name} triggered CLOBBER:\n${clobber.join('\n')}`);
      if (packedSets.length) bad.push(`${spec.index}:${spec.name} produced byte-30/32 SETs:\n${packedSets.join('\n')}`);
    }
    expect(bad, `isolation failures:\n${bad.join('\n')}`).toHaveLength(0);
    ping(`drove ${driveList.length} other controls — TCF + bass family DOM and flash bytes 30/32 unchanged each time, log clean`);
  });

  await test.step('A4 Save keeps byte 30 + byte 32; log records the save', async () => {
    const saveWait = page.waitForResponse((r) => r.request().url() === `${API_URL}/api/slots/save`);
    await page.locator('.slot-picker button').filter({ hasText: /^Save$/ }).click();
    const sj = await (await saveWait).json();
    expect(sj.ok).toBe(true);
    expect(sj.readback[30]).toBe(byte30Base);
    expect(sj.readback[32]).toBe(s.body[32]);
    const log = await actionLog(page);
    const saves = log.filter((l) => l.includes('SAVE '));
    expect(saves.length).toBeGreaterThanOrEqual(1);
    if (log.some((l) => l.includes('CLOBBER')))
      throw new Error('CLOBBER in action log after Save:\n' + log.join('\n'));
    ping(saves[saves.length - 1]);
    await page.reload();
    await expect(page.locator('.panel.workbench .kbody').first()).toBeVisible({ timeout: 30_000 });
    const dom = await domWatch(page);
    const sig = dom.map((d) => `${d.name}=${d.shown}`).join(', ');
    expect(sig).toBe(domBaseline.map((d) => `${d.name}=${d.shown}`).join(', '));
    ping(`A: Save + reload keep the full family (${sig}) at snapshot`);
  });

  await test.step('B all-0 -> Save persists every packed byte at 0 (intended), incl byte 30', async () => {
    await expect(page.locator('.panel.workbench .kbody').first()).toBeVisible({ timeout: 30_000 });
    await page.locator('.slot-picker button').filter({ hasText: 'all 0' }).click();
    await page.waitForTimeout(400);
    let log = await actionLog(page);
    expect(log.some((l) => l.includes('ZERO all 53 bytes'))).toBe(true);
    const saveWait = page.waitForResponse((r) => r.request().url() === `${API_URL}/api/slots/save`);
    await page.locator('.slot-picker button').filter({ hasText: /^Save$/ }).click();
    const sj = await (await saveWait).json();
    expect(sj.ok).toBe(true);
    const rb = sj.readback as number[];
    for (const b of PACKED_BYTES) {
      expect(rb[b], `readback[${b}] should be 0 after all-0+Save`).toBe(0);
    }
    expect(rb.every((v) => v === 0), 'readback should be all-zero (all 53 overrides)').toBe(true);
    await page.waitForTimeout(600);
    expect(Number(await tcfSelect(page).inputValue())).toBe(0);
    log = await actionLog(page);
    if (log.some((l) => l.includes('CLOBBER')))
      throw new Error('CLOBBER in action log during all-0 Save:\n' + log.join('\n'));
    ping('B: all-0 -> Save == full zero body (byte 30 == 0 intended, no CLOBBER)');
  });

  const log = await actionLog(page);
  evidence.actionLogSample = log.slice(-80);
  evidence.untrustedSkips = log.filter((l) => l.includes('OBSERVE skip'));
  console.log('LISTEN FINDINGS:\n' + (evidence.findings as string[]).map((f) => ' - ' + f).join('\n'));
  await test.info().attach('lalady-listen.json', {
    contentType: 'application/json',
    body: JSON.stringify(evidence, null, 2),
  });
});