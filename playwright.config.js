// @ts-check

const { defineConfig } = require("@playwright/test");

const BASE_URL = process.env.LLM_CROSSWORD_BASE_URL || "http://localhost:8000";

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
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
});
