// L.A. Lady workbench control audit (Playwright).
//
// Drives EVERY knob / select / toggle / segmented control of the workbench and
// verifies, for each one, exactly how it behaves:
//   - which DOM element it maps to (`/api/control-map` spec cross-referenced by
//     exact name),
//   - whether a change goes REALTIME (POST /api/control/live at spec.liveIndex,
//     RAM only, never persisted) or to the FLASH-COMMIT queue
//     (POST /api/control with a full composed byte: sibling bits preserved,
//     response readback equals the request),
//   - that the payload is byte-exact for the bit-field (mask/shift composition),
//   - and that a final Save persists every edited byte (readback == UI state).
//
// Safety:
//   - runs only against the device (GET /api/device); otherwise skipped.
//   - FIRST runs a "save-path probe" (drag Bass Shelf Frequency = body 31 /
//     live 30, Save, check packed byte 30 unchanged). If the running backend is
//     the OLD build whose save overlay clobbers packed bytes AND whose
//     resolveActiveSlot can misidentify the active slot, the write-audit is
//     ABORTED вЂ” stale servers must not receive /api/control flash commits that
//     could land in the wrong slot.
//   - always restores the original 53-byte slot body afterwards via
//     /api/slots/save with overrides for every byte (round-trips losslessly on
//     old and fixed backends alike).

