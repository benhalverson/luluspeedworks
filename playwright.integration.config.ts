import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test/integration",
  testMatch: "**/*.spec.ts",
  globalSetup: "./test/integration/setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  outputDir: "artifacts/local-admin/results",
  reporter: [
    ["list"],
    ["html", { outputFolder: "artifacts/local-admin/report", open: "never" }],
  ],
  use: {
    baseURL: `http://localhost:${process.env.LOCAL_ADMIN_FRONTEND_PORT ?? 3001}`,
    browserName: "chromium",
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    },
    serviceWorkers: "block",
    actionTimeout: 10_000,
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
