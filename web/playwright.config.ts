import { defineConfig } from '@playwright/test';

// Web frontend (ng serve on 4211) and L.A. Lady backend (:3111) are both
// expected to be running already — this suite never spawns servers.
const WEB_URL = process.env.WEB_URL ?? 'http://localhost:4211';
const API_URL = process.env.API_URL ?? 'http://localhost:3111';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.audit.spec.ts',
  fullyParallel: false,
  workers: 1, // a single Source Audio pedal is one USB device: serialize everything
  retries: 0, // never auto-re-run destructive device writes
  reporter: [['list']],
  timeout: 20 * 60 * 1000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: WEB_URL,
    headless: true,
    trace: 'retain-on-failure',
  },
  metadata: { apiUrl: API_URL, webUrl: WEB_URL },
});