// @ts-check

const { test, expect } = require("./coverage-fixture");
const {
  setupLoggedInRoutes,
  setupLoggedOutRoutes,
  json,
  defaultPuzzles,
  createSession,
  mountAppShell,
} = require("./route-helpers");

const ADMIN_CONFIG_YAML = 'administrators:\n  - "admin@example.com"\n';

function clonePuzzleSpec(title) {
  return {
    title,
    subtitle: title + " subtitle",
    items: defaultPuzzles[0].items.map((item) => ({
      word: item.word,
      definition: item.definition,
      hint: item.hint,
    })),
  };
}

async function loadScript(page, fileName) {
  await page.addScriptTag({ url: `/js/${fileName}` });
}

async function openSettingsDrawer(page) {
  await page.waitForFunction(() => {
    var el = document.getElementById("userMenu");
    return el && el.getAttribute("menu-items");
  });
  await page.click('[data-mpr-user="trigger"]');
  await page.click('[data-mpr-user-action="settings"]');
  await expect(page.locator("#settingsDrawer")).toHaveAttribute("open", "");
}

async function openAdminTab(page) {
  await openSettingsDrawer(page);
  await page.click("#settingsTabAdmin");
  await expect(page.locator("#settingsAdminTab")).toBeVisible();
}

async function openGenerateForm(page) {
  await expect(page.locator("#puzzleView")).toBeVisible();
  await page.locator("#newCrosswordCard").click();
  await expect(page.locator("#generatePanel")).toBeVisible();
}

test.describe("Admin coverage", () => {
  test("covers admin list, search, balance refresh, and successful grants", async ({ page }) => {
    var balanceCalls = 0;
    var grantCalls = 0;
    var grantPayloads = [];

    await setupLoggedInRoutes(page, {
      session: createSession({
        user_id: "admin-user",
        email: "admin@example.com",
        display: "Admin User",
        roles: ["member", "admin"],
        is_admin: true,
      }),
      configYaml: ADMIN_CONFIG_YAML,
      extra: {
        "**/api/admin/users": (route) =>
          route.fulfill(json(200, {
            users: [
              { user_id: "google:alpha", email: "alpha@example.com", display: "Alpha" },
              { user_id: "google:beta", email: "beta@example.com", display: "Beta" },
            ],
          })),
        "**/api/admin/balance?user_id=*": (route) => {
          balanceCalls += 1;
          if (balanceCalls === 1) {
            return route.fulfill(json(200, { balance: { available_cents: 1300 } }));
          }
          if (balanceCalls === 2) {
            return route.fulfill(json(200, { balance: { coins: 12, total_cents: 1200 } }));
          }
          if (balanceCalls === 3) {
            return route.fulfill(json(200, { balance: { coins: 19, total_cents: 1900 } }));
          }
          return route.fulfill(json(200, { balance: { coins: 12, total_cents: 1200 } }));
        },
        "**/api/admin/grants?user_id=*": (route) =>
          route.fulfill(json(200, {
            grants: [
              {
                id: "grant-existing",
                admin_email: "admin@example.com",
                admin_user_id: "admin-user",
                target_user_id: "google:alpha",
                target_email: "alpha@example.com",
                amount_coins: 2,
                reason: "Existing note",
                created_at: "2026-03-28T07:00:00Z",
              },
            ],
          })),
        "**/api/admin/grant": (route) => {
          grantPayloads.push(route.request().postDataJSON());
          grantCalls += 1;
          if (grantCalls === 1) {
            return route.fulfill(json(200, {
              balance: { coins: 17, total_cents: 1700 },
              grant: {
                id: "grant-1",
                admin_email: "admin@example.com",
                admin_user_id: "admin-user",
                target_user_id: "google:alpha",
                target_email: "alpha@example.com",
                amount_coins: 5,
                reason: "Prize top-up",
                created_at: "2026-03-28T07:08:00Z",
              },
            }));
          }
          return route.fulfill(json(200, {
            grant: {
              id: "grant-2",
              admin_email: "admin@example.com",
              admin_user_id: "admin-user",
              target_user_id: "google:alpha",
              target_email: "alpha@example.com",
              amount_coins: 1,
              reason: "Make-good",
              created_at: "2026-03-28T07:09:00Z",
            },
          }));
        },
      },
    });

    await page.goto("/");
    await openAdminTab(page);

    await expect(page.locator("#adminUserList button")).toHaveCount(2);
    await expect(page.locator("#adminUserList")).not.toContainText("google:");
    await page.fill("#adminUserSearch", "zzz");
    await expect(page.locator("#adminUserList")).toContainText("No matching users.");
    await page.fill("#adminUserSearch", "");

    await page.click("#adminRefreshUsers");
    await page.locator("#adminUserList").getByRole("button", { name: "alpha@example.com" }).click();

    await expect(page.locator("#adminSelectedUser")).toHaveText("alpha@example.com");
    await expect(page.locator("#adminSelectedUserMeta")).toHaveText("Alpha");
    await expect(page.locator("#adminBalanceCoins")).toHaveText("13");
    await expect(page.locator("#adminBalanceTotal")).toHaveText("-");

    await page.evaluate(() => {
      document.getElementById("adminRefreshUser").click();
    });
    await expect(page.locator("#adminBalanceCoins")).toHaveText("12");
    await expect(page.locator("#adminBalanceTotal")).toHaveText("1200");

    await page.fill("#adminGrantCoins", "0");
    await page.evaluate(() => {
      document.getElementById("adminGrantForm").dispatchEvent(new Event("submit", {
        bubbles: true,
        cancelable: true,
      }));
    });
    await expect(page.locator("#adminGrantStatus")).toContainText("Enter a positive number of credits.");

    await page.fill("#adminGrantCoins", "5");
    await page.fill("#adminGrantReason", "");
    await page.evaluate(() => {
      document.getElementById("adminGrantForm").dispatchEvent(new Event("submit", {
        bubbles: true,
        cancelable: true,
      }));
    });
    await expect(page.locator("#adminGrantStatus")).toContainText("Enter a reason for the grant.");

    await page.fill("#adminGrantCoins", "5");
    await page.fill("#adminGrantReason", "Prize top-up");
    await page.evaluate(() => {
      document.getElementById("adminGrantForm").dispatchEvent(new Event("submit", {
        bubbles: true,
        cancelable: true,
      }));
    });
    await expect(page.locator("#adminGrantStatus")).toContainText("Granted 5 credits!");
    await expect(page.locator("#adminGrantCoins")).toHaveValue("");
    await expect(page.locator("#adminGrantReason")).toHaveValue("");
    await expect(page.locator("#adminBalanceCoins")).toHaveText("17");
    await expect(page.locator("#adminBalanceTotal")).toHaveText("1700");
    await expect(page.locator("#settingsDrawer")).not.toContainText("google:");
    expect(grantPayloads[0]).toEqual({
      user_id: "google:alpha",
      user_email: "alpha@example.com",
      amount_coins: 5,
      reason: "Prize top-up",
    });
    await expect(page.locator("#adminGrantHistoryList")).toContainText("Existing note");

    await page.fill("#adminGrantCoins", "1");
    await page.fill("#adminGrantReason", "Make-good");
    await page.evaluate(() => {
      document.getElementById("adminGrantForm").dispatchEvent(new Event("submit", {
        bubbles: true,
        cancelable: true,
      }));
    });
    await expect(page.locator("#adminGrantStatus")).toContainText("Granted 1 credits!");
    await expect(page.locator("#adminBalanceCoins")).toHaveText("19");
    await expect(page.locator("#adminBalanceTotal")).toHaveText("1900");
    expect(grantPayloads[1]).toEqual({
      user_id: "google:alpha",
      user_email: "alpha@example.com",
      amount_coins: 1,
      reason: "Make-good",
    });
  });

  test("covers admin empty lists and grant fallback errors", async ({ page }) => {
    var userCalls = 0;
    var grantCalls = 0;

    await setupLoggedInRoutes(page, {
      session: createSession({
        user_id: "admin-user",
        email: "admin@example.com",
        display: "Admin User",
        roles: ["member", "admin"],
        is_admin: true,
      }),
      configYaml: ADMIN_CONFIG_YAML,
      extra: {
        "**/api/admin/users": (route) => {
          userCalls += 1;
          if (userCalls === 1) {
            return route.fulfill(json(200, { users: [] }));
          }
          if (userCalls === 2) {
            return route.fulfill(json(200, { users: [] }));
          }
          return route.fulfill(json(200, {
            users: [{ user_id: "google:gamma", email: "gamma@example.com" }],
          }));
        },
        "**/api/admin/balance?user_id=*": (route) =>
          route.fulfill(json(500, { error: "failed" })),
        "**/api/admin/grants?user_id=*": (route) =>
          route.fulfill(json(500, { error: "failed" })),
        "**/api/admin/grant": (route) => {
          grantCalls += 1;
          if (grantCalls === 1) {
            return route.fulfill(json(400, { message: "Grant denied" }));
          }
          return route.abort("failed");
        },
      },
    });

    await page.goto("/");
    await openAdminTab(page);

    await expect(page.locator("#adminUsersStatus")).toHaveText("");
    await expect(page.locator("#adminUserList")).toContainText("No other users found.");

    await page.click("#adminRefreshUsers");
    await expect(page.locator("#adminUserList")).toContainText("No other users found.");

    await page.click("#adminRefreshUsers");
    await page.locator("#adminUserList").getByRole("button", { name: "gamma@example.com" }).click();
    await expect(page.locator("#settingsDrawer")).not.toContainText("google:");
    await expect(page.locator("#adminBalanceStatus")).toContainText("Failed to load balance");
    await expect(page.locator("#adminGrantHistoryStatus")).toContainText("Failed to load grant history");

    await page.fill("#adminGrantCoins", "2");
    await page.fill("#adminGrantReason", "First attempt");
    await page.evaluate(() => {
      document.getElementById("adminGrantForm").dispatchEvent(new Event("submit", {
        bubbles: true,
        cancelable: true,
      }));
    });
    await expect(page.locator("#adminGrantStatus")).toContainText("Grant denied");

    await page.fill("#adminGrantCoins", "3");
    await page.fill("#adminGrantReason", "Retry attempt");
    await page.evaluate(() => {
      document.getElementById("adminGrantForm").dispatchEvent(new Event("submit", {
        bubbles: true,
        cancelable: true,
      }));
    });
    await expect(page.locator("#adminGrantStatus")).toContainText("Network error:");
    await expect(page.locator("#adminGrantBtn")).toBeEnabled();
  });

  test("covers placeholder account state, auth fetch failure, and modal close on logout", async ({ page }) => {
    await setupLoggedOutRoutes(page, {
      extra: {
        "**/api/session": (route) => route.abort("failed"),
      },
    });

    await page.goto("/");
    await page.evaluate(() => {
      document.dispatchEvent(new Event("mpr-ui:auth:authenticated"));
      document.dispatchEvent(new CustomEvent("mpr-user:menu-item", {
        detail: { action: "settings" },
      }));
    });

    await expect(page.locator("#settingsDrawer")).toHaveAttribute("open", "");
    await expect(page.locator("#settingsName")).toHaveText("—");
    await expect(page.locator("#settingsEmail")).toHaveText("—");
    await expect(page.locator("#settingsAvatar")).toBeHidden();

    await page.evaluate(() => {
      document.dispatchEvent(new Event("mpr-ui:auth:unauthenticated"));
    });
    await expect(page.locator("#settingsDrawer")).not.toHaveAttribute("open", "");
  });

  test("covers account rendering without an avatar element and refresh while the drawer is open", async ({ page }) => {
    await page.goto("/blank.html");
    await page.setContent(`<!doctype html>
      <html>
        <body>
          <dialog id="settingsDrawer"></dialog>
          <button id="settingsCloseButton" type="button">Close</button>
          <div id="userMenu"></div>
          <button id="settingsTabAccount" type="button">Account</button>
          <button id="settingsTabAdmin" type="button">Admin</button>
          <div id="settingsAccountTab"></div>
          <div id="settingsAdminTab" style="display:none;"></div>
          <div id="settingsName"></div>
          <div id="settingsEmail"></div>
          <dl id="settingsAccountDetails"></dl>
        </body>
      </html>`);
    await page.evaluate((responses) => {
      window.fetch = function () {
        var payload = responses.shift() || responses[responses.length - 1];
        return Promise.resolve({
          ok: true,
          json: function () {
            return Promise.resolve(payload);
          },
        });
      };
    }, [
      createSession({
        user_id: "admin-user",
        email: "admin@example.com",
        display: "First Admin",
        roles: ["member", "admin"],
        is_admin: true,
      }),
      createSession({
        user_id: "admin-user",
        email: "admin@example.com",
        display: "Updated Admin",
        roles: ["member", "admin"],
        is_admin: true,
      }),
    ]);
    await loadScript(page, "admin.js");
    await page.waitForFunction(() => {
      var menu = document.getElementById("userMenu");
      return menu && menu.getAttribute("menu-items");
    });

    await page.evaluate(() => {
      document.dispatchEvent(new CustomEvent("mpr-user:menu-item", {
        detail: { action: "settings" },
      }));
    });
    await expect(page.locator("#settingsDrawer")).toHaveAttribute("open", "");
    await expect(page.locator("#settingsName")).toHaveText("First Admin");
    await expect(page.locator("#settingsEmail")).toHaveText("admin@example.com");

    await page.evaluate(() => {
      document.dispatchEvent(new Event("mpr-ui:auth:authenticated"));
    });
    await expect(page.locator("#settingsName")).toHaveText("Updated Admin");
  });

  test("covers settings setup without a user menu", async ({ page }) => {
    await page.goto("/blank.html");
    await page.setContent("<!doctype html><html><body></body></html>");
    await page.evaluate(() => {
      window.__adminFetches = [];
      window.fetch = function (url) {
        window.__adminFetches.push(String(url));
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(createSession({
            user_id: "admin-user",
            email: "admin@example.com",
            display: "Admin User",
            roles: ["member", "admin"],
            is_admin: true,
          })),
        });
      };
    });
    await loadScript(page, "admin.js");
    await page.waitForFunction(() => window.__adminFetches.length >= 1);
    await page.waitForFunction(() => window.__adminFetches[0].indexOf("/api/session") >= 0);
    await page.evaluate(() => {
      document.dispatchEvent(new CustomEvent("mpr-user:menu-item", {
        detail: { action: "settings" },
      }));
      document.dispatchEvent(new Event("mpr-ui:auth:unauthenticated"));
    });
  });

  test("covers admin guard branches and fallback account or grant states", async ({ page }) => {
    var userCalls = 0;
    var grantCalls = 0;

    await setupLoggedInRoutes(page, {
      session: createSession({
        user_id: "admin-user",
        email: "admin@example.com",
        display: "",
        avatar_url: "/avatar.png",
        roles: ["member", "admin"],
        is_admin: true,
      }),
      configYaml: ADMIN_CONFIG_YAML,
      extra: {
        "**/api/admin/users": (route) => {
          userCalls += 1;
          if (userCalls === 1) {
            return route.fulfill(json(200, {}));
          }
          return route.fulfill(json(200, {
            users: [{ user_id: "google:fallback", email: "fallback@example.com" }],
          }));
        },
        "**/api/admin/balance?user_id=*": (route) =>
          route.fulfill(json(200, { balance: { coins: 9, total_cents: 900 } })),
        "**/api/admin/grants?user_id=*": (route) =>
          route.fulfill(json(200, { grants: [] })),
        "**/api/admin/grant": (route) => {
          grantCalls += 1;
          if (grantCalls === 1) {
            return route.fulfill(json(400, {}));
          }
          return route.fulfill(json(200, { balance: { available_cents: 1400 } }));
        },
      },
    });

    await page.goto("/");
    await page.evaluate(() => {
      document.dispatchEvent(new CustomEvent("mpr-user:menu-item"));
      document.dispatchEvent(new CustomEvent("mpr-user:menu-item", {
        detail: { action: "logout" },
      }));
    });

    await openSettingsDrawer(page);
    await expect(page.locator("#settingsName")).toHaveText("—");
    await expect(page.locator("#settingsEmail")).toHaveText("admin@example.com");
    await expect(page.locator("#settingsAvatar")).toHaveAttribute("alt", "Avatar");

    await page.click("#settingsTabAdmin");
    await expect(page.locator("#adminUserList")).toContainText("No other users found.");
    await expect(page.locator("#adminUserList")).not.toContainText("google:");

    await page.evaluate(() => {
      document.getElementById("adminRefreshUser").click();
    });
    await page.click("#adminRefreshUsers");
    await page.locator("#adminUserList").getByRole("button", { name: "fallback@example.com" }).click();
    await expect(page.locator("#adminSelectedUserMeta")).toHaveText("");

    await page.fill("#adminGrantCoins", "4");
    await page.fill("#adminGrantReason", "No reason returned");
    await page.evaluate(() => {
      document.getElementById("adminGrantForm").dispatchEvent(new Event("submit", {
        bubbles: true,
        cancelable: true,
      }));
    });
    await expect(page.locator("#adminGrantStatus")).toContainText("Grant failed.");

    await page.fill("#adminGrantCoins", "6");
    await page.fill("#adminGrantReason", "Adjustment after support review");
    await page.evaluate(() => {
      document.getElementById("adminGrantForm").dispatchEvent(new Event("submit", {
        bubbles: true,
        cancelable: true,
      }));
    });
    await expect(page.locator("#adminGrantStatus")).toContainText("Granted 6 credits!");
    await expect(page.locator("#adminBalanceCoins")).toHaveText("14");
    await expect(page.locator("#adminBalanceTotal")).toHaveText("-");
  });

  test("covers stale selected users and fallback rendering when the user list refresh fails", async ({ page }) => {
    var userCalls = 0;

    await setupLoggedInRoutes(page, {
      session: createSession({
        user_id: "admin-user",
        email: "admin@example.com",
        display: "Admin User",
        roles: ["member", "admin"],
        is_admin: true,
      }),
      configYaml: ADMIN_CONFIG_YAML,
      extra: {
        "**/api/admin/users": (route) => {
          userCalls += 1;
          if (userCalls === 1) {
            return route.fulfill(json(200, {
              users: [{ user_id: "google:alpha", email: "alpha@example.com", display: "Alpha" }],
            }));
          }
          if (userCalls === 2) {
            return route.abort("failed");
          }
          return route.fulfill(json(200, {
            users: [{ user_id: "google:beta", email: "beta@example.com", display: "Beta" }],
          }));
        },
        "**/api/admin/balance?user_id=*": (route) =>
          route.fulfill(json(200, { balance: { coins: 9, total_cents: 900 } })),
        "**/api/admin/grants?user_id=*": (route) =>
          route.fulfill(json(200, { grants: [] })),
      },
    });

    await page.goto("/");
    await openAdminTab(page);
    await page.locator("#adminUserList").getByRole("button", { name: "alpha@example.com" }).click();
    await expect(page.locator("#adminSelectedUser")).toHaveText("alpha@example.com");

    await page.click("#adminRefreshUsers");
    await expect(page.locator("#adminUsersStatus")).toContainText("We couldn't load the user list. Try Refresh.");
    await expect(page.locator("#adminUserList")).toContainText("alpha@example.com");
    await expect(page.locator("#adminSelectedUser")).toHaveText("alpha@example.com");

    await page.click("#adminRefreshUsers");
    await expect(page.locator("#adminUserList")).toContainText("beta@example.com");
    await expect(page.locator("#adminSelectedUser")).toHaveText("alpha@example.com");
  });

  test("covers admin-tab reset to account and ignored grants without a selection", async ({ page }) => {
    await setupLoggedInRoutes(page, {
      session: createSession({
        user_id: "admin-user",
        email: "admin@example.com",
        display: "Admin User",
        roles: ["member", "admin"],
        is_admin: true,
      }),
      configYaml: ADMIN_CONFIG_YAML,
      extra: {
        "**/api/admin/users": (route) => route.fulfill(json(200, { users: [] })),
      },
    });

    await page.goto("/");
    await openAdminTab(page);
    await page.click("#settingsTabAccount");
    await expect(page.locator("#settingsAccountTab")).toBeVisible();
    await page.click("#settingsTabAdmin");
    await page.evaluate(() => {
      document.getElementById("adminGrantForm").dispatchEvent(new Event("submit", {
        bubbles: true,
        cancelable: true,
      }));
    });
    await page.evaluate(() => {
      document.dispatchEvent(new Event("mpr-ui:auth:unauthenticated"));
    });

    await expect(page.locator("#settingsDrawer")).not.toHaveAttribute("open", "");
    await expect(page.locator("#settingsTabAdmin")).toBeHidden();
  });
});

