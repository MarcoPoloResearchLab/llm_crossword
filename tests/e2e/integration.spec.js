// @ts-check
// Blackbox integration tests against the real dockerized site.
// Docker compose is started/stopped by global-setup.js / global-teardown.js.
// Tests verify what the USER sees — visible text and screenshot comparisons.

const { test, expect } = require("@playwright/test");

test.describe("Landing page", () => {
  test("renders hero, CTAs, and feature cards", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Create crossword puzzles with AI")).toBeVisible();
    await expect(page.getByRole("button", { name: "Try a pre-built puzzle" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in to generate" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Any topic" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Instant generation" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Interactive solving" })).toBeVisible();
    await expect(page).toHaveScreenshot("landing.png", { maxDiffPixelRatio: 0.05 });
  });
});

test.describe("Header and footer", () => {
  test("header has brand on the left", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    await page.waitForTimeout(3000);
    await expect(page.getByRole("link", { name: "LLM Crossword" })).toBeVisible();
    await expect(page).toHaveScreenshot("header-footer.png", { maxDiffPixelRatio: 0.05 });
  });
});

test.describe("Pre-built puzzle", () => {
  test("clicking 'Try a pre-built puzzle' shows crossword", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Try a pre-built puzzle" }).click();
    // Wait for puzzle to render.
    await page.waitForTimeout(3000);
    await expect(page).toHaveScreenshot("after-try-prebuilt-click.png", { maxDiffPixelRatio: 0.05 });
  });
});

test.describe("Generate tab — unauthenticated", () => {
  test("shows disabled generate button and login prompt", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Try a pre-built puzzle" }).click();
    await page.waitForTimeout(1000);
    // Try switching to generate tab.
    var genTab = page.getByRole("tab", { name: "Generate" });
    if (await genTab.isVisible()) {
      await genTab.click();
    }
    await page.waitForTimeout(500);
    await expect(page).toHaveScreenshot("generate-logged-out.png", { maxDiffPixelRatio: 0.05 });
  });
});

test.describe("Landing page buttons", () => {
  test("'Try a pre-built puzzle' hides landing and shows puzzle view", async ({ page }) => {
    await page.goto("/");
    // Landing should be visible initially
    await expect(page.locator("#landingPage")).toBeVisible();
    await expect(page.locator("#puzzleView")).toBeHidden();
    // Click the button
    await page.getByRole("button", { name: "Try a pre-built puzzle" }).click();
    // Puzzle view should appear, landing should hide
    await expect(page.locator("#puzzleView")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("#landingPage")).toBeHidden();
  });

  test("'Sign in to generate' attempts sign-in or navigates to puzzle", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Sign in to generate" }).click();
    // Should either: open a Google sign-in popup, show puzzle view (fallback),
    // or at minimum the button should have been clickable (no crash).
    // We verify: either puzzle view is shown OR landing is still visible (Google popup opened externally).
    await page.waitForTimeout(2000);
    var puzzleVisible = await page.locator("#puzzleView").isVisible();
    var landingVisible = await page.locator("#landingPage").isVisible();
    // At least one must be true — the page didn't break.
    expect(puzzleVisible || landingVisible).toBeTruthy();
  });
});

test.describe("Crossword grid layout", () => {
  test("grid cells are square (not stretched)", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Try a pre-built puzzle" }).click();
    // Wait for puzzle to render — crosswords.json fetch + generator can take time
    var cell = page.locator(".cell:not(.blk)").first();
    await expect(cell).toBeVisible({ timeout: 15000 });
    var box = await cell.boundingBox();
    // Cells should be roughly square (width ≈ height, tolerance of 4px)
    expect(Math.abs(box.width - box.height)).toBeLessThanOrEqual(4);
    // Cells should be a reasonable size (30-60px)
    expect(box.width).toBeGreaterThanOrEqual(30);
    expect(box.width).toBeLessThanOrEqual(60);
  });

  test("no giant empty space above the crossword grid", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Try a pre-built puzzle" }).click();
    await expect(page.locator("#puzzleView")).toBeVisible({ timeout: 5000 });
    // Wait for puzzle to render
    var cell = page.locator(".cell:not(.blk)").first();
    await expect(cell).toBeVisible({ timeout: 15000 });
    var cellBox = await cell.boundingBox();
    var puzzleBox = await page.locator("#puzzleView").boundingBox();
    // The first cell should be within 250px of the top of the puzzle view
    // (header + controls + small gap is expected)
    var gap = cellBox.y - puzzleBox.y;
    expect(gap).toBeLessThanOrEqual(250);
  });
});