import { expect, request, test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';

const API_URL = process.env.API_URL ?? 'http://localhost:3111';
const LIVE_URL = `${API_URL}/api/control/live`;
const FLASH_URL = `${API_URL}/api/control`;

interface ControlOption {
  value: number;
  text: string;
}
interface ControlSpec {
  index: number;
  name: string;
  type: 'knob' | 'select' | 'toggle' | 'segmented';
  shift: number;
  mask: number;
  max: number;
  liveIndex?: number | null;
  cc?: number | null;
  options?: ControlOption[];
}

interface SlotSnapshot {
  activeIndex: number;
  body: number[];
  name: string;
  specs: ControlSpec[];
}

interface AuditLine {
  id: string;
  kind: string;
  action: string;
  expected: string;
  observed: string;
  ok: boolean;
  error?: string;
}

let api: APIRequestContext | null = null;
let snap: SlotSnapshot | null = null;

// Model of the frontend setField(): the exact payload a control edit fires.
//   realtime -> { index: spec.liveIndex, value: field }        (CTRL_SET, RAM)
//   packed   -> { index: spec.index, value: (prev & ~mask) | (field << shift) }
//               (full composed byte -> sibling bit-fields preserved; flash)
const fieldOf = (spec: ControlSpec, byte: number): number => (byte & spec.mask) >>> spec.shift;
const flashByte = (spec: ControlSpec, field: number, prev: number): number =>
  (prev & ~spec.mask) | ((field << spec.shift) & spec.mask);

async function restoreBody(ctx: APIRequestContext, idx: number, body: number[]): Promise<void> {
  const overrides: Record<number, number> = {};
  for (let i = 0; i < body.length; i++) overrides[i] = body[i];
  const res = await ctx.post('/api/slots/save', { data: { idx, overrides } });
  const j = await res.json().catch(() => null);
  if (!j || j.ok !== true) throw new Error(`restore save failed: ${JSON.stringify(j)}`);
  const rb = j.readback as number[] | undefined;
  if (!rb) throw new Error('restore save returned no readback');
  for (let i = 0; i < body.length; i++) {
    if (rb[i] !== body[i]) throw new Error(`restore mismatch: byte ${i} want ${body[i]} got ${rb[i]}`);
  }
}

function knobRoot(page: Page, name: string) {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return page
    .locator('.panel.workbench .knob')
    .filter({
      has: page.locator('.kname', { hasText: new RegExp('^' + esc + '$') }),
    })
    .first();
}

async function knobValue(root: ReturnType<typeof knobRoot>): Promise<number> {
  return Number((await root.locator('.kvalue').innerText()).trim());
}

// Change a knob and wait until the displayed value actually changed, then
// return the new displayed value. Knobs are driven via the wheel handler
// (knobWheel: value += 8): the app's drag path relies on real pointerdown to
// arm the drag, but headless-shell drops synthesized mouse->pointerdown, so
// drags never fire. Wheel is trusted input on the same kbody/setField path.
async function changeKnob(
  page: Page,
  root: ReturnType<typeof knobRoot>,
  preferUp: boolean
): Promise<number> {
  const before = await knobValue(root);
  if (before < 0) throw new Error(`unreadable knob value ${before}`);
  const kbody = root.locator('.kbody');
  const display = root.locator('.kvalue');

  await kbody.scrollIntoViewIfNeeded();
  const box = await kbody.boundingBox();
  if (!box) throw new Error('knob has no bounding box');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;

  await page.mouse.move(x, y);
  await page.mouse.wheel(0, preferUp ? -1 : 1); // deltaY<0 => +8
  await expect(display).not.toHaveText(String(before), { timeout: 3000 });
  return knobValue(root);
}

function pickOtherOption(spec: ControlSpec, current: number): number | null {
  const other = (spec.options || []).find((o) => o.value !== current);
  return other ? other.value : null;
}

// Register the waiters BEFORE the interaction so no request can slip past us
// (live CTRL_SET debounces ~40ms; flash commits debounce 300ms then serialize).
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

async function assertWrite(
  l: AuditLine,
  w: { realtime: boolean; live: Promise<any> | null; flash: Promise<any> | null },
  expectedField: number,
  spec: ControlSpec,
  prevByte: number
): Promise<void> {
  if (w.realtime) {
    const req = await w.live;
    const payload = req.postDataJSON();
    l.expected = `POST ${LIVE_URL} {index: ${spec.liveIndex}, value: ${expectedField}}`;
    l.observed = JSON.stringify(payload);
    if (payload.index !== spec.liveIndex || payload.value !== expectedField) {
      throw new Error(`expected ${l.expected}; got ${l.observed}`);
    }
  } else {
    const expected = flashByte(spec, expectedField, prevByte);
    const resp = await w.flash;
    const rj = await resp.json();
    const sent = resp.request().postDataJSON();
    l.expected = `POST ${FLASH_URL} {index: ${spec.index}, value: ${expected}} (siblings preserved)`;
    l.observed = JSON.stringify({ sent, readback: rj.readback });
    if (sent.index !== spec.index || sent.value !== expected || rj.readback !== expected) {
      throw new Error(`expected ${l.expected}; got ${l.observed}`);
    }
  }
}

test.beforeAll(async () => {
  api = await request.newContext({ baseURL: API_URL, extraHTTPHeaders: { 'Content-Type': 'application/json' } });
  try {
    const dev = await (await api.get('/api/device')).json().catch(() => null);
    if (!dev?.found) return; // snap stays null -> every test skips
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
    console.warn('[setup]', e);
    snap = null;
  }
});

test.afterAll(async () => {
  if (snap && api && snap.body.length) {
    try {
      await restoreBody(api, snap.activeIndex, snap.body);
      console.log('[restore] slot', snap.activeIndex, 'restored to original body');
    } catch (e) {
      console.error('[restore] FAILED вЂ” pedal not restored:', e);
    }
  }
  await api?.dispose();
  api = null;
});

test('workbench: save-path probe, per-control audit, save round-trip, restore', async ({ page }) => {
  test.skip(!snap, `L.A. Lady not connected or backend not reachable at ${API_URL}`);

  const s = snap!;
  const body = [...s.body]; // running UI-tracker of the 53-byte body
  const report: AuditLine[] = [];
  const findings: string[] = [];
  const line = (id: string, kind: string): AuditLine => {
    const l: AuditLine = { id, kind, action: '', expected: '', observed: '', ok: true };
    report.push(l);
    return l;
  };

  await test.step('workbench loads on the active slot (read-only)', async () => {
    await page.goto('/');
    await expect(page.locator('.badge.ok').first()).toBeVisible({ timeout: 30_000 });
    const knobs = page.locator('.panel.workbench .kbody');
    await expect(knobs.first()).toBeVisible({ timeout: 30_000 });
    // .kbody exists only for knob-type controls; selects/toggles/segmented render
    // other elements inside the same .knob container, so count .knob holders.
    await expect(page.locator('.panel.workbench .knob')).toHaveCount(
      s.specs.length
    );
    expect(s.specs.length).toBeGreaterThan(0);
    expect(s.body.length).toBe(53);
  });

  // STEP A вЂ” save-path probe (SAFE on old + fixed backends: RAM write + Save).
  await test.step('probe: Save after a live EQ knob edit must NOT clobber packed byte 30', async () => {
    const l = line('PROBE', 'probe');
    l.action = 'drag Bass Shelf Frequency, then Save';
    let k1 = -1;
    try {
      const root = knobRoot(page, 'Bass Shelf Frequency');
      await expect(root).toHaveCount(1);

      const k0 = await knobValue(root);
      const up = k0 < 250;
      const liveWait = page.waitForRequest((r) => r.url() === LIVE_URL && r.postDataJSON()?.index === 30);
      const k1 = await changeKnob(page, root, up);
      if (k1 === k0) throw new Error(`bass freq knob did not move (was ${k0})`);

      const req = await liveWait;
      l.expected = `live CTRL_SET index 30, value ${k1}`;
      l.observed = JSON.stringify(req.postDataJSON());
      if (req.postDataJSON().value !== k1) throw new Error(`expected ${l.expected}; got ${l.observed}`);

      const saveWait = page.waitForResponse((r) => r.request().url() === `${API_URL}/api/slots/save`);
      await page.locator('.slot-picker button').filter({ hasText: /^Save$/ }).click();
      const sj = await (await saveWait).json();
      if (sj.ok !== true) throw new Error(`save failed: ${JSON.stringify(sj)}`);

      const rb = sj.readback as number[];
      const b30 = rb[30];
      const b31 = rb[31];
      const packedKept = b30 === s.body[30];
      const editedKept = b31 === k1;
      l.expected = `after Save: byte 30 == packed snapshot 0x${s.body[30].toString(16).padStart(2, '0')}, byte 31 == ${k1}`;
      l.observed = `byte 30 = 0x${b30.toString(16).padStart(2, '0')} (${packedKept ? 'kept' : 'CLOBBERED'}), byte 31 = ${b31} (${editedKept ? 'kept' : 'WRONG'})`;
      findings.push(`PROBE: ${l.observed}`);
      if (!packedKept || !editedKept) {
        throw new Error(
          `save-path regression on the RUNNING backend (${l.observed}). ` +
            'Restart the la-lady backend (:3111) with the server.js save fix, then rerun.'
        );
      }
    } catch (e) {
      l.ok = false;
      l.error = String((e as Error).message);
    }

    if (!l.ok) return;
    // Post-save, re-anchor the tracker and the page to the freshly-saved body so
    // the per-control audit starts from a body both the UI and flash agree on.
    const fresh = await (await api!.get(`/api/slot-params?idx=${s.activeIndex}`)).json();
    for (let i = 0; i < fresh.params.length; i++) body[i] = fresh.params[i].value;
    if (k1 > -1) body[31] = k1;
    await page.reload();
    await expect(page.locator('.panel.workbench .kbody').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.panel.workbench .knob')).toHaveCount(
      s.specs.length
    );
  });

  // STEP B вЂ” write audit (only when the backend preserves packed bytes).
  const probeOk = report.find((r) => r.id === 'PROBE')?.ok ?? false;
  if (!probeOk) {
    test.info().annotations.push({
      type: 'blocked',
      description:
        'Save-path probe failed (stale backend). Write-audit aborted so /api/control flash commits cannot hit a misidentified slot. Restart back/lalady/server.js (:3111).',
    });
    findings.push('AUDIT SKIPPED вЂ” stale backend detected by the probe');
  } else {
    await test.step('audit: every control fires the exact expected request', async () => {
      for (const spec of s.specs) {
        const l = line(`${spec.index}:${spec.name}`, spec.type);
        try {
          console.log(`[audit] ${spec.index}:${spec.name} (${spec.type}) begin`);
          const root = knobRoot(page, spec.name);
          await root.waitFor({ state: 'attached', timeout: 15_000 });

          const realtime = spec.liveIndex != null;
          const prevByte = body[spec.index];
          const prevField = fieldOf(spec, prevByte);
          let finalField = -1;

          if (spec.type === 'knob') {
            const k0 = await knobValue(root);
            const up = k0 < spec.max; // single drag -> guaranteed movement
            const w = setupWaiter(page, spec);
            const k1 = await changeKnob(page, root, up);
            if (k1 === k0) throw new Error(`knob stuck at ${k0}`);
            finalField = k1;
            l.action = `drag ${k0} -> ${k1}`;
            await assertWrite(l, w, k1, spec, prevByte);
          }

          if (spec.type === 'select') {
            const target = pickOtherOption(spec, prevField);
            if (target == null) throw new Error('select has no alternative option');
            finalField = target;
            l.action = `select ${target} (was ${prevField})`;
            const w = setupWaiter(page, spec);
            await root.locator('.ctl-select').selectOption(String(target));
            await assertWrite(l, w, target, spec, prevByte);
            const shown = Number(await root.locator('.ctl-select').inputValue());
            if (shown !== target) throw new Error(`UI select shows ${shown}, expected ${target}`);
          }

          if (spec.type === 'toggle') {
            // The checkbox input is visually hidden (display:none) inside the
            // styled label, so click the visible .ctl-toggle, then verify the
            // hidden input actually flipped.
            const chk = root.locator('.ctl-toggle input');
            const target = (await chk.isChecked()) ? 0 : 1;
            finalField = target;
            l.action = `toggle -> ${target}`;
            const w = setupWaiter(page, spec);
            await root.locator('.ctl-toggle').click();
            await assertWrite(l, w, target, spec, prevByte);
            if ((await chk.isChecked()) !== (target === 1)) throw new Error('toggle UI did not follow');
          }

          if (spec.type === 'segmented') {
            const target = pickOtherOption(spec, prevField);
            if (target == null) throw new Error('segmented has no alternative option');
            const opt = (spec.options || []).find((o) => o.value === target)!;
            finalField = target;
            l.action = `segment -> ${opt.text} (${target})`;
            const w = setupWaiter(page, spec);
            await root.locator('.ctl-seg-btn').filter({ hasText: opt.text }).click();
            await assertWrite(l, w, target, spec, prevByte);
            const active = root.locator('.ctl-seg .ctl-seg-btn.on');
            if ((await active.count()) !== 1 || (await active.first().innerText()) !== opt.text) {
              throw new Error('segmented UI did not follow');
            }
          }

          if (finalField > -1) body[spec.index] = flashByte(spec, finalField, prevByte);
          l.observed += ` [${realtime ? 'realtime' : 'flash'}]`;
          console.log(`[audit] ${spec.index}:${spec.name} done: ${l.action}${l.ok ? '' : ' FAIL ' + l.error}`);
        } catch (e) {
          l.ok = false;
          l.error = String((e as Error).message);
          console.log(`[audit] ${spec.index}:${spec.name} ERROR: ${l.error}`);
        }
      }
      console.log('[audit] all controls processed');
    });

    await test.step('audit: Save round-trip persists the whole UI state byte-for-byte', async () => {
      const l = line('SAVE', 'save');
      l.action = 'Save after editing all controls';
      try {
        const saveWait = page.waitForResponse((r) => r.request().url() === `${API_URL}/api/slots/save`);
        await page.locator('.slot-picker button').filter({ hasText: /^Save$/ }).click();
        const sj = await (await saveWait).json();
        if (sj.ok !== true) throw new Error(`save failed: ${JSON.stringify(sj)}`);
        const rb = sj.readback as number[];
        const mismatches: string[] = [];
        for (let i = 0; i < s.body.length; i++) {
          if (rb[i] !== body[i]) mismatches.push(`byte ${i}: saved ${rb[i]} vs UI ${body[i]}`);
        }
        l.expected = 'readback[i] === UI-tracker body[i] for all 53 bytes';
        l.observed = mismatches.length
          ? mismatches.join('; ')
          : `all 53 bytes match (packed 0x${rb[30]?.toString(16)} 0x${rb[32]?.toString(16)} 0x${rb[38]?.toString(16)})`;
        if (mismatches.length) throw new Error(l.observed);
      } catch (e) {
        l.ok = false;
        l.error = String((e as Error).message);
        findings.push(`SAVE round-trip: ${l.error}`);
      }
    });
  }

  // STEP C вЂ” restore the original body and confirm the workbench reflects it.
  await test.step('restore: original 53-byte body back on the pedal and in the UI', async () => {
    const l = line('RESTORE', 'restore');
    l.action = 'full body restore + reload + DOM check';
    try {
      await restoreBody(api!, s.activeIndex, s.body);
      await page.reload();
      await expect(page.locator('.panel.workbench .kbody').first()).toBeVisible({ timeout: 30_000 });
      await expect(page.locator('.panel.workbench .knob')).toHaveCount(
        s.specs.length
      );
      const domBad: string[] = [];
      for (const spec of s.specs) {
        const want = fieldOf(spec, s.body[spec.index]);
        const root = knobRoot(page, spec.name);
        if ((await root.count()) !== 1) {
          domBad.push(`${spec.name}: ${await root.count()} DOM matches`);
          continue;
        }
        if (spec.type === 'knob' && (await knobValue(root)) !== want) {
          domBad.push(`${spec.name}: knob ${await knobValue(root)} != ${want}`);
        }
        if (spec.type === 'select') {
          const got = Number(await root.locator('.ctl-select').inputValue());
          if (got !== want) domBad.push(`${spec.name}: select ${got} != ${want}`);
        }
        if (spec.type === 'toggle') {
          const got = (await root.locator('.ctl-toggle input').isChecked()) ? 1 : 0;
          if (got !== want) domBad.push(`${spec.name}: toggle ${got} != ${want}`);
        }
        if (spec.type === 'segmented') {
          const opt = (spec.options || []).find((o) => o.value === want);
          const active = root.locator('.ctl-seg .ctl-seg-btn.on');
          const got = (await active.count()) === 1 ? (await active.first().innerText()) : '(none)';
          if (!opt || got !== opt.text) domBad.push(`${spec.name}: segmented '${got}' != '${opt?.text}'`);
        }
      }
      l.expected = 'all DOM controls match the snapshot body';
      l.observed = domBad.length
        ? domBad.join('; ')
        : `${s.specs.length}/${s.specs.length} controls match the snapshot`;
      if (domBad.length) throw new Error(l.observed);
    } catch (e) {
      l.ok = false;
      l.error = String((e as Error).message);
      findings.push(`RESTORE: ${l.error}`);
    }
  });

  // Report + verdict.
  const bad = report.filter((r) => !r.ok);
  await test.info().attach('workbench-audit.json', {
    contentType: 'application/json',
    body: JSON.stringify(
      {
        slot: s.activeIndex,
        presetName: s.name,
        bodySnapshotHex: s.body.map((b) => b.toString(16).padStart(2, '0')).join(' '),
        backendOk: probeOk,
        controlCount: s.specs.length,
        controls: report,
        findings,
        summary: {
          total: report.length,
          failed: bad.length,
          byKind: Object.fromEntries(
            [...new Set(report.map((r) => r.kind))].map((k) => [
              k,
              {
                total: report.filter((r) => r.kind === k).length,
                failed: report.filter((r) => r.kind === k && !r.ok).length,
              },
            ])
          ),
        },
      },
      null,
      2
    ),
  });

  for (const f of findings) console.log(`FINDING: ${f}`);
  const failed = bad.map((r) => `[${r.id}] ${r.error || r.observed}`).join('\n');
  expect(bad, `control audit failures:\n${failed}`).toHaveLength(0);
});
