import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test/smoke",
  testMatch: "**/*.spec.ts",
  globalSetup: "./test/smoke/setup.ts",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 2,
  outputDir: "artifacts/smoke/results",
  reporter: [
    ["list"],
    ["html", { outputFolder: "artifacts/smoke/report", open: "never" }],
  ],
  use: {
    baseURL: "http://127.0.0.1:4173",
    browserName: "chromium",
    serviceWorkers: "block",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 } } },
    {
      name: "mobile",
      use: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
});
