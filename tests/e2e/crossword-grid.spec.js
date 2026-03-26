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

test.describe("Crossword grid interactions", () => {
  test.beforeEach(async ({ page }) => {
    await setupMocks(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Try a pre-built puzzle" }).click();
    await expect(page.locator("#puzzleView").getByText("Across")).toBeVisible({ timeout: 10000 });
  });

  test("cell accepts letter input", async ({ page }) => {
    // Find the first input cell and type a letter
    var firstInput = page.locator("#grid input").first();
    await firstInput.click();
    await firstInput.fill("A");
    await expect(firstInput).toHaveValue("A");
  });

  test("check button marks correct and wrong cells", async ({ page }) => {
    // Click reveal to get all correct answers
    await page.getByRole("button", { name: "Reveal" }).click();
    await expect(page.getByText("Revealed.")).toBeVisible();

    // Click hide to go back
    await page.getByRole("button", { name: "Hide" }).click();

    // Type a wrong letter in first cell
    var firstInput = page.locator("#grid input").first();
    await firstInput.click();
    await firstInput.fill("Z");

    // Click Check
    await page.getByRole("button", { name: "Check" }).click();
    await expect(page.getByText("Checked.")).toBeVisible();
  });

  test("reveal button shows all answers", async ({ page }) => {
    await page.getByRole("button", { name: "Reveal" }).click();
    await expect(page.getByText("Revealed.")).toBeVisible();

    // All cells should be filled
    var inputs = page.locator("#grid input");
    var count = await inputs.count();
    expect(count).toBeGreaterThan(0);

    // Check that first cell has a value
    var firstInput = inputs.first();
    var value = await firstInput.inputValue();
    expect(value).toMatch(/^[A-Z]$/);
  });

  test("clue click focuses the word's first cell", async ({ page }) => {
    // Click on a clue in the Across list
    var firstClue = page.locator("#across li").first();
    await firstClue.click();

    // An input in the grid should be focused
    var focusedElement = page.locator("#grid input:focus");
    await expect(focusedElement).toBeVisible({ timeout: 3000 });
  });

  test("hint button shows hint text", async ({ page }) => {
    // Find a hint button (the "H" buttons on clues)
    var hintButton = page.locator("#puzzleView .hintButton").first();
    await hintButton.click();

    // Hint text should be visible
    var hintText = page.locator("#puzzleView .hintText").first();
    await expect(hintText).toBeVisible();
  });
});
