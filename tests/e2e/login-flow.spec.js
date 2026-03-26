// @ts-check

const { test, expect } = require("@playwright/test");

test.describe("Login flow — unauthenticated state", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("generate tab shows 'Log in to generate puzzles' message when not signed in", async ({ page }) => {
    // Navigate to puzzle view and switch to generate tab.
    await page.getByRole("button", { name: "Try a pre-built puzzle" }).click();
    await page.getByRole("tab", { name: "Generate" }).click();
    await expect(page.getByText("Log in to generate puzzles")).toBeVisible();
  });

  test("generate button shows 'Generate' without credits when not signed in", async ({ page }) => {
    await page.getByRole("button", { name: "Try a pre-built puzzle" }).click();
    await page.getByRole("tab", { name: "Generate" }).click();
    var genBtn = page.locator("#generateBtn");
    await expect(genBtn).toBeVisible();
    await expect(genBtn).toContainText("Generate");
    await expect(genBtn).toBeDisabled();
  });

  test("credit badge is hidden when not signed in", async ({ page }) => {
    await page.getByRole("button", { name: "Try a pre-built puzzle" }).click();
    await page.getByRole("tab", { name: "Generate" }).click();
    await expect(page.locator("#creditBalance")).toBeHidden();
  });

  test("topic input is visible in generate tab", async ({ page }) => {
    await page.getByRole("button", { name: "Try a pre-built puzzle" }).click();
    await page.getByRole("tab", { name: "Generate" }).click();
    await expect(page.getByPlaceholder("Enter a topic")).toBeVisible();
  });

  test("word count selector is visible in generate tab", async ({ page }) => {
    await page.getByRole("button", { name: "Try a pre-built puzzle" }).click();
    await page.getByRole("tab", { name: "Generate" }).click();
    await expect(page.getByText("Words:")).toBeVisible();
  });
});

test.describe("Login flow — mode switching", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Try a pre-built puzzle" }).click();
  });

  test("Pre-built tab shows puzzle selector", async ({ page }) => {
    await expect(page.getByText("Choose puzzle:")).toBeVisible();
  });

  test("switching to Generate tab hides puzzle selector", async ({ page }) => {
    await page.getByRole("tab", { name: "Generate" }).click();
    await expect(page.getByText("Choose puzzle:")).toBeHidden();
    await expect(page.getByPlaceholder("Enter a topic")).toBeVisible();
  });

  test("switching back to Pre-built tab restores puzzle selector", async ({ page }) => {
    await page.getByRole("tab", { name: "Generate" }).click();
    await page.getByRole("tab", { name: "Pre-built" }).click();
    await expect(page.getByText("Choose puzzle:")).toBeVisible();
    await expect(page.getByPlaceholder("Enter a topic")).toBeHidden();
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
