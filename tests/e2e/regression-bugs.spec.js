// @ts-check
// Regression tests for three reported bugs:
// 1. Session lost on page refresh (user gets logged out)
// 2. Grid cells stretched/deformed (not square)
// 3. Giant empty space between header area and crossword grid

const { test, expect } = require("./coverage-fixture");

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

function setupLoggedInMocks(page) {
  return page.addInitScript((puzzles) => {
    window.__testOverrides = {
      fetch: function (url) {
        if (url === "/me") return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        if (url === "/api/bootstrap") return Promise.resolve({ ok: true, json: () => Promise.resolve({ balance: { coins: 15 } }) });
        if (typeof url === "string" && url.includes("config.yaml")) return Promise.resolve({ ok: true, text: () => Promise.resolve("") });
        if (typeof url === "string" && url.includes("crosswords.json"))
          return Promise.resolve({ ok: true, json: () => Promise.resolve(puzzles) });
        return Promise.resolve({ ok: false, status: 404 });
      },
    };
  }, puzzlePayload);
}

function setupLoggedOutMocks(page) {
  return page.addInitScript((puzzles) => {
    window.__testOverrides = {
      fetch: function (url) {
        if (url === "/me") return Promise.resolve({ ok: false, status: 401 });
        if (typeof url === "string" && url.includes("config.yaml")) return Promise.resolve({ ok: true, text: () => Promise.resolve("") });
        if (typeof url === "string" && url.includes("crosswords.json"))
          return Promise.resolve({ ok: true, json: () => Promise.resolve(puzzles) });
        return Promise.resolve({ ok: false, status: 404 });
      },
    };
  }, puzzlePayload);
}

// ---------------------------------------------------------------------------
// Bug 1: Session must persist across hard refresh
// ---------------------------------------------------------------------------
test.describe("Session persistence on refresh", () => {
  test("user stays logged in after page reload", async ({ page }) => {
    // Inject mocks that return logged-in for /me on EVERY navigation
    await setupLoggedInMocks(page);
    await page.goto("/");

    // Verify logged-in state: generate button should be enabled
    const genBtn = page.locator("#generateBtn");
    await expect(genBtn).toBeEnabled({ timeout: 5000 });
    await expect(genBtn).toContainText("(5 credits)");

    // Hard refresh
    await page.reload();

    // After reload, user must STILL be logged in
    await expect(genBtn).toBeEnabled({ timeout: 5000 });
    await expect(genBtn).toContainText("(5 credits)");
  });

  test("credit badge persists after page reload", async ({ page }) => {
    await setupLoggedInMocks(page);
    await page.goto("/");

    const badge = page.locator("#headerCreditBadge");
    await expect(badge).toContainText("credits", { timeout: 5000 });

    // Hard refresh
    await page.reload();

    // Badge must still show credits
    await expect(badge).toContainText("credits", { timeout: 5000 });
  });
});

// ---------------------------------------------------------------------------
// Bug 2: Grid cells must be square (not horizontally stretched)
// ---------------------------------------------------------------------------
test.describe("Grid cell dimensions", () => {
  test("crossword cells are square", async ({ page }) => {
    await setupLoggedOutMocks(page);
    await page.goto("/");

    // Navigate to puzzle view
    await page.getByRole("button", { name: "Try a pre-built puzzle" }).click();

    // Wait for grid to render
    const firstCell = page.locator(".cell").first();
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
    await setupLoggedOutMocks(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Try a pre-built puzzle" }).click();

    await page.locator(".cell").first().waitFor({ timeout: 5000 });

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
    await setupLoggedOutMocks(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Try a pre-built puzzle" }).click();

    // Wait for grid
    const firstCell = page.locator(".cell").first();
    await expect(firstCell).toBeVisible({ timeout: 5000 });

    // Find the bottom of the last control area (hdr or panel-bar)
    // and the top of the first grid cell
    const gap = await page.evaluate(() => {
      const panels = document.querySelectorAll(".hdr, .panel-bar, .generate-form");
      let controlsBottom = 0;
      panels.forEach((el) => {
        const rect = el.getBoundingClientRect();
        if (rect.bottom > controlsBottom && rect.height > 0) {
          controlsBottom = rect.bottom;
        }
      });
      const firstCell = document.querySelector(".cell");
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
    await setupLoggedOutMocks(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Try a pre-built puzzle" }).click();

    await page.locator(".cell").first().waitFor({ timeout: 5000 });

    // The .wrap element's visible height should not vastly exceed its scroll height
    const ratio = await page.evaluate(() => {
      const wrap = document.querySelector(".wrap");
      if (!wrap) return 999;
      return wrap.clientHeight / wrap.scrollHeight;
    });

    // If ratio > 1 or close to 1, it means no excessive stretching.
    // If scrollHeight is much less than clientHeight, there's empty space.
    // For a small puzzle, scrollHeight should be roughly equal to clientHeight.
    // We allow some variance but the wrap should not be more than 2x the content.
    expect(ratio).toBeLessThanOrEqual(1.1); // wrap should not be stretched beyond content
  });

  test("puzzle view is horizontally centered and does not span full viewport width", async ({ page }) => {
    await setupLoggedOutMocks(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Try a pre-built puzzle" }).click();
    await page.locator(".cell").first().waitFor({ timeout: 5000 });

    const layout = await page.evaluate(() => {
      const wrap = document.querySelector(".wrap");
      if (!wrap) return null;
      const wrapRect = wrap.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      return {
        wrapWidth: wrapRect.width,
        wrapLeft: wrapRect.left,
        wrapRight: viewportWidth - wrapRect.right,
        viewportWidth: viewportWidth,
      };
    });

    expect(layout).not.toBeNull();
    // Wrap should not consume the full viewport width (leave some margin on each side)
    expect(layout.wrapWidth).toBeLessThan(layout.viewportWidth * 0.95);
    // Wrap should be roughly centered (left and right margins within 50px of each other)
    expect(Math.abs(layout.wrapLeft - layout.wrapRight)).toBeLessThan(50);
    // Left margin should be > 0 (not flush against the edge)
    expect(layout.wrapLeft).toBeGreaterThan(0);
  });
});

test.describe("Header layout", () => {
  test("header spans the full viewport width", async ({ page }) => {
    await setupLoggedOutMocks(page);
    await page.goto("/");

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
    await setupLoggedOutMocks(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Try a pre-built puzzle" }).click();
    await page.locator(".cell").first().waitFor({ timeout: 5000 });

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
    await setupLoggedOutMocks(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Try a pre-built puzzle" }).click();
    await page.locator(".cell").first().waitFor({ timeout: 5000 });

    // The hint button (H) should be visible on at least one clue
    const hintButtons = page.locator("li .hintButton");
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

test.describe("Grid scrollbar", () => {
  test("no extraneous scrollbar or black bar inside the grid viewport", async ({ page }) => {
    await setupLoggedOutMocks(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Try a pre-built puzzle" }).click();
    await page.locator(".cell").first().waitFor({ timeout: 5000 });

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
