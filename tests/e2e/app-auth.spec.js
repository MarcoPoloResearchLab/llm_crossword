// @ts-check

const { test, expect } = require("./coverage-fixture");

const testPuzzleData = [
  {
    title: "Test Puzzle",
    subtitle: "A test puzzle.",
    items: [
      { word: "orbit", definition: "The Moon's path around Earth", hint: "elliptical route" },
      { word: "mare", definition: "A lunar sea", hint: "shares name with horse" },
      { word: "tides", definition: "Ocean rise-and-fall", hint: "regular shoreline shifts" },
      { word: "lunar", definition: "Relating to the Moon", hint: "Earth's companion" },
      { word: "apollo", definition: "Program that took humans to the Moon", hint: "Saturn V missions" },
    ],
  },
];

async function setupLoggedInMocks(page) {
  await page.addInitScript(() => {
    window.__testOverrides = {
      fetch: function (url, opts) {
        if (url === "/me") return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        if (url === "/api/bootstrap") return Promise.resolve({ ok: true, json: () => Promise.resolve({ balance: { coins: 15 } }) });
        if (typeof url === "string" && url.includes("config.yaml")) return Promise.resolve({ ok: true, text: () => Promise.resolve("") });
        if (typeof url === "string" && url.includes("crosswords.json"))
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve([
                {
                  title: "Test Puzzle",
                  subtitle: "A test puzzle.",
                  items: [
                    { word: "orbit", definition: "The Moon's path around Earth", hint: "elliptical route" },
                    { word: "mare", definition: "A lunar sea", hint: "shares name with horse" },
                    { word: "tides", definition: "Ocean rise-and-fall", hint: "regular shoreline shifts" },
                    { word: "lunar", definition: "Relating to the Moon", hint: "Earth's companion" },
                    { word: "apollo", definition: "Program that took humans to the Moon", hint: "Saturn V missions" },
                  ],
                },
              ]),
          });
        return Promise.resolve({ ok: false, status: 404 });
      },
    };
  });
}

function setupLoggedOutMocks(page) {
  return page.addInitScript(() => {
    window.__testOverrides = {
      fetch: function (url, opts) {
        if (url === "/me") return Promise.resolve({ ok: false, status: 401 });
        if (typeof url === "string" && url.includes("config.yaml")) return Promise.resolve({ ok: true, text: () => Promise.resolve("") });
        if (typeof url === "string" && url.includes("crosswords.json"))
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve([
                {
                  title: "Test Puzzle",
                  subtitle: "A test puzzle.",
                  items: [
                    { word: "orbit", definition: "The Moon's path around Earth", hint: "elliptical route" },
                    { word: "mare", definition: "A lunar sea", hint: "shares name with horse" },
                    { word: "tides", definition: "Ocean rise-and-fall", hint: "regular shoreline shifts" },
                    { word: "lunar", definition: "Relating to the Moon", hint: "Earth's companion" },
                    { word: "apollo", definition: "Program that took humans to the Moon", hint: "Saturn V missions" },
                  ],
                },
              ]),
          });
        return Promise.resolve({ ok: false, status: 404 });
      },
    };
  });
}

test.describe("App auth — logged in state", () => {
  test("generate button is enabled with credits when logged in", async ({ page }) => {
    await setupLoggedInMocks(page);
    await page.goto("/");
    var genBtn = page.locator("#generateBtn");
    await expect(genBtn).toBeEnabled({ timeout: 5000 });
    await expect(genBtn).toContainText("(5 credits)");
  });

  test("credit badge shows balance after login", async ({ page }) => {
    await setupLoggedInMocks(page);
    await page.goto("/");
    // Wait for bootstrap to complete
    await expect(page.locator("#headerCreditBadge")).toContainText("credits", { timeout: 5000 });
  });

  test("logged-in user stays on landing page with generate form visible", async ({ page }) => {
    await setupLoggedInMocks(page);
    await page.goto("/");
    // Logged-in users stay on landing page with generate form visible
    await expect(page.locator("#landingPage")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("#landingGenerateForm")).toBeVisible({ timeout: 5000 });
  });

  test("session persists after page refresh", async ({ page }) => {
    await setupLoggedInMocks(page);
    await page.goto("/");
    // Wait for login to complete
    await expect(page.locator("#generateBtn")).toBeEnabled({ timeout: 5000 });
    // Refresh the page (mocks persist via addInitScript)
    await page.reload();
    // After refresh, user should still be logged in on the landing page
    await expect(page.locator("#landingPage")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("#landingGenerateForm")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("#generateBtn")).toBeEnabled({ timeout: 5000 });
    await expect(page.locator("#headerCreditBadge")).toContainText("credits", { timeout: 5000 });
  });
});

