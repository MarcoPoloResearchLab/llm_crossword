// @ts-check

const { test, expect } = require("./coverage-fixture");
const { setupLoggedOutRoutes } = require("./route-helpers");

test.describe("Config — default behavior", () => {
  test("header has base-url set to origin", async ({ page }) => {
    await setupLoggedOutRoutes(page);
    await page.goto("/");
    // The inline script in index.html sets base-url on the header to current origin.
    // mpr-header may be hidden when the mpr-ui component JS hides it for
    // unauthenticated users, so check the attribute rather than visibility.
    var baseUrl = await page.locator("mpr-header").getAttribute("base-url");
    expect(baseUrl).toBeTruthy();
  });
});

test.describe("Config — fetch failure", () => {
  test("page still works when config fetch fails (fallback)", async ({ page }) => {
    await setupLoggedOutRoutes(page, {
      extra: {
        "**/config.yaml": (route) => route.abort("failed"),
      },
    });
    await page.goto("/");
    // Page should still load and function despite config.yaml fetch failure
    await expect(page.getByText("Create crossword puzzles with AI")).toBeVisible();
    // tauth-url should still be set (fallback to same origin)
    var tauthUrl = await page.locator("mpr-header").getAttribute("tauth-url");
    expect(tauthUrl).toBeTruthy();
    // Puzzles should still work
    await page.getByRole("button", { name: "Try a pre-built puzzle" }).click();
    await expect(page.locator("#puzzleView").getByText("Across")).toBeVisible({ timeout: 10000 });
  });
});