test.describe("App coverage", () => {
  test("covers storage fallbacks and updateBalance guard through the app test hook", async ({ page }) => {
    await setupLoggedOutRoutes(page);
    await page.goto("/");

    var result = await page.evaluate(() => {
      var app = window.__LLM_CROSSWORD_TEST__.app;
      var storageProto = Object.getPrototypeOf(window.sessionStorage);
      var originalGetItem = storageProto.getItem;
      var originalSetItem = storageProto.setItem;
      var originalRemoveItem = storageProto.removeItem;

      storageProto.getItem = function () { throw new Error("blocked"); };
      storageProto.setItem = function () { throw new Error("blocked"); };
      storageProto.removeItem = function () { throw new Error("blocked"); };

      document.documentElement.setAttribute("data-auth-pending", "true");
      document.documentElement.setAttribute("data-post-login-view", "generator");

      var snapshot = {
        isAuthPending: app.isAuthPending(),
        postLoginView: app.getPostLoginView(),
      };

      app.setAuthPending();
      app.setPostLoginView("generator");
      snapshot.afterSet = {
        authPending: document.documentElement.getAttribute("data-auth-pending"),
        postLoginView: document.documentElement.getAttribute("data-post-login-view"),
      };

      app.clearAuthPending();
      app.clearPostLoginView();
      app.updateBalance(null);
      snapshot.afterClear = {
        authPending: document.documentElement.getAttribute("data-auth-pending"),
        postLoginView: document.documentElement.getAttribute("data-post-login-view"),
      };
      snapshot.state = app.getState();

      storageProto.getItem = originalGetItem;
      storageProto.setItem = originalSetItem;
      storageProto.removeItem = originalRemoveItem;
      return snapshot;
    });

    expect(result.isAuthPending).toBe(true);
    expect(result.postLoginView).toBe("generator");
    expect(result.afterSet.authPending).toBe("true");
    expect(result.afterSet.postLoginView).toBe("generator");
    expect(result.afterClear.authPending).toBeNull();
    expect(result.afterClear.postLoginView).toBeNull();
    expect(result.state.currentCoins).toBeNull();
  });

  test("covers updateBalance generation cost updates while logged out", async ({ page }) => {
    await setupLoggedOutRoutes(page);
    await page.goto("/");

    var result = await page.evaluate(() => {
      var app = window.__LLM_CROSSWORD_TEST__.app;

      app.updateBalance({
        coins: 9,
        generation_cost_coins: 6,
      });

      return {
        buttonText: document.getElementById("generateBtn").textContent,
        state: app.getState(),
      };
    });

    expect(result.buttonText).toBe("Generate");
    expect(result.state.generationCostCredits).toBe(6);
    expect(result.state.loggedIn).toBe(false);
  });

  test("covers header sign-in flow when a header button exists", async ({ page }) => {
    await setupLoggedOutRoutes(page);
    await page.goto("/");
    await page.evaluate(() => {
      var host = document.createElement("div");
      host.setAttribute("data-mpr-header", "google-signin");
      var button = document.createElement("div");
      button.setAttribute("role", "button");
      button.addEventListener("click", function () {
        window.__headerSignInClicks = (window.__headerSignInClicks || 0) + 1;
      });
      host.appendChild(button);
      document.body.appendChild(host);
    });

    await page.click("#landingSignIn");

    await expect(page.locator("#puzzleView")).toBeVisible();
    await expect(page.locator("#generatePanel")).toBeVisible();
    expect(await page.evaluate(() => window.__headerSignInClicks)).toBe(1);
    await expect(page.locator("html")).toHaveAttribute("data-auth-pending", "true");
    await expect(page.locator("html")).toHaveAttribute("data-post-login-view", "generator");
  });

  test("covers landing sign-in while already logged in", async ({ page }) => {
    await setupLoggedInRoutes(page);
    await page.goto("/");
    await page.evaluate(() => {
      window.__LLM_CROSSWORD_TEST__.app.setLoggedIn(true);
      document.getElementById("landingPage").style.display = "";
      document.getElementById("puzzleView").style.display = "none";
    });

    await page.click("#landingSignIn");
    await expect(page.locator("#puzzleView")).toBeVisible();
  });

  test("covers llm timeout and llm error refund flows", async ({ page }) => {
    var generateCalls = 0;
    var balanceCalls = 0;

    await setupLoggedInRoutes(page, {
      extra: {
        "**/api/generate": (route) => {
          generateCalls += 1;
          if (generateCalls === 1) {
            return route.fulfill(json(500, { error: "llm_timeout" }));
          }
          return route.fulfill(json(500, { error: "llm_error" }));
        },
        "**/api/balance": (route) => {
          balanceCalls += 1;
          return route.fulfill(json(200, { balance: { coins: 20 + balanceCalls } }));
        },
      },
    });

    await page.goto("/");
    await openGenerateForm(page);

    await page.fill("#topicInput", "timeouts");
    await page.click("#generateBtn");
    await expect(page.locator("#generateStatus")).toContainText("timed out");
    await expect(page.locator("#headerCreditBadge")).toContainText("21 credits");

    await page.fill("#topicInput", "errors");
    await page.click("#generateBtn");
    await expect(page.locator("#generateStatus")).toContainText("Generation failed. Your credits have been refunded");
    await expect(page.locator("#headerCreditBadge")).toContainText("22 credits");
  });

  test("covers insufficient-credit server responses with an enabled generate button", async ({ page }) => {
    await setupLoggedInRoutes(page, {
      coins: 10,
      extra: {
        "**/api/generate": (route) =>
          route.fulfill(json(402, { error: "insufficient_credits" })),
      },
    });

    await page.goto("/");
    await openGenerateForm(page);
    await page.fill("#topicInput", "server credits");
    await page.click("#generateBtn");
    await expect(page.locator("#generateStatus")).toContainText("Not enough credits. You need 4 credits per puzzle.");
  });

  test("covers refund refresh failures after llm timeouts", async ({ page }) => {
    await setupLoggedInRoutes(page, {
      extra: {
        "**/api/generate": (route) =>
          route.fulfill(json(500, { error: "llm_timeout" })),
        "**/api/balance": (route) => route.abort("failed"),
      },
    });

    await page.goto("/");
    await openGenerateForm(page);
    await page.fill("#topicInput", "timeout refresh");
    await page.click("#generateBtn");
    await expect(page.locator("#generateStatus")).toContainText("timed out");
  });

  test("covers insufficient-credit messaging when the generator is already showing balance loading text", async ({ page }) => {
    await mountAppShell(page);
    await page.evaluate(() => {
      window.fetch = function () {
        return Promise.resolve({
          ok: false,
          status: 401,
          json: function () { return Promise.resolve({}); },
        });
      };
      window.CrosswordApp = {};
    });
    await loadScript(page, "app.js");

    var result = await page.evaluate(() => {
      var app = window.__LLM_CROSSWORD_TEST__.app;
      app.setLoggedIn(true);
      app.showPuzzle();
      app.showGenerateForm();
      document.getElementById("generateStatus").textContent = "Loading your credit balance...";
      app.updateBalance({ coins: 1, generation_cost_coins: 4 });
      var buyCreditsButton = document.getElementById("generateBuyCreditsButton");
      return {
        status: document.getElementById("generateStatus").textContent,
        buyCreditsHidden: buyCreditsButton ? buyCreditsButton.hidden : null,
      };
    });

    expect(result.status).toBe("Not enough credits. You need 4 credits per puzzle.");
    expect(result.buyCreditsHidden).toBeNull();
  });

  test("covers generation-in-progress responses", async ({ page }) => {
    await setupLoggedInRoutes(page, {
      extra: {
        "**/api/generate": (route) =>
          route.fulfill(json(409, { error: "generation_in_progress" })),
      },
    });

    await page.goto("/");
    await openGenerateForm(page);
    await page.fill("#topicInput", "duplicate request");
    await page.click("#generateBtn");
    await expect(page.locator("#generateStatus")).toContainText("previous generation is still finishing");
  });

  test("covers the generate fallback when CrosswordApp.addGeneratedPuzzle is absent", async ({ page }) => {
    await setupLoggedInRoutes(page, {
      extra: {
        "**/api/generate": (route) =>
          route.fulfill(json(200, {
            title: "Fallback Title",
            subtitle: "Fallback Subtitle",
            items: defaultPuzzles[0].items,
          })),
      },
    });

    await page.goto("/");
    await openGenerateForm(page);
    await page.evaluate(() => {
      delete window.CrosswordApp.addGeneratedPuzzle;
      window.CrosswordApp.render = function (payload) {
        window.__fallbackRenderedTitle = payload.title;
      };
    });

    await page.fill("#topicInput", "fallback");
    await page.click("#generateBtn");
    await expect.poll(async () => page.evaluate(() => window.__fallbackRenderedTitle)).toBe("Fallback Title");
  });

  test("covers generate success with a share token", async ({ page }) => {
    await setupLoggedInRoutes(page, {
      extra: {
        "**/api/generate": (route) =>
          route.fulfill(json(200, {
            title: "Shared Result",
            subtitle: "Shared Subtitle",
            share_token: "shared-result",
            items: defaultPuzzles[0].items,
          })),
      },
    });

    await page.goto("/");
    await openGenerateForm(page);
    await page.fill("#topicInput", "shared result");
    await page.click("#generateBtn");
    await expect(page.locator("#shareBtn")).toBeVisible();
  });

  test("covers share button guard, clipboard copy, animation reset, and prompt fallback", async ({ page }) => {
    await setupLoggedOutRoutes(page);
    await page.goto("/");

    var result = await page.evaluate(async () => {
      var app = window.__LLM_CROSSWORD_TEST__.app;
      var shareBtn = document.getElementById("shareBtn");
      window.__shareCalls = [];

      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: function (value) {
            window.__shareCalls.push({ kind: "clipboard", value: value });
            return Promise.resolve();
          },
        },
      });
      window.prompt = function (label, value) {
        window.__shareCalls.push({ kind: "prompt", label: label, value: value });
      };

      app.setShareToken(null);
      shareBtn.click();

      app.setShareToken("alpha");
      shareBtn.click();
      await Promise.resolve();
      var copiedState = {
        ariaLabel: shareBtn.getAttribute("aria-label"),
        icon: shareBtn.querySelector("[data-share-icon]")
          ? shareBtn.querySelector("[data-share-icon]").textContent
          : null,
        className: shareBtn.className,
      };
      shareBtn.dispatchEvent(new Event("animationend"));

      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: null,
      });
      app.setShareToken("beta");
      shareBtn.click();

      return {
        calls: window.__shareCalls,
        copiedState: copiedState,
        finalAriaLabel: shareBtn.getAttribute("aria-label"),
        finalIcon: shareBtn.querySelector("[data-share-icon]")
          ? shareBtn.querySelector("[data-share-icon]").textContent
          : null,
      };
    });

    expect(result.calls).toHaveLength(2);
    expect(result.calls[0]).toEqual({
      kind: "clipboard",
      value: "http://localhost:8111/?puzzle=alpha",
    });
    expect(result.calls[1]).toEqual({
      kind: "prompt",
      label: "Copy this link to share:",
      value: "http://localhost:8111/?puzzle=beta",
    });
    expect(result.copiedState.ariaLabel).toBe("Copied share link");
    expect(result.copiedState.icon).toBe("✓");
    expect(result.copiedState.className).toContain("copied-flash");
    expect(result.finalAriaLabel).toBe("Share");
    expect(result.finalIcon).toBe("↗");
  });

  test("covers info and credit popover interaction branches", async ({ page }) => {
    var describedPuzzle = clonePuzzleSpec("Popover Branch Puzzle");
    describedPuzzle.description = "Popover branch coverage description.";

    await setupLoggedInRoutes(page, {
      coins: 12,
      puzzles: [describedPuzzle],
    });

    await page.goto("/");
    await expect(page.locator("#puzzleInfoButton")).toBeVisible({ timeout: 5000 });
    await page.evaluate(() => {
      window.__billingOpenCalls = [];
      window.CrosswordBilling = {
        openAccountBilling: function (options) {
          window.__billingOpenCalls.push(options);
        },
      };
      document.getElementById("rewardStripLabel").textContent = "";
      document.getElementById("rewardStripMeta").textContent = "";
      document.getElementById("shareHint").textContent = "";
    });

    await page.locator("#headerCreditBadge").click();
    await expect(page.locator("#creditPopoverSections")).toContainText("Generate new crosswords");
    await page.locator("#headerCreditBadge").click();
    await expect(page.locator("#creditDetailsPopover")).toBeHidden();

    await page.locator("#puzzleInfoButton").click();
    await expect(page.locator("#puzzleInfoPopover")).toBeVisible();
    await page.locator("#puzzleInfoButton").click();
    await expect(page.locator("#puzzleInfoPopover")).toBeHidden();

    await page.locator("#puzzleInfoButton").click();
    await expect(page.locator("#puzzleInfoPopover")).toBeVisible();
    await page.locator("#puzzleInfoContent").click();
    await expect(page.locator("#puzzleInfoPopover")).toBeVisible();
    await page.locator("#check").click();
    await expect(page.locator("#puzzleInfoPopover")).toBeHidden();

    await page.evaluate(() => {
      var badge = document.getElementById("headerCreditBadge");
      var popover = document.getElementById("creditDetailsPopover");
      var viewportHeight = window.innerHeight;
      var originalBadgeRect = badge.getBoundingClientRect.bind(badge);
      var originalPopoverRect = popover.getBoundingClientRect.bind(popover);

      badge.getBoundingClientRect = function () {
        return {
          x: 0,
          y: viewportHeight - 48,
          top: viewportHeight - 48,
          bottom: viewportHeight - 8,
          left: 600,
          right: 720,
          width: 120,
          height: 40,
          toJSON: function () {
            return this;
          },
        };
      };

      popover.getBoundingClientRect = function () {
        return {
          x: 0,
          y: 0,
          top: 0,
          bottom: 220,
          left: 0,
          right: 320,
          width: 320,
          height: 220,
          toJSON: function () {
            return this;
          },
        };
      };

      window.__restoreCreditRects = function () {
        badge.getBoundingClientRect = originalBadgeRect;
        popover.getBoundingClientRect = originalPopoverRect;
      };

      badge.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    });
    await expect(page.locator("#creditDetailsPopover")).toBeVisible();
    await page.evaluate(() => {
      if (window.__restoreCreditRects) {
        window.__restoreCreditRects();
      }
    });

    await page.evaluate(() => {
      var badge = document.getElementById("headerCreditBadge");
      var popover = document.getElementById("creditDetailsPopover");
      var outsideButton = document.getElementById("check");

      badge.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true, relatedTarget: popover }));
      popover.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true, relatedTarget: badge }));
      popover.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true, relatedTarget: outsideButton }));
    });
    await page.waitForTimeout(250);
    await expect(page.locator("#creditDetailsPopover")).toBeHidden();

    await page.locator("#headerCreditBadge").focus();
    await expect(page.locator("#creditDetailsPopover")).toBeVisible();
    await page.locator("#creditPopoverBillingButton").focus();
    await page.locator("#headerCreditBadge").focus();
    await page.locator("#creditPopoverBillingButton").focus();
    await page.locator("#check").focus();
    await page.waitForTimeout(250);
    await expect(page.locator("#creditDetailsPopover")).toBeHidden();

    await page.locator("#headerCreditBadge").click();
    await expect(page.locator("#creditDetailsPopover")).toBeVisible();
    await page.locator("#creditPopoverBillingButton").click();
    await expect(page.locator("#creditDetailsPopover")).toBeHidden();
    expect(await page.evaluate(() => window.__billingOpenCalls.slice())).toEqual([
      {
        force: true,
        message: "",
        source: "header_credit_popover",
      },
    ]);

    await page.evaluate(() => {
      var app = window.__LLM_CROSSWORD_TEST__.app;
      var creditBadge = document.getElementById("headerCreditBadge");
      var infoButton = document.getElementById("puzzleInfoButton");

      app.setLoggedIn(false);
      infoButton.hidden = true;
      infoButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      creditBadge.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
      creditBadge.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  });

  test("covers verifySessionStillValid on non-auth failure responses", async ({ page }) => {
    var meCalls = 0;

    await setupLoggedInRoutes(page, {
      extra: {
        "**/me": (route) => {
          meCalls += 1;
          if (meCalls === 1) {
            return route.fulfill(json(200, {}));
          }
          return route.fulfill(json(500, { error: "still-valid" }));
        },
      },
    });

    await page.goto("/");
    await page.evaluate(() => {
      document.dispatchEvent(new Event("mpr-ui:auth:unauthenticated"));
    });

    await expect(page.locator("#puzzleView")).toBeVisible();
    await openGenerateForm(page);
    await expect(page.locator("#generateBtn")).toBeEnabled();
  });

  test("covers verifySessionStillValid promise reuse", async ({ page }) => {
    var meCalls = 0;

    await setupLoggedInRoutes(page, {
      extra: {
        "**/me": async (route) => {
          meCalls += 1;
          if (meCalls === 1) {
            await route.fulfill(json(200, {}));
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
          await route.fulfill(json(200, {}));
        },
      },
    });

    await page.goto("/");
    await page.evaluate(() => {
      document.dispatchEvent(new Event("mpr-ui:auth:unauthenticated"));
      document.dispatchEvent(new Event("mpr-ui:auth:unauthenticated"));
    });
    await page.waitForTimeout(150);
    expect(meCalls).toBe(2);
  });

  test("covers verifySessionStillValid network failures", async ({ page }) => {
    var meCalls = 0;

    await setupLoggedInRoutes(page, {
      extra: {
        "**/me": (route) => {
          meCalls += 1;
          if (meCalls === 1) {
            return route.fulfill(json(200, {}));
          }
          return route.abort("failed");
        },
      },
    });

    await page.goto("/");
    await page.evaluate(() => {
      document.dispatchEvent(new Event("mpr-ui:auth:unauthenticated"));
    });

    await expect(page.locator("#puzzleView")).toBeVisible();
  });

  test("covers logged-out unauthenticated events", async ({ page }) => {
    await setupLoggedOutRoutes(page);
    await page.goto("/");
    await page.evaluate(() => {
      document.dispatchEvent(new Event("mpr-ui:auth:unauthenticated"));
    });
    await expect(page.locator("#landingPage")).toBeVisible();
  });

  test("covers stale verification callbacks after local auth state changes", async ({ page }) => {
    var meCalls = 0;
    await setupLoggedInRoutes(page, {
      extra: {
        "**/me": async (route) => {
          meCalls += 1;
          if (meCalls === 1) {
            await route.fulfill(json(200, {}));
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
          await route.fulfill(json(401, { error: "expired" }));
        },
      },
    });

    await page.goto("/");
    await page.evaluate(() => {
      document.dispatchEvent(new Event("mpr-ui:auth:unauthenticated"));
      window.__LLM_CROSSWORD_TEST__.app.setLoggedIn(false);
    });
    await page.waitForTimeout(150);
    await expect(page.locator("#landingSignIn")).toContainText("Sign in to generate");
  });

  test("covers authenticated no-op events, share-token events, and non-Enter topic keys", async ({ page }) => {
    var bootstrapCalls = 0;

    await setupLoggedInRoutes(page, {
      extra: {
        "**/api/bootstrap": (route) => {
          bootstrapCalls += 1;
          return route.fulfill(json(200, { balance: { coins: 15 } }));
        },
      },
    });

    await page.goto("/");
    await expect(page.locator("#headerCreditBadge")).toContainText("15 credits");

    await page.evaluate(() => {
      document.dispatchEvent(new Event("mpr-ui:auth:authenticated"));
      window.dispatchEvent(new CustomEvent("crossword:share-token", {
        detail: "event-share-token",
      }));
      document.getElementById("topicInput").dispatchEvent(new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
      }));
    });

    expect(bootstrapCalls).toBe(1);
    await expect(page.locator("#shareBtn")).toBeVisible();
  });

  test("covers refund refresh fallbacks when the balance refresh is non-ok or empty", async ({ page }) => {
    var generateCalls = 0;
    var balanceCalls = 0;

    await setupLoggedInRoutes(page, {
      extra: {
        "**/api/generate": (route) => {
          generateCalls += 1;
          if (generateCalls === 1) {
            return route.fulfill(json(500, { error: "llm_timeout" }));
          }
          return route.fulfill(json(500, { error: "llm_error" }));
        },
        "**/api/balance": (route) => {
          balanceCalls += 1;
          if (balanceCalls === 1) {
            return route.fulfill(json(500, { error: "not-ok" }));
          }
          return route.fulfill(json(200, {}));
        },
      },
    });

    await page.goto("/");
    await openGenerateForm(page);

    await page.fill("#topicInput", "refresh fallback one");
    await page.click("#generateBtn");
    await expect(page.locator("#generateStatus")).toContainText("timed out");

    await page.fill("#topicInput", "refresh fallback two");
    await page.click("#generateBtn");
    await expect(page.locator("#generateStatus")).toContainText("Generation failed. Your credits have been refunded");
  });

  test("covers app startup branches when a non-ok /me resolves after login state changes", async ({ page }) => {
    await mountAppShell(page);
    await page.evaluate(() => {
      window.sessionStorage.setItem("llm-crossword-auth-pending", "1");
      window.sessionStorage.setItem("llm-crossword-post-login-view", "generator");
      window.__pendingMe = new Promise((resolve) => {
        window.__resolveMe = resolve;
      });
      window.fetch = function (url) {
        if (String(url).indexOf("/me") >= 0) {
          return window.__pendingMe;
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: function () { return Promise.resolve({}); },
        });
      };
      window.CrosswordApp = {};
    });
    await loadScript(page, "app.js");

    var result = await page.evaluate(async () => {
      window.__LLM_CROSSWORD_TEST__.app.setLoggedIn(true);
      window.__resolveMe({ ok: false, status: 401 });
      await Promise.resolve();
      await Promise.resolve();
      return {
        authPending: window.sessionStorage.getItem("llm-crossword-auth-pending"),
        postLoginView: window.sessionStorage.getItem("llm-crossword-post-login-view"),
      };
    });

    expect(result.authPending).toBe("1");
    expect(result.postLoginView).toBe("generator");
  });

  test("covers app startup branches when a rejected /me resolves after login state changes", async ({ page }) => {
    await mountAppShell(page);
    await page.evaluate(() => {
      window.sessionStorage.setItem("llm-crossword-auth-pending", "1");
      window.sessionStorage.setItem("llm-crossword-post-login-view", "generator");
      window.__pendingMe = new Promise((resolve, reject) => {
        window.__rejectMe = reject;
      });
      window.fetch = function (url) {
        if (String(url).indexOf("/me") >= 0) {
          return window.__pendingMe;
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: function () { return Promise.resolve({}); },
        });
      };
      window.CrosswordApp = {};
    });
    await loadScript(page, "app.js");

    var result = await page.evaluate(async () => {
      window.__LLM_CROSSWORD_TEST__.app.setLoggedIn(true);
      window.__rejectMe(new Error("offline"));
      await Promise.resolve();
      await Promise.resolve();
      return {
        authPending: window.sessionStorage.getItem("llm-crossword-auth-pending"),
        postLoginView: window.sessionStorage.getItem("llm-crossword-post-login-view"),
      };
    });

    expect(result.authPending).toBe("1");
    expect(result.postLoginView).toBe("generator");
  });

  test("covers app behavior with the shared shell fixture", async ({ page }) => {
    await mountAppShell(page);
    await page.evaluate(() => {
      window.fetch = function (url) {
        if (String(url).indexOf("/me") >= 0) {
          return Promise.resolve({ ok: false, status: 401 });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: function () { return Promise.resolve({}); },
        });
      };
      window.CrosswordApp = {};
    });
    await loadScript(page, "app.js");

    var state = await page.evaluate(() => new Promise((resolve) => {
      var app = window.__LLM_CROSSWORD_TEST__.app;
      app.showPuzzle();
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          app.showGenerateForm();
          app.setShareToken("shared");
          window.dispatchEvent(new CustomEvent("crossword:share-token", { detail: "shared" }));
          document.getElementById("landingTryPrebuilt").click();
          document.getElementById("landingSignIn").click();
          resolve(app.getState());
        });
      });
    }));

    expect(state.currentView).toBe("puzzle");
  });

  test("covers startup share-token sync when the active puzzle already has a share token", async ({ page }) => {
    await mountAppShell(page);
    await page.evaluate(() => {
      window.fetch = function () {
        return Promise.resolve({
          ok: false,
          status: 401,
          json: function () { return Promise.resolve({}); },
        });
      };
      window.CrosswordApp = {
        getActivePuzzle: function () {
          return { shareToken: "active-share-token" };
        },
      };
    });
    await loadScript(page, "app.js");

    var state = await page.evaluate(() => window.__LLM_CROSSWORD_TEST__.app.getState());

    expect(state.currentShareToken).toBe("active-share-token");
  });

  test("covers generate success with the shared shell fixture", async ({ page }) => {
    await mountAppShell(page);
    await page.evaluate((items) => {
      window.fetch = function (url) {
        if (String(url).indexOf("/api/generate") >= 0) {
          return Promise.resolve({
            ok: true,
            json: function () {
              return Promise.resolve({
                title: "Isolated Success",
                subtitle: "No optional nodes",
                items: items,
              });
            },
          });
        }
        return Promise.resolve({
          ok: false,
          status: 401,
          json: function () { return Promise.resolve({}); },
        });
      };
      window.generateCrossword = function (generatedItems, options) {
        return {
          title: options.title,
          subtitle: options.subtitle,
          entries: [
            { id: "solo", row: 1, col: 1, dir: "across", clue: "Solo", answer: "A", hint: "A" },
          ],
          overlaps: [],
          items: generatedItems,
        };
      };
      window.CrosswordApp = {
        addGeneratedPuzzle: function (payload) {
          window.__isolatedGeneratedPayload = payload;
        },
      };
    }, defaultPuzzles[0].items);
    await loadScript(page, "app.js");

    await page.evaluate(() => {
      var app = window.__LLM_CROSSWORD_TEST__.app;
      app.setLoggedIn(true);
      app.updateBalance({ coins: 12, generation_cost_coins: 4 });
      document.getElementById("topicInput").value = "isolated";
      document.getElementById("generateBtn").click();
    });

    await expect.poll(async () => page.evaluate(() => {
      return window.__isolatedGeneratedPayload && window.__isolatedGeneratedPayload.title;
    })).toBe("Isolated Success");
  });

  test("covers bootstrap rejection while the generator is visible", async ({ page }) => {
    await mountAppShell(page);
    await page.evaluate(() => {
      window.__warns = [];
      window.__rejectBootstrap = null;
      console.warn = function () {
        window.__warns.push(Array.prototype.slice.call(arguments).join(" "));
      };
      window.sessionStorage.setItem("llm-crossword-post-login-view", "generator");
      window.fetch = function (url) {
        if (String(url).indexOf("/api/bootstrap") >= 0) {
          return new Promise(function (_, reject) {
            window.__rejectBootstrap = reject;
          });
        }
        return Promise.resolve({
          ok: false,
          status: 401,
          json: function () { return Promise.resolve({}); },
        });
      };
      window.CrosswordApp = {};
    });
    await loadScript(page, "app.js");

    await page.evaluate(() => {
      window.__LLM_CROSSWORD_TEST__.app.setPostLoginView("generator");
      document.dispatchEvent(new Event("mpr-ui:auth:authenticated"));
    });

    await page.evaluate(() => {
      document.getElementById("generateBtn").disabled = false;
      document.getElementById("generateStatus").classList.add("loading");
      window.__rejectBootstrap(new Error("offline"));
    });

    await expect(page.locator("#generatePanel")).toBeVisible();
    await expect(page.locator("#generateStatus")).toContainText("We couldn't load your credit balance");
    await expect(page.locator("#generateBtn")).toBeEnabled();
  });

  test("covers non-ok bootstrap responses while the generator is visible", async ({ page }) => {
    await mountAppShell(page);
    await page.evaluate(() => {
      window.fetch = function (url) {
        if (String(url).indexOf("/api/bootstrap") >= 0) {
          return Promise.resolve({ ok: false, status: 500 });
        }
        return Promise.resolve({
          ok: false,
          status: 401,
          json: function () { return Promise.resolve({}); },
        });
      };
      window.CrosswordApp = {};
    });
    await loadScript(page, "app.js");

    await page.evaluate(() => {
      window.__LLM_CROSSWORD_TEST__.app.setPostLoginView("generator");
      document.dispatchEvent(new Event("mpr-ui:auth:authenticated"));
    });

    await expect(page.locator("#generatePanel")).toBeVisible();
    await expect(page.locator("#generateStatus")).toContainText("We couldn't load your credit balance");
  });
});

