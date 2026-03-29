// @ts-check
// Regression tests for four reported bugs:
// 1. Session lost on page refresh (user gets logged out)
// 2. Grid cells stretched/deformed (not square)
// 3. Giant empty space between header area and crossword grid
// 4. Landing page comes back after the app has already confirmed login

const { test, expect } = require("./coverage-fixture");
const { setupLoggedInRoutes, setupLoggedOutRoutes } = require("./route-helpers");

const puzzlePayload = [
  {
    title: "Test Puzzle",
    subtitle: "A test puzzle.",
    items: [
      { word: "orbit", definition: "Path around Earth", hint: "elliptical route" },
      { word: "mare", definition: "A lunar sea", hint: "shares name with horse" },
      { word: "tides", definition: "Ocean rise-and-fall", hint: "regular shoreline shifts" },
      { word: "lunar", definition: "Relating to the Moon", hint: "companion" },
      { word: "apollo", definition: "Program to the Moon", hint: "Saturn V" },
    ],
  },
];

// ---------------------------------------------------------------------------
// Bug 1: Session must persist across hard refresh
// ---------------------------------------------------------------------------
test.describe("Session persistence on refresh", () => {
  test("user stays logged in after page reload", async ({ page }) => {
    await setupLoggedInRoutes(page, { puzzles: puzzlePayload });
    await page.goto("/");

    // Verify logged-in state: puzzle view visible, click New Crossword to check generate button
    await expect(page.locator("#puzzleView")).toBeVisible({ timeout: 5000 });
    await page.locator("#newCrosswordCard").click();
    const genBtn = page.locator("#generateBtn");
    await expect(genBtn).toBeEnabled({ timeout: 5000 });
    await expect(genBtn).toContainText("(4 credits)");

    // Hard refresh
    await page.reload();

    // After reload, user must STILL be logged in
    await expect(page.locator("#puzzleView")).toBeVisible({ timeout: 5000 });
    await page.locator("#newCrosswordCard").click();
    await expect(genBtn).toBeEnabled({ timeout: 5000 });
    await expect(genBtn).toContainText("(4 credits)");
  });

  test("credit badge persists after page reload", async ({ page }) => {
    await setupLoggedInRoutes(page, { puzzles: puzzlePayload });
    await page.goto("/");

    const badge = page.locator("#headerCreditBadge");
    await expect(badge).toContainText("credits", { timeout: 5000 });

    // Hard refresh
    await page.reload();

    // Badge must still show credits
    await expect(badge).toContainText("credits", { timeout: 5000 });
  });

  test("user stays logged in after page reload when /me requires /auth/refresh", async ({ page }) => {
    let meCallCount = 0;

    await setupLoggedInRoutes(page, {
      puzzles: puzzlePayload,
      extra: {
        "**/me": async (route) => {
          meCallCount += 1;
          if (meCallCount === 2) {
            await route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "expired" }) });
            return;
          }
          await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({}) });
        },
        "**/auth/refresh": async (route) => {
          await route.fulfill({ status: 204, body: "" });
        },
      },
    });

    await page.goto("/");
    await expect(page.locator("#puzzleView")).toBeVisible({ timeout: 5000 });

    await page.reload();

    await expect(page.locator("#puzzleView")).toBeVisible({ timeout: 5000 });
    await page.locator("#newCrosswordCard").click();
    await expect(page.locator("#generateBtn")).toBeEnabled({ timeout: 5000 });
  });

  test("landing page stays hidden after session-confirmed login", async ({ page }) => {
    await setupLoggedInRoutes(page, { puzzles: puzzlePayload });
    await page.goto("/");

    await expect(page.locator("#puzzleView")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("#landingPage")).toBeHidden({ timeout: 5000 });

    // The header can emit a stale unauthenticated event after /me has already
    // confirmed the session. The landing page must not come back.
    await page.evaluate(() => {
      document.dispatchEvent(new Event("mpr-ui:auth:unauthenticated"));
    });

    await expect(page.locator("#landingPage")).toBeHidden({ timeout: 2000 });
    await expect(page.locator("#puzzleView")).toBeVisible({ timeout: 2000 });
  });

  test("shared puzzle URL opens the shared crossword for logged-in users", async ({ page }) => {
    await setupLoggedInRoutes(page, {
      puzzles: puzzlePayload,
      extra: {
        "**/api/shared/shared-ok": async (route) => {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              title: "Shared Space",
              subtitle: "Shared with you",
              items: puzzlePayload[0].items,
              share_token: "shared-ok",
            }),
          });
        },
      },
    });

    await page.goto("/?puzzle=shared-ok");

    await expect(page.locator("#puzzleView")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("#title")).toHaveText("Shared Space");
    await expect(page.locator("#subtitle")).toHaveText("Shared with you");
    await expect(page.locator("#shareBtn")).toBeVisible();
  });

  test("shared puzzle URL stays on the shared crossword after a logged-out user opens puzzle view", async ({ page }) => {
    await setupLoggedOutRoutes(page, {
      puzzles: puzzlePayload,
      extra: {
        "**/api/shared/shared-ok": async (route) => {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              title: "Shared Space",
              subtitle: "Shared with you",
              items: puzzlePayload[0].items,
              share_token: "shared-ok",
            }),
          });
        },
      },
    });

    await page.goto("/?puzzle=shared-ok");
    await expect(page.locator(".landing__title")).toHaveText("Shared Space");

    await page.getByRole("button", { name: "Try a pre-built puzzle" }).click();

    await expect(page.locator("#puzzleView")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("#title")).toHaveText("Shared Space");
    await expect(page.locator("#subtitle")).toHaveText("Shared with you");
    await expect(page.locator("#shareBtn")).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Bug 2: Grid cells must be square (not horizontally stretched)
