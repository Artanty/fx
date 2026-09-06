// Shared helpers for the L.A. Lady workbench Playwright specs. Pure functions +
// DOM drivers over the SAME control map the audit and the isolation suite use,
// so both specs agree on what a control edit fires and how to read it back.

import { expect } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';

export interface ControlOption {
  value: number;
  text: string;
}
export interface ControlSpec {
  index: number;
  name: string;
  type: 'knob' | 'select' | 'toggle' | 'segmented';
  shift: number;
  mask: number;
  max: number;
  liveIndex?: number | null;
  options?: ControlOption[];
}

// Exact model of the frontend setField(): the payload a control edit fires.
//   realtime -> { index: spec.liveIndex, value: field }   (CTRL_SET, RAM)
//   packed   -> { index: spec.index, value: (prev & ~mask) | (field << shift) }
//               (full composed byte -> sibling bit-fields preserved; flash)
export const fieldOf = (spec: ControlSpec, byte: number): number =>
  (byte & spec.mask) >>> spec.shift;

export const flashByte = (spec: ControlSpec, field: number, prev: number): number =>
  (prev & ~spec.mask) | ((field << spec.shift) & spec.mask);

// Persist a full 53-byte body to pedal slot `idx` and verify byte-equality.
export async function restoreBody(
  ctx: APIRequestContext,
  idx: number,
  body: number[]
): Promise<void> {
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

export function knobRoot(page: Page, name: string) {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return page
    .locator('.panel.workbench .knob')
    .filter({ has: page.locator('.kname', { hasText: new RegExp('^' + esc + '$') }) })
    .first();
}

export async function knobValue(root: ReturnType<typeof knobRoot>): Promise<number> {
  return Number((await root.locator('.kvalue').innerText()).trim());
}

// Change a knob via the wheel handler (knobWheel: value += 8 per -1 deltaY);
// drags need real pointerdown which headless-shell drops, wheel is trusted.
export async function changeKnob(
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
  await page.mouse.wheel(0, preferUp ? -1 : 1);
  await expect(display).not.toHaveText(String(before), { timeout: 3000 });
  return knobValue(root);
}

export function pickOtherOption(spec: ControlSpec, current: number): number | null {
  const other = (spec.options || []).find((o) => o.value !== current);
  return other ? other.value : null;
}