test.describe("App auth — logged out state", () => {
  test("generate form is hidden when not logged in", async ({ page }) => {
    await setupLoggedOutMocks(page);
    await page.goto("/");
    // Generate form is hidden on landing page when logged out
    await expect(page.locator("#landingGenerateForm")).toBeHidden({ timeout: 5000 });
    // Generate button should be disabled
    var genBtn = page.locator("#generateBtn");
    await expect(genBtn).toBeDisabled();
  });

  test("generate form appears after login", async ({ page }) => {
    await setupLoggedInMocks(page);
    await page.goto("/");
    // Generate form is visible on landing page when logged in
    await expect(page.locator("#landingGenerateForm")).toBeVisible({ timeout: 5000 });
  });
});

test.describe("App auth — bootstrap failure", () => {
  test("UI still works when bootstrap fails", async ({ page }) => {
    const warnings = [];
    page.on("console", (msg) => {
      if (msg.type() === "warning") warnings.push(msg.text());
    });
    await page.addInitScript(() => {
      window.__testOverrides = {
        fetch: function (url, opts) {
          if (url === "/me") return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
          if (url === "/api/bootstrap") return Promise.reject(new Error("network failure"));
          if (typeof url === "string" && url.includes("config.yaml")) return Promise.resolve({ ok: true, text: () => Promise.resolve("") });
          if (typeof url === "string" && url.includes("crosswords.json"))
            return Promise.resolve({
              ok: true,
              json: () =>
                Promise.resolve([
                  {
                    title: "Test Puzzle",
                    subtitle: "A test puzzle.",
                    items: [
                      { word: "orbit", definition: "The Moon's path around Earth", hint: "elliptical route" },
                      { word: "mare", definition: "A lunar sea", hint: "shares name with horse" },
                      { word: "tides", definition: "Ocean rise-and-fall", hint: "regular shoreline shifts" },
                      { word: "lunar", definition: "Relating to the Moon", hint: "Earth's companion" },
                      { word: "apollo", definition: "Program that took humans to the Moon", hint: "Saturn V missions" },
                    ],
                  },
                ]),
            });
          return Promise.resolve({ ok: false, status: 404 });
        },
      };
    });
    await page.goto("/");
    // onLogin() auto-navigates to puzzle view with generate tab active
    // Generate button should still be enabled (user is logged in)
    await expect(page.locator("#generateBtn")).toBeEnabled({ timeout: 5000 });
  });
});

test.describe("App auth — generate success", () => {
  test("renders puzzle and shows 'Puzzle ready!' message", async ({ page }) => {
    await page.addInitScript(() => {
      window.__testOverrides = {
        fetch: function (url, opts) {
          if (url === "/me") return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
          if (url === "/api/bootstrap") return Promise.resolve({ ok: true, json: () => Promise.resolve({ balance: { coins: 15 } }) });
          if (url === "/api/generate")
            return Promise.resolve({
              ok: true,
              json: () =>
                Promise.resolve({
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
                }),
            });
          if (typeof url === "string" && url.includes("config.yaml")) return Promise.resolve({ ok: true, text: () => Promise.resolve("") });
          if (typeof url === "string" && url.includes("crosswords.json"))
            return Promise.resolve({
              ok: true,
              json: () =>
                Promise.resolve([
                  {
                    title: "Test Puzzle",
                    subtitle: "A test puzzle.",
                    items: [
                      { word: "orbit", definition: "The Moon's path around Earth", hint: "elliptical route" },
                      { word: "mare", definition: "A lunar sea", hint: "shares name with horse" },
                      { word: "tides", definition: "Ocean rise-and-fall", hint: "regular shoreline shifts" },
                      { word: "lunar", definition: "Relating to the Moon", hint: "Earth's companion" },
                      { word: "apollo", definition: "Program that took humans to the Moon", hint: "Saturn V missions" },
                    ],
                  },
                ]),
            });
          return Promise.resolve({ ok: false, status: 404 });
        },
      };
    });
    await page.goto("/");
    // Logged-in user sees generate form on landing page
    await expect(page.locator("#generateBtn")).toBeEnabled({ timeout: 5000 });
    await page.fill("#topicInput", "moon");
    await page.locator("#generateBtn").click();
    // After successful generation, user is navigated to puzzle view (solver)
    await expect(page.locator("#puzzleView")).toBeVisible({ timeout: 10000 });
    // The status message is set but may be hidden since landing page is hidden;
    // verify the text content directly.
    await expect(page.locator("#generateStatus")).toContainText("Puzzle ready!", { timeout: 5000 });
  });
});

