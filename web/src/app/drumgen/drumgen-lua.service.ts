import { Injectable } from '@angular/core';

import type { Fengari } from 'fengari-web';

import {
  BridgeFn,
  DrumgenEvent,
  DrumgenFrame,
  DrumgenInputEvent,
  DrumgenManifest,
  DrumgenPixels,
  DrumgenReply,
  DrumgenState,
} from './drumgen.models';

/**
 * Runs the real drumgen Lua in the browser.
 *
 * There is no second implementation of the generator here: the page fetches
 * monome/drumgen/lib/*.lua (copied to public/lua/drumgen by `npm run sync:lua`)
 * and fengari executes those exact files. TypeScript only moves JSON across the
 * boundary and paints what Lua draws.
 *
 * Two deliberate choices, both about not fighting the 2018-era VM:
 *
 * - The VM is loaded with a dynamic import, so esbuild puts its 219KB in a lazy
 *   chunk instead of the initial bundle (which has a 500kB budget). The package
 *   is CommonJS; esbuild's interop hands back module.exports, which is the
 *   fengari object.
 *
 * - Arguments travel as a Lua source literal rather than as JS values. The only
 *   documented string path into fengari is `load(source)`, so each call compiles
 *   a one-line chunk with a fully escaped literal in it. `luaQuote` escapes
 *   everything outside printable ASCII as \ddd, so the literal cannot depend on
 *   how the host encodes text.
 */

// Keep this list in step with monome/drumgen/lib; sync-lua.mjs and the manifest
// check in tests/drumgen-assets.audit.spec.ts catch a missing entry.
const MODULES = [
  'pattern',
  'kit',
  'store',
  'gen',
  'screen',
  'font6x8',
  'ui',
  'bridge',
];

const LUA_DIR = 'lua/drumgen/';

// package.preload has to exist before anything is registered; fengari opens the
// standard libraries, so it does. Module sources are handed in by the host
// because fengari has no filesystem to read them from.
const REGISTER_HOOK = [
  '__drumgen_register = function(name, src)',
  '  package.preload[name] = function(...)',
  "    local chunk, err = load(src, '@' .. name .. '.lua')",
  "    if not chunk then error('cannot load ' .. name .. ': ' .. tostring(err), 0) end",
  '    return chunk(...)',
  '  end',
  'end',
].join('\n');

@Injectable({ providedIn: 'root' })
export class DrumgenLuaService {
  private vm?: Fengari;
  private starting?: Promise<Fengari>;

  /** Load the VM and every Lua module. Safe to call repeatedly. */
  async start(): Promise<Fengari> {
    if (this.vm) return this.vm;
    this.starting ??= this.load();
    return this.starting;
  }

  private async load(): Promise<Fengari> {
    const mod = await import('fengari-web');
    // CommonJS interop: the fengari object is module.exports, so it arrives as
    // the default export - or as the namespace itself under a different
    // interop setting.
    const fengari = (mod.default ?? mod) as Fengari;
    if (typeof fengari?.load !== 'function') {
      throw new Error('fengari-web loaded but exposes no load()');
    }
    this.vm = fengari;
    fengari.load(REGISTER_HOOK)();

    for (const name of MODULES) {
      const res = await fetch(`${LUA_DIR}${name}.lua`);
      if (!res.ok) {
        throw new Error(
          `cannot fetch ${LUA_DIR}${name}.lua (${res.status}) - run: npm run sync:lua`,
        );
      }
      const src = await res.text();
      this.run(`__drumgen_register("${name}", ${this.luaQuote(src)})`);
    }
    return fengari;
  }

  /** Boot the Lua instance and return its first snapshot. */
  async boot(config: unknown = {}): Promise<DrumgenReply<DrumgenState>> {
    await this.start();
    return this.call<DrumgenState>('boot', config);
  }

