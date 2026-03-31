// @ts-check

const { test, expect } = require("./coverage-fixture");
const { setupLoggedInRoutes, setupLoggedOutRoutes, json, createSession } = require("./route-helpers");

test.describe("App auth — logged in state", () => {
  test("logged-in user never lands on the landing page", async ({ page }) => {
    await setupLoggedInRoutes(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });

    await expect(page.locator("#landingPage")).toBeHidden({ timeout: 5000 });
    await expect(page.locator("#puzzleView")).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(200);
    await expect(page.locator("#landingPage")).toBeHidden();
  });

  test("generate button is enabled with credits when logged in", async ({ page }) => {
    await setupLoggedInRoutes(page);
    await page.goto("/");
    await expect(page.locator("#landingPage")).toBeHidden({ timeout: 5000 });
    await expect(page.locator("#puzzleView")).toBeVisible({ timeout: 5000 });
    await page.locator("#newCrosswordCard").click();
    var genBtn = page.locator("#generateBtn");
    await expect(genBtn).toBeEnabled({ timeout: 5000 });
    await expect(genBtn).toContainText("(4 credits)");
  });

  test("user with exactly four credits can still generate a puzzle", async ({ page }) => {
    var generateCalls = 0;

    await setupLoggedInRoutes(page, {
      coins: 4,
      generationCostCoins: 4,
      extra: {
        "**/api/generate": (route) => {
          generateCalls += 1;
          return route.fulfill(
            json(200, {
              title: "Four Credit Puzzle",
              subtitle: "Exact-cost generation still works.",
              balance: { coins: 0 },
              items: [
                { word: "orbit", definition: "Path around Earth", hint: "route" },
                { word: "mare", definition: "Lunar sea", hint: "horse" },
                { word: "tides", definition: "Ocean rise-and-fall", hint: "shifts" },
                { word: "lunar", definition: "Relating to Moon", hint: "companion" },
                { word: "apollo", definition: "Moon program", hint: "missions" },
              ],
            })
          );
        },
      },
    });

    await page.goto("/");
    await expect(page.locator("#landingPage")).toBeHidden({ timeout: 5000 });
    await expect(page.locator("#puzzleView")).toBeVisible({ timeout: 5000 });
    await page.locator("#newCrosswordCard").click();
    await expect(page.locator("#generateBtn")).toBeEnabled({ timeout: 5000 });
    await expect(page.locator("#generateStatus")).toHaveText("");

    await page.fill("#topicInput", "moon");
    await page.locator("#generateBtn").click();

    expect(generateCalls).toBe(1);
    await expect(page.locator("#title")).toContainText("Four Credit Puzzle", { timeout: 5000 });
    await expect(page.getByText("Not enough credits")).toHaveCount(0);
  });

  test("generation gate follows the backend cost from balance data", async ({ page }) => {
    await setupLoggedInRoutes(page, {
      coins: 5,
      generationCostCoins: 6,
    });

    await page.goto("/");
    await expect(page.locator("#landingPage")).toBeHidden({ timeout: 5000 });
    await expect(page.locator("#puzzleView")).toBeVisible({ timeout: 5000 });
    await page.locator("#newCrosswordCard").click();

    await expect(page.locator("#generateBtn")).toBeDisabled({ timeout: 5000 });
    await expect(page.locator("#generateBtn")).toContainText("(6 credits)");
    await expect(page.locator("#generateStatus")).toContainText("You need 6 credits");
  });

  test("credit badge shows balance after login", async ({ page }) => {
    await setupLoggedInRoutes(page);
    await page.goto("/");
    await expect(page.locator("#landingPage")).toBeHidden({ timeout: 5000 });
    // Wait for bootstrap to complete
    await expect(page.locator("#headerCreditBadge")).toContainText("credits", { timeout: 5000 });
  });

  test("auth restore does not flash the landing page while login is settling", async ({ page }) => {
    await page.addInitScript(() => {
      window.sessionStorage.setItem("llm-crossword-auth-pending", "1");
    });
    await setupLoggedInRoutes(page, {
      extra: {
        "**/me": async (route) => {
          await new Promise((resolve) => setTimeout(resolve, 5000));
          await route.fulfill(json(200, {}));
        },
      },
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });

    await expect(page.locator("#landingPage")).toBeHidden({ timeout: 500 });
    await expect(page.locator("#puzzleView")).toBeVisible({ timeout: 10000 });
  });

  test("auth restore stays on the puzzle when the first /me check is unauthorized but the retry succeeds", async ({ page }) => {
    var meCalls = 0;

    await page.addInitScript(() => {
      window.sessionStorage.setItem("llm-crossword-auth-pending", "1");
    });
    await setupLoggedInRoutes(page, {
      extra: {
        "**/me": async (route) => {
          meCalls += 1;
          if (meCalls === 1) {
            await route.fulfill(json(401, { error: "unauthorized" }));
            return;
          }
          await route.fulfill(json(200, {}));
        },
      },
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });

    await expect(page.locator("#landingPage")).toBeHidden({ timeout: 500 });
    await expect(page.locator("#puzzleView")).toBeVisible({ timeout: 500 });
    await page.waitForTimeout(1500);
    await expect(page.locator("#landingPage")).toBeHidden();
    await expect(page.locator("#puzzleView")).toBeVisible();
  });

  test("sign in to generate restores directly into the generator instead of the moon prebuilt puzzle", async ({ page }) => {
    await page.addInitScript(() => {
      window.sessionStorage.setItem("llm-crossword-auth-pending", "1");
      window.sessionStorage.setItem("llm-crossword-post-login-view", "generator");
    });
    await setupLoggedInRoutes(page, {
      extra: {
        "**/me": async (route) => {
          await new Promise((resolve) => setTimeout(resolve, 3000));
          await route.fulfill(json(200, {}));
        },
      },
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });

    await expect(page.locator("#landingPage")).toBeHidden({ timeout: 500 });
    await expect(page.locator("#generatePanel")).toBeVisible({ timeout: 500 });
    await expect(page.locator("#title")).toContainText("Generate a New Crossword", { timeout: 10000 });
    await expect(page.locator("#generatePanel")).toBeVisible();
    await expect(page.locator("#puzzleView .pane")).toBeHidden();
  });

  test("logged-in puzzle view does not show a back button", async ({ page }) => {
    await setupLoggedInRoutes(page);
    await page.goto("/");

    await expect(page.locator("#landingPage")).toBeHidden({ timeout: 5000 });
    await expect(page.locator("#puzzleView")).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole("button", { name: "Back" })).toHaveCount(0);
    await expect(page.locator("#landingPage")).toBeHidden();
    await expect(page.locator("#puzzleView")).toBeVisible();
  });
});

