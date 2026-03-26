// @ts-check
// Blackbox integration tests against the real dockerized site.
// Docker compose is started/stopped by global-setup.js / global-teardown.js.
// Tests verify what the USER sees — visible text and screenshot comparisons.

const { test, expect } = require("@playwright/test");

test.describe("Landing page", () => {
  test("renders hero, CTAs, and feature cards", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Create crossword puzzles with AI")).toBeVisible();
    await expect(page.getByRole("button", { name: "Try a pre-built puzzle" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in to generate" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Any topic" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Instant generation" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Interactive solving" })).toBeVisible();
    await expect(page).toHaveScreenshot("landing.png", { maxDiffPixelRatio: 0.05 });
  });
});

test.describe("Header and footer", () => {
  test("header has brand on the left", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    await page.waitForTimeout(3000);
    await expect(page.getByRole("link", { name: "LLM Crossword" })).toBeVisible();
    await expect(page).toHaveScreenshot("header-footer.png", { maxDiffPixelRatio: 0.05 });
  });
});

test.describe("Pre-built puzzle", () => {
  test("clicking 'Try a pre-built puzzle' shows crossword", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Try a pre-built puzzle" }).click();
    // Wait for puzzle to render.
    await page.waitForTimeout(3000);
    await expect(page).toHaveScreenshot("after-try-prebuilt-click.png", { maxDiffPixelRatio: 0.05 });
  });
});

test.describe("Generate tab — unauthenticated", () => {
  test("shows disabled generate button and login prompt", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Try a pre-built puzzle" }).click();
    await page.waitForTimeout(1000);
    // Try switching to generate tab.
    var genTab = page.getByRole("tab", { name: "Generate" });
    if (await genTab.isVisible()) {
      await genTab.click();
    }
    await page.waitForTimeout(500);
    await expect(page).toHaveScreenshot("generate-logged-out.png", { maxDiffPixelRatio: 0.05 });
  });
});