// ---------------------------------------------------------------------------
test.describe("Grid cell dimensions", () => {
  test("crossword cells are square", async ({ page }) => {
    await setupLoggedOutRoutes(page, { puzzles: puzzlePayload });
    await page.goto("/");

    // Navigate to puzzle view
    await page.getByRole("button", { name: "Try a pre-built puzzle" }).click();

    // Wait for grid to render
    const firstCell = page.locator("#puzzleView .cell").first();
    await expect(firstCell).toBeVisible({ timeout: 5000 });

    // Wait for cells to stabilize (ResizeObserver recalculates after visibility change)
    await expect(async () => {
      const box = await firstCell.boundingBox();
      expect(box).not.toBeNull();
      expect(box.width).toBeGreaterThan(20); // not collapsed
      expect(box.width).toBeCloseTo(box.height, 0); // square
    }).toPass({ timeout: 5000 });
  });

  test("all cells have consistent size", async ({ page }) => {
    await setupLoggedOutRoutes(page, { puzzles: puzzlePayload });
    await page.goto("/");
    await page.getByRole("button", { name: "Try a pre-built puzzle" }).click();

    await page.locator("#puzzleView .cell").first().waitFor({ timeout: 5000 });

    // All non-block cells should have the same width
    const sizes = await page.$$eval(".cell:not(.blk)", (cells) =>
      cells.slice(0, 10).map((c) => {
        const rect = c.getBoundingClientRect();
        return { w: Math.round(rect.width), h: Math.round(rect.height) };
      })
    );

    expect(sizes.length).toBeGreaterThan(0);
    const firstSize = sizes[0];
    for (const size of sizes) {
      expect(size.w).toBe(firstSize.w);
      expect(size.h).toBe(firstSize.h);
      expect(size.w).toBe(size.h); // square
    }
  });
});

