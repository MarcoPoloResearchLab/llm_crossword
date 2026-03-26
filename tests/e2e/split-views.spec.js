// @ts-check
// Tests for the split generation/solving views (Option C).
// Generate form lives on the landing page; solver view is clean.

const { test, expect } = require("./coverage-fixture");

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

function setupLoggedInMocks(page) {
  return page.addInitScript(() => {
    window.__testOverrides = {
      fetch: function (url) {
        if (url === "/me") return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        if (url === "/api/bootstrap") return Promise.resolve({ ok: true, json: () => Promise.resolve({ balance: { coins: 15 } }) });
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

function setupLoggedOutMocks(page) {
  return page.addInitScript(() => {
    window.__testOverrides = {
      fetch: function (url) {
        if (url === "/me") return Promise.resolve({ ok: false, status: 403 });
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

test.describe("Landing page — auth-based routing", () => {
  test("logged-out user sees landing page", async ({ page }) => {
    await setupLoggedOutMocks(page);
    await page.goto("/");
    await expect(page.locator("#landingPage")).toBeVisible({ timeout: 3000 });
    await expect(page.locator("#puzzleView")).toBeHidden();
  });

  test("logged-in user skips landing and sees puzzle view with generate form", async ({ page }) => {
    await setupLoggedInMocks(page);
    await page.goto("/");
    await expect(page.locator("#landingPage")).toBeHidden({ timeout: 5000 });
    await expect(page.locator("#puzzleView")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("#topicInput")).toBeVisible();
    await expect(page.locator("#generateBtn")).toBeVisible();
  });

  test("generate button shows credit cost when logged in", async ({ page }) => {
    await setupLoggedInMocks(page);
    await page.goto("/");
    await expect(page.locator("#generateBtn")).toContainText("5 credits", { timeout: 5000 });
  });
});

test.describe("Solver view — no tabs", () => {
  test("solver view has no mode tabs", async ({ page }) => {
    await setupLoggedOutMocks(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Try a pre-built puzzle" }).click();
    await expect(page.locator("#puzzleView")).toBeVisible({ timeout: 5000 });
    // There should be NO tab elements in the solver view
    await expect(page.locator(".mode-tabs")).toHaveCount(0);
    await expect(page.locator("[role='tab']")).toHaveCount(0);
  });

  test("solver view shows puzzle selector for pre-built puzzles", async ({ page }) => {
    await setupLoggedOutMocks(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Try a pre-built puzzle" }).click();
    await expect(page.locator("#puzzleView")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("#puzzleSelect")).toBeVisible();
  });

  test("solver view shows grid and clues", async ({ page }) => {
    await setupLoggedOutMocks(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Try a pre-built puzzle" }).click();
    await expect(page.locator("#grid")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("#puzzleView").getByText("Across")).toBeVisible();
    await expect(page.locator("#puzzleView").getByText("Down")).toBeVisible();
  });

  test("solver view has Check, Reveal, and Back buttons", async ({ page }) => {
    await setupLoggedOutMocks(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Try a pre-built puzzle" }).click();
    await expect(page.locator("#puzzleView")).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole("button", { name: "Check" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Reveal" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Back" })).toBeVisible();
  });

  test("generate form is hidden in solver when logged out", async ({ page }) => {
    await setupLoggedOutMocks(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Try a pre-built puzzle" }).click();
    await expect(page.locator("#puzzleView")).toBeVisible({ timeout: 5000 });
    // The generate panel exists but is hidden when not logged in
    await expect(page.locator("#generatePanel")).toBeHidden();
  });
});

test.describe("Generate flow — landing to solver", () => {
  test("successful generation navigates to solver view", async ({ page }) => {
    await page.addInitScript(() => {
      window.__testOverrides = {
        fetch: function (url, opts) {
          if (url === "/me") return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
          if (url === "/api/bootstrap") return Promise.resolve({ ok: true, json: () => Promise.resolve({ balance: { coins: 15 } }) });
          if (url === "/api/generate") {
            return Promise.resolve({
              ok: true,
              json: () =>
                Promise.resolve({
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
                }),
            });
          }
          if (typeof url === "string" && url.includes("config.yaml")) return Promise.resolve({ ok: true, text: () => Promise.resolve("") });
          if (typeof url === "string" && url.includes("crosswords.json"))
            return Promise.resolve({
              ok: true,
              json: () =>
                Promise.resolve([
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
                ]),
            });
          return Promise.resolve({ ok: false, status: 404 });
        },
      };
    });
    await page.goto("/");
    // Wait for login
    await expect(page.locator("#generateBtn")).toBeEnabled({ timeout: 5000 });
    // Fill topic and generate
    await page.locator("#topicInput").fill("Greek Gods");
    await page.locator("#generateBtn").click();
    // Should navigate to solver view
    await expect(page.locator("#puzzleView")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("#landingPage")).toBeHidden();
    // Solver should show the generated puzzle title
    await expect(page.locator("#title")).toContainText("Greek Gods");
    // Puzzle selector should be hidden (this is a generated puzzle, not pre-built)
    await expect(page.locator("#puzzleSelect")).toBeHidden();
  });
});

test.describe("Back button", () => {
  test("back returns to landing from solver", async ({ page }) => {
    await setupLoggedOutMocks(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Try a pre-built puzzle" }).click();
    await expect(page.locator("#puzzleView")).toBeVisible({ timeout: 5000 });
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.locator("#landingPage")).toBeVisible();
    await expect(page.locator("#puzzleView")).toBeHidden();
  });
});
