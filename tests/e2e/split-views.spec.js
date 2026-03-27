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

  test("solver view shows grid and clues", async ({ page }) => {
    await setupLoggedOutRoutes(page, { puzzles: testPuzzleData });
    await page.goto("/");
    await page.getByRole("button", { name: "Try a pre-built puzzle" }).click();
    await expect(page.locator("#grid")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("#puzzleView").getByText("Across")).toBeVisible();
    await expect(page.locator("#puzzleView").getByText("Down")).toBeVisible();
  });

  test("solver view has Check, Reveal, and Back buttons", async ({ page }) => {
    await setupLoggedOutRoutes(page, { puzzles: testPuzzleData });
    await page.goto("/");
    await page.getByRole("button", { name: "Try a pre-built puzzle" }).click();
    await expect(page.locator("#puzzleView")).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole("button", { name: "Check" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Reveal" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Back" })).toBeVisible();
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
            title: "Crossword — Greek Gods",
            subtitle: 'Generated from "Greek Gods" topic.',
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
    // Generate panel should be hidden after successful generation
    await expect(page.locator("#generatePanel")).toBeHidden();
  });
});

test.describe("Back button", () => {
  test("back returns to landing from solver", async ({ page }) => {
    await setupLoggedOutRoutes(page, { puzzles: testPuzzleData });
    await page.goto("/");
    await page.getByRole("button", { name: "Try a pre-built puzzle" }).click();
    await expect(page.locator("#puzzleView")).toBeVisible({ timeout: 5000 });
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.locator("#landingPage")).toBeVisible();
    await expect(page.locator("#puzzleView")).toBeHidden();
  });
});