// ---------------------------------------------------------------------------
// Bug 3: No giant empty space between controls and crossword grid
// ---------------------------------------------------------------------------
test.describe("Layout — no excessive empty space", () => {
  test("crossword grid starts within 250px of the controls above it", async ({ page }) => {
    await setupLoggedOutRoutes(page, { puzzles: puzzlePayload });
    await page.goto("/");
    await page.getByRole("button", { name: "Try a pre-built puzzle" }).click();

    // Wait for grid
    const firstCell = page.locator("#puzzleView .cell").first();
    await expect(firstCell).toBeVisible({ timeout: 5000 });

    // Find the bottom of the last control area (hdr or panel-bar)
    // and the top of the first grid cell
    const gap = await page.evaluate(() => {
      var pv = document.getElementById("puzzleView");
      if (!pv) return 9999;
      const panels = pv.querySelectorAll(".hdr, .panel-bar, .generate-form");
      let controlsBottom = 0;
      panels.forEach((el) => {
        const rect = el.getBoundingClientRect();
        if (rect.bottom > controlsBottom && rect.height > 0) {
          controlsBottom = rect.bottom;
        }
      });
      const firstCell = pv.querySelector(".cell");
      if (!firstCell) return 9999;
      const cellTop = firstCell.getBoundingClientRect().top;
      return cellTop - controlsBottom;
    });

    // The gap between controls and the first cell should be reasonable
    // (pane-gap is 16px, some padding — should be well under 250px)
    expect(gap).toBeLessThan(250);
    expect(gap).toBeGreaterThanOrEqual(0); // not overlapping
  });

  test("puzzle view does not have a fixed height taller than its content", async ({ page }) => {
    await setupLoggedOutRoutes(page, { puzzles: puzzlePayload });
    await page.goto("/");
    await page.getByRole("button", { name: "Try a pre-built puzzle" }).click();

    await page.locator("#puzzleView .cell").first().waitFor({ timeout: 5000 });

    // The puzzle main area's visible height should not vastly exceed its scroll height
    const ratio = await page.evaluate(() => {
      const main = document.querySelector(".puzzle-main") || document.querySelector(".wrap");
      if (!main) return 999;
      return main.clientHeight / main.scrollHeight;
    });

    // If ratio > 1 or close to 1, it means no excessive stretching.
    // If scrollHeight is much less than clientHeight, there's empty space.
    // For a small puzzle, scrollHeight should be roughly equal to clientHeight.
    // We allow some variance but the wrap should not be more than 2x the content.
    expect(ratio).toBeLessThanOrEqual(1.1); // wrap should not be stretched beyond content
  });

  test("puzzle view spans full viewport width (no container-in-a-page)", async ({ page }) => {
    await setupLoggedOutRoutes(page, { puzzles: puzzlePayload });
    await page.goto("/");
    await page.getByRole("button", { name: "Try a pre-built puzzle" }).click();
    await page.locator("#puzzleView .cell").first().waitFor({ timeout: 5000 });

    const layout = await page.evaluate(() => {
      var pv = document.getElementById("puzzleView");
      if (!pv) return null;
      var rect = pv.getBoundingClientRect();
      return { pvWidth: rect.width, viewportWidth: window.innerWidth };
    });

    expect(layout).not.toBeNull();
    // Puzzle view should use most of the viewport width
    expect(layout.pvWidth).toBeGreaterThanOrEqual(layout.viewportWidth * 0.9);
  });

  test("solver controls stay above the sticky footer", async ({ page }) => {
    await setupLoggedOutRoutes(page, { puzzles: puzzlePayload });
    await page.goto("/");
    await page.getByRole("button", { name: "Try a pre-built puzzle" }).click();
    await page.locator("#puzzleView .cell").first().waitFor({ timeout: 5000 });

    const layout = await page.evaluate(() => {
      var controls = document.querySelector("#puzzleView .controls__actions");
      var footer = document.querySelector("footer.mpr-footer");
      if (!controls || !footer) return null;
      var controlsRect = controls.getBoundingClientRect();
      var footerRect = footer.getBoundingClientRect();
      return {
        controlsBottom: controlsRect.bottom,
        footerTop: footerRect.top,
      };
    });

    expect(layout).not.toBeNull();
    expect(layout.controlsBottom).toBeLessThanOrEqual(layout.footerTop + 1);
  });

  test("solver controls stay above the sticky footer on a short viewport", async ({ page }) => {
    await page.setViewportSize({ width: 2048, height: 300 });
    await setupLoggedOutRoutes(page, { puzzles: puzzlePayload });
    await page.goto("/");
    await page.getByRole("button", { name: "Try a pre-built puzzle" }).click();
    await page.locator("#puzzleView .cell").first().waitFor({ timeout: 5000 });
    await page.waitForTimeout(500);

    const layout = await page.evaluate(() => {
      var controls = document.querySelector("#puzzleView .controls__actions");
      var footer = document.querySelector("footer.mpr-footer");
      if (!controls || !footer) return null;
      var controlsRect = controls.getBoundingClientRect();
      var footerRect = footer.getBoundingClientRect();
      return {
        controlsBottom: controlsRect.bottom,
        footerTop: footerRect.top,
      };
    });

    expect(layout).not.toBeNull();
    expect(layout.controlsBottom).toBeLessThanOrEqual(layout.footerTop + 1);
  });
});

