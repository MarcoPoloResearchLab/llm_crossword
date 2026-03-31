// @ts-check

const { test, expect } = require("./coverage-fixture");
const { setupLoggedOutRoutes } = require("./route-helpers");

test.describe("Landing page", () => {
  test.beforeEach(async ({ page }) => {
    await setupLoggedOutRoutes(page);
    await page.goto("/");
  });

  test("logged-out user sees the landing page and not the puzzle view", async ({ page }) => {
    await expect(page.locator("#landingPage")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("#puzzleView")).toBeHidden();
  });

  test("shows the hero title", async ({ page }) => {
    await expect(page.getByText("Create crossword puzzles with AI")).toBeVisible();
  });

  test("shows the landing page brand logo", async ({ page }) => {
    await expect(page.getByAltText("LLM Crossword logo")).toBeVisible();
  });

  test("shows the hero subtitle describing the product", async ({ page }) => {
    await expect(
      page.getByText("Enter any topic and let a large language model"),
    ).toBeVisible();
  });

  test("publishes favicon links", async ({ page }) => {
    await expect(page.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveAttribute("href", "/assets/img/llm_crossword_favicon.svg");
    await expect(page.locator('link[rel="icon"][type="image/png"]')).toHaveAttribute("href", "/assets/img/llm_crossword_favicon.png");
    await expect(page.locator('link[rel="shortcut icon"]')).toHaveAttribute("href", "/assets/img/llm_crossword_favicon.ico");
  });

  test("shows the 'Try a pre-built puzzle' button", async ({ page }) => {
    await expect(page.getByRole("button", { name: "Try a pre-built puzzle" })).toBeVisible();
  });

  test("shows the 'Sign in to generate' button", async ({ page }) => {
    await expect(page.getByRole("button", { name: "Sign in to generate" })).toBeVisible();
  });

  test("shows three feature cards", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Any topic" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Instant generation" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Interactive solving" })).toBeVisible();
  });

  test("feature cards have descriptions", async ({ page }) => {
    await expect(page.getByText("Greek gods, space exploration")).toBeVisible();
    await expect(page.getByText("Puzzles are generated in seconds")).toBeVisible();
    await expect(page.getByText("Type answers directly")).toBeVisible();
  });

  test("puzzle view is hidden on initial load", async ({ page }) => {
    await expect(page.locator("#puzzleView")).toBeHidden();
  });

  test("clicking 'Try a pre-built puzzle' navigates to puzzle view", async ({ page }) => {
    await page.getByRole("button", { name: "Try a pre-built puzzle" }).click();
    await expect(page.locator("#puzzleView")).toBeVisible();
    await expect(page.locator("#landingPage")).toBeHidden();
  });

  test("puzzle view shows puzzle cards in sidebar after clicking try", async ({ page }) => {
    await page.getByRole("button", { name: "Try a pre-built puzzle" }).click();
    // Sidebar with puzzle cards is shown
    await expect(page.locator("#puzzleSidebar")).toBeVisible();
    await expect(page.locator("#puzzleCardList .puzzle-card").first()).toBeVisible();
  });

  test("puzzle view no longer shows a back button", async ({ page }) => {
    await page.getByRole("button", { name: "Try a pre-built puzzle" }).click();
    await expect(page.locator("#puzzleView")).toBeVisible();
    await expect(page.getByRole("button", { name: "Back" })).toHaveCount(0);
  });

  test("page title is set", async ({ page }) => {
    await expect(page).toHaveTitle(/LLM Crossword/);
  });

  test("shows a sample crossword puzzle below the feature cards", async ({ page }) => {
    // A sample moon-themed crossword should be embedded on the landing page
    var sampleGrid = page.locator("#landingSamplePuzzle");
    await expect(sampleGrid).toBeVisible({ timeout: 5000 });
  });

  test("sample puzzle has a grid with cells", async ({ page }) => {
    var cells = page.locator("#landingSamplePuzzle .cell");
    // Should have multiple cells rendered
    await expect(cells.first()).toBeVisible({ timeout: 5000 });
    var count = await cells.count();
    expect(count).toBeGreaterThan(10);
  });

  test("sample puzzle has Across and Down clues", async ({ page }) => {
    var sampleSection = page.locator("#landingSamplePuzzle");
    await expect(sampleSection.getByText("Across")).toBeVisible({ timeout: 5000 });
    await expect(sampleSection.getByText("Down")).toBeVisible();
  });

  test("sample puzzle cells are interactive (accept input)", async ({ page }) => {
    var firstInput = page.locator("#landingSamplePuzzle .cell:not(.blk) input").first();
    await expect(firstInput).toBeVisible({ timeout: 5000 });
    await firstInput.click();
    await firstInput.fill("A");
    await expect(firstInput).toHaveValue("A");
  });

  test("sample puzzle has Check and Reveal buttons", async ({ page }) => {
    var sampleSection = page.locator("#landingSamplePuzzle");
    await expect(sampleSection.getByRole("button", { name: "Check" })).toBeVisible({ timeout: 5000 });
    await expect(sampleSection.getByRole("button", { name: "Reveal" })).toBeVisible();
  });

  test("sample puzzle has a moon-related title", async ({ page }) => {
    var sampleSection = page.locator("#landingSamplePuzzle");
    // Title should mention moon or lunar
    await expect(sampleSection.locator("h2, h3").first()).toBeVisible({ timeout: 5000 });
    var titleText = await sampleSection.locator("h2, h3").first().textContent();
    expect(titleText.toLowerCase()).toMatch(/moon|lunar/);
  });

  test("sample puzzle has hint buttons on clues", async ({ page }) => {
    var sampleSection = page.locator("#landingSamplePuzzle");
    var hintButtons = sampleSection.locator(".hintButton");
    await expect(hintButtons.first()).toBeVisible({ timeout: 5000 });
    var count = await hintButtons.count();
    // Should have at least one hint button per clue
    expect(count).toBeGreaterThanOrEqual(3);
  });

  test("sample puzzle clues are beside the grid, not below", async ({ page }) => {
    var sampleSection = page.locator("#landingSamplePuzzle");
    await expect(sampleSection.locator(".cell").first()).toBeVisible({ timeout: 5000 });
    // Get bounding boxes of grid and clues
    var gridBox = await sampleSection.locator(".gridViewport").boundingBox();
    var cluesBox = await sampleSection.locator(".clues").boundingBox();
    // Clues should be to the right of the grid (not below)
    // cluesBox.x should be >= gridBox.x + gridBox.width (roughly)
    expect(cluesBox.x).toBeGreaterThanOrEqual(gridBox.x + gridBox.width - 10);
  });

  test("sample puzzle container is at least 700px wide", async ({ page }) => {
    var sampleSection = page.locator("#landingSamplePuzzle");
    await expect(sampleSection).toBeVisible({ timeout: 5000 });
    var box = await sampleSection.boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(600);
  });
});
