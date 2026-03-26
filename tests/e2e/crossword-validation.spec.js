// @ts-check

const { test, expect } = require("./coverage-fixture");

function setupMocks(page) {
  return page.addInitScript(() => {
    window.__testOverrides = {
      fetch: function (url, opts) {
        if (url === "/me") return Promise.resolve({ ok: false, status: 401 });
        if (typeof url === "string" && url.includes("config.yaml")) return Promise.resolve({ ok: true, text: () => Promise.resolve("") });
        if (typeof url === "string" && url.includes("crosswords.json"))
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve([
                {
                  title: "Test Puzzle",
                  subtitle: "A test puzzle.",
                  items: [
                    { word: "orbit", definition: "The Moon's path around Earth", hint: "elliptical route" },
                    { word: "mare", definition: "A lunar sea", hint: "shares name with horse" },
                    { word: "tides", definition: "Ocean rise-and-fall", hint: "regular shoreline shifts" },
                    { word: "lunar", definition: "Relating to the Moon", hint: "Earth's companion" },
                    { word: "apollo", definition: "Program that took humans to the Moon", hint: "Saturn V missions" },
                  ],
                },
              ]),
          });
        return Promise.resolve({ ok: false, status: 404 });
      },
    };
  });
}

test.describe("Crossword validation — edge cases", () => {
  test.beforeEach(async ({ page }) => {
    await setupMocks(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Try a pre-built puzzle" }).click();
    await expect(page.getByText("Across")).toBeVisible({ timeout: 10000 });
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
