// @ts-check

const { defineConfig } = require("@playwright/test");

const BASE_URL = process.env.INTEGRATION_URL || "http://localhost:8000";

module.exports = defineConfig({
  testDir: "tests/e2e",
  testMatch: "integration.spec.js",
  timeout: 30000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  retries: 0,
  globalSetup: "./tests/e2e/global-setup.js",
  globalTeardown: "./tests/e2e/global-teardown.js",
  use: {
    headless: true,
    baseURL: BASE_URL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    viewport: { width: 1280, height: 800 },
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
  ],
});
