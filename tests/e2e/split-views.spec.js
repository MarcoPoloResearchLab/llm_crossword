// @ts-check
// Tests for the split generation/solving views (Option C).
// Generate form lives on the landing page; solver view is clean.

const { test, expect } = require("./coverage-fixture");
const { setupLoggedInRoutes, setupLoggedOutRoutes, json } = require("./route-helpers");

const testPuzzleData = [
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
];

test.describe("Landing page — auth-based routing", () => {
  test("logged-out user sees landing page", async ({ page }) => {
    await setupLoggedOutRoutes(page, { puzzles: testPuzzleData });
    await page.goto("/");
    await expect(page.locator("#landingPage")).toBeVisible({ timeout: 3000 });
    await expect(page.locator("#puzzleView")).toBeHidden();
  });

});

test.describe("Solver view — no tabs", () => {
  test("solver view has no mode tabs", async ({ page }) => {
    await setupLoggedOutRoutes(page, { puzzles: testPuzzleData });
    await page.goto("/");
    await page.getByRole("button", { name: "Try a pre-built puzzle" }).click();
    await expect(page.locator("#puzzleView")).toBeVisible({ timeout: 5000 });
    // There should be NO tab elements in the solver view
    await expect(page.locator(".mode-tabs")).toHaveCount(0);
    await expect(page.locator("[role='tab']")).toHaveCount(0);
  });

  test("solver view shows puzzle cards in sidebar for pre-built puzzles", async ({ page }) => {
    await setupLoggedOutRoutes(page, { puzzles: testPuzzleData });
    await page.goto("/");
    await page.getByRole("button", { name: "Try a pre-built puzzle" }).click();
    await expect(page.locator("#puzzleView")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("#puzzleCardList .puzzle-card").first()).toBeVisible();
  });

  test("solver sidebar collapses to a sliver and expands back", async ({ page }) => {
    await setupLoggedOutRoutes(page, { puzzles: testPuzzleData });
    await page.goto("/");
    await page.getByRole("button", { name: "Try a pre-built puzzle" }).click();

    const sidebar = page.locator("#puzzleSidebar");
    const firstCard = page.locator("#puzzleCardList .puzzle-card").first();

    await expect(sidebar).toBeVisible({ timeout: 5000 });
    await expect(firstCard).toBeVisible();

    const expandedWidth = await sidebar.evaluate((element) => element.getBoundingClientRect().width);
    expect(expandedWidth).toBeGreaterThan(200);

    await page.getByRole("button", { name: "Collapse puzzle list" }).click();

    await expect(page.locator("#puzzleView")).toHaveAttribute("data-sidebar-collapsed", "true");
    await expect(firstCard).toBeHidden();

    await expect
      .poll(async () => sidebar.evaluate((element) => element.getBoundingClientRect().width))
      .toBeLessThan(40);

    await page.getByRole("button", { name: "Expand puzzle list" }).click();

    await expect(page.locator("#puzzleView")).toHaveAttribute("data-sidebar-collapsed", "false");
    await expect(firstCard).toBeVisible();

    await expect
      .poll(async () => sidebar.evaluate((element) => element.getBoundingClientRect().width))
      .toBeGreaterThan(200);
  });

  test("solver view shows grid and clues", async ({ page }) => {
    await setupLoggedOutRoutes(page, { puzzles: testPuzzleData });
    await page.goto("/");
    await page.getByRole("button", { name: "Try a pre-built puzzle" }).click();
    await expect(page.locator("#grid")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("#puzzleView").getByText("Across")).toBeVisible();
    await expect(page.locator("#puzzleView").getByText("Down")).toBeVisible();
  });

  test("solver view hides the description header for puzzles without descriptions", async ({ page }) => {
    await setupLoggedOutRoutes(page, { puzzles: testPuzzleData });
    await page.goto("/");
    await page.getByRole("button", { name: "Try a pre-built puzzle" }).click();
    await expect(page.locator("#descriptionPanel")).toBeHidden();
  });

  test("solver view keeps Check, Reveal, and Share visible", async ({ page }) => {
    await setupLoggedOutRoutes(page, { puzzles: testPuzzleData });
    await page.goto("/");
    await page.getByRole("button", { name: "Try a pre-built puzzle" }).click();
    await expect(page.locator("#puzzleView")).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole("button", { name: "Check" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Reveal" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Share" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Share" })).toBeDisabled();
  });

  test("generate form is hidden in solver when logged out", async ({ page }) => {
    await setupLoggedOutRoutes(page, { puzzles: testPuzzleData });
    await page.goto("/");
    await page.getByRole("button", { name: "Try a pre-built puzzle" }).click();
    await expect(page.locator("#puzzleView")).toBeVisible({ timeout: 5000 });
    // The generate panel exists but is hidden when not logged in
    await expect(page.locator("#generatePanel")).toBeHidden();
  });
});

test.describe("Generate flow — landing to solver", () => {
  test("successful generation navigates to solver view", async ({ page }) => {
    var generatePuzzles = [
      {
        title: "Test Puzzle",
        subtitle: "A test.",
        items: [
          { word: "orbit", definition: "Path", hint: "route" },
          { word: "lunar", definition: "Moon", hint: "Earth companion" },
          { word: "tides", definition: "Waves", hint: "shoreline" },
          { word: "mare", definition: "Sea", hint: "dark area" },
          { word: "apollo", definition: "Program", hint: "NASA" },
        ],
      },
    ];
    await setupLoggedInRoutes(page, {
      puzzles: generatePuzzles,
      extra: {
        "**/api/generate": (route) =>
          route.fulfill(json(200, {
            items: [
              { word: "zeus", definition: "King of the gods", hint: "thunderbolt wielder" },
              { word: "athena", definition: "Goddess of wisdom", hint: "owl companion" },
              { word: "apollo", definition: "God of the sun", hint: "lyre player" },
              { word: "ares", definition: "God of war", hint: "battlefield deity" },
              { word: "hera", definition: "Queen of the gods", hint: "Zeus's wife" },
            ],
            title: "Greek Gods",
            subtitle: "Zeus, Athena, Apollo, Ares, and Hera define a tightly focused Olympian clue set.",
            description: "This puzzle concentrates on major Olympian deities and the traits, symbols, and relationships that make their mythology easy to recognize.",
            balance: { coins: 10 },
          })),
      },
    });
    await page.goto("/");
    // Logged-in user sees puzzle view; click New Crossword to show generate form
    await expect(page.locator("#puzzleView")).toBeVisible({ timeout: 5000 });
    await page.locator("#newCrosswordCard").click();
    await expect(page.locator("#generateBtn")).toBeEnabled({ timeout: 5000 });
    // Fill topic and generate
    await page.locator("#topicInput").fill("Greek Gods");
    await page.locator("#generateBtn").click();
    // Should navigate to solver view
    await expect(page.locator("#puzzleView")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("#landingPage")).toBeHidden();
    // Solver should show the generated puzzle title
    await expect(page.locator("#title")).toContainText("Greek Gods");
    await expect(page.locator("#subtitle")).toContainText("Olympian clue set");
    await expect(page.locator("#descriptionPanel")).toBeVisible();
    await expect(page.locator("#descriptionContent")).toContainText("major Olympian deities");
    var layout = await page.evaluate(() => {
      var title = document.getElementById("title");
      var clues = document.querySelector("#puzzleView .clues");
      if (!title || !clues) return null;
      return {
        titleTop: title.getBoundingClientRect().top,
        cluesTop: clues.getBoundingClientRect().top,
      };
    });
    expect(layout).not.toBeNull();
    expect(Math.abs(layout.cluesTop - layout.titleTop)).toBeLessThanOrEqual(8);
    // Generate panel should be hidden after successful generation
    await expect(page.locator("#generatePanel")).toBeHidden();
  });
});
