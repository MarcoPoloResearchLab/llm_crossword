// @ts-check

const { test, expect } = require("./coverage-fixture");
const { defaultPuzzles, json, setupLoggedInRoutes, setupLoggedOutRoutes } = require("./route-helpers");

const ownedPuzzle = {
  id: "owned-1",
  source: "owned",
  share_token: "owned-share-token",
  title: "Owned Puzzle",
  subtitle: "Solve for credits",
  description: "Stored rewardable puzzle",
  items: defaultPuzzles[0].items,
  reward_summary: {
    owner_reward_status: "available",
    owner_reward_claim_total: 0,
    shared_unique_solves: 2,
    creator_credits_earned: 3,
    creator_puzzle_cap_remaining: 7,
    creator_daily_cap_remaining: 19,
  },
};

const sharedPuzzle = {
  id: "shared-1",
  source: "shared",
  share_token: "shared-token",
  title: "Shared Puzzle",
  subtitle: "Support the creator",
  description: "Shared puzzle description",
  items: defaultPuzzles[0].items,
};

async function openOwnedPuzzle(page) {
  await expect(page.locator("#puzzleView")).toBeVisible({ timeout: 5000 });
  await expect(page.locator("text=My Section")).toBeVisible({ timeout: 5000 });
  await page.locator('[data-puzzle-key="owned-1"]').click();
  await expect(page.locator("#title")).toContainText("Owned Puzzle", { timeout: 5000 });
}

test.describe("Credits gamification", () => {
  test("loads My Section after login and keeps it after reload", async ({ page }) => {
    await setupLoggedInRoutes(page, {
      ownedPuzzles: [ownedPuzzle],
    });

    await page.goto("/");
    await expect(page.locator("text=My Section")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("text=Practice Session")).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-puzzle-key="owned-1"]')).toBeVisible();
    await expect(page.locator('[data-puzzle-key="owned-1"] .puzzle-card__description')).toContainText("Stored rewardable puzzle");

    await page.reload();
    await expect(page.locator("text=My Section")).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-puzzle-key="owned-1"]')).toBeVisible();
  });

  test("shows reward-strip states for owned and practice puzzles", async ({ page }) => {
    await setupLoggedInRoutes(page, {
      ownedPuzzles: [ownedPuzzle],
    });

    await page.goto("/");
    await openOwnedPuzzle(page);
    await expect(page.locator("#rewardStripLabel")).toContainText("Solve to earn credits");
    await expect(page.locator("#rewardStripMeta")).toContainText("Base reward: 3 credits");
    await expect(page.locator("#shareHint")).toContainText("Share to earn up to 10 credits");

    await page.locator('[data-puzzle-key="prebuilt:0"]').click();
    await expect(page.locator("#rewardStripLabel")).toContainText("Practice puzzle");
    await expect(page.locator("#rewardStripMeta")).toContainText("do not affect credits");
  });

  test("shows shared sign-in reward strip for anonymous viewers", async ({ page }) => {
    await setupLoggedOutRoutes(page, {
      extra: {
        "**/api/shared/shared-token": (route) => route.fulfill(json(200, sharedPuzzle)),
      },
    });

    await page.goto("/?puzzle=shared-token");
    await page.getByRole("button", { name: "Try a pre-built puzzle" }).click();
    await expect(page.locator("#title")).toContainText("Shared Puzzle", { timeout: 5000 });
    await expect(page.locator("#rewardStripLabel")).toContainText("Shared puzzle");
    await expect(page.locator("#rewardStripMeta")).toContainText("Sign in if you want your solve to support the creator");
  });

  test("owner completion updates balance, reward strip, and completion modal", async ({ page }) => {
    await setupLoggedInRoutes(page, {
      coins: 18,
      ownedPuzzles: [ownedPuzzle],
      extra: {
        "**/api/puzzles/owned-1/complete": (route) =>
          route.fulfill(
            json(200, {
              mode: "owner",
              balance: { coins: 23 },
              reward: { base: 3, no_hint_bonus: 1, daily_bonus: 1, total: 5 },
              reward_summary: {
                owner_reward_status: "claimed",
                owner_reward_claim_total: 5,
                shared_unique_solves: 2,
                creator_credits_earned: 3,
                creator_puzzle_cap_remaining: 7,
                creator_daily_cap_remaining: 19,
              },
            })
          ),
      },
    });

    await page.goto("/");
    await openOwnedPuzzle(page);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent("crossword:completed", {
        detail: { usedHint: false, usedReveal: false },
      }));
    });

    await expect(page.locator("#completionModal")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("#completionSummary")).toContainText("You earned 5 credits.");
    await expect(page.locator("#completionBreakdown")).toContainText("Base reward");
    await expect(page.locator("#completionBreakdown")).toContainText("No-hint bonus");
    await expect(page.locator("#headerCreditBadge")).toContainText("23 credits");
    await expect(page.locator("#rewardStripLabel")).toContainText("Reward claimed");
  });

  test("shared completion credits the creator without changing solver balance", async ({ page }) => {
    await setupLoggedInRoutes(page, {
      coins: 15,
      extra: {
        "**/api/shared/shared-token": (route) => route.fulfill(json(200, sharedPuzzle)),
        "**/api/shared/shared-token/complete": (route) =>
          route.fulfill(
            json(200, {
              mode: "shared",
              creator_rewarded: true,
              creator_coins: 1,
            })
          ),
      },
    });

    await page.goto("/?puzzle=shared-token");
    await expect(page.locator("#title")).toContainText("Shared Puzzle", { timeout: 5000 });
    await expect(page.locator("#headerCreditBadge")).toContainText("15 credits");

    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent("crossword:completed", {
        detail: { usedHint: false, usedReveal: false },
      }));
    });

    await expect(page.locator("#completionModal")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("#completionTitle")).toContainText("Creator supported");
    await expect(page.locator("#completionSummary")).toContainText("rewarded the creator");
    await expect(page.locator("#headerCreditBadge")).toContainText("15 credits");
  });

  test("reveal marks an owned puzzle ineligible and blocks reward payout", async ({ page }) => {
    await setupLoggedInRoutes(page, {
      coins: 18,
      ownedPuzzles: [ownedPuzzle],
      extra: {
        "**/api/puzzles/owned-1/complete": (route) =>
          route.fulfill(
            json(200, {
              mode: "owner",
              balance: { coins: 18 },
              reward: { base: 0, no_hint_bonus: 0, daily_bonus: 0, total: 0 },
              reason: "revealed",
              reward_summary: {
                owner_reward_status: "ineligible",
                owner_reward_claim_total: 0,
                shared_unique_solves: 2,
                creator_credits_earned: 3,
                creator_puzzle_cap_remaining: 7,
                creator_daily_cap_remaining: 19,
              },
            })
          ),
      },
    });

    await page.goto("/");
    await openOwnedPuzzle(page);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent("crossword:reveal-used", {
        detail: { usedHint: false, usedReveal: true },
      }));
    });

    await expect(page.locator("#completionModal")).toBeHidden();
    await expect(page.locator("#rewardStripLabel")).toContainText("Reward unavailable");
    await expect(page.locator("#headerCreditBadge")).toContainText("18 credits");
  });
});