test.describe("Isolated script coverage", () => {
  test("covers auth-fetch refresh cleanup", async ({ page }) => {
    await page.goto("/blank.html");
    await page.setContent("<!doctype html><html><body></body></html>");
    await page.evaluate(() => {
      window.__fetchCalls = [];
      window.fetch = function (url) {
        window.__fetchCalls.push(String(url));
        if (String(url) === "/auth/refresh") {
          return Promise.reject(new Error("refresh failed"));
        }
        return Promise.resolve({ status: 401, ok: false });
      };
    });
    await loadScript(page, "auth-fetch.js");

    var result = await page.evaluate(async () => {
      await window.authFetch("/api/protected");
      await window.authFetch("/api/protected");
      return window.__fetchCalls;
    });

    expect(result).toEqual([
      "/api/protected",
      "/auth/refresh",
      "/api/protected",
      "/auth/refresh",
    ]);
  });

  test("covers auth-fetch tenant header wiring", async ({ page }) => {
    await page.goto("/blank.html");
    await page.setContent('<!doctype html><html><body><mpr-header tauth-tenant-id=" default "></mpr-header></body></html>');
    await page.evaluate(() => {
      window.__tenantFetchCalls = [];
      window.fetch = function (url, options) {
        var headers = {};
        if (options && options.headers && typeof options.headers.forEach === "function") {
          options.headers.forEach(function (value, key) {
            headers[key] = value;
          });
        }
        window.__tenantFetchCalls.push({
          url: String(url),
          credentials: options && options.credentials,
          headers: headers,
        });
        return Promise.resolve({ status: 200, ok: true });
      };
    });
    await loadScript(page, "auth-fetch.js");

    var result = await page.evaluate(async () => {
      await window.fetchTauth("/me", {
        headers: {
          "X-Test-Header": "present",
        },
      });
      return {
        tenantId: window.getTauthTenantId(),
        request: window.__tenantFetchCalls[0],
      };
    });

    expect(result.tenantId).toBe("default");
    expect(result.request.url).toBe("/me");
    expect(result.request.credentials).toBe("include");
    expect(result.request.headers["x-tauth-tenant"]).toBe("default");
    expect(result.request.headers["x-test-header"]).toBe("present");
  });

  test("covers auth-fetch fallback inputs without tenant context", async ({ page }) => {
    await page.goto("/blank.html");
    await page.setContent("<!doctype html><html><body></body></html>");
    await page.evaluate(() => {
      window.__fallbackFetchCalls = [];
      window.fetch = function (url, options) {
        var headers = {};
        if (options && options.headers && typeof options.headers.forEach === "function") {
          options.headers.forEach(function (value, key) {
            headers[key] = value;
          });
        }
        window.__fallbackFetchCalls.push({
          urlType: typeof url,
          credentials: options && options.credentials,
          headers: headers,
        });
        return Promise.resolve({ status: 200, ok: true });
      };
    });
    await loadScript(page, "auth-fetch.js");

    var result = await page.evaluate(async () => {
      var missingTenantId = window.getTauthTenantId();
      var emptyTenantElement = document.createElement("mpr-header");
      emptyTenantElement.setAttribute("tauth-tenant-id", "");
      document.body.appendChild(emptyTenantElement);
      await window.fetchTauth("/auth/logout");
      await window.authFetch({ url: "/opaque" });
      return {
        missingTenantId: missingTenantId,
        emptyTenantId: window.getTauthTenantId(),
        calls: window.__fallbackFetchCalls,
      };
    });

    expect(result.missingTenantId).toBe("");
    expect(result.emptyTenantId).toBe("");
    expect(result.calls[0].credentials).toBe("include");
    expect(result.calls[0].headers["x-tauth-tenant"]).toBeUndefined();
    expect(result.calls[1].urlType).toBe("object");
  });

  test("covers auth-fetch runtime service URL resolution", async ({ page }) => {
    await page.goto("/blank.html");
    await page.setContent("<!doctype html><html><body></body></html>");
    await page.evaluate(() => {
      window.LLMCrosswordRuntimeConfig = {
        services: {
          apiBaseUrl: "https://api.example.test",
          authBaseUrl: "https://tauth.example.test",
        },
      };
      window.__serviceFetchCalls = [];
      window.fetch = function (url, options) {
        window.__serviceFetchCalls.push({
          credentials: options && options.credentials,
          url: String(url),
        });
        return Promise.resolve({ status: 200, ok: true });
      };
    });
    await loadScript(page, "service-config.js");
    await loadScript(page, "auth-fetch.js");

    var result = await page.evaluate(async () => {
      await window.fetchTauth("/me");
      await window.authFetch("/api/protected", { credentials: "include" });
      return window.__serviceFetchCalls.slice();
    });

    expect(result).toEqual([
      {
        credentials: "include",
        url: "https://tauth.example.test/me",
      },
      {
        credentials: "include",
        url: "https://api.example.test/api/protected",
      },
    ]);
  });

  test("covers auth-fetch absolute URL fallbacks with malformed service helpers", async ({ page }) => {
    await page.goto("/blank.html");
    await page.setContent("<!doctype html><html><body></body></html>");
    await page.evaluate(() => {
      window.LLMCrosswordServices = {
        getApiBaseUrl: function () {
          return { invalid: true };
        },
        getAuthBaseUrl: function () {
          return { invalid: true };
        },
      };
      window.__malformedServiceFetchCalls = [];
      window.fetch = function (url, options) {
        window.__malformedServiceFetchCalls.push({
          credentials: options && options.credentials,
          url: String(url),
        });
        return Promise.resolve({ ok: true, status: 200 });
      };
    });
    await loadScript(page, "auth-fetch.js");

    var result = await page.evaluate(async () => {
      await window.fetchTauth("https://tauth.example.test/auth/logout");
      await window.authFetch("https://api.example.test/api/protected?mode=test", { credentials: "include" });
      return window.__malformedServiceFetchCalls.slice();
    });

    expect(result).toEqual([
      {
        credentials: "include",
        url: "https://tauth.example.test/auth/logout",
      },
      {
        credentials: "include",
        url: "https://api.example.test/api/protected?mode=test",
      },
    ]);
  });

  test("covers auth-fetch direct /me routing, missing API helpers, and object tauth fetches", async ({ page }) => {
    await page.goto("/blank.html");
    await page.setContent("<!doctype html><html><body></body></html>");
    await page.evaluate(() => {
      window.LLMCrosswordServices = {
        buildApiUrl: function (url) {
          if (typeof url !== "string" || url.indexOf("https://api.example.test/") === 0) {
            return url;
          }
          return "https://api.example.test" + url;
        },
        buildAuthUrl: function (url) {
          if (typeof url !== "string" || url.indexOf("https://tauth.example.test/") === 0) {
            return url;
          }
          return "https://tauth.example.test" + url;
        },
        getApiBaseUrl: function () {
          return "https://api.example.test";
        },
        getAuthBaseUrl: function () {
          return "https://tauth.example.test";
        },
      };
      window.__directPathFetchCalls = [];
      window.fetch = function (url, options) {
        window.__directPathFetchCalls.push({
          credentials: options && options.credentials,
          url: typeof url === "string" ? url : null,
          urlType: typeof url,
        });
        return Promise.resolve({ ok: true, status: 200 });
      };
    });
    await loadScript(page, "auth-fetch.js");

    var result = await page.evaluate(async () => {
      await window.authFetch("/me");
      await window.authFetch("https://api.example.test/api/direct");
      delete window.LLMCrosswordServices.getApiBaseUrl;
      await window.authFetch("https://api.example.test/api/fallback");
      await window.fetchTauth({ opaque: true });
      return window.__directPathFetchCalls.slice();
    });

    expect(result).toEqual([
      {
        credentials: "include",
        url: "https://tauth.example.test/me",
        urlType: "string",
      },
      {
        credentials: undefined,
        url: "https://api.example.test/api/direct",
        urlType: "string",
      },
      {
        credentials: undefined,
        url: "https://api.example.test/api/fallback",
        urlType: "string",
      },
      {
        credentials: "include",
        url: null,
        urlType: "object",
      },
    ]);
  });

  test("covers auth-fetch API and auth fallbacks without service config", async ({ page }) => {
    await page.goto("/blank.html");
    await page.setContent("<!doctype html><html><body></body></html>");
    await page.evaluate(() => {
      delete window.LLMCrosswordServices;
      window.__noServiceFetchCalls = [];
      window.fetch = function (url, options) {
        window.__noServiceFetchCalls.push({
          credentials: options && options.credentials,
          url: String(url),
        });
        return Promise.resolve({ ok: true, status: 200 });
      };
    });
    await loadScript(page, "auth-fetch.js");

    var result = await page.evaluate(async () => {
      await window.authFetch("/api/no-services");
      await window.fetchTauth("/auth/logout");
      return window.__noServiceFetchCalls.slice();
    });

    expect(result).toEqual([
      {
        credentials: undefined,
        url: "/api/no-services",
      },
      {
        credentials: "include",
        url: "/auth/logout",
      },
    ]);
  });

  test("covers service-config helper fallbacks and joinUrl branches", async ({ page }) => {
    await page.goto("/blank.html");
    await page.setContent("<!doctype html><html><body></body></html>");
    await page.evaluate(() => {
      delete window.LLMCrosswordRuntimeConfig;
    });
    await loadScript(page, "service-config.js");

    var result = await page.evaluate(() => {
      var services = window.LLMCrosswordServices;
      return {
        absoluteFalse: services.isAbsoluteUrl("/api/example"),
        absoluteTrue: services.isAbsoluteUrl("https://api.example.test/path"),
        authBaseUrl: services.getAuthBaseUrl(),
        apiBaseUrl: services.getApiBaseUrl(),
        configUrl: services.getConfigUrl(),
        tauthScriptUrl: services.getTauthScriptUrl(),
        joinedEmptyPath: services.joinUrl("https://api.example.test/", ""),
        joinedNoBase: services.joinUrl("", "relative/path"),
        joinedQuery: services.joinUrl("https://api.example.test", "?debug=1"),
        joinedHash: services.joinUrl("https://api.example.test", "#details"),
        joinedAbsolute: services.joinUrl("https://api.example.test", "https://cdn.example.test/app.js"),
        builtApiPath: services.buildApiUrl("/api/puzzles"),
        builtAuthPath: services.buildAuthUrl("/auth/google"),
        rawConfig: services.getConfig(),
      };
    });

    expect(result.absoluteFalse).toBe(false);
    expect(result.absoluteTrue).toBe(true);
    expect(result.authBaseUrl).toBe("http://localhost:8111");
    expect(result.apiBaseUrl).toBe("http://localhost:8111");
    expect(result.configUrl).toBe("http://localhost:8111/config.yml");
    expect(result.tauthScriptUrl).toBe("http://localhost:8111/tauth.js");
    expect(result.joinedEmptyPath).toBe("https://api.example.test");
    expect(result.joinedNoBase).toBe("relative/path");
    expect(result.joinedQuery).toBe("https://api.example.test?debug=1");
    expect(result.joinedHash).toBe("https://api.example.test#details");
    expect(result.joinedAbsolute).toBe("https://cdn.example.test/app.js");
    expect(result.builtApiPath).toBe("http://localhost:8111/api/puzzles");
    expect(result.builtAuthPath).toBe("http://localhost:8111/auth/google");
    expect(result.rawConfig).toEqual({
      apiBaseUrl: "http://localhost:8111",
      authBaseUrl: "http://localhost:8111",
      configUrl: "http://localhost:8111/config.yml",
      tauthScriptUrl: "http://localhost:8111/tauth.js",
    });
  });

  test("covers config.js early return without a header", async ({ page }) => {
    await page.goto("/blank.html");
    await page.setContent("<!doctype html><html><body></body></html>");
    await page.evaluate(() => {
      window.__configFetchCount = 0;
      window.fetch = function () {
        window.__configFetchCount += 1;
        return Promise.resolve({ text: () => Promise.resolve("") });
      };
    });
    await loadScript(page, "config.js");
    expect(await page.evaluate(() => window.__configFetchCount)).toBe(0);
  });

  test("covers landing-puzzle shared success flow", async ({ page }) => {
    await setupLoggedOutRoutes(page, {
      extra: {
        "**/api/shared/shared-ok": (route) =>
          route.fulfill(json(200, {
            title: "Shared Space",
            subtitle: "",
            items: defaultPuzzles[0].items,
          })),
      },
    });

    await page.goto("/?puzzle=shared-ok");
    await expect(page.locator(".landing__title")).toHaveText("Shared Space");
    await expect(page.locator(".landing__subtitle")).toContainText("Someone shared this crossword with you");
    expect(await page.locator("#landingSamplePuzzle .cell").count()).toBeGreaterThan(0);
  });

  test("covers landing-puzzle shared error flow", async ({ page }) => {
    await setupLoggedOutRoutes(page, {
      extra: {
        "**/api/shared/missing": (route) => route.fulfill(json(404, { error: "missing" })),
      },
    });

    await page.goto("/?puzzle=missing");
    await expect(page.locator("#landingSamplePuzzle")).toContainText("Could not load shared puzzle.");
  });

  test("covers landing-puzzle early exits when the container or generator is missing", async ({ page }) => {
    await page.goto("/blank.html");
    await page.setContent("<!doctype html><html><body></body></html>");
    await loadScript(page, "landing-puzzle.js");

    await page.setContent('<!doctype html><html><body><div id="landingSamplePuzzle"></div></body></html>');
    await loadScript(page, "landing-puzzle.js");

    expect(await page.evaluate(() => document.getElementById("landingSamplePuzzle").textContent)).toBe("");
  });

  test("covers landing-puzzle fallback titles without landing text nodes", async ({ page }) => {
    await page.goto("/blank.html?puzzle=shared-fallback");
    await page.setContent('<!doctype html><html><body><div id="landingSamplePuzzle"></div></body></html>');
    await page.evaluate(() => {
      window.fetch = function () {
        return Promise.resolve({
          ok: true,
          json: function () {
            return Promise.resolve({ items: [{ word: "orbit", definition: "Path", hint: "route" }] });
          },
        });
      };
      window.generateCrossword = function (items, options) {
        window.__landingOptions = options;
        return { title: options.title, subtitle: options.subtitle, entries: [], overlaps: [] };
      };
      window.CrosswordWidget = function (container, options) {
        window.__landingWidgetTitle = options.puzzle.title;
        container.textContent = options.puzzle.title;
      };
    });
    await loadScript(page, "landing-puzzle.js");

    expect(await page.evaluate(() => window.__landingOptions.title)).toBe("Shared Crossword");
    expect(await page.evaluate(() => window.__landingWidgetTitle)).toBe("Shared Crossword");
  });

  test("covers landing-puzzle heading fallback when the shared puzzle has no title", async ({ page }) => {
    await page.goto("/blank.html?puzzle=shared-heading");
    await page.setContent(`<!doctype html>
      <html>
        <body>
          <h1 class="landing__title">Original</h1>
          <p class="landing__subtitle">Original subtitle</p>
          <div id="landingSamplePuzzle"></div>
        </body>
      </html>`);
    await page.evaluate(() => {
      window.fetch = function () {
        return Promise.resolve({
          ok: true,
          json: function () {
            return Promise.resolve({
              subtitle: "",
              items: [{ word: "orbit", definition: "Path", hint: "route" }],
            });
          },
        });
      };
      window.generateCrossword = function (items, options) {
        return { title: options.title, subtitle: options.subtitle, entries: [], overlaps: [], items: items };
      };
      window.CrosswordWidget = function () {};
    });
    await loadScript(page, "landing-puzzle.js");

    await expect(page.locator(".landing__title")).toHaveText("Shared Crossword");
  });

  test("covers crossword.js guard clauses before bootstrapping", async ({ page }) => {
    await page.goto("/blank.html");
    await page.setContent("<!doctype html><html><body></body></html>");
    {
      var pageErrorPromise = page.waitForEvent("pageerror");
      await loadScript(page, "crossword.js");
      await expect(pageErrorPromise.then((error) => error.message)).resolves.toMatch(/CrosswordWidget is required/);
    }

    await page.setContent("<!doctype html><html><body></body></html>");
    await page.evaluate(() => {
      window.__LLM_CROSSWORD_MAIN_PAGE_BOOTED__ = true;
      window.CrosswordWidget = function () {};
    });
    await loadScript(page, "crossword.js");
    expect(await page.evaluate(() => typeof window.CrosswordApp)).toBe("undefined");

    await page.evaluate(() => {
      delete window.__LLM_CROSSWORD_MAIN_PAGE_BOOTED__;
    });
    await loadScript(page, "crossword.js");
    expect(await page.evaluate(() => typeof window.CrosswordApp)).toBe("undefined");
  });

  test("covers crossword.js addGeneratedPuzzle without a card list", async ({ page }) => {
    await page.goto("/blank.html");
    await page.setContent(`<!doctype html>
      <html>
        <body>
          <div id="puzzleView">
            <h1 id="title"></h1>
            <div id="subtitle"></div>
            <div id="status"></div>
            <div id="errorBox"></div>
            <div id="gridViewport"><div id="grid"></div></div>
            <ol id="across"></ol>
            <ol id="down"></ol>
            <button id="check">Check</button>
            <button id="reveal">Reveal</button>
          </div>
        </body>
      </html>`);
    await page.evaluate(() => {
      window.fetch = function () {
        return Promise.resolve({
          ok: true,
          json: function () { return Promise.resolve([]); },
        });
      };
    });
    await loadScript(page, "generator.js");
    await loadScript(page, "crossword-widget.js");
    await loadScript(page, "crossword.js");

    var title = await page.evaluate((items) => {
      var payload = generateCrossword(items, {
        title: "No Sidebar",
        subtitle: "fallback",
      });
      window.CrosswordApp.addGeneratedPuzzle(payload);
      return document.getElementById("title").textContent;
    }, defaultPuzzles[0].items);

    expect(title).toBe("No Sidebar");
  });

  test("covers crossword.js initial rendering without a sidebar and share-token updates", async ({ page }) => {
    await page.goto("/blank.html");
    await page.setContent(`<!doctype html>
      <html>
        <body>
          <div id="puzzleView">
            <h1 id="title"></h1>
            <div id="subtitle"></div>
            <div id="status"></div>
            <div id="errorBox"></div>
            <div id="gridViewport"><div id="grid"></div></div>
            <ol id="across"></ol>
            <ol id="down"></ol>
            <button id="check">Check</button>
            <button id="reveal">Reveal</button>
          </div>
          <button id="shareBtn" style="display:none"></button>
          <div id="puzzleCardList"></div>
        </body>
      </html>`);
    await page.evaluate((spec) => {
      window.fetch = function () {
        return Promise.resolve({
          ok: true,
          json: function () { return Promise.resolve([spec]); },
        });
      };
    }, clonePuzzleSpec("Loaded Without Sidebar"));
    await loadScript(page, "generator.js");
    await loadScript(page, "crossword-widget.js");
    await loadScript(page, "crossword.js");
    await page.waitForFunction(() => document.getElementById("title").textContent === "Loaded Without Sidebar");

    var display = await page.evaluate((items) => {
      var payload = generateCrossword(items, {
        title: "Generated Share",
        subtitle: "share",
      });
      payload.shareToken = "share-token";
      window.CrosswordApp.addGeneratedPuzzle(payload);
      return document.getElementById("shareBtn").style.display;
    }, defaultPuzzles[0].items);

    expect(display).toBe("");
  });

  test("covers crossword.js sidebar toggles without a nested icon and retains shared tokens", async ({ page }) => {
    await page.goto("/blank.html?puzzle=shared-sidebar");
    await page.setContent(`<!doctype html>
      <html>
        <body>
          <div id="puzzleView">
            <div id="descriptionPanel" hidden><p id="descriptionContent" hidden></p></div>
            <h1 id="title"></h1>
            <div id="subtitle"></div>
            <div id="status"></div>
            <div id="errorBox"></div>
            <div id="puzzleSidebar"></div>
            <button id="puzzleSidebarToggle" type="button"></button>
            <div id="puzzleCardList"></div>
            <div id="generatePanel"></div>
            <div class="pane" id="pane"></div>
            <div class="controls"></div>
            <div id="gridViewport"><div id="grid"></div></div>
            <ol id="across"></ol>
            <ol id="down"></ol>
            <button id="check">Check</button>
            <button id="reveal">Reveal</button>
          </div>
          <button id="shareBtn" style="display:none"></button>
        </body>
      </html>`);
    await page.evaluate((spec) => {
      window.fetch = function (url) {
        if (String(url).indexOf("/api/shared/") >= 0) {
          return Promise.resolve({
            ok: true,
            json: function () {
              return Promise.resolve({
                title: "Shared Sidebar Puzzle",
                subtitle: "Shared subtitle",
                description: "Shared detail copy.",
                items: spec.items,
                share_token: "shared-sidebar-token",
              });
            },
          });
        }

        return Promise.resolve({
          ok: true,
          json: function () {
            return Promise.resolve([spec]);
          },
        });
      };
    }, clonePuzzleSpec("Sidebar Fixture"));
    await loadScript(page, "generator.js");
    await loadScript(page, "crossword-widget.js");
    await loadScript(page, "crossword.js");
    await page.waitForFunction(() => document.getElementById("title").textContent === "Shared Sidebar Puzzle");

    await expect(page.locator("#shareBtn")).toBeVisible();
    expect(await page.locator("#puzzleSidebarToggle").textContent()).toBe("‹");
    expect(await page.evaluate(() => window.CrosswordApp.isSidebarCollapsed())).toBe(false);

    await page.locator("#puzzleSidebarToggle").click();

    expect(await page.evaluate(() => window.CrosswordApp.isSidebarCollapsed())).toBe(true);
    expect(await page.locator("#puzzleSidebarToggle").textContent()).toBe("›");
  });

  test("covers crossword.js false branches for empty sidebar state and missing share button", async ({ page }) => {
    await page.goto("/blank.html");
    await page.setContent(`<!doctype html>
      <html>
        <body>
          <div id="puzzleView">
            <h1 id="title"></h1>
            <div id="subtitle"></div>
            <div id="status"></div>
            <div id="errorBox"></div>
            <div id="gridViewport"><div id="grid"></div></div>
            <ol id="across"></ol>
            <ol id="down"></ol>
            <button id="check">Check</button>
            <button id="reveal">Reveal</button>
            <div id="puzzleCardList"></div>
          </div>
        </body>
      </html>`);
    await page.evaluate((spec) => {
      var cardList = document.getElementById("puzzleCardList");
      cardList.appendChild = function (child) {
        return child;
      };
      cardList.insertBefore = function (child) {
        return child;
      };
      window.__shareEvents = [];
      window.addEventListener("crossword:share-token", function (event) {
        window.__shareEvents.push(event.detail);
      });
      window.fetch = function () {
        return Promise.resolve({
          ok: true,
          json: function () { return Promise.resolve([spec]); },
        });
      };
    }, clonePuzzleSpec("Branchy Sidebar"));
    await loadScript(page, "generator.js");
    await loadScript(page, "crossword-widget.js");
    await loadScript(page, "crossword.js");
    await page.waitForFunction(() => document.getElementById("title").textContent === "Branchy Sidebar");

    var result = await page.evaluate((items) => {
      var payload = generateCrossword(items, {
        title: "Generated Without Share Button",
        subtitle: "missing share button",
      });
      payload.shareToken = "no-share-button-token";
      window.CrosswordApp.addGeneratedPuzzle(payload);
      return new Promise((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            resolve({
              cardCount: document.getElementById("puzzleCardList").children.length,
              shareEvents: window.__shareEvents.slice(),
            });
          });
        });
      });
    }, defaultPuzzles[0].items);

    expect(result.cardCount).toBe(0);
    expect(result.shareEvents).toContain("no-share-button-token");
  });

  test("covers crossword.js optional DOM branches and guarded card clicks", async ({ page }) => {
    await page.goto("/blank.html");
    await page.setContent(`<!doctype html>
      <html>
        <body>
          <div id="puzzleView">
            <div id="gridViewport"><div id="grid"></div></div>
            <ol id="across"></ol>
            <ol id="down"></ol>
            <button id="check">Check</button>
            <button id="reveal">Reveal</button>
            <div id="puzzleCardList"></div>
          </div>
        </body>
      </html>`);
    await page.evaluate((spec) => {
      Object.defineProperty(window, "visualViewport", {
        configurable: true,
        value: null,
      });
      window.fetch = function () {
        return Promise.resolve({
          ok: true,
          json: function () { return Promise.resolve([spec]); },
        });
      };
    }, clonePuzzleSpec("Isolated Card"));
    await loadScript(page, "generator.js");
    await loadScript(page, "crossword-widget.js");
    await loadScript(page, "crossword.js");
    await page.waitForFunction(() => document.querySelectorAll("#puzzleCardList .puzzle-card").length > 0);

    var result = await page.evaluate(() => {
      window.CrosswordApp.setActiveCard(null);
      var emptyMiniGrid = window.CrosswordApp.renderMiniGrid([]);
      var cardList = document.getElementById("puzzleCardList");
      cardList.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      var fakeCard = document.createElement("div");
      fakeCard.className = "puzzle-card";
      fakeCard.dataset.puzzleIndex = "99";
      cardList.appendChild(fakeCard);
      fakeCard.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      cardList.firstElementChild.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      return {
        miniGridTag: emptyMiniGrid.tagName,
        cardCount: cardList.children.length,
      };
    });

    expect(result.miniGridTag).toBe("DIV");
    expect(result.cardCount).toBe(2);
  });

  test("covers crossword.js invalid shared puzzle specifications", async ({ page }) => {
    await page.goto("/blank.html?puzzle=broken-shared");
    await page.setContent(`<!doctype html>
      <html>
        <body>
          <div id="puzzleView">
            <h1 id="title"></h1>
            <div id="subtitle"></div>
            <div id="status"></div>
            <div id="errorBox"></div>
            <div id="gridViewport"><div id="grid"></div></div>
            <ol id="across"></ol>
            <ol id="down"></ol>
            <button id="check">Check</button>
            <button id="reveal">Reveal</button>
            <div id="puzzleSidebar"></div>
            <button id="puzzleSidebarToggle" type="button"><span class="puzzle-sidebar__toggle-icon"></span></button>
            <div id="puzzleCardList"></div>
            <div class="pane"></div>
            <div class="controls"></div>
            <div id="generatePanel"></div>
          </div>
          <button id="shareBtn" style="display:none"></button>
        </body>
      </html>`);
    await page.evaluate((spec) => {
      window.fetch = function (url) {
        if (String(url).indexOf("/api/shared/") >= 0) {
          return Promise.resolve({
            ok: true,
            json: function () {
              return Promise.resolve({
                title: "Broken Shared Puzzle",
                subtitle: "broken",
                items: null,
              });
            },
          });
        }

        return Promise.resolve({
          ok: true,
          json: function () {
            return Promise.resolve([spec]);
          },
        });
      };
    }, clonePuzzleSpec("Broken Shared Fixture"));
    await loadScript(page, "generator.js");
    await loadScript(page, "crossword-widget.js");
    await loadScript(page, "crossword.js");

    await expect(page.locator("#errorBox")).toContainText("Shared crossword specification invalid");
  });

  test("covers crossword.js empty puzzle lists without optional UI", async ({ page }) => {
    await page.goto("/blank.html");
    await page.setContent(`<!doctype html>
      <html>
        <body>
          <div id="puzzleView">
            <div id="gridViewport"><div id="grid"></div></div>
            <ol id="across"></ol>
            <ol id="down"></ol>
            <button id="check">Check</button>
            <button id="reveal">Reveal</button>
            <div id="puzzleCardList"></div>
          </div>
        </body>
      </html>`);
    await page.evaluate(() => {
      window.fetch = function () {
        return Promise.resolve({
          ok: true,
          json: function () { return Promise.resolve([]); },
        });
      };
    });
    await loadScript(page, "generator.js");
    await loadScript(page, "crossword-widget.js");
    await loadScript(page, "crossword.js");
    await page.waitForTimeout(50);
    expect(await page.locator("#puzzleCardList .puzzle-card").count()).toBe(0);
  });

  test("covers crossword.js fetch failures without an error box", async ({ page }) => {
    await page.goto("/blank.html");
    await page.setContent(`<!doctype html>
      <html>
        <body>
          <div id="puzzleView">
            <div id="gridViewport"><div id="grid"></div></div>
            <ol id="across"></ol>
            <ol id="down"></ol>
            <button id="check">Check</button>
            <button id="reveal">Reveal</button>
          </div>
        </body>
      </html>`);
    await page.evaluate(() => {
      window.fetch = function () {
        return Promise.reject(new Error("boom"));
      };
    });
    await loadScript(page, "generator.js");
    await loadScript(page, "crossword-widget.js");
    await loadScript(page, "crossword.js");
    await page.waitForTimeout(50);
  });
});

