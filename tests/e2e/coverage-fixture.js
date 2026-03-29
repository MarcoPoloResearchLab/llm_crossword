const { test: base, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");

const NYC_OUTPUT = path.join(__dirname, "../../.nyc_output");

const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    await use(page);
    // Collect coverage after test
    try {
      const coverage = await page.evaluate(() => window.__coverage__);
      if (coverage) {
        if (!fs.existsSync(NYC_OUTPUT)) fs.mkdirSync(NYC_OUTPUT, { recursive: true });
        const file = path.join(NYC_OUTPUT, `cov-${testInfo.testId}.json`);
        fs.writeFileSync(file, JSON.stringify(coverage));
      }
    } catch (_) {}
  },
});

module.exports = { test, expect };
