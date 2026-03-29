// @ts-check

const { test, expect } = require("./coverage-fixture");
const { appShellHtml, defaultPuzzles, mountAppShell, setupLoggedInRoutes } = require("./route-helpers");

async function loadScript(page, fileName) {
  await page.addScriptTag({ url: `/js/${fileName}` });
}

function buildAdminShell(drawerTagName) {
  return `<!doctype html>
    <html>
      <body>
        <${drawerTagName} id="settingsDrawer"></${drawerTagName}>
        <button id="settingsCloseButton" type="button">Close</button>
        <div id="userMenu"></div>
        <button id="settingsTabAccount" type="button">Account</button>
        <button id="settingsTabAdmin" type="button">Admin</button>
        <div id="settingsAccountTab"></div>
        <div id="settingsAdminTab" style="display:none;"></div>
        <img id="settingsAvatar" alt="">
        <div id="settingsName"></div>
        <div id="settingsEmail"></div>
        <dl id="settingsAccountDetails"></dl>
        <button id="adminRefreshUsers" type="button">Refresh Users</button>
        <input id="adminUserSearch" type="text">
        <div id="adminUserList"></div>
        <div id="adminUsersStatus"></div>
        <div id="adminNoSelection"></div>
        <div id="adminUserDetails"></div>
        <div id="adminSelectedUser"></div>
        <div id="adminSelectedUserMeta"></div>
        <button id="adminRefreshUser" type="button">Refresh User</button>
        <div id="adminBalanceCoins"></div>
        <div id="adminBalanceTotal"></div>
        <div id="adminBalanceStatus"></div>
        <form id="adminGrantForm">
          <input id="adminGrantCoins" type="number">
          <input id="adminGrantReason" type="text">
          <button id="adminGrantBtn" type="submit">Grant</button>
        </form>
        <div id="adminGrantStatus"></div>
        <div id="adminGrantHistoryList"></div>
        <div id="adminGrantHistoryStatus"></div>
      </body>
    </html>`;
}

function buildCrosswordShell(includeHeaderAndFooter) {
  return `<!doctype html>
    <html>
      <body>
        ${includeHeaderAndFooter ? '<div id="app-header"></div><div id="page-footer"></div>' : ""}
        <div id="puzzleView">
          <div id="descriptionPanel" hidden>
            <p id="descriptionContent" hidden></p>
          </div>
          <h1 id="title"></h1>
          <div id="subtitle"></div>
          <div id="status"></div>
          <div id="errorBox"></div>
          <div id="puzzleSidebar"></div>
          <button id="puzzleSidebarToggle" type="button"><span class="puzzle-sidebar__toggle-icon"></span></button>
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
    </html>`;
}