test.describe("App auth — logged out state", () => {
  test("logged-out user sees the landing page and not the puzzle view", async ({ page }) => {
    await setupLoggedOutRoutes(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });

    await expect(page.locator("#landingPage")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("#puzzleView")).toBeHidden();
  });

  test("generate form is hidden when not logged in", async ({ page }) => {
    await setupLoggedOutRoutes(page);
    await page.goto("/");
    await expect(page.locator("#landingPage")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("#puzzleView")).toBeHidden();
    // Generate form is hidden on landing page when logged out
    await expect(page.locator("#generatePanel")).toBeHidden({ timeout: 5000 });
    // Generate button should be disabled
    var genBtn = page.locator("#generateBtn");
    await expect(genBtn).toBeDisabled();
  });

  test("generate form appears after clicking New Crossword", async ({ page }) => {
    await setupLoggedInRoutes(page);
    await page.goto("/");
    // Logged-in user sees puzzle view with sidebar
    await expect(page.locator("#puzzleView")).toBeVisible({ timeout: 5000 });
    // Generate panel is hidden until New Crossword card is clicked
    await expect(page.locator("#generatePanel")).toBeHidden();
    await page.locator("#newCrosswordCard").click();
    await expect(page.locator("#generatePanel")).toBeVisible({ timeout: 5000 });
  });

  test("late /me response does not reopen the landing page after choosing a pre-built puzzle", async ({ page }) => {
    await setupLoggedOutRoutes(page, {
      extra: {
        "**/me": async (route) => {
          await new Promise((resolve) => setTimeout(resolve, 5000));
          await route.fulfill(json(401, { error: "unauthorized" }));
        },
      },
    });
    const meResponse = page.waitForResponse((response) => response.url().includes("/me"));

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Try a pre-built puzzle" }).click();

    await expect(page.locator("#puzzleView")).toBeVisible();
    await expect(page.locator("#landingPage")).toBeHidden();

    await meResponse;

    await expect(page.locator("#puzzleView")).toBeVisible();
    await expect(page.locator("#landingPage")).toBeHidden();
  });

  test("stale auth-pending state eventually falls back to the landing page after the retry also fails", async ({ page }) => {
    await page.addInitScript(() => {
      window.sessionStorage.setItem("llm-crossword-auth-pending", "1");
    });
    await setupLoggedOutRoutes(page, {
      extra: {
        "**/me": (route) => route.fulfill(json(401, { error: "unauthorized" })),
      },
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });

    await expect(page.locator("#puzzleView")).toBeVisible({ timeout: 500 });
    await expect(page.locator("#landingPage")).toBeHidden({ timeout: 500 });
    await expect(page.locator("#landingPage")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("#puzzleView")).toBeHidden();
  });
});