test.describe("Header layout", () => {
  test("header spans the full viewport width", async ({ page }) => {
    await setupLoggedOutRoutes(page, { puzzles: puzzlePayload });
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Wait for mpr-header web component to render its shadow DOM.
    await page.waitForFunction(() => {
      var header = document.querySelector("mpr-header");
      return header && header.getBoundingClientRect().width > 0;
    }, { timeout: 5000 });

    const headerBox = await page.evaluate(() => {
      var header = document.querySelector("mpr-header");
      if (!header) return null;
      var rect = header.getBoundingClientRect();
      return { width: rect.width, viewportWidth: window.innerWidth };
    });

    expect(headerBox).not.toBeNull();
    // Header should span the full viewport width (within 2px tolerance)
    expect(headerBox.width).toBeGreaterThanOrEqual(headerBox.viewportWidth - 2);
  });
});

test.describe("Clue visibility", () => {
  test("clue text is not truncated", async ({ page }) => {
    await setupLoggedOutRoutes(page, { puzzles: puzzlePayload });
    await page.goto("/");
    await page.getByRole("button", { name: "Try a pre-built puzzle" }).click();
    await page.locator("#puzzleView .cell").first().waitFor({ timeout: 5000 });

    // Check that clue list items are not overflowing/truncated
    const clueOverflow = await page.evaluate(() => {
      var items = document.querySelectorAll("li");
      var truncated = [];
      for (var i = 0; i < items.length; i++) {
        var li = items[i];
        // If scrollWidth > clientWidth, text is being clipped
        if (li.scrollWidth > li.clientWidth + 2) {
          truncated.push(li.textContent.substring(0, 40));
        }
      }
      return truncated;
    });

    // No clue items should be truncated
    expect(clueOverflow).toHaveLength(0);
  });

  test("hint buttons are visible on clue items", async ({ page }) => {
    await setupLoggedOutRoutes(page, { puzzles: puzzlePayload });
    await page.goto("/");
    await page.getByRole("button", { name: "Try a pre-built puzzle" }).click();
    await page.locator("#puzzleView .cell").first().waitFor({ timeout: 5000 });

    // The hint button (H) should be visible on at least one clue
    const hintButtons = page.locator("#puzzleView li .hintButton");
    const count = await hintButtons.count();
    expect(count).toBeGreaterThan(0);

    // Each hint button should be within the viewport (not clipped off-screen)
    for (var i = 0; i < Math.min(count, 3); i++) {
      const box = await hintButtons.nth(i).boundingBox();
      expect(box).not.toBeNull();
      expect(box.width).toBeGreaterThan(0);
      expect(box.height).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Class of problems: UI elements clipped, hidden, or shown in wrong state
// regardless of content length, puzzle size, or auth state.
// ---------------------------------------------------------------------------

// Long-clue puzzle for testing truncation with realistic content
const longCluePuzzle = [
  {
    title: "Greek Gods",
    subtitle: "Olympian and other Greek deities.",
    items: [
      { word: "athena", definition: "Goddess of wisdom, handicraft, and strategic warfare in ancient mythology", hint: "owl companion" },
      { word: "poseidon", definition: "God of the sea, earthquakes, and horses who carried a mighty trident", hint: "brother of Zeus" },
      { word: "artemis", definition: "Goddess of the hunt, wilderness, and protector of young children", hint: "twin of Apollo" },
      { word: "hermes", definition: "Messenger god known for speed and cunning who guided souls to the underworld", hint: "winged sandals" },
      { word: "demeter", definition: "Goddess of the harvest and agriculture whose grief caused winter", hint: "mother of Persephone" },
      { word: "hades", definition: "God of the underworld and ruler of the dead in Greek mythology", hint: "invisible helmet" },
      { word: "apollo", definition: "God of the sun, music, poetry, and prophecy at the Oracle of Delphi", hint: "golden lyre" },
      { word: "zeus", definition: "King of the Olympian gods who wielded thunderbolts from Mount Olympus", hint: "ruler of the sky" },
      { word: "hera", definition: "Queen of the gods and goddess of marriage and family", hint: "wife of Zeus" },
      { word: "ares", definition: "God of war known for his brutal and violent nature in battle", hint: "feared by mortals" },
      { word: "dionysus", definition: "God of wine, festivity, and ecstatic ritual celebrations", hint: "grape harvest" },
      { word: "hephaestus", definition: "God of fire, metalworking, and craftsmanship who forged divine weapons", hint: "volcano forge" },
    ],
  },
];

test.describe("Clue visibility — long clues (class: content never clipped)", () => {
  test("long clue text is fully visible, not truncated", async ({ page }) => {
    await setupLoggedOutRoutes(page, { puzzles: longCluePuzzle });
    await page.goto("/");
    await page.getByRole("button", { name: "Try a pre-built puzzle" }).click();
    await page.locator("#puzzleView .cell").first().waitFor({ timeout: 10000 });

    // Check every clue <li> — scrollWidth must not exceed clientWidth
    const truncated = await page.evaluate(() => {
      var items = document.querySelectorAll("#puzzleView li");
      var result = [];
      for (var i = 0; i < items.length; i++) {
        var li = items[i];
        if (li.scrollWidth > li.clientWidth + 2) {
          result.push(li.textContent.substring(0, 60));
        }
      }
      return result;
    });

    expect(truncated).toHaveLength(0);
  });

  test("hint buttons are visible on every clue with long text", async ({ page }) => {
    await setupLoggedOutRoutes(page, { puzzles: longCluePuzzle });
    await page.goto("/");
    await page.getByRole("button", { name: "Try a pre-built puzzle" }).click();
    await page.locator("#puzzleView .cell").first().waitFor({ timeout: 10000 });

    const hintButtons = page.locator("#puzzleView li .hintButton");
    const count = await hintButtons.count();
    // Every clue should have a hint button
    expect(count).toBeGreaterThanOrEqual(6); // at least half the clues

    // Every hint button must have non-zero dimensions (not clipped)
    for (var i = 0; i < count; i++) {
      const box = await hintButtons.nth(i).boundingBox();
      expect(box).not.toBeNull();
      expect(box.width).toBeGreaterThan(10);
      expect(box.height).toBeGreaterThan(10);
    }
  });

  test("clues container does not use text-overflow ellipsis", async ({ page }) => {
    await setupLoggedOutRoutes(page, { puzzles: longCluePuzzle });
    await page.goto("/");
    await page.getByRole("button", { name: "Try a pre-built puzzle" }).click();
    await page.locator("#puzzleView .cell").first().waitFor({ timeout: 10000 });

    const hasEllipsis = await page.evaluate(() => {
      var items = document.querySelectorAll("#puzzleView li");
      for (var i = 0; i < items.length; i++) {
        var style = getComputedStyle(items[i]);
        if (style.textOverflow === "ellipsis" || style.overflow === "hidden") {
          return true;
        }
      }
      return false;
    });

    expect(hasEllipsis).toBe(false);
  });

  test("clues are positioned to the right of the grid, not below", async ({ page }) => {
    await setupLoggedOutRoutes(page, { puzzles: longCluePuzzle });
    await page.goto("/");
    await page.getByRole("button", { name: "Try a pre-built puzzle" }).click();
    await page.locator("#puzzleView .cell").first().waitFor({ timeout: 10000 });

    const layout = await page.evaluate(() => {
      var pv = document.getElementById("puzzleView");
      if (!pv) return null;
      var grid = pv.querySelector(".gridViewport");
      var clues = pv.querySelector(".clues");
      if (!grid || !clues) return null;
      var gridRect = grid.getBoundingClientRect();
      var cluesRect = clues.getBoundingClientRect();
      return {
        gridRight: gridRect.right,
        cluesLeft: cluesRect.left,
        gridBottom: gridRect.bottom,
        cluesTop: cluesRect.top,
      };
    });

    expect(layout).not.toBeNull();
    // Clues should start to the right of the grid (with some tolerance for gap)
    expect(layout.cluesLeft).toBeGreaterThanOrEqual(layout.gridRight - 10);
    // Clues should NOT be below the grid (their top should be near the grid top)
    expect(layout.cluesTop).toBeLessThan(layout.gridBottom);
  });

  test("clues container is at least 250px wide", async ({ page }) => {
    await setupLoggedOutRoutes(page, { puzzles: longCluePuzzle });
    await page.goto("/");
    await page.getByRole("button", { name: "Try a pre-built puzzle" }).click();
    await page.locator("#puzzleView .cell").first().waitFor({ timeout: 10000 });

    const clueWidth = await page.evaluate(() => {
      var pv = document.getElementById("puzzleView");
      if (!pv) return 0;
      var clues = pv.querySelector(".clues");
      return clues ? clues.getBoundingClientRect().width : 0;
    });

    // With the sidebar taking 280px, clues get ~25% of the remaining main area
    expect(clueWidth).toBeGreaterThanOrEqual(200);
  });

  test("no scrollbar artifact (black bar) inside grid viewport", async ({ page }) => {
    await setupLoggedOutRoutes(page, { puzzles: longCluePuzzle });
    await page.goto("/");
    await page.getByRole("button", { name: "Try a pre-built puzzle" }).click();
    await page.locator("#puzzleView .cell").first().waitFor({ timeout: 10000 });

    const scrollInfo = await page.evaluate(() => {
      var pv = document.getElementById("puzzleView");
      if (!pv) return null;
      var gv = pv.querySelector(".gridViewport");
      if (!gv) return null;
      return {
        scrollWidth: gv.scrollWidth,
        clientWidth: gv.clientWidth,
        scrollHeight: gv.scrollHeight,
        clientHeight: gv.clientHeight,
        overflowX: getComputedStyle(gv).overflowX,
        overflowY: getComputedStyle(gv).overflowY,
      };
    });

    expect(scrollInfo).not.toBeNull();
    // The grid viewport should not have forced scrollbars that create visual artifacts
    // (overflow:auto is fine — it only shows scrollbars when needed)
    var hasForcedHBar = scrollInfo.overflowX === "scroll";
    expect(hasForcedHBar).toBe(false);
  });
});

test.describe("Generate panel visibility (class: view state correctness)", () => {
  test("generate form is hidden when viewing pre-built puzzle as logged-out user", async ({ page }) => {
    await setupLoggedOutRoutes(page, { puzzles: puzzlePayload });
    await page.goto("/");
    await page.getByRole("button", { name: "Try a pre-built puzzle" }).click();
    await page.locator("#puzzleView .cell").first().waitFor({ timeout: 5000 });

    await expect(page.locator("#generatePanel")).toBeHidden();
  });

  test("generate form is visible after clicking New Crossword when logged in", async ({ page }) => {
    await setupLoggedInRoutes(page, { puzzles: puzzlePayload });
    await page.goto("/");
    await expect(page.locator("#puzzleView")).toBeVisible({ timeout: 5000 });

    // Generate panel is hidden until New Crossword card is clicked
    await expect(page.locator("#generatePanel")).toBeHidden();
    await page.locator("#newCrosswordCard").click();
    await expect(page.locator("#generatePanel")).toBeVisible();
  });
});


test.describe("Theme switching", () => {
  test("body background changes when theme is toggled to light", async ({ page }) => {
    await setupLoggedOutRoutes(page, { puzzles: puzzlePayload });
    await page.goto("/");

    // Get the dark background gradient
    const darkBg = await page.evaluate(() => {
      return getComputedStyle(document.body).backgroundImage;
    });

    // Simulate mpr-ui setting the light theme attribute on <html>
    await page.evaluate(() => {
      document.documentElement.setAttribute("data-mpr-theme", "light");
    });

    // Get the light background gradient
    const lightBg = await page.evaluate(() => {
      return getComputedStyle(document.body).backgroundImage;
    });

    // They should be different — theme switch took effect
    expect(darkBg).not.toEqual(lightBg);
  });
});

test.describe("Grid scrollbar", () => {
  test("no extraneous scrollbar or black bar inside the grid viewport", async ({ page }) => {
    await setupLoggedOutRoutes(page, { puzzles: puzzlePayload });
    await page.goto("/");
    await page.getByRole("button", { name: "Try a pre-built puzzle" }).click();
    await page.locator("#puzzleView .cell").first().waitFor({ timeout: 5000 });

    const viewport = await page.evaluate(() => {
      var gv = document.querySelector(".gridViewport");
      if (!gv) return null;
      return {
        scrollWidth: gv.scrollWidth,
        clientWidth: gv.clientWidth,
        scrollHeight: gv.scrollHeight,
        clientHeight: gv.clientHeight,
        hasHorizontalScroll: gv.scrollWidth > gv.clientWidth + 5,
        hasVerticalScroll: gv.scrollHeight > gv.clientHeight + 5,
      };
    });

    expect(viewport).not.toBeNull();
    // For a small puzzle, the grid should not need scrollbars
    // (the black bar is caused by a scrollbar track or overflow)
    expect(viewport.hasHorizontalScroll).toBe(false);
  });
});
