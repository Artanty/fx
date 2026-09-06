// L.A. Lady workbench — Treble Cut Filter isolation regression suite.
//
// User report (repeat of the packed-byte chaos class): changing OTHER knobs
// made the Treble Cut Filter (body byte 30, bit 0) change. This spec drives
// every other control and asserts, after EACH one, that the Treble Cut Filter
// stayed put — in the DOM select AND in the flash body byte 30 — then that a
// Save and a reload keep it stable, then that editing the SIBLING fields in
// byte 30 (slope/rolloff/boost max) preserves bit 0 the other way around.
//
// Safety mirrors the workbench audit:
//   - runs only against the device (GET /api/device); otherwise skipped.
//   - never touches byte 30's bit 0 itself, and afterAll restores the original
//     53-byte body via /api/slots/save overrides (lossless on old+fixed backends).

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
const LIVE_URL = `${API_URL}/api/control/live`;
const FLASH_URL = `${API_URL}/api/control`;

interface SlotSnapshot {
  activeIndex: number;
  body: number[];
  name: string;
  specs: ControlSpec[];
}

let api: APIRequestContext | null = null;
let snap: SlotSnapshot | null = null;

// Register the waiters BEFORE the interaction, so no request slips past us.
function setupWaiter(page: Page, spec: ControlSpec) {
  const realtime = spec.liveIndex != null;
  return {
    realtime,
    live: realtime
      ? page.waitForRequest((r) => r.url() === LIVE_URL && r.postDataJSON()?.index === spec.liveIndex)
      : null,
    flash: !realtime
      ? page.waitForResponse(
          (r) => r.request().url() === FLASH_URL && r.request().postDataJSON()?.index === spec.index
        )
      : null,
  };
}

// Drive a control the same way the audit does; resolves when its write landed.
// Realtime specs resolve on the CTRL_SET request; flash specs resolve on the
// /api/control response (index is validated — the exact composed byte is the
// workbench audit's byte-exact concern, not the isolation claim here).
async function driveControl(
  page: Page,
  spec: ControlSpec,
  prevByte: number
): Promise<{ field: number; byte: number }> {
  const root = knobRoot(page, spec.name);
  await root.waitFor({ state: 'attached', timeout: 15_000 });
  const prevField = fieldOf(spec, prevByte);
  const w = setupWaiter(page, spec);

  if (spec.type === 'knob') {
    const k0 = await knobValue(root);
    const k1 = await changeKnob(page, root, k0 < spec.max);
    if (k1 === k0) throw new Error(`knob ${spec.name} stuck at ${k0}`);
    await settleWrite(w, spec, k1);
    return { field: k1, byte: flashByte(spec, k1, prevByte) };
  }

  if (spec.type === 'select') {
    const target = pickOtherOption(spec, prevField);
    if (target == null) throw new Error(`select ${spec.name} has no alternative option`);
    await root.locator('.ctl-select').selectOption(String(target));
    await settleWrite(w, spec, target);
    return { field: target, byte: flashByte(spec, target, prevByte) };
  }

  if (spec.type === 'toggle') {
    const chk = root.locator('.ctl-toggle input');
    const target = (await chk.isChecked()) ? 0 : 1;
    await root.locator('.ctl-toggle').click();
    await settleWrite(w, spec, target);
    return { field: target, byte: flashByte(spec, target, prevByte) };
  }

  // segmented
  const target = pickOtherOption(spec, prevField);
  if (target == null) throw new Error(`segmented ${spec.name} has no alternative option`);
  const opt = (spec.options || []).find((o) => o.value === target)!;
  await root.locator('.ctl-seg-btn').filter({ hasText: opt.text }).click();
  await settleWrite(w, spec, target);
  return { field: target, byte: flashByte(spec, target, prevByte) };
}

// Await the relevant request/response so no waiter is left dangling: realtime
// specs by their payload, flash specs by target index.
async function settleWrite(
  w: { realtime: boolean; live: Promise<{ postDataJSON(): any }> | null; flash: Promise<any> | null },
  spec: ControlSpec,
  field: number
): Promise<void> {
  if (w.realtime) {
    const req = await w.live;
    const p = req.postDataJSON();
    if (p.index !== spec.liveIndex || p.value !== field)
      throw new Error(`${spec.name} live payload ${JSON.stringify(p)} != {index:${spec.liveIndex}, value:${field}}`);
  } else {
    const resp = await w.flash;
    const sent = resp.request().postDataJSON();
    if (sent.index !== spec.index)
      throw new Error(`${spec.name} flash payload ${JSON.stringify(sent)} targets wrong index ${sent.index}`);
  }
}

