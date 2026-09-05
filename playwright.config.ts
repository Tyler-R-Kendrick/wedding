import fs from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

// BASE_URL points at a deployed preview when set; otherwise Playwright starts the local app.
const external = process.env.BASE_URL;
const baseURL = external || 'http://localhost:3000';

// Sandboxes without `playwright install` may ship a system Chromium; CI keeps Playwright's own.
const chromiumPath = process.env.PW_CHROMIUM_PATH ?? (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
// A system Chromium running as root needs --no-sandbox; Playwright's own build handles this itself.
const launchOptions = chromiumPath ? { executablePath: chromiumPath, args: ['--no-sandbox'] } : {};

export default defineConfig({
  testDir: './tests',
  testMatch: /.*\.spec\.ts$/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    launchOptions,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer: external
    ? undefined
    : {
        command: process.env.PW_WEB_SERVER_COMMAND ?? 'npm run dev',
        url: 'http://localhost:3000/api/health',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: { PGLITE_MEMORY: process.env.PGLITE_MEMORY ?? '1', LOG_FORMAT: 'json' },
      },
  // Only Chromium is installed in CI and the sandbox, so phone/tablet profiles emulate on Chromium.
  projects: [
    { name: 'mobile', use: { ...devices['iPhone 14'], browserName: 'chromium', launchOptions } },
    { name: 'tablet', use: { ...devices['iPad (gen 7)'], browserName: 'chromium', launchOptions } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, launchOptions } },
  ],
});