test.describe("Admin 100 coverage", () => {
  test("covers admin session normalization, fallback drawer opening, and mixed user payloads", async ({ page }) => {
    await page.goto("/blank.html");
    await page.setContent(buildAdminShell("div"));
    await page.evaluate(({ sessions, users }) => {
      var sessionIndex = 0;

      window.fetch = function (url) {
        if (String(url).indexOf("/api/session") >= 0) {
          var payload = sessions[Math.min(sessionIndex, sessions.length - 1)];
          sessionIndex += 1;
          return Promise.resolve({
            ok: true,
            json: function () {
              return Promise.resolve(payload);
            },
          });
        }
        if (String(url).indexOf("/api/admin/users") >= 0) {
          return Promise.resolve({
            ok: true,
            json: function () {
              return Promise.resolve({ users: users });
            },
          });
        }
        return Promise.resolve({
          ok: true,
          json: function () {
            return Promise.resolve({});
          },
        });
      };
    }, {
      sessions: [
        {
          user_id: "admin-user",
          email: "admin@example.com",
          display: "Admin User",
          roles: ["member"],
          expires: "1700000000",
          is_admin: true,
        },
        {
          user_id: "admin-user",
          email: "admin@example.com",
          display: "Admin User",
          roles: ["member"],
          expires: "never",
          is_admin: true,
        },
      ],
      users: [
        "google:legacy",
        null,
        { user_id: "google:beta", email: "beta@example.com", display: "Beta" },
      ],
    });

    await loadScript(page, "admin.js");
    await page.waitForFunction(() => {
      var menu = document.getElementById("userMenu");
      return menu && menu.getAttribute("menu-items");
    });

    await page.evaluate(() => {
      document.dispatchEvent(new CustomEvent("mpr-user:menu-item", {
        detail: { action: "settings" },
      }));
      document.getElementById("settingsDrawer").open = true;
    });
    await expect(page.locator("#settingsDrawer")).toHaveAttribute("open", "");
    await expect(page.locator("#settingsAccountDetails")).toContainText("Admin User");
    await expect(page.locator("#settingsAccountDetails")).toContainText("2023-11");

    await page.click("#settingsTabAdmin");
    await expect(page.locator("#adminUserList")).toContainText("beta@example.com");

    await page.evaluate(() => {
      document.dispatchEvent(new Event("mpr-ui:auth:authenticated"));
    });
    await expect(page.locator("#settingsAccountDetails")).toContainText("never");
  });

  test("covers empty user-list failures without stale data", async ({ page }) => {
    await page.goto("/blank.html");
    await page.setContent(buildAdminShell("dialog"));
    await page.evaluate(() => {
      window.fetch = function (url) {
        if (String(url).indexOf("/api/session") >= 0) {
          return Promise.resolve({
            ok: true,
            json: function () {
              return Promise.resolve({
                user_id: "admin-user",
                email: "admin@example.com",
                display: "Admin User",
                roles: ["member"],
                is_admin: true,
              });
            },
          });
        }
        if (String(url).indexOf("/api/admin/users") >= 0) {
          return Promise.resolve({
            ok: false,
            json: function () {
              return Promise.resolve({});
            },
          });
        }
        return Promise.resolve({
          ok: true,
          json: function () {
            return Promise.resolve({});
          },
        });
      };
    });

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
    await page.evaluate(() => {
      document.getElementById("settingsTabAdmin").click();
    });

    await expect(page.locator("#adminUsersStatus")).toContainText("We couldn't load the user list. Try Refresh.");
    await expect(page.locator("#adminUserList")).toHaveText("");
  });

  test("covers admin helper fallbacks through the test hook", async ({ page }) => {
    await page.goto("/blank.html");
    await page.setContent(buildAdminShell("div"));
    await page.evaluate(() => {
      window.__grantResult = new Promise((resolve) => {
        window.__resolveGrantResult = resolve;
      });
      window.fetch = function (url) {
        if (String(url).indexOf("/api/session") >= 0) {
          return Promise.resolve({
            ok: true,
            json: function () {
              return Promise.resolve({
                user_id: "admin-user",
                email: "admin@example.com",
                display: "Admin User",
                roles: ["member"],
                is_admin: true,
              });
            },
          });
        }
        if (String(url).indexOf("/api/admin/grants") >= 0) {
          return Promise.resolve({
            ok: true,
            json: function () {
              return Promise.resolve({});
            },
          });
        }
        if (String(url).indexOf("/api/admin/balance") >= 0) {
          return Promise.resolve({
            ok: true,
            json: function () {
              return Promise.resolve({ balance: { available_cents: 700 } });
            },
          });
        }
        if (String(url).indexOf("/api/admin/grant") >= 0) {
          return window.__grantResult.then(function () {
            return {
              ok: true,
              json: function () {
                return Promise.resolve({});
              },
            };
          });
        }
        return Promise.resolve({
          ok: true,
          json: function () {
            return Promise.resolve({ users: [] });
          },
        });
      };
    });

    await loadScript(page, "admin.js");
    await page.waitForFunction(() => window.__LLM_CROSSWORD_TEST__ && window.__LLM_CROSSWORD_TEST__.admin);

    var result = await page.evaluate(async () => {
      var admin = window.__LLM_CROSSWORD_TEST__.admin;
      var firstUser = { user_id: "first", email: "first@example.com", display: "First" };
      var secondUser = { user_id: "second", email: "second@example.com", display: "Second" };

      admin.setSessionData({
        user_id: null,
        email: null,
        display: "   ",
        avatar_url: "",
        roles: [],
        expires: "not-a-date",
        is_admin: true,
      });
      admin.renderAccountDetails();
      admin.setMenuItems();
      admin.switchTab("account");
      admin.renderSelectedUser();
      admin.setUsers([firstUser]);
      admin.selectUser(firstUser);
      await Promise.resolve();
      await Promise.resolve();

      document.getElementById("adminGrantCoins").value = "2";
      document.getElementById("adminGrantReason").value = "Hooked branch";
      document.getElementById("adminGrantForm").dispatchEvent(new Event("submit", {
        bubbles: true,
        cancelable: true,
      }));

      admin.setSelectedUser(secondUser);
      window.__resolveGrantResult();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      admin.renderGrantHistory([{ amount_coins: 2, created_at: "bad-date", reason: "", admin_email: "" }]);
      var invalidHistoryText = document.getElementById("adminGrantHistoryList").textContent;
      admin.loadGrantHistory("hook-user");
      await new Promise(function (resolve) {
        window.setTimeout(resolve, 0);
      });

      return {
        detailsText: document.getElementById("settingsAccountDetails").textContent,
        grantHistoryText: document.getElementById("adminGrantHistoryList").textContent,
        invalidHistoryText: invalidHistoryText,
        menuItems: document.getElementById("userMenu").getAttribute("menu-items"),
        primaryLabel: admin.getUserPrimaryLabel(null),
        rolesFilled: admin.formatRolesValue(["member", "admin"]),
        rolesInvalid: admin.formatRolesValue("admin"),
        rolesPlaceholder: admin.formatRolesValue([]),
        searchText: admin.getUserSearchText({ user_id: "ID-1", email: null, display: "Name" }),
        secondaryLabel: admin.getUserSecondaryLabel({ email: "same@example.com", display: "same@example.com" }),
        sameUserMissing: admin.isSameUser(null, firstUser),
      };
    });

    expect(result.detailsText).toContain("not-a-date");
    expect(result.invalidHistoryText).toContain("Granted by admin");
    expect(result.grantHistoryText).toContain("No grants recorded yet.");
    expect(result.menuItems).toContain("Settings");
    expect(result.primaryLabel).toBe("—");
    expect(result.rolesFilled).toBe("member, admin");
    expect(result.rolesInvalid).toBe("—");
    expect(result.rolesPlaceholder).toBe("—");
    expect(result.searchText).toBe("name id-1");
    expect(result.secondaryLabel).toBe("");
    expect(result.sameUserMissing).toBe(false);
  });

  test("covers admin guard branches when optional elements are missing", async ({ page }) => {
    await page.goto("/blank.html");
    await page.setContent(`<!doctype html>
      <html>
        <body>
          <dialog id="settingsDrawer"></dialog>
          <div id="settingsName"></div>
          <div id="settingsEmail"></div>
          <div id="adminNoSelection"></div>
          <div id="adminUserDetails" style="display:none;"></div>
          <div id="adminSelectedUser"></div>
          <button id="adminRefreshUser" type="button">Refresh</button>
          <input id="adminUserSearch" type="text">
          <div id="adminUserList"></div>
          <div id="adminUsersStatus"></div>
          <div id="adminBalanceCoins"></div>
          <div id="adminBalanceTotal"></div>
          <div id="adminBalanceStatus"></div>
          <form id="adminGrantForm">
            <button id="adminGrantBtn" type="submit">Grant</button>
          </form>
          <div id="adminGrantStatus"></div>
        </body>
      </html>`);
    await page.evaluate(() => {
      window.fetch = function (url) {
        if (String(url).indexOf("/api/session") >= 0) {
          return Promise.resolve({
            ok: true,
            json: function () {
              return Promise.resolve({
                user_id: "admin-user",
                email: "admin@example.com",
                display: "Admin User",
                roles: ["member"],
                is_admin: false,
              });
            },
          });
        }
        if (String(url).indexOf("/api/admin/balance") >= 0) {
          return Promise.resolve({
            ok: true,
            json: function () {
              return Promise.resolve({ balance: { coins: 3, total_cents: 300 } });
            },
          });
        }
        return Promise.resolve({
          ok: true,
          json: function () {
            return Promise.resolve({ users: [] });
          },
        });
      };
    });

    await loadScript(page, "admin.js");
    await page.waitForFunction(() => window.__LLM_CROSSWORD_TEST__ && window.__LLM_CROSSWORD_TEST__.admin);

    var result = await page.evaluate(async () => {
      var admin = window.__LLM_CROSSWORD_TEST__.admin;
      admin.setMenuItems();
      admin.setSessionData(null);
      admin.populateAccount();
      admin.setSessionData({
        user_id: "admin-user",
        email: "admin@example.com",
        display: "No Avatar User",
        roles: ["member"],
        is_admin: false,
      });
      admin.renderAccountDetails();
      admin.switchTab("admin");
      admin.loadGrantHistory("skip-history");
      admin.renderSelectedUser();
      admin.selectUser({ user_id: "target-user", email: "target@example.com", display: "Target User" });
      await new Promise(function (resolve) {
        window.setTimeout(resolve, 0);
      });
      return {
        selectedUser: document.getElementById("adminSelectedUser").textContent,
        balanceCoins: document.getElementById("adminBalanceCoins").textContent,
        balanceTotal: document.getElementById("adminBalanceTotal").textContent,
        detailsVisible: document.getElementById("adminUserDetails").style.display,
      };
    });

    expect(result.selectedUser).toBe("target@example.com");
    expect(result.balanceCoins).toBe("3");
    expect(result.balanceTotal).toBe("300");
    expect(result.detailsVisible).toBe("");
  });

  test("covers remaining admin helper branches with direct hook calls", async ({ page }) => {
    await page.goto("/blank.html");
    await page.setContent(buildAdminShell("dialog"));
    await page.evaluate(() => {
      window.fetch = function (url) {
        if (String(url).indexOf("/api/session") >= 0) {
          return Promise.resolve({
            ok: true,
            json: function () {
              return Promise.resolve({
                user_id: "admin-user",
                email: "admin@example.com",
                display: "Admin User",
                roles: ["member"],
                is_admin: true,
              });
            },
          });
        }
        return Promise.resolve({
          ok: true,
          json: function () {
            return Promise.resolve({ users: [] });
          },
        });
      };
    });

    await loadScript(page, "admin.js");
    await page.waitForFunction(() => window.__LLM_CROSSWORD_TEST__ && window.__LLM_CROSSWORD_TEST__.admin);

    var result = await page.evaluate(() => {
      var admin = window.__LLM_CROSSWORD_TEST__.admin;
      var status = document.createElement("div");

      admin.setSessionData(null);
      admin.populateAccount();
      document.getElementById("settingsDrawer").open = true;
      admin.openDrawer();
      document.getElementById("settingsDrawer").dispatchEvent(new MouseEvent("click", {
        bubbles: true,
      }));
      admin.setStatus(null, "ignored", true);
      admin.hasDisplayValue(["role"]);
      admin.normalizeRoles("admin");
      admin.normalizeRoles(["", null, "Admin", "admin"]);
      admin.setSessionData({
        user_id: "admin-user",
        email: "",
        display: "Shown",
        avatar_url: "",
        roles: [],
        is_admin: false,
      });
      admin.populateAccount();

      return {
        blankEmailText: document.getElementById("settingsEmail").textContent,
        primaryFallback: admin.getUserPrimaryLabel({ email: "" }),
        secondaryFallback: admin.getUserSecondaryLabel(null),
        formattedExpiresNaN: admin.formatExpiresValue(Number.NaN),
        normalizedSessionNull: admin.normalizeSessionData(null),
        normalizedSessionMissing: admin.normalizeSessionData({
          user_id: null,
          email: null,
          display: "Display",
          roles: [],
          is_admin: false,
        }),
        normalizedAdminUser: admin.normalizeAdminUser({ user_id: null, email: null, display: "Shown" }),
        drawerOpen: document.getElementById("settingsDrawer").open,
        drawerAttr: document.getElementById("settingsDrawer").getAttribute("open"),
        nameText: document.getElementById("settingsName").textContent,
        emailText: document.getElementById("settingsEmail").textContent,
        avatarDisplay: document.getElementById("settingsAvatar").style.display,
        validHistoryText: (function () {
          admin.renderGrantHistory([{
            amount_coins: 4,
            created_at: "2026-03-28T07:08:00Z",
            reason: "Valid timestamp",
            admin_email: "admin@example.com",
          }]);
          return document.getElementById("adminGrantHistoryList").textContent;
        })(),
        missingCreatedAtText: (function () {
          admin.renderGrantHistory([{
            amount_coins: 1,
            reason: "",
            admin_email: "",
          }]);
          return document.getElementById("adminGrantHistoryList").textContent;
        })(),
        statusClass: (function () {
          admin.setStatus(status, "Success", false, true);
          return status.className;
        })(),
      };
    });

    expect(result.blankEmailText).toBe("—");
    expect(result.primaryFallback).toBe("—");
    expect(result.secondaryFallback).toBe("");
    expect(result.formattedExpiresNaN).toBe("NaN");
    expect(result.normalizedSessionNull).toBeNull();
    expect(result.normalizedSessionMissing.user_id).toBe("");
    expect(result.normalizedSessionMissing.email).toBe("");
    expect(result.normalizedAdminUser.user_id).toBe("");
    expect(result.normalizedAdminUser.email).toBe("");
    expect(result.drawerOpen).toBe(false);
    expect(result.drawerAttr).toBeNull();
    expect(result.nameText).toBe("Shown");
    expect(result.emailText).toBe("—");
    expect(result.avatarDisplay).toBe("none");
    expect(result.validHistoryText).toContain("admin@example.com");
    expect(result.missingCreatedAtText).toContain("Granted by admin");
    expect(result.statusClass).toContain("admin-panel__status--success");
  });
});