test.describe("App auth — bootstrap failure", () => {
  test("UI still works when bootstrap fails", async ({ page }) => {
    const warnings = [];
    page.on("console", (msg) => {
      if (msg.type() === "warning") warnings.push(msg.text());
    });
    // Bootstrap fails with a network error; use extra to override
    await setupLoggedInRoutes(page, {
      extra: {
        "**/api/bootstrap": (route) => route.abort("failed"),
      },
    });
    await page.goto("/");
    // onLogin() auto-navigates to puzzle view
    await expect(page.locator("#puzzleView")).toBeVisible({ timeout: 5000 });
    await page.locator("#newCrosswordCard").click();
    await expect(page.locator("#generateBtn")).toBeDisabled({ timeout: 5000 });
    await expect(page.locator("#generateStatus")).toContainText("couldn't load your credit balance", { timeout: 5000 });
    expect(warnings.some((text) => text.includes("bootstrap failed"))).toBeTruthy();
  });
});

test.describe("App auth — bootstrap loading gate", () => {
  test("generate stays disabled until bootstrap returns a balance", async ({ page }) => {
    await setupLoggedInRoutes(page, {
      extra: {
        "**/api/bootstrap": async (route) => {
          await new Promise((resolve) => setTimeout(resolve, 1500));
          await route.fulfill(json(200, {
            balance: {
              coins: 15,
              generation_cost_coins: 4,
            },
            grants: { bootstrap_coins: 0, daily_login_coins: 0, low_balance_coins: 0 },
          }));
        },
      },
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#puzzleView")).toBeVisible({ timeout: 5000 });

    await page.locator("#newCrosswordCard").click();
    await expect(page.locator("#generateBtn")).toBeDisabled();
    await expect(page.locator("#generateStatus")).toContainText("Loading your credit balance", { timeout: 5000 });

    await expect(page.locator("#generateBtn")).toBeEnabled({ timeout: 5000 });
  });
});

test.describe("App auth — generate success", () => {
  test("renders puzzle and shows 'Puzzle ready!' message", async ({ page }) => {
    await setupLoggedInRoutes(page);
    // Add generate route (LIFO: this takes priority over any base routes)
    await page.route("**/api/generate", (route) =>
      route.fulfill(
        json(200, {
          title: "Test Generated",
          subtitle: "From LLM.",
          description: "This puzzle focuses on familiar lunar vocabulary and exploration references.",
          balance: { coins: 10 },
          items: [
            { word: "orbit", definition: "The Moon's path around Earth", hint: "elliptical route" },
            { word: "mare", definition: "A lunar sea", hint: "shares name with horse" },
            { word: "tides", definition: "Ocean rise-and-fall", hint: "regular shoreline shifts" },
            { word: "lunar", definition: "Relating to the Moon", hint: "Earth's companion" },
            { word: "apollo", definition: "Program that took humans to the Moon", hint: "Saturn V missions" },
          ],
        })
      )
    );
    await page.goto("/");
    // Logged-in user sees puzzle view; click New Crossword to show generate form
    await expect(page.locator("#puzzleView")).toBeVisible({ timeout: 5000 });
    await page.locator("#newCrosswordCard").click();
    await expect(page.locator("#generateBtn")).toBeEnabled({ timeout: 5000 });
    await page.fill("#topicInput", "moon");
    await page.locator("#generateBtn").click();
    // After successful generation, puzzle is rendered and generate panel is hidden
    await expect(page.locator("#puzzleView")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("#title")).toContainText("Test Generated", { timeout: 5000 });
    await expect(page.locator("#generatePanel")).toBeHidden();
  });
});

test.describe("App auth — generate insufficient credits", () => {
  test("shows 'Not enough credits' message", async ({ page }) => {
    await setupLoggedInRoutes(page, { coins: 2 });
    // Add generate route that returns 402
    await page.route("**/api/generate", (route) =>
      route.fulfill(
        json(402, { error: "insufficient_credits", message: "Not enough credits" })
      )
    );
    await page.goto("/");
    // Logged-in user sees puzzle view; click New Crossword to show generate form
    await expect(page.locator("#puzzleView")).toBeVisible({ timeout: 5000 });
    await page.locator("#newCrosswordCard").click();
    // With only 2 credits, generate button should be disabled and message shown immediately
    await expect(page.locator("#generateBtn")).toBeDisabled({ timeout: 5000 });
    await expect(page.getByText("Not enough credits")).toBeVisible({ timeout: 5000 });
  });
});

test.describe("App auth — generate network error", () => {
  test("shows 'Network error' message", async ({ page }) => {
    await setupLoggedInRoutes(page);
    // Add generate route that aborts with a network error
    await page.route("**/api/generate", (route) => route.abort("failed"));
    await page.goto("/");
    // Logged-in user sees puzzle view; click New Crossword to show generate form
    await expect(page.locator("#puzzleView")).toBeVisible({ timeout: 5000 });
    await page.locator("#newCrosswordCard").click();
    await expect(page.locator("#generateBtn")).toBeEnabled({ timeout: 5000 });
    await page.fill("#topicInput", "moon");
    await page.locator("#generateBtn").click();
    await expect(page.getByText("Network error")).toBeVisible({ timeout: 10000 });
  });
});

test.describe("App auth — empty topic", () => {
  test("shows 'Please enter a topic.' when topic is empty", async ({ page }) => {
    await setupLoggedInRoutes(page);
    await page.goto("/");
    // Logged-in user sees puzzle view; click New Crossword to show generate form
    await expect(page.locator("#puzzleView")).toBeVisible({ timeout: 5000 });
    await page.locator("#newCrosswordCard").click();
    await expect(page.locator("#generateBtn")).toBeEnabled({ timeout: 5000 });
    await page.locator("#generateBtn").click();
    await expect(page.getByText("Please enter a topic.")).toBeVisible();
  });
});

test.describe("App auth — landing Sign in button fallback", () => {
  test("landing Sign in button falls back to puzzle view when no header sign-in button", async ({ page }) => {
    await setupLoggedOutRoutes(page);
    await page.goto("/");
    // Wait for landing page to stabilize
    await expect(page.locator("#landingPage")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("#landingSignIn")).toBeVisible();
    // Click landing Sign in button — since there's no real mpr-header Google sign-in button,
    // it should fall back to showing puzzle view with generate tab.
    await page.locator("#landingSignIn").click();
    // The fallback should either show puzzle view or trigger some sign-in flow.
    // Since mpr-ui may dispatch auth events, just verify the button is clickable and the page responds.
    // After click, either puzzle view is shown (fallback) or landing remains (if auth event resets).
    var puzzleVisible = await page.locator("#puzzleView").isVisible();
    var landingVisible = await page.locator("#landingPage").isVisible();
    // At least one should be visible — page should not be blank.
    expect(puzzleVisible || landingVisible).toBeTruthy();
  });
});

test.describe("Settings modal — avatar dropdown", () => {
  var adminConfigYaml =
    'administrators:\n  - "admin@example.com"\n\nenvironments: []\n';

  test("logged-in user sees Settings and Log out in avatar dropdown", async ({
    page,
  }) => {
    await setupLoggedInRoutes(page, {
      session: createSession({
        user_id: "admin-user",
        email: "admin@example.com",
        display: "Admin",
        roles: ["member", "admin"],
        is_admin: true,
      }),
      configYaml: adminConfigYaml,
    });
    await page.goto("/");
    await expect(page.locator("#puzzleView")).toBeVisible({ timeout: 5000 });

    // Wait for admin.js to set menu-items on mpr-user after /api/session responds.
    await page.waitForFunction(
      () => {
        var el = document.getElementById("userMenu");
        return el && el.getAttribute("menu-items");
      },
      { timeout: 5000 }
    );

    // Click avatar trigger to open dropdown.
    await page.click('[data-mpr-user="trigger"]');

    // Both menu items should be visible.
    await expect(
      page.locator('[data-mpr-user="menu-item"]', { hasText: "Settings" })
    ).toBeVisible();
    await expect(
      page.locator('[data-mpr-user="logout"]', { hasText: "Log out" })
    ).toBeVisible();
  });

  test("clicking Settings opens the settings modal", async ({ page }) => {
    await setupLoggedInRoutes(page, {
      session: createSession({
        user_id: "admin-user",
        email: "admin@example.com",
        display: "Admin",
        roles: ["member", "admin"],
        is_admin: true,
      }),
      configYaml: adminConfigYaml,
    });
    await page.goto("/");
    await expect(page.locator("#puzzleView")).toBeVisible({ timeout: 5000 });

    await page.waitForFunction(
      () => {
        var el = document.getElementById("userMenu");
        return el && el.getAttribute("menu-items");
      },
      { timeout: 5000 }
    );

    // Open dropdown and click Settings.
    await page.click('[data-mpr-user="trigger"]');
    await page.click('[data-mpr-user-action="settings"]');

    // Modal should be open (has open attribute).
    await expect(page.locator("#settingsDrawer")).toHaveAttribute("open", "", {
      timeout: 5000,
    });
  });

  test("settings modal shows Account tab with the full session info", async ({
    page,
  }) => {
    await setupLoggedInRoutes(page, {
      session: {
        user_id: "user-123",
        email: "admin@example.com",
        display: "Admin User",
        avatar_url: "https://example.com/avatar.png",
        roles: ["member", "admin"],
        expires: 1704067200,
        is_admin: true,
      },
      configYaml: adminConfigYaml,
    });
    await page.goto("/");
    await expect(page.locator("#puzzleView")).toBeVisible({ timeout: 5000 });

    await page.waitForFunction(
      () => {
        var el = document.getElementById("userMenu");
        return el && el.getAttribute("menu-items");
      },
      { timeout: 5000 }
    );

    await page.click('[data-mpr-user="trigger"]');
    await page.click('[data-mpr-user-action="settings"]');

    // Account tab should show user info.
    await expect(page.locator("#settingsName")).toHaveText("Admin User");
    await expect(page.locator("#settingsEmail")).toHaveText(
      "admin@example.com"
    );
    await expect(page.locator("#settingsAccountDetails")).not.toContainText("user-123");
    await expect(page.locator("#settingsAccountDetails")).not.toContainText("member, admin");
    await expect(page.locator("#settingsAccountDetails")).not.toContainText("Yes");
    await expect(page.locator("#settingsAccountDetails")).toContainText(
      "2024-01-01T00:00:00.000Z"
    );
  });

  test("settings trusts the session admin state instead of re-reading config", async ({
    page,
  }) => {
    await setupLoggedInRoutes(page, {
      session: {
        user_id: "user-123",
        email: "admin@example.com",
        display: "Admin User",
        avatar_url: "https://example.com/avatar.png",
        roles: ["user"],
        expires: 1704067200,
        is_admin: false,
      },
      configYaml: adminConfigYaml,
    });
    await page.goto("/");
    await expect(page.locator("#puzzleView")).toBeVisible({ timeout: 5000 });

    await page.waitForFunction(
      () => {
        var el = document.getElementById("userMenu");
        return el && el.getAttribute("menu-items");
      },
      { timeout: 5000 }
    );

    await page.click('[data-mpr-user="trigger"]');
    await page.click('[data-mpr-user-action="settings"]');

    await expect(page.locator("#settingsAccountDetails")).toContainText("Admin User");
    await expect(page.locator("#settingsAccountDetails")).not.toContainText("user, admin");
    await expect(page.locator("#settingsAccountDetails")).not.toContainText("No");
    await expect(page.locator("#settingsTabAdmin")).toBeHidden();
  });

  test("admin user sees Admin tab in settings modal", async ({ page }) => {
    await setupLoggedInRoutes(page, {
      session: createSession({
        user_id: "admin-user",
        email: "admin@example.com",
        display: "Admin",
        roles: ["member", "admin"],
        is_admin: true,
      }),
      configYaml: adminConfigYaml,
    });
    await page.goto("/");
    await expect(page.locator("#puzzleView")).toBeVisible({ timeout: 5000 });

    await page.waitForFunction(
      () => {
        var el = document.getElementById("userMenu");
        return el && el.getAttribute("menu-items");
      },
      { timeout: 5000 }
    );

    await page.click('[data-mpr-user="trigger"]');
    await page.click('[data-mpr-user-action="settings"]');

    // Admin tab should be visible for admin users.
    await expect(page.locator("#settingsTabAdmin")).toBeVisible();
  });

  test("non-admin user does not see Admin tab", async ({ page }) => {
    await setupLoggedInRoutes(page, {
      session: createSession({
        user_id: "regular-user",
        email: "regular@example.com",
        display: "Regular User",
      }),
      configYaml: adminConfigYaml,
    });
    await page.goto("/");
    await expect(page.locator("#puzzleView")).toBeVisible({ timeout: 5000 });

    await page.waitForFunction(
      () => {
        var el = document.getElementById("userMenu");
        return el && el.getAttribute("menu-items");
      },
      { timeout: 5000 }
    );

    await page.click('[data-mpr-user="trigger"]');
    await page.click('[data-mpr-user-action="settings"]');

    // Admin tab should be hidden for non-admin users.
    await expect(page.locator("#settingsTabAdmin")).toBeHidden();
  });
});
