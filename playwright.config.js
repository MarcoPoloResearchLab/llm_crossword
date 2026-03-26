const { defineConfig } = require("@playwright/test");
const BASE_URL = process.env.LLM_CROSSWORD_BASE_URL || "http://localhost:8111";

module.exports = defineConfig({
  testDir: "tests/e2e",
  timeout: 30000,
  expect: { timeout: 10000 },
  fullyParallel: true,
  retries: 0,
  use: {
    baseURL: BASE_URL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node scripts/test-server.js",
    port: 8111,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
  ],
});