// Fresh flash body of the active slot from the backend (source of truth).
async function flashBody(): Promise<number[]> {
  const sp = await (await api!.get(`/api/slot-params?idx=${snap!.activeIndex}`)).json();
  return sp.params.map((p: { value: number }) => p.value);
}

// The Treble Cut Filter spec + its DOM select value.
const TCF_NAME = 'Treble Cut Filter';
function tcfSpec(specs: ControlSpec[]): ControlSpec {
  const s = specs.find((x) => x.name === TCF_NAME);
  if (!s) throw new Error('control map has no Treble Cut Filter spec');
  return s;
}
function tcfSelectValue(page: Page): Promise<string> {
  return knobRoot(page, TCF_NAME).locator('.ctl-select').inputValue();
}

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
    console.warn('[tcf-setup]', e);
    snap = null;
  }
});

test.afterAll(async () => {
  if (snap && api && snap.body.length) {
    try {
      await restoreBody(api, snap.activeIndex, snap.body);
      console.log('[tcf-restore] slot', snap.activeIndex, 'restored to original body');
    } catch (e) {
      console.error('[tcf-restore] FAILED — pedal not restored:', e);
    }
  }
  await api?.dispose();
  api = null;
});

test('treble cut filter: isolated from every other knob, Save, and byte-30 siblings', async ({ page }) => {
  test.skip(!snap, `L.A. Lady not connected or backend not reachable at ${API_URL}`);

  const s = snap!;
  const tcf = tcfSpec(s.specs);
  const byte30Base = s.body[30];
  const bit0Base = fieldOf(tcf, byte30Base);
  const findings: string[] = [];

  await test.step('workbench loads on the active slot', async () => {
    await page.goto('/');
    await expect(page.locator('.badge.ok').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.panel.workbench .kbody').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.panel.workbench .knob')).toHaveCount(s.specs.length);
    expect(s.body.length).toBe(53);
    const shown = Number(await tcfSelectValue(page));
    if (shown !== bit0Base)
      throw new Error(`Treble Cut Filter shows ${shown}, snapshot says ${bit0Base} (byte 30 = 0x${byte30Base.toString(16)})`);
  });

  const others = s.specs.filter((x) => x.index !== 30);
  const siblings = s.specs.filter((x) => x.index === 30 && x !== tcf);

  // A) Every OTHER control must leave Treble Cut Filter untouched.
  await test.step('TCF stays put while changing every other knob', async () => {
    const bad: string[] = [];
    for (const spec of others) {
      const root = knobRoot(page, spec.name);
      if ((await root.count()) !== 1) {
        bad.push(`${spec.index}:${spec.name} has ${await root.count()} DOM matches`);
        continue;
      }
      const prevByte = s.body[spec.index];
      try {
        await driveControl(page, spec, prevByte);
      } catch (e) {
        bad.push(`${spec.index}:${spec.name} drive error: ${(e as Error).message}`);
        continue;
      }
      const shown = Number(await tcfSelectValue(page));
      if (shown !== bit0Base) bad.push(`${spec.index}:${spec.name} moved TCF select to ${shown}`);
      const body = await flashBody();
      if (body[30] !== byte30Base)
        bad.push(
          `${spec.index}:${spec.name} changed flash byte 30: 0x${body[30].toString(16)} != 0x${byte30Base.toString(16)}`
        );
    }
    findings.push(`A: drove ${others.length} other controls; TCF DOM + flash byte 30 unchanged (${bad.length ? bad.length + ' failures' : 'all clean'})`);
    expect(bad, `Treble Cut Filter moved by another knob:\n${bad.join('\n')}`).toHaveLength(0);
  });

  // B) Save (after only-other edits) must keep byte 30 + the select.
  await test.step('Save preserves Treble Cut Filter', async () => {
    const before = Number(await tcfSelectValue(page));
    const saveWait = page.waitForResponse((r) => r.request().url() === `${API_URL}/api/slots/save`);
    await page.locator('.slot-picker button').filter({ hasText: /^Save$/ }).click();
    const sj = await (await saveWait).json();
    if (sj.ok !== true) throw new Error(`save failed: ${JSON.stringify(sj)}`);
    const rb = sj.readback as number[];
    const rbBit0 = rb[30] & tcf.mask;
    if (rb[30] !== byte30Base || rbBit0 !== bit0Base)
      throw new Error(`after Save byte 30 = 0x${rb[30].toString(16)} (bit0 ${rbBit0}), expected 0x${byte30Base.toString(16)} (bit0 ${bit0Base})`);
    await page.reload();
    await expect(page.locator('.panel.workbench .kbody').first()).toBeVisible({ timeout: 30_000 });
    const after = Number(await tcfSelectValue(page));
    if (after !== bit0Base) throw new Error(`reload shows TCF ${after}, expected ${bit0Base}`);
    findings.push('B: Save + reload keep byte 30 and the TCF select at snapshot');
  });

  // C) Sibling fields in byte 30 must preserve bit 0 the other way around, AND
  // the sibling edit must only flag ITS OWN field as "modified" — the field-
  // scoped dirty highlight (user report: editing Slope lit up TCF/BoostMax/
  // Rolloff too, even though their values did not change).
  await test.step('editing Treble Shelf Slope / Rolloff / Boost Maximum preserves Treble Cut Filter + field-scoped modified highlight', async () => {
    const bad: string[] = [];
    const touched = new Set<string>();
    for (const spec of siblings) {
      const shown = Number(await tcfSelectValue(page));
      const root = knobRoot(page, spec.name);
      if ((await root.count()) !== 1) {
        bad.push(`${spec.index}:${spec.name} has ${await root.count()} DOM matches`);
        continue;
      }
      const prevByte = s.body[30];
      try {
        await driveControl(page, spec, prevByte);
        const body = await flashBody();
        const bit0 = fieldOf(tcf, body[30]);
        if (bit0 !== bit0Base)
          bad.push(`${spec.name} flipped TCF bit0 to ${bit0} (byte 30 = 0x${body[30].toString(16)})`);
      } catch (e) {
        bad.push(`${spec.name} drive error: ${(e as Error).message}`);
        continue;
      }
      const after = Number(await tcfSelectValue(page));
      if (after !== bit0Base) bad.push(`${spec.name} moved TCF select to ${after} (was ${shown})`);
      touched.add(spec.name);

      // Modified highlight must be field-scoped: the just-driven sibling is lit,
      // the siblings NOT driven in this step yet must stay clean even though
      // they share body byte 30 with the edited one.
      await page.waitForTimeout(300);
      for (const other of siblings) {
        const oroot = knobRoot(page, other.name);
        const isModified = await oroot.locator('.modified, .ctl-select.modified, .ctl-seg.modified, .kbody.modified').count().then((n) => n > 0);
        if (touched.has(other.name)) {
          if (!isModified)
            bad.push(`${other.name} should be marked modified after its own edit (was clean)`);
        } else if (isModified) {
          const kinds = (await oroot.evaluate((el) =>
            Array.from(el.querySelectorAll('.modified')).map((m) => m.className)
          )).join('; ');
          bad.push(`${other.name} marked modified by sibling ${spec.name} edit without its field changing (classes: ${kinds || '?'})`);
        }
      }
    }
    findings.push(`C: ${siblings.length} byte-30 siblings edited; TCF bit0 stayed ${bit0Base}, modified highlight stayed field-scoped (${bad.length ? bad.length + ' failures' : 'all clean'})`);
    expect(bad, `Treble Cut Filter moved by a sibling field or dirty-highlight cross-talk:\n${bad.join('\n')}`).toHaveLength(0);
  });

  await test.info().attach('treble-cut-isolation.json', {
    contentType: 'application/json',
    body: JSON.stringify(
      {
        slot: s.activeIndex,
        presetName: s.name,
        byte30SnapshotHex: byte30Base.toString(16).padStart(2, '0'),
        tcfBit0: bit0Base,
        findings,
      },
      null,
      2
    ),
  });
  for (const f of findings) console.log(`TCF FINDING: ${f}`);
});