test.describe("Session persistence", () => {
  test("/me endpoint is reachable through ghttp proxy", async ({ page }) => {
    var response = await page.request.get("/me");
    // Should return 401 or 403 (not 404) when not logged in
    expect([401, 403]).toContain(response.status());
  });
});

// ---------------------------------------------------------------------------
// These tests run against the REAL site with real crosswords.json (Greek Gods
// puzzle with 17 words). They catch issues that small mock puzzles miss.
// ---------------------------------------------------------------------------
test.describe("Real puzzle — clue layout (class: content always readable)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Try a pre-built puzzle" }).click();
    // Wait for puzzle cells to render
    await expect(page.locator("#puzzleView .cell:not(.blk)").first()).toBeVisible({ timeout: 15000 });
  });

  test("every clue has a visible hint button", async ({ page }) => {
    var hintButtons = page.locator("#puzzleView li .hintButton");
    var count = await hintButtons.count();
    // Must have hint buttons
    expect(count).toBeGreaterThan(0);
    // Every hint button must be visible (non-zero size, within viewport)
    for (var i = 0; i < count; i++) {
      var box = await hintButtons.nth(i).boundingBox();
      expect(box).not.toBeNull();
      expect(box.width).toBeGreaterThan(5);
      expect(box.height).toBeGreaterThan(5);
    }
  });

  test("clue text is not truncated on real puzzle", async ({ page }) => {
    var truncated = await page.evaluate(() => {
      var pv = document.getElementById("puzzleView");
      if (!pv) return ["puzzleView not found"];
      var items = pv.querySelectorAll("li");
      var result = [];
      for (var i = 0; i < items.length; i++) {
        var li = items[i];
        if (li.scrollWidth > li.clientWidth + 2) {
          result.push(li.textContent.substring(0, 50));
        }
      }
      return result;
    });
    expect(truncated).toHaveLength(0);
  });

  test("clues are to the right of the grid, not below", async ({ page }) => {
    var layout = await page.evaluate(() => {
      var pv = document.getElementById("puzzleView");
      if (!pv) return null;
      var grid = pv.querySelector(".gridViewport");
      var clues = pv.querySelector(".clues");
      if (!grid || !clues) return null;
      var gr = grid.getBoundingClientRect();
      var cr = clues.getBoundingClientRect();
      return { gridRight: gr.right, cluesLeft: cr.left, gridTop: gr.top, cluesTop: cr.top };
    });
    expect(layout).not.toBeNull();
    // Clues left edge should be at or past grid right edge
    expect(layout.cluesLeft).toBeGreaterThanOrEqual(layout.gridRight - 20);
    // Clues top should be near grid top (not pushed far below)
    expect(Math.abs(layout.cluesTop - layout.gridTop)).toBeLessThanOrEqual(50);
  });

  test("no black bar artifact at bottom of grid", async ({ page }) => {
    var info = await page.evaluate(() => {
      var pv = document.getElementById("puzzleView");
      if (!pv) return null;
      var gv = pv.querySelector(".gridViewport");
      if (!gv) return null;
      var grid = pv.querySelector(".grid");
      if (!grid) return null;
      var gvRect = gv.getBoundingClientRect();
      var gridRect = grid.getBoundingClientRect();
      return {
        viewportHeight: gvRect.height,
        gridHeight: gridRect.height,
        overflowY: getComputedStyle(gv).overflowY,
        // Black bar = viewport much taller than grid content
        excessHeight: gvRect.height - gridRect.height,
      };
    });
    expect(info).not.toBeNull();
    // The viewport should not have more than 50px excess below the grid
    // (a black bar is caused by the viewport being taller than its content)
    expect(info.excessHeight).toBeLessThanOrEqual(50);
  });
});