test.describe("App 100 coverage", () => {
  test("covers app required-element failures and timer cleanup", async ({ page }) => {
    await page.goto("/blank.html");
    await page.setContent("<!doctype html><html><body></body></html>");
    {
      var missingElementError = page.waitForEvent("pageerror");
      await loadScript(page, "app.js");
      await expect(missingElementError.then((error) => error.message)).resolves.toMatch(/Missing required app element #completionBreakdown/);
    }

    await page.goto("/blank.html");
    await page.setContent(appShellHtml.replace(/<div class="pane">[\s\S]*?<\/div>\s+<div class="controls">/, '<div class="controls">'));
    await page.evaluate(() => {
      window.fetch = function () {
        return Promise.resolve({
          ok: false,
          status: 401,
          json: function () {
            return Promise.resolve({});
          },
        });
      };
      window.CrosswordApp = {};
    });
    {
      var missingChildError = page.waitForEvent("pageerror");
      await loadScript(page, "app.js");
      await expect(missingChildError.then((error) => error.message)).resolves.toMatch(/Missing required app element #puzzleView \.pane/);
    }

    await mountAppShell(page);
    await page.evaluate(() => {
      window.__clearedTimeouts = [];
      window.fetch = function () {
        return Promise.resolve({
          ok: false,
          status: 401,
          json: function () {
            return Promise.resolve({});
          },
        });
      };
      window.clearTimeout = function (timerId) {
        window.__clearedTimeouts.push(timerId);
      };
      window.CrosswordApp = {};
    });
    await loadScript(page, "app.js");

    var cleanupResult = await page.evaluate(() => {
      var app = window.__LLM_CROSSWORD_TEST__.app;
      app.setPendingAuthRestoreTimer(42);
      app.clearPendingAuthRestoreTimer();
      return {
        cleared: window.__clearedTimeouts.slice(),
        state: app.getState(),
      };
    });

    expect(cleanupResult.cleared).toEqual([42]);
    expect(cleanupResult.state.loggedIn).toBe(false);
  });

  test("covers auth-pending retry restores that keep the generator visible", async ({ page }) => {
    await mountAppShell(page);
    await page.evaluate(() => {
      var originalSetTimeout = window.setTimeout;
      var meCalls = 0;

      window.sessionStorage.setItem("llm-crossword-auth-pending", "1");
      window.sessionStorage.setItem("llm-crossword-post-login-view", "generator");
      window.setTimeout = function (callback) {
        return originalSetTimeout(callback, 0);
      };
      window.fetch = function (url) {
        if (String(url).indexOf("/me") >= 0) {
          meCalls += 1;
          if (meCalls === 1) {
            return Promise.resolve({ ok: false, status: 401 });
          }
          return Promise.resolve({ ok: false, status: 500 });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: function () {
            return Promise.resolve({});
          },
        });
      };
      window.CrosswordApp = {};
    });

    await loadScript(page, "app.js");
    await page.waitForTimeout(50);

    await expect(page.locator("#puzzleView")).toBeVisible();
    await expect(page.locator("#generatePanel")).toBeVisible();
  });

  test("covers auth-pending startup rejection fallback", async ({ page }) => {
    await mountAppShell(page);
    await page.evaluate(() => {
      var originalSetTimeout = window.setTimeout;

      window.sessionStorage.setItem("llm-crossword-auth-pending", "1");
      window.sessionStorage.setItem("llm-crossword-post-login-view", "generator");
      window.setTimeout = function (callback) {
        return originalSetTimeout(callback, 0);
      };
      window.fetch = function () {
        return Promise.reject(new Error("offline"));
      };
      window.CrosswordApp = {};
    });

    await loadScript(page, "app.js");
    await page.waitForTimeout(50);

    await expect(page.locator("#landingPage")).toBeVisible();
  });

  test("covers logged-out puzzle-view restore and generate submit guard", async ({ page }) => {
    await mountAppShell(page);
    await page.evaluate(() => {
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
          json: function () {
            return Promise.resolve({});
          },
        });
      };
      window.CrosswordApp = {};
    });

    await loadScript(page, "app.js");

    var state = await page.evaluate(async () => {
      var app = window.__LLM_CROSSWORD_TEST__.app;
      app.showPuzzle();
      window.__resolveMe({ ok: false, status: 401 });
      await Promise.resolve();
      await Promise.resolve();
      app.showGenerateForm();
      document.getElementById("generateBtn").disabled = false;
      document.getElementById("topicInput").value = "guard topic";
      document.getElementById("generateBtn").click();
      return {
        generateStatus: document.getElementById("generateStatus").textContent,
        landingDisplay: document.getElementById("landingPage").style.display,
        puzzleDisplay: document.getElementById("puzzleView").style.display,
      };
    });

    expect(state.generateStatus).toBe("Please log in first.");
    expect(state.landingDisplay).toBe("none");
    expect(state.puzzleDisplay).toBe("");
  });

  test("covers app helper guards through the test hook", async ({ page }) => {
    await page.goto("/blank.html");
    await page.setContent(appShellHtml.replace(/<div id="descriptionPanel"[\s\S]*?<\/div>\s+<\/div>/, "</div>"));
    await page.evaluate(() => {
      window.__pendingRetryCallback = null;
      window.setTimeout = function (callback) {
        window.__pendingRetryCallback = callback;
        return 123;
      };
      window.fetch = function (url) {
        if (String(url).indexOf("/me") >= 0) {
          return Promise.resolve({ ok: false, status: 401 });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: function () {
            return Promise.resolve({});
          },
        });
      };
      window.fetchTauth = function () {
        return Promise.resolve({ ok: true, status: 200 });
      };
      window.CrosswordApp = {};
    });

    await loadScript(page, "app.js");

    var result = await page.evaluate(async () => {
      var app = window.__LLM_CROSSWORD_TEST__.app;
      var storageProto = Object.getPrototypeOf(window.sessionStorage);
      var originalGetItem = storageProto.getItem;
      var missingElementMessage = "";
      var missingChildMessage = "";

      try {
        app.requireElement("missingElement");
      } catch (error) {
        missingElementMessage = error.message;
      }
      try {
        app.requireChild(document.body, ".missing", "body .missing");
      } catch (error) {
        missingChildMessage = error.message;
      }

      storageProto.getItem = function () {
        throw new Error("blocked");
      };
      document.documentElement.setAttribute("data-auth-pending", "false");
      var falseAttributePending = app.isAuthPending();
      storageProto.getItem = originalGetItem;

      app.showGenerateForm();
      app.setLoggedIn(true);
      app.finalizePendingAuthRestoreFailure();
      app.setPendingAuthRestoreTimer(77);
      app.schedulePendingAuthRestoreRetry();
      app.clearPendingAuthRestoreTimer();
      app.setAuthPending();
      app.setLoggedIn(false);
      app.schedulePendingAuthRestoreRetry();
      app.setLoggedIn(true);
      await window.__pendingRetryCallback();

      return {
        falseAttributePending: falseAttributePending,
        isAuthPending: app.isAuthPending(),
        missingChildMessage: missingChildMessage,
        missingElementMessage: missingElementMessage,
        state: app.getState(),
      };
    });

    expect(result.falseAttributePending).toBe(false);
    expect(result.isAuthPending).toBe(true);
    expect(result.missingElementMessage).toBe("Missing required app element #missingElement");
    expect(result.missingChildMessage).toBe("Missing required app element body .missing");
    expect(result.state.loggedIn).toBe(true);
  });

  test("covers startup /me success after login state changes", async ({ page }) => {
    await mountAppShell(page);
    await page.evaluate(() => {
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
          json: function () {
            return Promise.resolve({});
          },
        });
      };
      window.CrosswordApp = {};
    });

    await loadScript(page, "app.js");

    var result = await page.evaluate(async () => {
      var app = window.__LLM_CROSSWORD_TEST__.app;
      app.setLoggedIn(true);
      window.__resolveMe({ ok: true, status: 200 });
      await Promise.resolve();
      await Promise.resolve();
      return app.getState();
    });

    expect(result.loggedIn).toBe(true);
    expect(result.currentView).toBe("landing");
  });

  test("covers stale verification callbacks after auth version changes", async ({ page }) => {
    var meCalls = 0;

    await setupLoggedInRoutes(page, {
      extra: {
        "**/me": async (route) => {
          meCalls += 1;
          if (meCalls === 1) {
            await route.fulfill({
              status: 200,
              contentType: "application/json",
              body: "{}",
            });
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
          await route.fulfill({
            status: 401,
            contentType: "application/json",
            body: JSON.stringify({ error: "expired" }),
          });
        },
      },
    });

    await page.goto("/");
    await page.evaluate(() => {
      document.dispatchEvent(new Event("mpr-ui:auth:unauthenticated"));
      window.__LLM_CROSSWORD_TEST__.app.setLoggedIn(false);
      document.dispatchEvent(new Event("mpr-ui:auth:authenticated"));
    });
    await page.waitForTimeout(150);

    var state = await page.evaluate(() => window.__LLM_CROSSWORD_TEST__.app.getState());
    expect(state.loggedIn).toBe(true);
    await expect(page.locator("#puzzleView")).toBeVisible();
  });

  test("covers startup and generate success fallbacks when CrosswordApp handlers are absent", async ({ page }) => {
    await mountAppShell(page);
    await page.evaluate((items) => {
      window.__pendingMe = new Promise((resolve) => {
        window.__resolveMe = resolve;
      });
      window.fetch = function (url) {
        if (String(url).indexOf("/me") >= 0) {
          return window.__pendingMe;
        }
        if (String(url).indexOf("/api/generate") >= 0) {
          return Promise.resolve({
            ok: true,
            json: function () {
              return Promise.resolve({
                title: "Handlerless Puzzle",
                subtitle: "No Crossword handlers",
                items: items,
              });
            },
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: function () {
            return Promise.resolve({});
          },
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
      window.CrosswordApp = {};
    }, defaultPuzzles[0].items);

    await loadScript(page, "app.js");

    var result = await page.evaluate(async () => {
      var app = window.__LLM_CROSSWORD_TEST__.app;
      app.setLoggedIn(true);
      window.__resolveMe({ ok: false, status: 500 });
      await Promise.resolve();
      await Promise.resolve();
      app.showPuzzle();
      app.showGenerateForm();
      document.getElementById("topicInput").value = "no handlers";
      document.getElementById("generateBtn").click();
      await new Promise(function (resolve) {
        window.setTimeout(resolve, 0);
      });
      return {
        currentView: app.getState().currentView,
        generateStatus: document.getElementById("generateStatus").textContent,
        panelDisplay: document.getElementById("generatePanel").style.display,
      };
    });

    expect(result.currentView).toBe("puzzle");
    expect(result.generateStatus).toBe("");
    expect(result.panelDisplay).toBe("none");
  });
});

test.describe("Crossword 100 coverage", () => {
  test("covers shared crossword fallbacks and reuses the in-flight prebuilt promise", async ({ page }) => {
    await page.goto("/blank.html?puzzle=shared-fallback");
    await page.setContent(buildCrosswordShell(false));
    await page.evaluate((spec) => {
      window.__puzzlesPromise = new Promise((resolve) => {
        window.__resolvePuzzles = resolve;
      });
      window.__sharedPromise = new Promise((resolve) => {
        window.__resolveSharedPuzzle = resolve;
      });
      window.fetch = function (url) {
        if (String(url).indexOf("/api/shared/") >= 0) {
          return window.__sharedPromise.then(function (payload) {
            return {
              ok: true,
              json: function () {
                return Promise.resolve(payload);
              },
            };
          });
        }
        if (String(url).indexOf("crosswords.json") >= 0) {
          return window.__puzzlesPromise.then(function (payload) {
            return {
              ok: true,
              json: function () {
                return Promise.resolve(payload);
              },
            };
          });
        }
        return Promise.resolve({
          ok: true,
          json: function () {
            return Promise.resolve([spec]);
          },
        });
      };
    }, defaultPuzzles[0]);

    await loadScript(page, "generator.js");
    await loadScript(page, "crossword-widget.js");
    await loadScript(page, "crossword.js");

    expect(await page.evaluate(() => {
      return window.CrosswordApp.loadPrebuilt() === window.CrosswordApp.loadPrebuilt();
    })).toBe(true);

    await page.evaluate((spec) => {
      window.__resolvePuzzles([spec]);
      window.__resolveSharedPuzzle({
        title: "   ",
        items: spec.items,
      });
    }, defaultPuzzles[0]);

    await page.waitForFunction(() => document.getElementById("title").textContent === "Shared Crossword");
    await expect(page.locator("#title")).toHaveText("Shared Crossword");
  });

  test("covers crossword layout observer registrations and ignores invalid card indices", async ({ page }) => {
    await page.goto("/blank.html");
    await page.setContent(buildCrosswordShell(true));
    await page.evaluate((spec) => {
      window.__resizeObserved = [];
      window.ResizeObserver = function () {
        this.observe = function (element) {
          window.__resizeObserved.push(element.id);
        };
        this.unobserve = function () {};
      };
      window.MutationObserver = function () {
        this.observe = function () {};
      };
      window.fetch = function () {
        return Promise.resolve({
          ok: true,
          json: function () {
            return Promise.resolve([spec]);
          },
        });
      };
    }, defaultPuzzles[0]);

    await loadScript(page, "generator.js");
    await loadScript(page, "crossword-widget.js");
    await loadScript(page, "crossword.js");
    await page.waitForFunction(() => document.getElementById("title").textContent === "Test Puzzle");

    expect(await page.evaluate(() => window.__resizeObserved.slice().sort())).toEqual(
      expect.arrayContaining(["app-header", "page-footer"])
    );

    await page.evaluate(() => {
      var badCard = document.createElement("button");
      badCard.className = "puzzle-card";
      badCard.dataset.puzzleIndex = "nope";
      document.getElementById("puzzleCardList").appendChild(badCard);
      badCard.click();
    });

    await expect(page.locator("#title")).toHaveText("Test Puzzle");
  });

  test("covers crossword mutation refreshes when ResizeObserver is unavailable", async ({ page }) => {
    await page.goto("/blank.html");
    await page.setContent(buildCrosswordShell(true));
    await page.evaluate((spec) => {
      window.__mutationCallbacks = [];
      window.ResizeObserver = undefined;
      window.MutationObserver = function (callback) {
        this.observe = function () {
          window.__mutationCallbacks.push(callback);
        };
      };
      window.fetch = function () {
        return Promise.resolve({
          ok: true,
          json: function () {
            return Promise.resolve([spec]);
          },
        });
      };
    }, defaultPuzzles[0]);

    await loadScript(page, "generator.js");
    await loadScript(page, "crossword-widget.js");
    await loadScript(page, "crossword.js");
    await page.waitForFunction(() => document.getElementById("title").textContent === "Test Puzzle");

    await page.evaluate(() => {
      window.__mutationCallbacks.forEach(function (callback) {
        callback([], {});
      });
    });

    await expect(page.locator("#title")).toHaveText("Test Puzzle");
  });

  test("covers crossword hook guards, observer fallbacks, and empty shared tokens", async ({ page }) => {
    await page.goto("/blank.html?puzzle=%20%20");
    await page.setContent(`<!doctype html>
      <html>
        <body>
          <div id="puzzleView">
            <h1 id="title"></h1>
            <div id="subtitle"></div>
            <div id="status"></div>
            <div id="gridViewport"><div id="grid"></div></div>
            <ol id="across"></ol>
            <ol id="down"></ol>
            <button id="check">Check</button>
            <button id="reveal">Reveal</button>
          </div>
        </body>
      </html>`);
    await page.evaluate((spec) => {
      window.ResizeObserver = undefined;
      window.MutationObserver = undefined;
      window.__unobserved = [];
      window.fetch = function () {
        return Promise.resolve({
          ok: true,
          json: function () {
            return Promise.resolve([spec]);
          },
        });
      };
    }, defaultPuzzles[0]);

    await loadScript(page, "generator.js");
    await loadScript(page, "crossword-widget.js");
    await loadScript(page, "crossword.js");
    await page.waitForTimeout(50);

    var result = await page.evaluate(() => {
      var crossword = window.__LLM_CROSSWORD_TEST__.crossword;
      var oldHeader = document.createElement("div");
      var oldFooter = document.createElement("div");

      oldHeader.id = "old-header";
      oldFooter.id = "old-footer";

      crossword.applySidebarState();
      crossword.setDescriptionExpanded(true);
      crossword.updatePuzzleDescription({ text: "ignored" });
      crossword.setState({
        layoutObserver: {
          observe: function () {},
          unobserve: function (element) {
            window.__unobserved.push(element.id);
          },
        },
        layoutObserverHeaderElement: oldHeader,
        layoutObserverFooterElement: oldFooter,
      });
      crossword.refreshObservedShellElements();
      crossword.setState(null);

      return {
        descriptionIsValid: crossword.validatePuzzleSpecification({
          title: "Bad description",
          subtitle: "still bad",
          description: 7,
          items: [],
        }),
        sharedToken: crossword.readSharedPuzzleToken(),
        unobserved: window.__unobserved.slice().sort(),
      };
    });

    expect(result.descriptionIsValid).toBe(false);
    expect(result.sharedToken).toBeNull();
    expect(result.unobserved).toEqual(["old-footer", "old-header"]);
  });

  test("covers shared crossword failures when the page has no error box", async ({ page }) => {
    await page.goto("/blank.html?puzzle=broken-without-error-box");
    await page.setContent(`<!doctype html>
      <html>
        <body>
          <div id="puzzleView">
            <div id="puzzleSidebar"></div>
            <button id="puzzleSidebarToggle" type="button"><span class="puzzle-sidebar__toggle-icon"></span></button>
            <div id="puzzleCardList"></div>
            <div class="pane"></div>
            <div class="controls"></div>
            <div id="generatePanel"></div>
            <h1 id="title"></h1>
            <div id="subtitle"></div>
            <div id="status"></div>
            <div id="gridViewport"><div id="grid"></div></div>
            <ol id="across"></ol>
            <ol id="down"></ol>
            <button id="check">Check</button>
            <button id="reveal">Reveal</button>
          </div>
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
    }, defaultPuzzles[0]);

    await loadScript(page, "generator.js");
    await loadScript(page, "crossword-widget.js");
    await loadScript(page, "crossword.js");
    await page.waitForTimeout(50);
    expect(await page.evaluate(() => document.getElementById("title").textContent)).toBe("Test Puzzle");
  });
});

test.describe("App completion coverage", () => {
  test("covers completion modal controls, storage writes, and completion failures", async ({ page }) => {
    await mountAppShell(page);
    await page.evaluate(() => {
      var storageProto = Object.getPrototypeOf(window.sessionStorage);

      window.__completionMode = "owner";
      window.__lastRewardUpdate = null;
      window.__setItemCalls = [];
      window.__warns = [];
      window.__originalSetItem = storageProto.setItem;
      storageProto.setItem = function (key, value) {
        window.__setItemCalls.push([key, value]);
        return window.__originalSetItem.call(this, key, value);
      };
      console.warn = function () {
        window.__warns.push(Array.prototype.slice.call(arguments).join(" "));
      };
      window.fetch = function (url) {
        if (String(url).indexOf("/me") >= 0) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: function () {
              return Promise.resolve({});
            },
          });
        }
        if (String(url).indexOf("/api/puzzles/owned-1/complete") >= 0) {
          if (window.__completionMode === "reject") {
            return Promise.reject(new Error("completion offline"));
          }
          return Promise.resolve({
            ok: true,
            json: function () {
              return Promise.resolve({
                mode: "owner",
                balance: { coins: 21 },
                reward: { base: 3, no_hint_bonus: 1, daily_bonus: 0, total: 4 },
                reward_summary: {
                  owner_reward_status: "claimed",
                  owner_reward_claim_total: 4,
                  shared_unique_solves: 2,
                  creator_credits_earned: 3,
                  creator_puzzle_cap_remaining: 7,
                  creator_daily_cap_remaining: 18,
                },
              });
            },
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: function () {
            return Promise.resolve({});
          },
        });
      };
      window.CrosswordApp = {
        getActivePuzzle: function () {
          return { id: "owned-1", source: "owned", shareToken: null };
        },
        updatePuzzleRewardData: function (puzzleId, rewardSummary) {
          window.__lastRewardUpdate = { puzzleId: puzzleId, rewardSummary: rewardSummary };
        },
      };
    });

    await loadScript(page, "app.js");

    var result = await page.evaluate(async () => {
      var app = window.__LLM_CROSSWORD_TEST__.app;
      var storageProto = Object.getPrototypeOf(window.sessionStorage);
      var modal = document.getElementById("completionModal");

      function waitForSettledCompletion() {
        return new Promise(function (resolve) {
          window.setTimeout(resolve, 0);
        });
      }

      function dispatchCompletionEvent() {
        window.dispatchEvent(new CustomEvent("crossword:completed", {
          detail: { usedHint: false, usedReveal: false },
        }));
      }

      app.setLoggedIn(true);
      app.setPostLoginView("generator");

      dispatchCompletionEvent();
      await waitForSettledCompletion();
      document.getElementById("completionCloseButton").click();
      var closedAfterClose = modal.open;

      dispatchCompletionEvent();
      await waitForSettledCompletion();
      document.getElementById("completionSecondaryAction").click();
      var closedAfterSecondary = modal.open;

      dispatchCompletionEvent();
      await waitForSettledCompletion();
      document.getElementById("completionPrimaryAction").click();
      var afterPrimary = {
        modalOpen: modal.open,
        generateDisplay: document.getElementById("generatePanel").style.display,
        title: document.getElementById("title").textContent,
      };

      dispatchCompletionEvent();
      await waitForSettledCompletion();
      modal.dispatchEvent(new MouseEvent("click", {
        bubbles: true,
      }));
      var closedAfterBackdrop = modal.open;

      window.__completionMode = "reject";
      dispatchCompletionEvent();
      await waitForSettledCompletion();
      storageProto.setItem = window.__originalSetItem;

      return {
        badgeText: document.getElementById("headerCreditBadge").textContent,
        closedAfterBackdrop: closedAfterBackdrop,
        closedAfterClose: closedAfterClose,
        closedAfterSecondary: closedAfterSecondary,
        postLoginView: window.sessionStorage.getItem("llm-crossword-post-login-view"),
        primaryState: afterPrimary,
        rewardUpdate: window.__lastRewardUpdate,
        setItemCalls: window.__setItemCalls.slice(),
        warnMessages: window.__warns.slice(),
      };
    });

    expect(result.postLoginView).toBe("generator");
    expect(result.setItemCalls).toContainEqual(["llm-crossword-post-login-view", "generator"]);
    expect(result.badgeText).toBe("21 credits");
    expect(result.closedAfterClose).toBe(false);
    expect(result.closedAfterSecondary).toBe(false);
    expect(result.closedAfterBackdrop).toBe(false);
    expect(result.primaryState).toEqual({
      modalOpen: false,
      generateDisplay: "",
      title: "Generate a New Crossword",
    });
    expect(result.rewardUpdate).toEqual({
      puzzleId: "owned-1",
      rewardSummary: {
        owner_reward_status: "claimed",
        owner_reward_claim_total: 4,
        shared_unique_solves: 2,
        creator_credits_earned: 3,
        creator_puzzle_cap_remaining: 7,
        creator_daily_cap_remaining: 18,
      },
    });
    expect(result.warnMessages.some((message) => message.indexOf("completion request failed: Error: completion offline") >= 0)).toBe(true);
  });

  test("covers completion helper fallbacks and early-return branches through the app hook", async ({ page }) => {
    await mountAppShell(page);
    await page.evaluate(() => {
      window.__activePuzzle = null;
      window.__completionCalls = [];
      window.__completionResponses = [];
      window.__generateResponse = null;
      window.__lastGeneratedPuzzle = null;
      window.__warns = [];
      window.__meMode = "ok";
      window.__mePromise = new Promise(function (resolve) {
        window.__resolveMe = resolve;
      });
      console.warn = function () {
        window.__warns.push(Array.prototype.slice.call(arguments).join(" "));
      };
      window.fetch = function (url, options) {
        if (String(url).indexOf("/me") >= 0) {
          if (window.__meMode === "pending") {
            return window.__mePromise;
          }
          return Promise.resolve({
            ok: window.__meMode === "ok",
            status: window.__meMode === "ok" ? 200 : 401,
            json: function () {
              return Promise.resolve({});
            },
          });
        }
        if (String(url).indexOf("/complete") >= 0) {
          var nextResponse = window.__completionResponses.shift();
          window.__completionCalls.push({
            url: String(url),
            body: options && options.body ? String(options.body) : "",
          });
          return Promise.resolve({
            ok: nextResponse ? nextResponse.ok : true,
            json: function () {
              return Promise.resolve(nextResponse ? nextResponse.data : {});
            },
          });
        }
        if (String(url).indexOf("/api/generate") >= 0) {
          return Promise.resolve({
            ok: window.__generateResponse ? window.__generateResponse.ok : true,
            json: function () {
              return Promise.resolve(window.__generateResponse ? window.__generateResponse.data : {});
            },
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: function () {
            return Promise.resolve({});
          },
        });
      };
      window.CrosswordApp = {
        addGeneratedPuzzle: function (puzzle) {
          window.__lastGeneratedPuzzle = puzzle;
        },
        getActivePuzzle: function () {
          return window.__activePuzzle;
        },
        updatePuzzleRewardData: function () {},
      };
    });

    await loadScript(page, "app.js");

    var result = await page.evaluate(async () => {
      var app = window.__LLM_CROSSWORD_TEST__.app;

      function waitForAsyncWork() {
        return new Promise(function (resolve) {
          window.setTimeout(resolve, 0);
        });
      }

      app.setState(null);
      app.showCompletionModal({ hidePrimary: true });
      var modalDefaults = {
        primaryDisplay: document.getElementById("completionPrimaryAction").style.display,
        reasonText: document.getElementById("completionReason").textContent,
        summaryText: document.getElementById("completionSummary").textContent,
        titleText: document.getElementById("completionTitle").textContent,
      };

      var reasonResults = {
        revealed: app.describeCompletionReason("revealed"),
        anonymous: app.describeCompletionReason("anonymous_solver"),
        puzzleCap: app.describeCompletionReason("creator_puzzle_cap_reached"),
        dailyCap: app.describeCompletionReason("creator_daily_cap_reached"),
        alreadyRecorded: app.describeCompletionReason("already_recorded"),
        empty: app.describeCompletionReason(""),
        fallback: app.describeCompletionReason("mystery_reason"),
      };

      var endpoints = {
        none: app.getCompletionEndpoint(null),
        owned: app.getCompletionEndpoint({ id: "owned-1", source: "owned" }),
        shared: app.getCompletionEndpoint({ source: "shared", shareToken: "shared-token" }),
        sharedMissingToken: app.getCompletionEndpoint({ source: "shared" }),
      };

      app.submitPuzzleCompletion({});
      window.__activePuzzle = { id: "practice-1", source: "practice" };
      app.submitPuzzleCompletion({});
      app.setLoggedIn(false);
      window.__activePuzzle = { source: "shared", shareToken: "shared-token" };
      app.submitPuzzleCompletion({});
      var earlyCallCount = window.__completionCalls.length;

      app.setLoggedIn(true);
      app.showSolveCompletionModal({});
      var zeroRewardSummary = document.getElementById("completionSummary").textContent;

      window.__completionResponses.push({
        ok: true,
        data: { mode: "shared", creator_coins: 0, reason: "mystery_reason" },
      });
      window.__activePuzzle = { source: "shared", shareToken: "shared-token" };
      app.submitPuzzleCompletion({});
      await waitForAsyncWork();
      var sharedFallbackReason = document.getElementById("completionReason").textContent;

      app.setState({
        pendingCompletionKey: "/api/shared/shared-token/complete:complete",
      });
      app.submitPuzzleCompletion({});
      var dedupedCallCount = window.__completionCalls.length;
      app.setState({
        pendingCompletionKey: null,
      });

      window.__completionResponses.push({
        ok: false,
        data: { message: "Blocked completion" },
      });
      window.__activePuzzle = { id: "owned-1", source: "owned" };
      app.submitPuzzleCompletion({});
      await waitForAsyncWork();

      window.generateCrossword = function (items, options) {
        return {
          title: options.title,
          subtitle: options.subtitle,
          description: options.description || "",
          entries: [
            { id: "solo", row: 1, col: 1, dir: "across", clue: "Solo", answer: "A", hint: "A" },
          ],
          overlaps: [],
          items: items,
        };
      };
      window.__generateResponse = {
        ok: true,
        data: {
          id: "generated-1",
          source: "owned",
          title: "Generated With Id",
          subtitle: "generated",
          description: "",
          items: [{ word: "Orbit", definition: "Path", hint: "Ring" }],
        },
      };
      app.showGenerateForm();
      document.getElementById("topicInput").value = "generate with id";
      document.getElementById("generateBtn").click();
      await waitForAsyncWork();

      window.dispatchEvent(new CustomEvent("crossword:active-puzzle", {
        detail: {},
      }));
      window.dispatchEvent(new CustomEvent("crossword:active-puzzle"));
      var shareTokenAfterEmptyActivePuzzle = app.getState().currentShareToken;

      window.__meMode = "pending";
      app.setLoggedIn(true);
      document.dispatchEvent(new Event("mpr-ui:auth:authenticated"));
      document.dispatchEvent(new Event("mpr-ui:auth:unauthenticated"));
      window.__resolveMe({ ok: false, status: 401 });
      await waitForAsyncWork();

      return {
        earlyCallCount: earlyCallCount,
        endpoints: endpoints,
        modalDefaults: modalDefaults,
        reasonResults: reasonResults,
        generatedPuzzleId: window.__lastGeneratedPuzzle && window.__lastGeneratedPuzzle.id,
        dedupedCallCount: dedupedCallCount,
        shareTokenAfterEmptyActivePuzzle: shareTokenAfterEmptyActivePuzzle,
        sharedFallbackReason: sharedFallbackReason,
        zeroRewardSummary: zeroRewardSummary,
        stateAfterAuthRace: app.getState(),
        warnings: window.__warns.slice(),
      };
    });

    expect(result.modalDefaults).toEqual({
      primaryDisplay: "none",
      reasonText: "",
      summaryText: "",
      titleText: "Puzzle complete",
    });
    expect(result.reasonResults).toEqual({
      revealed: "Reveal was used, so this puzzle no longer qualifies for rewards.",
      anonymous: "Sign in if you want shared solves to support the creator.",
      puzzleCap: "This puzzle has already reached its creator reward cap.",
      dailyCap: "The creator has already reached today’s shared reward cap.",
      alreadyRecorded: "This puzzle has already recorded its solve outcome.",
      empty: "",
      fallback: "This solve did not qualify for extra credits.",
    });
    expect(result.endpoints).toEqual({
      none: null,
      owned: "/api/puzzles/owned-1/complete",
      shared: "/api/shared/shared-token/complete",
      sharedMissingToken: null,
    });
    expect(result.earlyCallCount).toBe(0);
    expect(result.zeroRewardSummary).toBe("This puzzle completed without a reward payout.");
    expect(result.sharedFallbackReason).toBe("This solve did not qualify for extra credits.");
    expect(result.dedupedCallCount).toBe(1);
    expect(result.generatedPuzzleId).toBe("generated-1");
    expect(result.shareTokenAfterEmptyActivePuzzle).toBeNull();
    expect(result.stateAfterAuthRace.loggedIn).toBe(false);
    expect(result.warnings.some((message) => message.indexOf("Blocked completion") >= 0)).toBe(true);
  });

  test("covers app helper fallbacks when optional puzzle UI hooks are absent", async ({ page }) => {
    await page.goto("/blank.html");
    await page.setContent(
      appShellHtml
        .replace('        <div id="rewardStrip" hidden>\n          <span id="rewardStripLabel"></span>\n          <span id="rewardStripMeta"></span>\n        </div>\n', "")
        .replace('        <p id="shareHint" hidden></p>\n', "")
    );
    await page.evaluate(() => {
      window.__completionResponses = [];
      window.__completionCalls = [];
      window.__meMode = "ok";
      window.fetch = function (url, options) {
        if (String(url).indexOf("/me") >= 0) {
          if (window.__meMode === "pending") {
            return new Promise(function (resolve) {
              window.__resolveMe = resolve;
            });
          }
          return Promise.resolve({
            ok: window.__meMode !== "unauthorized",
            status: window.__meMode === "unauthorized" ? 401 : 200,
            json: function () {
              return Promise.resolve({});
            },
          });
        }
        if (String(url).indexOf("/complete") >= 0) {
          var nextResponse = window.__completionResponses.shift();
          window.__completionCalls.push({ url: String(url), body: options && options.body ? String(options.body) : "" });
          return Promise.resolve({
            ok: nextResponse ? nextResponse.ok : true,
            json: function () {
              return Promise.resolve(nextResponse ? nextResponse.data : {});
            },
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: function () {
            return Promise.resolve({});
          },
        });
      };
      window.CrosswordApp = {
        getActivePuzzle: function () {
          return window.__activePuzzle;
        },
      };
    });

    await loadScript(page, "app.js");

    var result = await page.evaluate(async () => {
      var app = window.__LLM_CROSSWORD_TEST__.app;

      function waitForAsyncWork() {
        return new Promise(function (resolve) {
          window.setTimeout(resolve, 0);
        });
      }

      app.setLoggedIn(true);
      app.showGenerateForm();

      window.CrosswordApp = {};
      app.submitPuzzleCompletion({});

      window.CrosswordApp = {
        getActivePuzzle: function () {
          return window.__activePuzzle;
        },
      };
      window.__completionResponses.push({
        ok: true,
        data: {
          mode: "owner",
          reward_summary: {
            owner_reward_status: "claimed",
            owner_reward_claim_total: 0,
            shared_unique_solves: 0,
            creator_credits_earned: 0,
            creator_puzzle_cap_remaining: 10,
            creator_daily_cap_remaining: 20,
          },
        },
      });
      window.__activePuzzle = { id: "owned-2", source: "owned" };
      app.submitPuzzleCompletion({});
      await waitForAsyncWork();

      window.__completionResponses.push({
        ok: false,
        data: {},
      });
      app.submitPuzzleCompletion({});
      await waitForAsyncWork();

      app.setState({
        authStateVersion: 7,
        loggedIn: true,
      });
      window.__meMode = "pending";
      document.dispatchEvent(new Event("mpr-ui:auth:unauthenticated"));
      app.setState({
        loggedIn: false,
      });
      window.__resolveMe({
        ok: false,
        status: 401,
        json: function () {
          return Promise.resolve({});
        },
      });
      await waitForAsyncWork();
      await waitForAsyncWork();

      return {
        completionCalls: window.__completionCalls.length,
        ownerSummary: document.getElementById("completionSummary").textContent,
        staleState: app.getState(),
      };
    });

    expect(result.completionCalls).toBe(2);
    expect(result.ownerSummary).toBe("This puzzle completed without a reward payout.");
    expect(result.staleState.loggedIn).toBe(false);
  });
});

test.describe("Crossword reward coverage", () => {
  test("covers owned replacement, shared reward updates, invalid stored puzzles, and owned-load failures", async ({ page }) => {
    await page.goto("/blank.html");
    await page.setContent(buildCrosswordShell(false));
    await page.evaluate((spec) => {
      window.__ownedFetchMode = "success";
      window.fetch = function (url) {
        if (String(url).indexOf("/api/puzzles") >= 0) {
          if (window.__ownedFetchMode === "error") {
            return Promise.resolve({
              ok: false,
              json: function () {
                return Promise.resolve({});
              },
            });
          }
          return Promise.resolve({
            ok: true,
            json: function () {
              return Promise.resolve({ puzzles: [] });
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
    }, defaultPuzzles[0]);

    await loadScript(page, "generator.js");
    await loadScript(page, "crossword-widget.js");
    await loadScript(page, "crossword.js");
    await page.waitForFunction(() => document.getElementById("title").textContent === "Test Puzzle");

    var result = await page.evaluate(async (spec) => {
      var crossword = window.__LLM_CROSSWORD_TEST__.crossword;

      function buildRewardSummary(status, sharedSolves, creatorCredits) {
        return {
          owner_reward_status: status,
          owner_reward_claim_total: status === "claimed" ? 4 : 0,
          shared_unique_solves: sharedSolves,
          creator_credits_earned: creatorCredits,
          creator_puzzle_cap_remaining: 10 - creatorCredits,
          creator_daily_cap_remaining: 20 - creatorCredits,
        };
      }

      function buildOwnedPuzzle(id, title, rewardSummary) {
        return crossword.buildStoredPuzzleFromResponse({
          id: id,
          source: "owned",
          share_token: id + "-share",
          title: title,
          subtitle: title + " subtitle",
          items: spec.items,
          reward_summary: rewardSummary,
        }, "owned", 0);
      }

      var invalidStoredMessage = "";
      try {
        crossword.buildStoredPuzzleFromResponse({
          id: "broken-owned",
          source: "owned",
          title: "Broken owned",
          items: null,
        }, "owned", 0);
      } catch (error) {
        invalidStoredMessage = error.message;
      }

      var firstOwned = buildOwnedPuzzle("owned-a", "Owned A", buildRewardSummary("available", 1, 2));
      var secondOwned = buildOwnedPuzzle("owned-b", "Owned B", buildRewardSummary("available", 2, 3));
      var replacementOwned = buildOwnedPuzzle("owned-b", "Owned B Updated", buildRewardSummary("claimed", 3, 4));

      crossword.setState({
        loggedIn: true,
        ownedPuzzles: [firstOwned, secondOwned],
        prebuiltPuzzles: [],
        sharedPuzzle: null,
        allPuzzles: [firstOwned, secondOwned],
        activePuzzleKey: firstOwned.puzzleKey,
        activePuzzleIndex: 0,
      });
      crossword.addGeneratedPuzzle(replacementOwned);

      var cardTitles = Array.prototype.map.call(
        document.querySelectorAll(".puzzle-card__title"),
        function (element) {
          return element.textContent;
        }
      );

      var sharedPuzzle = crossword.buildSharedPuzzleFromResponse({
        id: "shared-rewarded",
        source: "shared",
        share_token: "shared-rewarded-token",
        title: "Shared Reward Puzzle",
        subtitle: "Support the creator",
        items: spec.items,
        reward_summary: buildRewardSummary("available", 0, 0),
      }, "shared-rewarded-token");

      crossword.setState({
        loggedIn: true,
        ownedPuzzles: [],
        prebuiltPuzzles: [],
        sharedPuzzle: sharedPuzzle,
        activePuzzleKey: sharedPuzzle.puzzleKey,
        activePuzzleIndex: 0,
      });
      window.CrosswordApp.setViewerSession({ loggedIn: true });
      window.CrosswordApp.updatePuzzleRewardData("shared-rewarded", buildRewardSummary("available", 4, 6));
      var activeSharedRewardSummary = window.CrosswordApp.getActivePuzzle().rewardSummary;

      crossword.setState({
        loggedIn: false,
        ownedPuzzles: [firstOwned],
        prebuiltPuzzles: [],
        sharedPuzzle: null,
        ownedLoadPromise: null,
      });
      var loggedOutOwned = await crossword.loadOwnedPuzzles();

      window.__ownedFetchMode = "error";
      crossword.setState({
        loggedIn: true,
        ownedLoadPromise: null,
      });

      var loadFailureMessage = "";
      try {
        await crossword.loadOwnedPuzzles();
      } catch (error) {
        loadFailureMessage = error.message;
      }

      return {
        activeSharedRewardSummary: activeSharedRewardSummary,
        cardTitles: cardTitles,
        invalidStoredMessage: invalidStoredMessage,
        loadFailureMessage: loadFailureMessage,
        loggedOutOwnedLength: loggedOutOwned.length,
      };
    }, defaultPuzzles[0]);

    expect(result.invalidStoredMessage).toBe("Crossword specification invalid");
    expect(result.cardTitles).toEqual(["Owned A", "Owned B Updated"]);
    expect(result.activeSharedRewardSummary).toEqual({
      owner_reward_status: "available",
      owner_reward_claim_total: 0,
      shared_unique_solves: 4,
      creator_credits_earned: 6,
      creator_puzzle_cap_remaining: 4,
      creator_daily_cap_remaining: 14,
    });
    expect(result.loggedOutOwnedLength).toBe(0);
    expect(result.loadFailureMessage).toBe("Failed to load your puzzles");
  });

  test("covers crossword helper fallbacks and reward-strip edge cases through the crossword hook", async ({ page }) => {
    await page.goto("/blank.html");
    await page.setContent(`<!doctype html>
      <html>
        <body>
          <div id="puzzleView">
            <div id="descriptionPanel" hidden>
              <p id="descriptionContent" hidden></p>
            </div>
            <h1 id="title"></h1>
            <div id="subtitle"></div>
            <div id="rewardStrip" hidden>
              <span id="rewardStripLabel"></span>
              <span id="rewardStripMeta"></span>
            </div>
            <div id="status"></div>
            <div id="errorBox"></div>
            <div id="puzzleSidebar"></div>
            <button id="puzzleSidebarToggle" type="button"><span class="puzzle-sidebar__toggle-icon"></span></button>
            <div id="puzzleCardList"></div>
            <div id="generatePanel"></div>
            <div class="pane"></div>
            <div class="controls"></div>
            <div id="gridViewport"><div id="grid"></div></div>
            <ol id="across"></ol>
            <ol id="down"></ol>
            <button id="check">Check</button>
            <button id="reveal">Reveal</button>
            <div id="shareHint" hidden></div>
          </div>
          <button id="shareBtn" style="display:none"></button>
        </body>
      </html>`);
    await page.evaluate((spec) => {
      window.__ownedFetchMode = "success";
      window.fetch = function (url) {
        if (String(url).indexOf("/api/puzzles") >= 0) {
          if (window.__ownedFetchMode === "empty") {
            return Promise.resolve({
              ok: true,
              json: function () {
                return Promise.resolve({});
              },
            });
          }
          return Promise.resolve({
            ok: true,
            json: function () {
              return Promise.resolve({ puzzles: [] });
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
    }, defaultPuzzles[0]);

    await loadScript(page, "generator.js");
    await loadScript(page, "crossword-widget.js");
    await loadScript(page, "crossword.js");
    await page.waitForFunction(() => document.getElementById("title").textContent === "Test Puzzle");

    var result = await page.evaluate(async (spec) => {
      var crossword = window.__LLM_CROSSWORD_TEST__.crossword;

      function buildOwnedPuzzle(id, title, rewardSummary) {
        return crossword.buildStoredPuzzleFromResponse({
          id: id,
          source: "owned",
          share_token: id + "-share",
          title: title,
          subtitle: title + " subtitle",
          items: spec.items,
          reward_summary: rewardSummary,
        }, "owned", 0);
      }

      var nullKey = crossword.ensurePuzzleKey(null, "fallback", 3);
      var nullDescription = crossword.buildCardDescription(null);
      var coercedDefaults = crossword.coerceRewardSummary({});
      var defaultTitlePuzzle = crossword.buildStoredPuzzleFromResponse({
        subtitle: "Untitled subtitle",
        items: spec.items,
      }, null, 4);
      var storedFallbacks = crossword.buildStoredPuzzleFromResponse({
        title: "Stored fallback",
        subtitle: "Fallback subtitle",
        items: spec.items,
        reward_summary: {},
      }, "owned-fallback", 7);
      var preparedOwned = crossword.preparePuzzle({
        source: "owned",
        reward_summary: {},
      }, null, 1);
      var preparedPractice = crossword.preparePuzzle({
        reward_summary: {},
      }, null, 2);

      window.CrosswordApp.render(buildOwnedPuzzle("claimed-zero", "Claimed Zero", {
        owner_reward_status: "claimed",
        owner_reward_claim_total: 0,
        shared_unique_solves: 0,
        creator_credits_earned: 0,
        creator_puzzle_cap_remaining: 10,
        creator_daily_cap_remaining: 20,
      }));
      var claimedZeroMeta = document.getElementById("rewardStripMeta").textContent;
      var zeroDescription = crossword.buildCardDescription(buildOwnedPuzzle("zero-meta", "Zero Meta", {
        owner_reward_status: "claimed",
        owner_reward_claim_total: 0,
        shared_unique_solves: 0,
        creator_credits_earned: 0,
        creator_puzzle_cap_remaining: 10,
        creator_daily_cap_remaining: 20,
      }));
      var emptyDescriptionCard = crossword.createPuzzleCard({
        puzzleKey: "empty-meta",
        title: "Empty Meta",
        entries: [],
        source: "",
      });

      var titleBeforeInvalidSelect = document.getElementById("title").textContent;
      crossword.selectPuzzleByKey("missing-puzzle-key");
      var titleAfterInvalidSelect = document.getElementById("title").textContent;
      crossword.setActivePuzzleByKey(null);
      var activePuzzleIndexAfterNullKey = window.CrosswordApp.getActivePuzzle();

      var reusedPromise = Promise.resolve(["reused"]);
      crossword.setState({
        loggedIn: true,
        ownedLoadPromise: reusedPromise,
      });
      var reusedOwnedPromise = crossword.loadOwnedPuzzles() === reusedPromise;
      await reusedPromise;

      window.__ownedFetchMode = "empty";
      crossword.setState({
        loggedIn: true,
        ownedLoadPromise: null,
        ownedPuzzles: [],
      });
      var loadedOwnedPuzzles = await crossword.loadOwnedPuzzles();

      crossword.setState({
        sharedPuzzle: null,
        loggedIn: false,
        ownedPuzzles: [],
        prebuiltPuzzles: [],
        activePuzzleKey: null,
      });
      crossword.renderSidebar();
      var emptySidebarMarkup = document.getElementById("puzzleCardList").textContent;

      window.CrosswordApp.updatePuzzleRewardData("claimed-zero", null);
      crossword.setState({
        ownedPuzzles: [buildOwnedPuzzle("owned-match", "Owned Match", {
          owner_reward_status: "available",
          owner_reward_claim_total: 0,
          shared_unique_solves: 1,
          creator_credits_earned: 1,
          creator_puzzle_cap_remaining: 9,
          creator_daily_cap_remaining: 19,
        })],
      });
      window.CrosswordApp.updatePuzzleRewardData("non-matching-id", {
        owner_reward_status: "claimed",
        owner_reward_claim_total: 3,
        shared_unique_solves: 1,
        creator_credits_earned: 1,
        creator_puzzle_cap_remaining: 9,
        creator_daily_cap_remaining: 19,
      });
      var metaAfterInvalidRewardUpdate = document.getElementById("rewardStripMeta").textContent;

      var plainPractice = generateCrossword(spec.items, {
        title: "Plain Practice",
        subtitle: "Practice subtitle",
        description: "",
        random: function () {
          return 0.5;
        },
      });
      window.CrosswordApp.render(plainPractice);

      return {
        claimedZeroMeta: claimedZeroMeta,
        coercedDefaults: coercedDefaults,
        activePuzzleAfterNullKey: activePuzzleIndexAfterNullKey,
        defaultTitle: defaultTitlePuzzle.title,
        defaultTitleKey: defaultTitlePuzzle.puzzleKey,
        emptySidebarMarkup: emptySidebarMarkup,
        emptyDescriptionCardText: emptyDescriptionCard.querySelector(".puzzle-card__description").textContent,
        loadedOwnedPuzzlesLength: loadedOwnedPuzzles.length,
        metaAfterInvalidRewardUpdate: metaAfterInvalidRewardUpdate,
        nullKey: nullKey,
        nullDescription: nullDescription,
        preparedOwnedSource: preparedOwned.source,
        preparedPracticeKey: preparedPractice.puzzleKey,
        preparedPracticeSource: preparedPractice.source,
        renderedSource: plainPractice.source,
        reusedOwnedPromise: reusedOwnedPromise,
        zeroDescription: zeroDescription,
        storedFallbackId: storedFallbacks.id,
        storedFallbackKey: storedFallbacks.puzzleKey,
        storedFallbackShareToken: storedFallbacks.shareToken,
        storedFallbackSource: storedFallbacks.source,
        titleAfterInvalidSelect: titleAfterInvalidSelect,
        titleBeforeInvalidSelect: titleBeforeInvalidSelect,
      };
    }, defaultPuzzles[0]);

    expect(result.nullKey).toBe("fallback:3");
    expect(result.nullDescription).toBe("");
    expect(result.defaultTitle).toBe("Crossword");
    expect(result.defaultTitleKey).toBe("stored:4");
    expect(result.coercedDefaults).toEqual({
      owner_reward_status: "practice",
      owner_reward_claim_total: 0,
      shared_unique_solves: 0,
      creator_credits_earned: 0,
      creator_puzzle_cap_remaining: 0,
      creator_daily_cap_remaining: 0,
    });
    expect(result.activePuzzleAfterNullKey).toBeNull();
    expect(result.claimedZeroMeta).toBe("This puzzle has already recorded its solve outcome.");
    expect(result.emptySidebarMarkup).toBe("");
    expect(result.emptyDescriptionCardText).toBe("");
    expect(result.titleBeforeInvalidSelect).toBe("Claimed Zero");
    expect(result.titleAfterInvalidSelect).toBe("Claimed Zero");
    expect(result.reusedOwnedPromise).toBe(true);
    expect(result.loadedOwnedPuzzlesLength).toBe(0);
    expect(result.metaAfterInvalidRewardUpdate).toBe("Base reward: 3 credits. No hints: +1. First 3 owner solves each UTC day: +1. Shared solves: 1. Creator credits earned: 1.");
    expect(result.preparedOwnedSource).toBe("owned");
    expect(result.preparedPracticeSource).toBe("practice");
    expect(result.preparedPracticeKey).toBe("practice:2");
    expect(result.renderedSource).toBe("practice");
    expect(result.zeroDescription).toBe("Zero Meta subtitle");
    expect(result.storedFallbackId).toBeNull();
    expect(result.storedFallbackShareToken).toBeNull();
    expect(result.storedFallbackSource).toBe("owned-fallback");
    expect(result.storedFallbackKey).toBe("owned-fallback:7");
  });
});

test.describe("Crossword widget completion coverage", () => {
  test("covers completed-puzzle event dispatch from the widget", async ({ page }) => {
    await page.goto("/blank.html");
    await loadScript(page, "generator.js");
    await loadScript(page, "crossword-widget.js");

    var result = await page.evaluate((items) => {
      var container = document.createElement("div");
      var completionDetail = null;
      var widget;

      document.body.appendChild(container);
      window.addEventListener("crossword:completed", function handleCompletion(event) {
        completionDetail = event.detail;
      }, { once: true });

      widget = new window.CrosswordWidget(container, {
        puzzle: generateCrossword(items, {
          title: "Solved Widget",
          subtitle: "completion coverage",
          random: function () {
            return 0.5;
          },
        }),
      });

      Object.keys(widget._testApi.cellsById).forEach(function (entryId) {
        widget._testApi.cellsById[entryId].forEach(function (cell) {
          cell.input.value = cell.sol;
        });
      });

      widget._checkBtn.click();

      return {
        completionDetail: completionDetail,
        statusText: widget._statusEl.textContent,
      };
    }, defaultPuzzles[0].items);

    expect(result.completionDetail).toEqual({
      trigger: "check",
      usedHint: false,
      usedReveal: false,
    });
    expect(result.statusText).toBe("All correct — nice!");
  });
});

test.describe("Generator comparison coverage", () => {
  test("covers density and longest-side tiebreakers through the generator hook", async ({ page }) => {
    await page.goto("/blank.html");
    await loadScript(page, "generator.js");

    var result = await page.evaluate((items) => {
      generateCrossword(items, {
        title: "Comparison Seed",
        random: function () {
          return 0.5;
        },
      });

      return {
        noBestLayoutTreatsCandidateAsBetter: generateCrossword.__test.compareLayoutMetrics(
          {
            crossings: 1,
            area: 10,
            imbalance: 1,
            density: 0.7,
            longestSide: 4,
          },
          null
        ),
        densityBetter: generateCrossword.__test.compareLayoutMetrics(
          {
            crossings: 1,
            area: 10,
            imbalance: 1,
            density: 0.7,
            longestSide: 5,
          },
          {
            crossings: 1,
            area: 10,
            imbalance: 1,
            density: 0.6,
            longestSide: 5,
          }
        ),
        shorterLongestSideBetter: generateCrossword.__test.compareLayoutMetrics(
          {
            crossings: 1,
            area: 10,
            imbalance: 1,
            density: 0.7,
            longestSide: 4,
          },
          {
            crossings: 1,
            area: 10,
            imbalance: 1,
            density: 0.7,
            longestSide: 5,
          }
        ),
      };
    }, defaultPuzzles[0].items);

    expect(result.noBestLayoutTreatsCandidateAsBetter).toBe(true);
    expect(result.densityBetter).toBe(true);
    expect(result.shorterLongestSideBetter).toBe(true);
  });
});
