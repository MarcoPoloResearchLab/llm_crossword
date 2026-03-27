// @ts-check
// Tests for the redesigned layout:
// 1. No container-in-a-page — content fills full page width
// 2. Clues take ~25% of page width, always on the right
// 3. Grid takes ~75%, scrolls/pans if needed
// 4. Cell size never changes (always --cell-size = 44px)
// 5. Clue text wraps — never truncated

const { test, expect } = require("./coverage-fixture");
const { setupLoggedOutRoutes } = require("./route-helpers");

const puzzlePayload = [
  {
    title: "Layout Test",
    subtitle: "Testing layout constraints.",
    items: [
      { word: "athena", definition: "Goddess of wisdom, handicraft, and strategic warfare in ancient mythology", hint: "owl companion" },
      { word: "poseidon", definition: "God of the sea, earthquakes, and horses who carried a mighty trident", hint: "brother of Zeus" },
      { word: "artemis", definition: "Goddess of the hunt, wilderness, and protector of young children", hint: "twin of Apollo" },
      { word: "hermes", definition: "Messenger god known for speed and cunning who guided souls to the underworld", hint: "winged sandals" },
      { word: "demeter", definition: "Goddess of the harvest and agriculture whose grief caused winter", hint: "mother of Persephone" },
      { word: "hades", definition: "God of the underworld and ruler of the dead in Greek mythology", hint: "invisible helmet" },
      { word: "apollo", definition: "God of the sun, music, poetry, and prophecy at the Oracle of Delphi", hint: "golden lyre" },
      { word: "zeus", definition: "King of the Olympian gods who wielded thunderbolts from Mount Olympus", hint: "ruler of the sky" },
      { word: "ares", definition: "God of war known for his brutal and violent nature in battle", hint: "feared by mortals" },
      { word: "hera", definition: "Queen of the gods and goddess of marriage and family", hint: "wife of Zeus" },
    ],
  },
];

async function goToPuzzle(page) {
  await setupLoggedOutRoutes(page, { puzzles: puzzlePayload });
  await page.goto("/");
  await page.getByRole("button", { name: "Try a pre-built puzzle" }).click();
  await expect(page.locator("#puzzleView")).toBeVisible();
  await expect(page.locator("#puzzleView .cell:not(.blk)").first()).toBeVisible();
}

test.describe("Layout — no container-in-a-page", () => {
  test("puzzle view spans full viewport width (no inner box)", async ({ page }) => {
    await goToPuzzle(page);

    var layout = await page.evaluate(() => {
      var pv = document.getElementById("puzzleView");
      if (!pv) return null;
      var rect = pv.getBoundingClientRect();
      return { pvWidth: rect.width, viewportWidth: window.innerWidth };
    });

    expect(layout).not.toBeNull();
    // Puzzle view should use most of the viewport width (within padding)
    expect(layout.pvWidth).toBeGreaterThanOrEqual(layout.viewportWidth * 0.9);
  });
});

test.describe("Layout — clues always on the right at 25%", () => {
  test("clues container takes approximately 25% of puzzle-main width", async ({ page }) => {
    await goToPuzzle(page);

    var layout = await page.evaluate(() => {
      var pv = document.getElementById("puzzleView");
      if (!pv) return null;
      var clues = pv.querySelector(".clues");
      // Measure against .puzzle-main (the right panel), not the full viewport,
      // since .puzzle-sidebar takes ~280px on the left.
      var main = pv.querySelector(".puzzle-main") || pv;
      if (!clues) return null;
      return { clueWidth: clues.getBoundingClientRect().width, mainWidth: main.getBoundingClientRect().width };
    });

    expect(layout).not.toBeNull();
    var ratio = layout.clueWidth / layout.mainWidth;
    // Clues should be between 20% and 40% of the main area
    expect(ratio).toBeGreaterThanOrEqual(0.20);
    expect(ratio).toBeLessThanOrEqual(0.40);
  });

  test("clues are to the right of the grid", async ({ page }) => {
    await goToPuzzle(page);

    var layout = await page.evaluate(() => {
      var pv = document.getElementById("puzzleView");
      if (!pv) return null;
      var grid = pv.querySelector(".gridViewport");
      var clues = pv.querySelector(".clues");
      if (!grid || !clues) return null;
      return {
        gridRight: grid.getBoundingClientRect().right,
        cluesLeft: clues.getBoundingClientRect().left,
      };
    });

    expect(layout).not.toBeNull();
    expect(layout.cluesLeft).toBeGreaterThanOrEqual(layout.gridRight - 20);
  });
});

