// @ts-check

const { test, expect } = require("./coverage-fixture");

test.describe("Header — rendered content", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    // Wait for mpr-ui orchestration to complete.
    await page.waitForTimeout(2000);
  });

  test("renders a visible <header> element with the mpr-header class", async ({ page }) => {
    var rendered = page.locator("header.mpr-header");
    await expect(rendered).toBeVisible();
  });

  test("header contains the brand text 'LLM Crossword' as a clickable link", async ({ page }) => {
    var brandLink = page.locator("header.mpr-header a").filter({ hasText: "LLM Crossword" });
    await expect(brandLink).toBeVisible();
  });

  test("header renders a Google sign-in button when not authenticated", async ({ page }) => {
    // The rendered header should contain a Google sign-in iframe or button element.
    var signinArea = page.locator("header.mpr-header [data-mpr-header='google-signin']");
    await expect(signinArea).toBeVisible();
  });

  test("header has a visible background (not transparent)", async ({ page }) => {
    var header = page.locator("header.mpr-header");
    var bg = await header.evaluate(function (el) {
      return window.getComputedStyle(el).backgroundColor;
    });
    // Should not be fully transparent.
    expect(bg).not.toBe("rgba(0, 0, 0, 0)");
    expect(bg).not.toBe("transparent");
  });

  test("header has non-zero height (actually rendered, not collapsed)", async ({ page }) => {
    var header = page.locator("header.mpr-header");
    var box = await header.boundingBox();
    expect(box).not.toBeNull();
    expect(box.height).toBeGreaterThan(30);
  });

  test("header persists across landing and puzzle views", async ({ page }) => {
    await expect(page.locator("header.mpr-header")).toBeVisible();
    await page.getByRole("button", { name: "Try a pre-built puzzle" }).click();
    await expect(page.locator("header.mpr-header")).toBeVisible();
  });
});

test.describe("Footer — rendered content", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);
  });

  test("renders a visible <footer> element with the mpr-footer class", async ({ page }) => {
    var rendered = page.locator("footer.mpr-footer");
    await expect(rendered).toBeVisible();
  });

  test("footer contains 'Privacy' link text", async ({ page }) => {
    await expect(page.locator("footer.mpr-footer").getByText("Privacy")).toBeVisible();
  });

  test("footer contains theme switcher toggle", async ({ page }) => {
    // The theme toggle is a button or switch inside the footer.
    var toggle = page.locator("footer.mpr-footer [data-mpr-footer='theme-toggle'], footer.mpr-footer button").first();
    await expect(toggle).toBeVisible();
  });

  test("footer contains 'Built by Marco Polo Research Lab' text", async ({ page }) => {
    await expect(page.locator("footer.mpr-footer").getByRole("button", { name: "Built by Marco Polo Research Lab" })).toBeVisible();
  });

  test("footer has non-zero height (actually rendered)", async ({ page }) => {
    var footer = page.locator("footer.mpr-footer");
    var box = await footer.boundingBox();
    expect(box).not.toBeNull();
    expect(box.height).toBeGreaterThan(20);
  });

  test("footer persists across landing and puzzle views", async ({ page }) => {
    await expect(page.locator("footer.mpr-footer")).toBeVisible();
    await page.getByRole("button", { name: "Try a pre-built puzzle" }).click();
    await expect(page.locator("footer.mpr-footer")).toBeVisible();
  });
});
