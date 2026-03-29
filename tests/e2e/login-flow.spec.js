// @ts-check

const { test, expect } = require("./coverage-fixture");

test.describe("Login flow — unauthenticated state", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("generate form is hidden when not signed in", async ({ page }) => {
    // Generate form on landing page is hidden when logged out
    await expect(page.locator("#generatePanel")).toBeHidden();
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

  test("puzzle view shows puzzle sidebar with cards", async ({ page }) => {
    await expect(page.locator("#puzzleSidebar")).toBeVisible();
    await expect(page.locator("#puzzleCardList .puzzle-card").first()).toBeVisible({ timeout: 5000 });
  });

  test("puzzle view does not have mode tabs", async ({ page }) => {
    // Mode tabs have been removed from the puzzle view
    await expect(page.locator("#modePrebuilt")).not.toBeAttached();
    await expect(page.locator("#modeGenerate")).not.toBeAttached();
  });

  test("generate form is in puzzle view", async ({ page }) => {
    // Topic input is in the puzzle view (inside generatePanel)
    await expect(page.locator("#puzzleView #topicInput")).toBeAttached();
  });
});

test.describe("Login flow — pre-built puzzles", () => {
  test("pre-built puzzle loads and shows crossword grid", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Try a pre-built puzzle" }).click();
    // Wait for crossword to load.
    await expect(page.locator("#puzzleView").getByText("Across")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("#puzzleView").getByText("Down")).toBeVisible();
  });

  test("pre-built puzzle shows Check and Review buttons in the header", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Try a pre-built puzzle" }).click();
    await expect(page.getByRole("button", { name: "Check" })).toBeVisible({ timeout: 10000 });
    await expect(page.locator("#headerPuzzleTabs")).toBeVisible();
    await expect(page.locator("#reveal")).toHaveText("Review");
  });

  test("puzzle sidebar has cards populated", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Try a pre-built puzzle" }).click();
    // Wait for puzzles to load.
    await page.waitForTimeout(3000);
    var cards = page.locator("#puzzleCardList .puzzle-card");
    var count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });
});
