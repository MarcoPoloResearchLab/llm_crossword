// @ts-check

const { test, expect } = require("./coverage-fixture");

test.describe("Login flow — unauthenticated state", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("generate form is hidden when not signed in", async ({ page }) => {
    // Generate form on landing page is hidden when logged out
    await expect(page.locator("#landingGenerateForm")).toBeHidden();
  });

  test("generate button shows 'Generate' without credits when not signed in", async ({ page }) => {
    var genBtn = page.locator("#generateBtn");
    await expect(genBtn).toContainText("Generate");
    await expect(genBtn).toBeDisabled();
  });

  test("credit badge is hidden when not signed in", async ({ page }) => {
    await expect(page.locator("#headerCreditBadge")).toBeHidden();
  });

  test("topic input exists on landing page inside generate form", async ({ page }) => {
    // The input exists but is hidden because the generate form is hidden when logged out
    await expect(page.locator("#topicInput")).toBeAttached();
  });

  test("word count selector exists on landing page inside generate form", async ({ page }) => {
    // The selector exists but is hidden because the generate form is hidden when logged out
    await expect(page.locator("#wordCount")).toBeAttached();
  });
});

test.describe("Login flow — puzzle view", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Try a pre-built puzzle" }).click();
  });

  test("puzzle view shows puzzle selector", async ({ page }) => {
    await expect(page.getByText("Choose puzzle:")).toBeVisible();
  });

  test("puzzle view does not have mode tabs", async ({ page }) => {
    // Mode tabs have been removed from the puzzle view
    await expect(page.locator("#modePrebuilt")).not.toBeAttached();
    await expect(page.locator("#modeGenerate")).not.toBeAttached();
  });

  test("generate form is on landing page, not puzzle view", async ({ page }) => {
    // Topic input is on the landing page (hidden), not in puzzle view
    await expect(page.locator("#landingPage #topicInput")).toBeAttached();
  });
});

test.describe("Login flow — pre-built puzzles", () => {
  test("pre-built puzzle loads and shows crossword grid", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Try a pre-built puzzle" }).click();
    // Wait for crossword to load.
    await expect(page.getByText("Across")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Down")).toBeVisible();
  });

  test("pre-built puzzle shows Check and Reveal buttons", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Try a pre-built puzzle" }).click();
    await expect(page.getByRole("button", { name: "Check" })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole("button", { name: "Reveal" })).toBeVisible();
  });

  test("puzzle selector has options populated", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Try a pre-built puzzle" }).click();
    // Wait for puzzles to load.
    await page.waitForTimeout(3000);
    var select = page.locator("#puzzleSelect");
    var options = select.locator("option");
    var count = await options.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });
});
