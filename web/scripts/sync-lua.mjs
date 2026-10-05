// Copies the drumgen Lua core out of monome/ and into public/ so Angular can
// serve it. monome/drumgen/lib stays the single source of truth: it is the code
// that ships to the device and the code the host tests run.
//
// Angular's assets cannot reach outside web/ (input must live under the project
// root), hence the copy. MANIFEST.json records a sha256 per file so the copy can
// never silently drift: tests/drumgen-assets.audit.spec.ts re-hashes the sources
// and fails on a mismatch.
//
// Usage: npm run sync:lua   (add --check to verify without writing)

import { createHash } from 'node:crypto';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = resolve(web, '../monome/drumgen/lib');
const dest = join(web, 'public/lua/drumgen');

if (!existsSync(src)) {
  console.error(`sync-lua: missing ${src} - run from web/ in the fx repo`);
  process.exit(1);
}

const check = process.argv.includes('--check');
const files = (await readdir(src)).filter((f) => f.endsWith('.lua')).sort();
const hashes = {};

for (const file of files) {
  const body = await readFile(join(src, file));
  hashes[file] = createHash('sha256').update(body).digest('hex').slice(0, 16);
}

const manifest = `${JSON.stringify({ source: 'monome/drumgen/lib', files: hashes }, null, 2)}\n`;

if (check) {
  const current = existsSync(join(dest, 'MANIFEST.json'))
    ? await readFile(join(dest, 'MANIFEST.json'), 'utf8')
    : '';
  if (current !== manifest) {
    console.error('sync-lua: public/lua/drumgen is stale - run: npm run sync:lua');
    for (const [file, hash] of Object.entries(hashes)) {
      if (!current.includes(hash)) console.error(`  stale/missing: ${file} (${hash})`);
    }
    process.exit(1);
  }
  console.log(`sync-lua: ${files.length} lua files up to date`);
  process.exit(0);
}

await rm(dest, { recursive: true, force: true });
await mkdir(dest, { recursive: true });
for (const file of files) await cp(join(src, file), join(dest, file));
await writeFile(join(dest, 'MANIFEST.json'), manifest);

// These copies are gitignored (see web/.gitignore): they exist only so the
// dev server can serve the same Lua the host tests run. MANIFEST.json carries
// the sha256 of the source, so a stale copy shows up as a hash mismatch on the
// page rather than as a silent difference.
console.log(`sync-lua: ${files.length} files -> public/lua/drumgen`);
for (const [file, hash] of Object.entries(hashes)) console.log(`  ${file}  ${hash}`);