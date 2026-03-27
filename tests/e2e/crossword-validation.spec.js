// @ts-check

const { test, expect } = require("./coverage-fixture");
const { setupLoggedOutRoutes } = require("./route-helpers");

test.describe("Crossword validation — edge cases", () => {
  test.beforeEach(async ({ page }) => {
    await setupLoggedOutRoutes(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Try a pre-built puzzle" }).click();
    await expect(page.locator("#puzzleView").getByText("Across")).toBeVisible({ timeout: 10000 });
  });

  test("missing entries shows error", async ({ page }) => {
    await page.evaluate(() => {
      window.CrosswordApp.render({ title: "Bad", subtitle: "", entries: [], overlaps: [] });
    });
    var errorBox = page.locator("#errorBox");
    await expect(errorBox).toBeVisible();
    await expect(errorBox).toContainText("entries[]");
  });

  test("duplicate id shows error", async ({ page }) => {
    await page.evaluate(() => {
      window.CrosswordApp.render({
        title: "Dup",
        subtitle: "",
        entries: [
          { id: "W0", dir: "across", row: 0, col: 0, answer: "AB", clue: "test", hint: "test" },
          { id: "W0", dir: "down", row: 0, col: 0, answer: "AC", clue: "test2", hint: "test2" },
        ],
        overlaps: [],
      });
    });
    var errorBox = page.locator("#errorBox");
    await expect(errorBox).toBeVisible();
    await expect(errorBox).toContainText("Duplicate id");
  });

  test("invalid dir shows error", async ({ page }) => {
    await page.evaluate(() => {
      window.CrosswordApp.render({
        title: "Bad Dir",
        subtitle: "",
        entries: [
          { id: "W0", dir: "diagonal", row: 0, col: 0, answer: "AB", clue: "test", hint: "test" },
        ],
        overlaps: [],
      });
    });
    var errorBox = page.locator("#errorBox");
    await expect(errorBox).toBeVisible();
    await expect(errorBox).toContainText("Bad dir");
  });
});
