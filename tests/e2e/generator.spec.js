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

test.describe("Generator — valid input", () => {
  test("valid 5-word input produces rendered grid", async ({ page }) => {
    await setupMocks(page);
    await page.goto("/");
    // Wait for page to load
    await page.getByRole("button", { name: "Try a pre-built puzzle" }).click();
    await expect(page.getByText("Across")).toBeVisible({ timeout: 10000 });

    // Generate a crossword in page context and render it
    await page.evaluate(() => {
      var items = [
        { word: "orbit", definition: "Path around Earth", hint: "route" },
        { word: "mare", definition: "Lunar sea", hint: "horse" },
        { word: "tides", definition: "Ocean rise-and-fall", hint: "shifts" },
        { word: "lunar", definition: "Relating to Moon", hint: "companion" },
        { word: "apollo", definition: "Moon program", hint: "missions" },
      ];
      var payload = generateCrossword(items, { title: "Test Grid", subtitle: "Generated in test.", random: function () { return 0.5; } });
      window.CrosswordApp.render(payload);
    });

    // Grid should be rendered with clues
    await expect(page.getByText("Test Grid")).toBeVisible();
    await expect(page.getByText("Across")).toBeVisible();
    await expect(page.getByText("Down")).toBeVisible();
  });
});

test.describe("Generator — error cases", () => {
  test("empty array throws and shows error", async ({ page }) => {
    await setupMocks(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Try a pre-built puzzle" }).click();
    await expect(page.getByText("Across")).toBeVisible({ timeout: 10000 });

    // Try generating with empty array
    var errorMsg = await page.evaluate(() => {
      try {
        generateCrossword([], { title: "Empty" });
        return null;
      } catch (e) {
        return e.message;
      }
    });
    expect(errorMsg).toBeTruthy();
    expect(errorMsg).toContain("No valid words");
  });

  test("all-invalid words throws", async ({ page }) => {
    await setupMocks(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Try a pre-built puzzle" }).click();
    await expect(page.getByText("Across")).toBeVisible({ timeout: 10000 });

    var errorMsg = await page.evaluate(() => {
      try {
        generateCrossword([{ word: "x", definition: "single char", hint: "nope" }], { title: "Invalid" });
        return null;
      } catch (e) {
        return e.message;
      }
    });
    expect(errorMsg).toBeTruthy();
    expect(errorMsg).toContain("No valid words");
  });

  test("filters single-character words", async ({ page }) => {
    await setupMocks(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Try a pre-built puzzle" }).click();
    await expect(page.getByText("Across")).toBeVisible({ timeout: 10000 });

    // Mix of valid and single-char words
    await page.evaluate(() => {
      var items = [
        { word: "a", definition: "single char", hint: "nope" },
        { word: "orbit", definition: "Path around Earth", hint: "route" },
        { word: "b", definition: "single char", hint: "nope" },
        { word: "mare", definition: "Lunar sea", hint: "horse" },
        { word: "tides", definition: "Ocean rise-and-fall", hint: "shifts" },
        { word: "lunar", definition: "Moon-related", hint: "companion" },
        { word: "apollo", definition: "Moon program", hint: "missions" },
      ];
      var payload = generateCrossword(items, { title: "Filtered", subtitle: "Should filter single chars.", random: function () { return 0.5; } });
      window.CrosswordApp.render(payload);
    });

    await expect(page.getByText("Filtered")).toBeVisible();
  });

  test("custom title and subtitle passed through", async ({ page }) => {
    await setupMocks(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Try a pre-built puzzle" }).click();
    await expect(page.getByText("Across")).toBeVisible({ timeout: 10000 });

    await page.evaluate(() => {
      var items = [
        { word: "orbit", definition: "Path around Earth", hint: "route" },
        { word: "mare", definition: "Lunar sea", hint: "horse" },
        { word: "tides", definition: "Ocean rise-and-fall", hint: "shifts" },
        { word: "lunar", definition: "Moon-related", hint: "companion" },
        { word: "apollo", definition: "Moon program", hint: "missions" },
      ];
      var payload = generateCrossword(items, { title: "Custom Title Here", subtitle: "Custom Subtitle Here", random: function () { return 0.5; } });
      window.CrosswordApp.render(payload);
    });

    await expect(page.getByText("Custom Title Here")).toBeVisible();
    await expect(page.getByText("Custom Subtitle Here")).toBeVisible();
  });
});