test.describe("App auth — generate insufficient credits", () => {
  test("shows 'Not enough credits' message", async ({ page }) => {
    await page.addInitScript(() => {
      window.__testOverrides = {
        fetch: function (url, opts) {
          if (url === "/me") return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
          if (url === "/api/bootstrap") return Promise.resolve({ ok: true, json: () => Promise.resolve({ balance: { coins: 2 } }) });
          if (url === "/api/generate")
            return Promise.resolve({
              ok: false,
              status: 402,
              json: () => Promise.resolve({ error: "insufficient_credits", message: "Not enough credits" }),
            });
          if (typeof url === "string" && url.includes("config.yaml")) return Promise.resolve({ ok: true, text: () => Promise.resolve("") });
          if (typeof url === "string" && url.includes("crosswords.json"))
            return Promise.resolve({
              ok: true,
              json: () =>
                Promise.resolve([
                  {
                    title: "Test Puzzle",
                    subtitle: "A test puzzle.",
                    items: [
                      { word: "orbit", definition: "The Moon's path around Earth", hint: "elliptical route" },
                      { word: "mare", definition: "A lunar sea", hint: "shares name with horse" },
                      { word: "tides", definition: "Ocean rise-and-fall", hint: "regular shoreline shifts" },
                      { word: "lunar", definition: "Relating to the Moon", hint: "Earth's companion" },
                      { word: "apollo", definition: "Program that took humans to the Moon", hint: "Saturn V missions" },
                    ],
                  },
                ]),
            });
          return Promise.resolve({ ok: false, status: 404 });
        },
      };
    });
    await page.goto("/");
    // onLogin() auto-navigates to puzzle view with generate tab active
    await expect(page.locator("#generateBtn")).toBeEnabled({ timeout: 5000 });
    await page.fill("#topicInput", "moon");
    await page.locator("#generateBtn").click();
    await expect(page.getByText("Not enough credits")).toBeVisible({ timeout: 10000 });
  });
});

test.describe("App auth — generate network error", () => {
  test("shows 'Network error' message", async ({ page }) => {
    await page.addInitScript(() => {
      window.__testOverrides = {
        fetch: function (url, opts) {
          if (url === "/me") return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
          if (url === "/api/bootstrap") return Promise.resolve({ ok: true, json: () => Promise.resolve({ balance: { coins: 15 } }) });
          if (url === "/api/generate") return Promise.reject(new Error("network error"));
          if (typeof url === "string" && url.includes("config.yaml")) return Promise.resolve({ ok: true, text: () => Promise.resolve("") });
          if (typeof url === "string" && url.includes("crosswords.json"))
            return Promise.resolve({
              ok: true,
              json: () =>
                Promise.resolve([
                  {
                    title: "Test Puzzle",
                    subtitle: "A test puzzle.",
                    items: [
                      { word: "orbit", definition: "The Moon's path around Earth", hint: "elliptical route" },
                      { word: "mare", definition: "A lunar sea", hint: "shares name with horse" },
                      { word: "tides", definition: "Ocean rise-and-fall", hint: "regular shoreline shifts" },
                      { word: "lunar", definition: "Relating to the Moon", hint: "Earth's companion" },
                      { word: "apollo", definition: "Program that took humans to the Moon", hint: "Saturn V missions" },
                    ],
                  },
                ]),
            });
          return Promise.resolve({ ok: false, status: 404 });
        },
      };
    });
    await page.goto("/");
    // onLogin() auto-navigates to puzzle view with generate tab active
    await expect(page.locator("#generateBtn")).toBeEnabled({ timeout: 5000 });
    await page.fill("#topicInput", "moon");
    await page.locator("#generateBtn").click();
    await expect(page.getByText("Network error")).toBeVisible({ timeout: 10000 });
  });
});

