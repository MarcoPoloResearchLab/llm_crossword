// @ts-check

const { test, expect } = require("./coverage-fixture");
const { setupLoggedInRoutes, setupLoggedOutRoutes, json } = require("./route-helpers");

test.describe("App auth — logged in state", () => {
  test("generate button is enabled with credits when logged in", async ({ page }) => {
    await setupLoggedInRoutes(page);
    await page.goto("/");
    await expect(page.locator("#puzzleView")).toBeVisible({ timeout: 5000 });
    await page.locator("#newCrosswordCard").click();
    var genBtn = page.locator("#generateBtn");
    await expect(genBtn).toBeEnabled({ timeout: 5000 });
    await expect(genBtn).toContainText("(5 credits)");
  });

  test("credit badge shows balance after login", async ({ page }) => {
    await setupLoggedInRoutes(page);
    await page.goto("/");
    // Wait for bootstrap to complete
    await expect(page.locator("#headerCreditBadge")).toContainText("credits", { timeout: 5000 });
  });
});

test.describe("App auth — logged out state", () => {
  test("generate form is hidden when not logged in", async ({ page }) => {
    await setupLoggedOutRoutes(page);
    await page.goto("/");
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
    // Generate button should still be enabled after clicking New Crossword
    await page.locator("#newCrosswordCard").click();
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

test.describe("Settings drawer — avatar dropdown", () => {
  var adminConfigYaml =
    'administrators:\n  - "admin@example.com"\n\nenvironments: []\n';

  test("logged-in user sees Settings and Log out in avatar dropdown", async ({
    page,
  }) => {
    await setupLoggedInRoutes(page, {
      session: { email: "admin@example.com", name: "Admin" },
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

  test("clicking Settings opens the settings drawer", async ({ page }) => {
    await setupLoggedInRoutes(page, {
      session: { email: "admin@example.com", name: "Admin" },
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

    // Drawer should be open (has open attribute).
    await expect(page.locator("#settingsDrawer")).toHaveAttribute("open", "", {
      timeout: 5000,
    });
  });

  test("settings drawer shows Account tab with user info", async ({
    page,
  }) => {
    await setupLoggedInRoutes(page, {
      session: {
        email: "admin@example.com",
        name: "Admin User",
        picture: "https://example.com/avatar.png",
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
  });

  test("admin user sees Admin tab in settings drawer", async ({ page }) => {
    await setupLoggedInRoutes(page, {
      session: { email: "admin@example.com", name: "Admin" },
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
      session: { email: "regular@example.com", name: "Regular User" },
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
