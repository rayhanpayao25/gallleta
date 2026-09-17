import { defineConfig, devices } from "@playwright/test";

// PW_HEADED=1 is the "I want to watch this" pass: headed Chromium + a
// visible slowMo. The normal headless suite (CI or a plain local run) never
// gets slowMo.
const isHeaded = process.env.PW_HEADED === "1";

// PORT is honored both by `next dev` (the webServer command) and here, so
// PORT=3100 npx playwright test runs the suite on a different port when
// localhost:3000 is already bound by another project.
const port = process.env.PORT ?? "3000";
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: "./tests",
  testMatch: /.*\.spec\.ts/,
  // The suite shares one live Supabase project across tests (see
  // tests/e2e/utils.ts) - run serially so two tests never race the same
  // disposable data or the shared inventory/order concurrency fixtures.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  timeout: 45_000,
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    ...(isHeaded ? { launchOptions: { slowMo: 250 } } : {}),
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], headless: !isHeaded },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: baseURL,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