test.describe("Layout — cell size invariant", () => {
  test("cells are exactly --cell-size (44px) wide and tall", async ({ page }) => {
    await goToPuzzle(page);

    var cellBox = await page.locator("#puzzleView .cell:not(.blk)").first().boundingBox();
    expect(cellBox).not.toBeNull();
    // Cells must be 44px (the --cell-size default), tolerance of 2px
    expect(Math.abs(cellBox.width - 44)).toBeLessThanOrEqual(2);
    expect(Math.abs(cellBox.height - 44)).toBeLessThanOrEqual(2);
  });

  test("cells are square", async ({ page }) => {
    await goToPuzzle(page);

    var cellBox = await page.locator("#puzzleView .cell:not(.blk)").first().boundingBox();
    expect(cellBox).not.toBeNull();
    expect(Math.abs(cellBox.width - cellBox.height)).toBeLessThanOrEqual(2);
  });
});

test.describe("Layout — clue text wraps, never truncated", () => {
  test("no clue text is truncated (scrollWidth <= clientWidth)", async ({ page }) => {
    await goToPuzzle(page);

    var truncated = await page.evaluate(() => {
      var pv = document.getElementById("puzzleView");
      if (!pv) return ["no puzzleView"];
      var items = pv.querySelectorAll("li");
      var result = [];
      for (var i = 0; i < items.length; i++) {
        if (items[i].scrollWidth > items[i].clientWidth + 2) {
          result.push(items[i].textContent.substring(0, 50));
        }
      }
      return result;
    });

    expect(truncated).toHaveLength(0);
  });

  test("long clue text wraps to multiple lines", async ({ page }) => {
    await goToPuzzle(page);

    var hasMultiLine = await page.evaluate(() => {
      var pv = document.getElementById("puzzleView");
      if (!pv) return false;
      var items = pv.querySelectorAll("li");
      for (var i = 0; i < items.length; i++) {
        // If height > 1.5 * line-height, text has wrapped
        var style = getComputedStyle(items[i]);
        var lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2;
        if (items[i].getBoundingClientRect().height > lineHeight * 1.5) {
          return true;
        }
      }
      return false;
    });

    // At least one clue should wrap (our test clues are long)
    expect(hasMultiLine).toBe(true);
  });

  test("every clue has a visible hint button", async ({ page }) => {
    await goToPuzzle(page);

    var hintButtons = page.locator("#puzzleView li .hintButton");
    var count = await hintButtons.count();
    expect(count).toBeGreaterThanOrEqual(5);

    for (var i = 0; i < count; i++) {
      var box = await hintButtons.nth(i).boundingBox();
      expect(box).not.toBeNull();
      expect(box.width).toBeGreaterThan(10);
      expect(box.height).toBeGreaterThan(10);
    }
  });
});

test.describe("Layout — no black bar artifact", () => {
  test("grid viewport has no excess height below the grid", async ({ page }) => {
    await goToPuzzle(page);

    var info = await page.evaluate(() => {
      var pv = document.getElementById("puzzleView");
      if (!pv) return null;
      var gv = pv.querySelector(".gridViewport");
      var grid = pv.querySelector(".grid");
      if (!gv || !grid) return null;
      return {
        viewportHeight: gv.getBoundingClientRect().height,
        gridHeight: grid.getBoundingClientRect().height,
      };
    });

    expect(info).not.toBeNull();
    // No more than 50px excess (no black bar)
    expect(info.viewportHeight - info.gridHeight).toBeLessThanOrEqual(50);
  });
});
