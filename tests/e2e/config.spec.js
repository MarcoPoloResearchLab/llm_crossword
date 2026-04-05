// @ts-check

const { test, expect } = require("./coverage-fixture");
const { createFrontendConfigYaml, setupLoggedOutRoutes } = require("./route-helpers");

test.describe("Config — default behavior", () => {
  test("header has base-url set to origin", async ({ page }) => {
    await setupLoggedOutRoutes(page);
    await page.goto("/");
    // The inline script in index.html sets base-url on the header to current origin.
    // mpr-header may be hidden when the mpr-ui component JS hides it for
    // unauthenticated users, so check the attribute rather than visibility.
    var baseUrl = await page.locator("mpr-header").getAttribute("base-url");
    expect(baseUrl).toBeTruthy();
  });

  test("config.js falls back to /configs/frontend-config.yml when data-config-url is missing", async ({ page }) => {
    var configYaml = createFrontendConfigYaml({
      auth: {
        tauthUrl: "https://tauth.example.test",
        googleClientId: "test-google-client-id",
        tenantId: "crossword",
        loginPath: "/auth/google",
        logoutPath: "/auth/logout",
        noncePath: "/auth/nonce",
      },
    });

    await page.goto("/blank.html");
    await page.setContent("<!doctype html><html><body><mpr-header id=\"app-header\"></mpr-header></body></html>");
    await page.evaluate((yamlText) => {
      window.__configFetches = [];
      window.fetch = function (url) {
        window.__configFetches.push(String(url));
        return Promise.resolve({
          text: function () {
            return Promise.resolve(yamlText);
          },
        });
      };
    }, configYaml);
    await page.addScriptTag({ url: "/js/config.js" });

    var absoluteConfigUrl = await page.evaluate(() => {
      return window.location.origin + "/configs/frontend-config.yml";
    });
    var fetchedUrls = await page.evaluate(() => window.__configFetches.slice());
    var tauthUrl = await page.locator("#app-header").getAttribute("tauth-url");

    expect(fetchedUrls).toContain(absoluteConfigUrl);
    expect(tauthUrl).toBe("https://tauth.example.test");
  });

  test("config.js uses runtime service config for the frontend config URL", async ({ page }) => {
    var configYaml = createFrontendConfigYaml({
      auth: {
        tauthUrl: "https://selected.example.test",
        googleClientId: "test-google-client-id",
        tenantId: "crossword",
        loginPath: "/auth/google",
        logoutPath: "/auth/logout",
        noncePath: "/auth/nonce",
      },
    });

    await page.goto("/blank.html");
    await page.setContent("<!doctype html><html><body><mpr-header id=\"app-header\"></mpr-header></body></html>");
    await page.evaluate((yamlText) => {
      window.LLMCrosswordRuntimeConfig = {
        services: {
          authBaseUrl: "https://tauth.example.test",
          configUrl: "https://config.example.test/runtime-config",
        },
      };
      window.__configFetches = [];
      window.fetch = function (url) {
        window.__configFetches.push(String(url));
        return Promise.resolve({
          text: function () {
            return Promise.resolve(yamlText);
          },
        });
      };
    }, configYaml);
    await page.addScriptTag({ url: "/js/service-config.js" });
    await page.addScriptTag({ url: "/js/config.js" });

    var fetchedUrls = await page.evaluate(() => window.__configFetches.slice());
    var tauthUrl = await page.locator("#app-header").getAttribute("tauth-url");

    expect(fetchedUrls).toEqual([
      "https://config.example.test/runtime-config",
    ]);
    expect(tauthUrl).toBe("https://selected.example.test");
  });

  test("service-config keeps frontend config on the site origin when apiBaseUrl is set", async ({ page }) => {
    var configYaml = createFrontendConfigYaml();

    await page.goto("/blank.html");
    await page.setContent("<!doctype html><html><body><mpr-header id=\"app-header\"></mpr-header></body></html>");
    await page.evaluate((yamlText) => {
      window.LLMCrosswordRuntimeConfig = {
        services: {
          apiBaseUrl: "https://llm-crossword-api.mprlab.com",
        },
      };
      window.__configFetches = [];
      window.fetch = function (url) {
        window.__configFetches.push(String(url));
        return Promise.resolve({
          text: function () {
            return Promise.resolve(yamlText);
          },
        });
      };
    }, configYaml);
    await page.addScriptTag({ url: "/js/service-config.js" });
    await page.addScriptTag({ url: "/js/config.js" });

    expect(await page.evaluate(() => window.__configFetches.slice())).toEqual([
      "http://localhost:8111/configs/frontend-config.yml",
    ]);
  });
});

test.describe("Config — fetch failure", () => {
  test("page still works when config fetch fails (fallback)", async ({ page }) => {
    await setupLoggedOutRoutes(page, {
      extra: {
        "**/configs/frontend-config.yml*": (route) => route.abort("failed"),
      },
    });
    await page.goto("/");
    // Page should still load and function despite frontend config fetch failure.
    await expect(page.getByText("Create crossword puzzles with AI")).toBeVisible();
    // tauth-url should still be set (fallback to same origin)
    var tauthUrl = await page.locator("mpr-header").getAttribute("tauth-url");
    expect(tauthUrl).toBeTruthy();
    // Puzzles should still work
    await page.getByRole("button", { name: "Try a pre-built puzzle" }).click();
    await expect(page.locator("#puzzleView").getByText("Across")).toBeVisible({ timeout: 10000 });
  });
});
