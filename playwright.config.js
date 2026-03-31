const { defineConfig } = require("@playwright/test");
const BASE_URL = process.env.LLM_CROSSWORD_BASE_URL || "http://localhost:8111";

module.exports = defineConfig({
  testDir: "tests/e2e",
  testIgnore: ["**/integration.spec.js"],
  timeout: 30000,
  expect: { timeout: 10000 },
  fullyParallel: true,
  retries: 0,
  use: {
    headless: true,
    baseURL: BASE_URL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "RUNTIME_AUTH_CONFIG_PATH=js/runtime-auth-config.override.js bash scripts/render-runtime-auth-config.sh && node scripts/test-server.js",
    port: 8111,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
  ],
});
