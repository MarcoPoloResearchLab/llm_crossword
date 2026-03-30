// @ts-check

const { test, expect } = require("./coverage-fixture");
const { setupLoggedOutRoutes } = require("./route-helpers");

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

  test("config.js falls back to /config.yml when data-config-url is missing", async ({ page }) => {
    await page.goto("/blank.html");
    await page.setContent("<!doctype html><html><body><mpr-header id=\"app-header\"></mpr-header></body></html>");
    await page.evaluate(() => {
      var yamlText = [
        "environments:",
        "  - description: \"Local\"",
        "    origins:",
        "      - \"" + window.location.origin + "\"",
        "    auth:",
        "      tauthUrl: \"https://tauth.example.test\"",
      ].join("\n");
      window.__configFetches = [];
      window.fetch = function (url) {
        window.__configFetches.push(String(url));
        return Promise.resolve({
          text: function () {
            return Promise.resolve(yamlText);
          },
        });
      };
    });
    await page.addScriptTag({ url: "/js/config.js" });

    var absoluteConfigUrl = await page.evaluate(() => {
      return window.location.origin + "/config.yml";
    });
    var fetchedUrls = await page.evaluate(() => window.__configFetches.slice());
    var tauthUrl = await page.locator("#app-header").getAttribute("tauth-url");

    expect(fetchedUrls).toContain(absoluteConfigUrl);
    expect(tauthUrl).toBe("https://tauth.example.test");
  });

  test("config.js prefers runtime service config when present", async ({ page }) => {
    await page.goto("/blank.html");
    await page.setContent("<!doctype html><html><body><mpr-header id=\"app-header\"></mpr-header></body></html>");
    await page.evaluate(() => {
      window.LLMCrosswordRuntimeConfig = {
        services: {
          authBaseUrl: "https://tauth.example.test",
          configUrl: "https://config.example.test/runtime-config.yml",
        },
      };
      window.__configFetches = [];
      window.fetch = function (url) {
        window.__configFetches.push(String(url));
        return Promise.resolve({
          text: function () {
            return Promise.resolve("environments:\n  - description: \"Other\"\n    origins:\n      - \"https://elsewhere.example.test\"\n    auth:\n      tauthUrl: \"https://ignored.example.test\"");
          },
        });
      };
    });
    await page.addScriptTag({ url: "/js/service-config.js" });
    await page.addScriptTag({ url: "/js/config.js" });

    var fetchedUrls = await page.evaluate(() => window.__configFetches.slice());
    var tauthUrl = await page.locator("#app-header").getAttribute("tauth-url");

    expect(fetchedUrls).toEqual(["https://config.example.test/runtime-config.yml"]);
    expect(tauthUrl).toBe("https://tauth.example.test");
  });

  test("service-config defaults config.yml to the API origin when apiBaseUrl is set", async ({ page }) => {
    await page.goto("/blank.html");
    await page.setContent("<!doctype html><html><body><mpr-header id=\"app-header\"></mpr-header></body></html>");
    await page.evaluate(() => {
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
            return Promise.resolve("");
          },
        });
      };
    });
    await page.addScriptTag({ url: "/js/service-config.js" });
    await page.addScriptTag({ url: "/js/config.js" });

    expect(await page.evaluate(() => window.__configFetches.slice())).toEqual([
      "https://llm-crossword-api.mprlab.com/config.yml",
    ]);
  });
});

test.describe("Config — fetch failure", () => {
  test("page still works when config fetch fails (fallback)", async ({ page }) => {
    await setupLoggedOutRoutes(page, {
      extra: {
        "**/config.yml": (route) => route.abort("failed"),
      },
    });
    await page.goto("/");
    // Page should still load and function despite config.yml fetch failure.
    await expect(page.getByText("Create crossword puzzles with AI")).toBeVisible();
    // tauth-url should still be set (fallback to same origin)
    var tauthUrl = await page.locator("mpr-header").getAttribute("tauth-url");
    expect(tauthUrl).toBeTruthy();
    // Puzzles should still work
    await page.getByRole("button", { name: "Try a pre-built puzzle" }).click();
    await expect(page.locator("#puzzleView").getByText("Across")).toBeVisible({ timeout: 10000 });
  });
});
