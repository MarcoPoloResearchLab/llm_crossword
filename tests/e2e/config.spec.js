// @ts-check

const { test, expect } = require("./coverage-fixture");

test.describe("Config — default behavior", () => {
  test("header has base-url set to origin", async ({ page }) => {
    await page.addInitScript(() => {
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
    await page.goto("/");
    // The inline script in index.html sets base-url on the header to current origin.
    // Verify the header is present and the page loads correctly.
    await expect(page.locator("mpr-header")).toBeVisible();
    // base-url should be set by the inline script
    var baseUrl = await page.locator("mpr-header").getAttribute("base-url");
    expect(baseUrl).toBeTruthy();
  });
});

test.describe("Config — fetch failure", () => {
  test("page still works when config fetch fails (fallback)", async ({ page }) => {
    await page.addInitScript(() => {
      window.__testOverrides = {
        fetch: function (url, opts) {
          if (url === "/me") return Promise.resolve({ ok: false, status: 401 });
          if (typeof url === "string" && url.includes("config.yaml")) return Promise.reject(new Error("network failure"));
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
    await page.goto("/");
    // Page should still load and function despite config.yaml fetch failure
    await expect(page.locator("mpr-header")).toBeVisible();
    await expect(page.getByText("Create crossword puzzles with AI")).toBeVisible();
    // Puzzles should still work
    await page.getByRole("button", { name: "Try a pre-built puzzle" }).click();
    await expect(page.getByText("Across")).toBeVisible({ timeout: 10000 });
  });
});
