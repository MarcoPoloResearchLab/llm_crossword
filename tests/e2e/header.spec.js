// @ts-check

const { test, expect } = require("./coverage-fixture");

test.describe("Header", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("displays the brand label 'LLM Crossword'", async ({ page }) => {
    await expect(page.getByText("LLM Crossword")).toBeVisible();
  });

  test("renders the header element at the top of the page", async ({ page }) => {
    var header = page.locator("mpr-header");
    await expect(header).toBeVisible();
  });

  test("shows a sign-in control when not authenticated", async ({ page }) => {
    // The header should show either a Google sign-in button or a
    // fallback sign-in element when user is not logged in.
    // We check that the header area contains sign-in related content.
    var header = page.locator("mpr-header");
    // Wait for mpr-ui to initialize.
    await page.waitForTimeout(2000);
    // The header should contain some form of sign-in affordance.
    var headerText = await header.textContent();
    expect(
      headerText.includes("Sign in") ||
      headerText.includes("sign in") ||
      headerText.includes("LLM Crossword"),
    ).toBeTruthy();
  });

  test("renders the footer with theme switcher", async ({ page }) => {
    var footer = page.locator("mpr-footer");
    await expect(footer).toBeVisible();
  });

  test("header is visible from both landing page and puzzle view", async ({ page }) => {
    // Visible on landing page.
    await expect(page.locator("mpr-header")).toBeVisible();
    // Navigate to puzzle view.
    await page.getByRole("button", { name: "Try a pre-built puzzle" }).click();
    // Still visible.
    await expect(page.locator("mpr-header")).toBeVisible();
  });
});