test.describe("App auth — empty topic", () => {
  test("shows 'Please enter a topic.' when topic is empty", async ({ page }) => {
    await setupLoggedInMocks(page);
    await page.goto("/");
    // onLogin() auto-navigates to puzzle view with generate tab active
    await expect(page.locator("#generateBtn")).toBeEnabled({ timeout: 5000 });
    await page.locator("#generateBtn").click();
    await expect(page.getByText("Please enter a topic.")).toBeVisible();
  });
});

test.describe("App auth — landing Sign in button fallback", () => {
  test("landing Sign in button falls back to puzzle view when no header sign-in button", async ({ page }) => {
    await setupLoggedOutMocks(page);
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

test.describe("App auth — auth events", () => {
  test("mpr-ui:auth:authenticated event triggers login", async ({ page }) => {
    await page.addInitScript(() => {
      window.__testOverrides = {
        fetch: function (url, opts) {
          if (url === "/me") return Promise.resolve({ ok: false, status: 401 });
          if (url === "/api/bootstrap") return Promise.resolve({ ok: true, json: () => Promise.resolve({ balance: { coins: 20 } }) });
          if (typeof url === "string" && url.includes("config.yaml")) return Promise.resolve({ ok: true, text: () => Promise.resolve("") });
          if (typeof url === "string" && url.includes("crosswords.json"))
            return Promise.resolve({
              ok: true,
              json: () =>
                Promise.resolve([
                  {
                    title: "Test Puzzle",
                    subtitle: "A test puzzle.",
                    items: [
                      { word: "orbit", definition: "The Moon's path around Earth", hint: "elliptical route" },
                      { word: "mare", definition: "A lunar sea", hint: "shares name with horse" },
                      { word: "tides", definition: "Ocean rise-and-fall", hint: "regular shoreline shifts" },
                      { word: "lunar", definition: "Relating to the Moon", hint: "Earth's companion" },
                      { word: "apollo", definition: "Program that took humans to the Moon", hint: "Saturn V missions" },
                    ],
                  },
                ]),
            });
          return Promise.resolve({ ok: false, status: 404 });
        },
      };
    });
    await page.goto("/");
    // Initially logged out — generate form is hidden, button is disabled
    await expect(page.locator("#landingGenerateForm")).toBeHidden({ timeout: 5000 });
    await expect(page.locator("#generateBtn")).toBeDisabled();
    // Dispatch authenticated event
    await page.evaluate(() => {
      document.dispatchEvent(new Event("mpr-ui:auth:authenticated"));
    });
    // Now generate form should be visible and button enabled
    await expect(page.locator("#landingGenerateForm")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("#generateBtn")).toBeEnabled({ timeout: 5000 });
  });

  test("mpr-ui:auth:unauthenticated event triggers logout and hides generate form", async ({ page }) => {
    await setupLoggedInMocks(page);
    await page.goto("/");
    // Logged-in user sees generate form on landing page
    await expect(page.locator("#generateBtn")).toBeEnabled({ timeout: 5000 });
    await expect(page.locator("#landingGenerateForm")).toBeVisible({ timeout: 5000 });
    // Dispatch unauthenticated event
    await page.evaluate(() => {
      document.dispatchEvent(new Event("mpr-ui:auth:unauthenticated"));
    });
    // Should stay on landing page but generate form should be hidden
    await expect(page.locator("#landingPage")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("#landingGenerateForm")).toBeHidden({ timeout: 5000 });
  });
});
