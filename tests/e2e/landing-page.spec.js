// @ts-check

const { test, expect } = require("@playwright/test");

test.describe("Landing page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("shows the hero title", async ({ page }) => {
    await expect(page.getByText("Create crossword puzzles with AI")).toBeVisible();
  });

  test("shows the hero subtitle describing the product", async ({ page }) => {
    await expect(
      page.getByText("Enter any topic and let a large language model"),
    ).toBeVisible();
  });

  test("shows the 'Try a pre-built puzzle' button", async ({ page }) => {
    await expect(page.getByRole("button", { name: "Try a pre-built puzzle" })).toBeVisible();
  });

  test("shows the 'Sign in to generate' button", async ({ page }) => {
    await expect(page.getByRole("button", { name: "Sign in to generate" })).toBeVisible();
  });

  test("shows three feature cards", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Any topic" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Instant generation" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Interactive solving" })).toBeVisible();
  });

  test("feature cards have descriptions", async ({ page }) => {
    await expect(page.getByText("Greek gods, space exploration")).toBeVisible();
    await expect(page.getByText("Puzzles are generated in seconds")).toBeVisible();
    await expect(page.getByText("Type answers directly")).toBeVisible();
  });

  test("puzzle view is hidden on initial load", async ({ page }) => {
    await expect(page.locator("#puzzleView")).toBeHidden();
  });

  test("clicking 'Try a pre-built puzzle' navigates to puzzle view", async ({ page }) => {
    await page.getByRole("button", { name: "Try a pre-built puzzle" }).click();
    await expect(page.locator("#puzzleView")).toBeVisible();
    await expect(page.locator("#landingPage")).toBeHidden();
  });

  test("puzzle view shows Pre-built tab as active after clicking try", async ({ page }) => {
    await page.getByRole("button", { name: "Try a pre-built puzzle" }).click();
    var prebuiltTab = page.getByRole("tab", { name: "Pre-built" });
    await expect(prebuiltTab).toBeVisible();
  });

  test("back button returns to landing page from puzzle view", async ({ page }) => {
    await page.getByRole("button", { name: "Try a pre-built puzzle" }).click();
    await expect(page.locator("#puzzleView")).toBeVisible();
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.locator("#landingPage")).toBeVisible();
    await expect(page.locator("#puzzleView")).toBeHidden();
  });

  test("page title is set", async ({ page }) => {
    await expect(page).toHaveTitle(/LLM Crossword/);
  });
});
