// @ts-check

const { test, expect } = require("./coverage-fixture");
const { createBillingSummary, json, setupLoggedInRoutes, setupLoggedOutRoutes } = require("./route-helpers");

function buildEnabledBillingSummary(overrides = {}) {
  return createBillingSummary({
    enabled: true,
    provider_code: "paddle",
    balance: { coins: 2 },
    packs: [
      {
        code: "starter",
        credits: 20,
        label: "Starter Pack",
        price_display: "$20.00",
      },
      {
        code: "creator",
        credits: 60,
        label: "Creator Pack",
        price_display: "$54.00",
      },
    ],
    activity: [
      {
        event_id: "evt_credited",
        event_type: "transaction.completed",
        transaction_id: "txn_paid",
        pack_code: "starter",
        credits_delta: 20,
        status: "completed",
        summary: "Starter Pack credited 20 credits.",
        occurred_at: "2026-03-28T18:30:00Z",
      },
    ],
    portal_available: true,
    ...(overrides || {}),
  });
}

test.describe("Billing UI", () => {
  test("insufficient-credits CTA opens billing with packs and activity", async ({ page }) => {
    await setupLoggedInRoutes(page, {
      coins: 2,
      extra: {
        "**/api/billing/summary": (route) =>
          route.fulfill(json(200, buildEnabledBillingSummary())),
      },
    });

    await page.goto("/");
    await expect(page.locator("#puzzleView")).toBeVisible({ timeout: 5000 });

    await page.locator("#newCrosswordCard").click();
    await expect(page.locator("#generateBuyCreditsButton")).toBeVisible({ timeout: 5000 });

    await page.locator("#generateBuyCreditsButton").click();

    await expect(page.locator("#settingsDrawer")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("#settingsBillingBalanceValue")).toContainText("2 credits");
    await expect(page.locator("#settingsBillingPackList")).toContainText("Starter Pack");
    await expect(page.locator("#settingsBillingActivityList")).toContainText("Starter Pack credited 20 credits.");
    await expect(page.locator("#settingsManageBillingButton")).toBeVisible();
  });

  test("checkout return restores the drawer and refreshes the balance after completion", async ({ page }) => {
    var reconcileCallCount = 0;
    var summaryCallCount = 0;
    var pendingSummary = buildEnabledBillingSummary({
      activity: [
        {
          event_id: "evt_created",
          event_type: "transaction.created",
          transaction_id: "txn_return",
          pack_code: "starter",
          credits_delta: 0,
          status: "ready",
          summary: "Checkout created.",
          occurred_at: "2026-03-28T18:31:00Z",
        },
      ],
    });
    var completedSummary = buildEnabledBillingSummary({
      balance: { coins: 22 },
      activity: [
        {
          event_id: "evt_completed",
          event_type: "transaction.completed",
          transaction_id: "txn_return",
          pack_code: "starter",
          credits_delta: 20,
          status: "completed",
          summary: "Starter Pack credited 20 credits.",
          occurred_at: "2026-03-28T18:32:00Z",
        },
      ],
    });

    await setupLoggedInRoutes(page, {
      coins: 2,
      extra: {
        "**/api/billing/checkout/reconcile": (route) => {
          reconcileCallCount += 1;
          route.fulfill(json(200, {
            provider_code: "paddle",
            transaction_id: "txn_return",
            status: reconcileCallCount < 2 ? "pending" : "succeeded",
          }));
        },
        "**/api/billing/summary": (route) => {
          summaryCallCount += 1;
          route.fulfill(json(200, summaryCallCount < 3 ? pendingSummary : completedSummary));
        },
      },
    });

    await page.goto("/?billing_transaction_id=txn_return");

    await expect(page.locator("#settingsDrawer")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("#headerCreditBadge")).toContainText("22 credits", { timeout: 12000 });
    await expect(page.locator("#settingsBillingStatus")).toContainText("Payment confirmed", { timeout: 10000 });
    await expect(page).not.toHaveURL(/billing_transaction_id=/);
  });

  test("anonymous users never see purchase entry points", async ({ page }) => {
    await setupLoggedOutRoutes(page);
    await page.goto("/");

    await expect(page.locator("#headerCreditBadge")).toBeHidden();
    await expect(page.locator("#generateBuyCreditsButton")).toBeHidden();
  });
});