test.describe("Crossword widget coverage", () => {
  test("covers static helpers and confetti cleanup", async ({ page }) => {
    await setupLoggedOutRoutes(page);
    await page.goto("/");

    var result = await page.evaluate(() => {
      var helpers = window.CrosswordWidget.__test;
      var container = document.createElement("div");
      document.body.appendChild(container);
      helpers.launchConfetti(container);
      var overlay = container.lastElementChild;
      var pieces = Array.prototype.slice.call(overlay.children);
      pieces.forEach(function (piece) {
        piece.dispatchEvent(new Event("animationend", { bubbles: true }));
      });

      return {
        sanitizeClue: helpers.sanitizeClue("12. Trim me"),
        emptyGridSize: helpers.computeGridSize([]),
        payloadErrors: helpers.validatePayload(null),
        invalidSpec: helpers.validatePuzzleSpecification({ title: 1 }),
        overlayRemoved: !container.lastElementChild,
      };
    });

    expect(result.sanitizeClue).toBe("Trim me");
    expect(result.emptyGridSize).toEqual({ rows: 1, cols: 1, offsetRow: 0, offsetCol: 0 });
    expect(result.payloadErrors).toContain("Payload missing.");
    expect(result.invalidSpec).toBe(false);
    expect(result.overlayRemoved).toBe(true);
  });

  test("covers constructor variants and existing-element fallbacks", async ({ page }) => {
    await setupLoggedOutRoutes(page);
    await page.goto("/");

    var result = await page.evaluate((items) => {
      var container = document.createElement("div");
      document.body.appendChild(container);
      var widget = window.CrosswordWidget(container, {
        showTitle: false,
        showControls: false,
        puzzle: generateCrossword(items, {
          title: "No Header",
          subtitle: "No Controls",
        }),
      });

      var existingViewport = document.createElement("div");
      var existingGrid = document.createElement("div");
      existingViewport.appendChild(existingGrid);
      var existingWidget = new window.CrosswordWidget(document.createElement("div"), {
        _existingElements: {
          gridViewport: existingViewport,
          gridEl: existingGrid,
          acrossOl: document.createElement("ol"),
          downOl: document.createElement("ol"),
        },
      });

      var fallbackContainer = {
        innerHTML: "",
        ownerDocument: null,
        appendChild: function () {},
      };
      var fallbackWidget = new window.CrosswordWidget(fallbackContainer, {
        responsive: false,
        draggable: false,
        showControls: false,
      });

      var duplicateEntryPrototype = { inherited: "ignore-me" };
      var duplicateAcross = Object.assign(Object.create(duplicateEntryPrototype), {
        id: "shared-id",
        row: 1,
        col: 1,
        dir: "across",
        clue: "Across",
        answer: "A",
        hint: "A",
      });
      var duplicateDown = {
        id: "shared-id",
        row: 1,
        col: 1,
        dir: "down",
        clue: "Down",
        answer: "A",
        hint: "A",
      };
      var duplicateBuilt = window.CrosswordWidget.__test.buildModel({
        title: "Duplicate",
        subtitle: "",
        entries: [duplicateAcross, duplicateDown],
        overlaps: [],
      }, 1, 1, 1, 1);

      return {
        isInstance: widget instanceof window.CrosswordWidget,
        titleEl: widget._titleEl,
        checkBtn: widget._checkBtn,
        existingCheckBtn: existingWidget._checkBtn,
        existingRevealBtn: existingWidget._revealBtn,
        existingStatusEl: existingWidget._statusEl,
        existingErrorBox: existingWidget._errorBox,
        existingTitleEl: existingWidget._titleEl,
        existingSubEl: existingWidget._subEl,
        existingSelectEl: existingWidget._selectEl,
        fallbackWidgetHasGrid: !!fallbackWidget._gridEl,
        duplicateBelongsCount: duplicateBuilt.getCell(0, 0).belongs.length,
        duplicateInheritedCopied: Object.prototype.hasOwnProperty.call(duplicateBuilt.refsById["shared-id"], "inherited"),
        nullSpec: window.CrosswordWidget.__test.validatePuzzleSpecification(null),
        badItemsSpec: window.CrosswordWidget.__test.validatePuzzleSpecification({
          title: "x",
          subtitle: "y",
          items: "bad",
        }),
      };
    }, defaultPuzzles[0].items);

    expect(result.isInstance).toBe(true);
    expect(result.titleEl).toBeNull();
    expect(result.checkBtn).toBeNull();
    expect(result.existingCheckBtn).toBeNull();
    expect(result.existingRevealBtn).toBeNull();
    expect(result.existingStatusEl).toBeNull();
    expect(result.existingErrorBox).toBeNull();
    expect(result.existingTitleEl).toBeNull();
    expect(result.existingSubEl).toBeNull();
    expect(result.existingSelectEl).toBeNull();
    expect(result.fallbackWidgetHasGrid).toBe(true);
    expect(result.duplicateBelongsCount).toBe(1);
    expect(result.duplicateInheritedCopied).toBe(false);
    expect(result.nullSpec).toBe(false);
    expect(result.badItemsSpec).toBe(false);
  });

  test("covers loadPuzzles, selector changes, testApi branches, and destroy cleanup", async ({ page }) => {
    await setupLoggedOutRoutes(page);
    await page.goto("/");

    var result = await page.evaluate(({ firstSpec, secondSpec, items }) => {
      var container = document.createElement("div");
      document.body.appendChild(container);

      var widget = new window.CrosswordWidget(container, {
        showSelector: true,
        puzzle: generateCrossword(items, {
          title: "Initial Widget",
          subtitle: "initial",
        }),
      });

      widget.loadPuzzles([firstSpec, secondSpec]);
      var optionTexts = Array.prototype.map.call(widget._selectEl.options, function (option) {
        return option.textContent;
      });
      widget._selectEl.value = "1";
      widget._selectEl.dispatchEvent(new Event("change", { bubbles: true }));
      var selectedTitle = widget._titleEl.textContent;

      var api = widget._testApi;
      var firstId = Object.keys(api.clueById)[0];
      var stepId = Object.keys(api.cellsById)[1] || firstId;
      var firstCell = api.cellsById[stepId][0];
      api.cellsById[firstId] = [];
      api.clueById[firstId].dispatchEvent(new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
      }));

      var solvedMissing = api.isEntrySolved("missing");
      var revealMissing = api.revealLetter("missing");
      api.updateEntrySolvedState("missing");
      api.focusCell(999, 999);

      var defaultStep = api.step(firstCell, "across");
      var missingStep = api.step({
        links: {
          across: { next: { r: 999, c: 999 }, prev: null },
          down: { next: null, prev: null },
        },
      }, "across", true);

      widget.render(widget._puzzles[0]);
      api = widget._testApi;
      firstId = Object.keys(api.clueById)[0];
      stepId = Object.keys(api.cellsById)[1] || firstId;
      firstCell = api.cellsById[stepId][0];

      delete api.cellsById[firstId];
      api.clueById[firstId].dispatchEvent(new MouseEvent("mouseenter", {
        bubbles: true,
      }));

      api.cellsById[firstId] = [{}];
      api.clueById[firstId].dispatchEvent(new MouseEvent("mouseenter", {
        bubbles: true,
      }));

      delete api.clueById[firstId];
      firstCell.belongs = ["missing-clue"];
      firstCell.input.dispatchEvent(new Event("focus"));

      delete api.cellsById[stepId];
      api.clueById[stepId].dispatchEvent(new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
      }));

      widget.render(widget._puzzles[0]);
      api = widget._testApi;
      var edgeId = Object.keys(api.cellsById)[0];
      var edgeCells = api.cellsById[edgeId];
      var edgeCell = edgeCells[edgeCells.length - 1];
      edgeCell.input.dispatchEvent(new Event("focus"));
      edgeCell.input.value = "Z";
      edgeCell.input.dispatchEvent(new Event("input", { bubbles: true }));

      window.clipboardData = {
        getData: function () { return "XY"; },
      };
      var pasteEvent = new Event("paste", { bubbles: true, cancelable: true });
      api.cellsById[edgeId][0].input.dispatchEvent(pasteEvent);
      delete window.clipboardData;

      var extraOption = document.createElement("option");
      extraOption.value = "999";
      extraOption.textContent = "Missing";
      widget._selectEl.appendChild(extraOption);
      widget._selectEl.value = "999";
      widget._selectEl.dispatchEvent(new Event("change", { bubbles: true }));

      widget.render(widget._puzzles[0]);
      widget.destroy();
      widget.render(widget._puzzles[0]);
      widget.loadPuzzles([firstSpec]);
      widget.destroy();

      return {
        optionTexts: optionTexts,
        selectedTitle: selectedTitle,
        solvedMissing: solvedMissing,
        revealMissing: revealMissing,
        defaultStepExists: !!defaultStep,
        missingStep: missingStep,
        containerEmpty: container.innerHTML,
        testApiCleared: widget._testApi,
      };
    }, {
      firstSpec: clonePuzzleSpec("Selector One"),
      secondSpec: clonePuzzleSpec("Selector Two"),
      items: defaultPuzzles[0].items,
    });

    expect(result.optionTexts).toEqual(["Selector One", "Selector Two"]);
    expect(result.selectedTitle).toBe("Selector Two");
    expect(result.solvedMissing).toBe(false);
    expect(result.revealMissing).toBeNull();
    expect(result.defaultStepExists).toBe(true);
    expect(result.missingStep).toBeNull();
    expect(result.containerEmpty).toBe("");
    expect(result.testApiCleared).toBeNull();
  });

  test("covers widget fallbacks without selectors, hints, observers, or controls", async ({ page }) => {
    await setupLoggedOutRoutes(page);
    await page.goto("/");

    var result = await page.evaluate((items) => {
      var payload = generateCrossword(items, {
        title: "Fallback Widget",
        subtitle: "",
      });
      payload.title = "";

      var bareContainer = document.createElement("div");
      document.body.appendChild(bareContainer);
      var bareWidget = new window.CrosswordWidget(bareContainer);
      bareWidget.loadPuzzles([]);

      var minimalContainer = document.createElement("div");
      document.body.appendChild(minimalContainer);
      var minimalWidget = new window.CrosswordWidget(minimalContainer, {
        hints: false,
        responsive: false,
        draggable: false,
        showControls: false,
      });
      minimalWidget.render(payload);
      var titleText = minimalWidget._titleEl.textContent;
      var hintButtons = minimalContainer.querySelectorAll(".hintButton").length;
      minimalWidget.destroy();

      return {
        barePuzzleCount: bareWidget._puzzles.length,
        titleText: titleText,
        hintButtons: hintButtons,
        minimalContainerHtml: minimalContainer.innerHTML,
      };
    }, defaultPuzzles[0].items);

    expect(result.barePuzzleCount).toBe(0);
    expect(result.titleText).toBe("Crossword");
    expect(result.hintButtons).toBe(0);
    expect(result.minimalContainerHtml).toBe("");
  });

  test("covers loadPuzzles validation errors", async ({ page }) => {
    await setupLoggedOutRoutes(page);
    await page.goto("/");

    var result = await page.evaluate(() => {
      var container = document.createElement("div");
      document.body.appendChild(container);
      var widget = new window.CrosswordWidget(container, {});

      try {
        widget.loadPuzzles("bad");
      } catch (error) {
        window.__loadPuzzlesTypeError = error.message;
      }

      try {
        widget.loadPuzzles([{ title: "Bad", subtitle: "Bad", items: [{}] }]);
      } catch (error) {
        window.__loadPuzzlesSpecError = error.message;
      }

      return {
        typeError: window.__loadPuzzlesTypeError,
        specError: window.__loadPuzzlesSpecError,
      };
    });

    expect(result.typeError).toContain("Puzzles data must be an array");
    expect(result.specError).toContain("Crossword specification invalid");
  });
});