  /**
   * Call one bridge entry point. `payload` is JSON-encoded into a Lua string
   * literal, so what crosses the boundary is exactly what Lua sees. The bridge
   * answers with a JSON string, so a Lua error arrives as data, not as a
   * dead page.
   */
  call<T = DrumgenState>(fn: BridgeFn, payload: unknown = {}): DrumgenReply<T> {
    // `require` rather than a global: the modules are loaded through
    // package.preload, so going through require also proves the registration.
    const chunk =
      `local bridge = require 'bridge'\nreturn bridge.${fn}(${this.luaQuote(JSON.stringify(payload))})`;
    return JSON.parse(this.toText(chunk)) as DrumgenReply<T>;
  }

  /** Apply a UI change: style, params, tempo, play state. */
  async set(change: {
    style?: string;
    params?: Record<string, number>;
    tempo?: number;
    playing?: boolean;
  }): Promise<DrumgenReply> {
    await this.start();
    return this.call('set', change);
  }

  /**
   * Generate one bar and hand back its events for scheduling.
   *
   * `playhead` tells Lua where the host is, so the redraw that follows shows the
   * column that is sounding. `force_fill` is the FILL action, separate from the
   * cadence in gen.lua so a fill never shifts the next scheduled one.
   */
  async tick(opts: { playhead?: number; force_fill?: boolean } = {}): Promise<
    DrumgenReply & { events?: DrumgenEvent[] }
  > {
    await this.start();
    return this.call('tick', opts);
  }

  /** Feed device-shaped input in: the same numbers a norns enc()/key() would send. */
  async input(events: DrumgenInputEvent[]): Promise<DrumgenReply> {
    await this.start();
    return this.call('input', { events });
  }

  /**
   * Redraw and get the pixels back.
   *
   * Lua hands the screen over run-length encoded because a 128x64 framebuffer is
   * mostly one level: a few hundred pairs cross the boundary instead of 8192
   * numbers, and none of them need fengari table interop. This expands them into
   * one row-major array for the canvas.
   */
  async render(opts: { playhead?: number; playing?: boolean } = {}): Promise<
    DrumgenReply & { pixels?: DrumgenPixels }
  > {
    await this.start();
    return this.call('render', opts);
  }

  /** Expand run-length encoded levels into a row-major frame, one level per pixel. */
  static toFrame(pixels: DrumgenPixels): DrumgenFrame {
    const frame = new Uint8Array(pixels.width * pixels.height);
    let at = 0;
    for (const [count, level] of pixels.rle) {
      for (let i = 0; i < count && at < frame.length; i++) frame[at++] = level;
    }
    return frame;
  }

  /** The Lua version string, for the status line. */
  luaVersion(): string {
    return this.toText('return _VERSION');
  }

  async manifest(): Promise<DrumgenManifest> {
    const res = await fetch(`${LUA_DIR}MANIFEST.json`);
    if (!res.ok) {
      throw new Error(`cannot fetch manifest (${res.status}) - run: npm run sync:lua`);
    }
    return (await res.json()) as DrumgenManifest;
  }

  private requireVm(): Fengari {
    if (!this.vm) throw new Error('drumgen lua not started');
    return this.vm;
  }

  private run(source: string): unknown {
    return this.requireVm().load(source, '=drumgen')();
  }

  private toText(source: string): string {
    const raw = this.run(source);
    return typeof raw === 'string' ? raw : this.requireVm().to_jsstring(raw);
  }

  /**
   * A Lua string literal that survives the trip through JS unchanged. Lua 5.1's
   * \ddd escape is the only one guaranteed everywhere, so everything outside
   * printable ASCII uses it and the literal is pure ASCII by construction.
   */
  private luaQuote(s: string): string {
    let out = '"';
    for (let i = 0; i < s.length; i++) {
      const code = s.charCodeAt(i);
      const ch = s[i];
      if (ch === '"') out += '\\"';
      else if (ch === '\\') out += '\\\\';
      else if (code >= 32 && code <= 126) out += ch;
      else out += `\\${code.toString().padStart(3, '0')}`;
    }
    return `${out}"`;
  }
}