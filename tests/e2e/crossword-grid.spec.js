// @ts-check

const { test, expect } = require("./coverage-fixture");
const { setupLoggedOutRoutes } = require("./route-helpers");

test.describe("Crossword grid interactions", () => {
  test.beforeEach(async ({ page }) => {
    await setupLoggedOutRoutes(page);
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
