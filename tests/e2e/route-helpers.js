// Shared Playwright route helpers — replaces the old __testOverrides shim.
//
// These use page.route() to intercept at the network level, so tests exercise
// the real window.fetch (including credentials: "include") rather than a
// monkey-patched wrapper.  If app code ever drops credentials or changes the
// /me check, the tests will notice.

const fs = require("fs");
const path = require("path");

const defaultPuzzles = [
  {
    title: "Test Puzzle",
    subtitle: "A test puzzle.",
    items: [
      { word: "orbit", definition: "Path around Earth", hint: "elliptical route" },
      { word: "mare", definition: "A lunar sea", hint: "shares name with horse" },
      { word: "tides", definition: "Ocean rise-and-fall", hint: "regular shoreline shifts" },
      { word: "lunar", definition: "Relating to the Moon", hint: "companion" },
      { word: "apollo", definition: "Program to the Moon", hint: "Saturn V" },
    ],
  },
];

const defaultSession = Object.freeze({
  user_id: "user-123",
  email: "user@example.com",
  display: "Test User",
  avatar_url: "",
  roles: ["member"],
  expires: 4102444800,
  is_admin: false,
});

const appShellHtml = `<!doctype html>
<html>
  <body>
    <section id="landingPage">
      <button id="landingTryPrebuilt" type="button">Try a pre-built puzzle</button>
      <button id="landingSignIn" type="button">Sign in to generate</button>
    </section>
    <span id="headerCreditBadge" style="display:none;"></span>
    <div id="puzzleView" style="display:none;">
      <div id="newCrosswordCard" role="button" tabindex="0">New Crossword</div>
      <div class="hdr">
        <div class="hdr__copy">
          <h1 id="title">Crossword Puzzle</h1>
          <div id="subtitle">Loading...</div>
        </div>
      </div>
      <div id="generatePanel" style="display:none;">
        <input id="topicInput" type="text">
        <select id="wordCount">
          <option value="5">5</option>
          <option value="8" selected>8</option>
        </select>
        <button id="generateBtn" type="button">Generate</button>
        <div id="generateStatus"></div>
      </div>
      <div class="pane">
        <div class="clues">
          <div id="descriptionPanel" hidden>
            <p id="descriptionContent" hidden></p>
          </div>
        </div>
      </div>
      <div class="controls">
        <div id="rewardStrip" hidden>
          <span id="rewardStripLabel"></span>
          <span id="rewardStripMeta"></span>
        </div>
        <button id="shareBtn" type="button" disabled>Share</button>
        <p id="shareHint" hidden></p>
      </div>
    </div>
    <dialog id="completionModal">
      <h2 id="completionTitle">Puzzle complete</h2>
      <p id="completionSummary"></p>
      <div id="completionBreakdown"></div>
      <p id="completionReason"></p>
      <button id="completionCloseButton" type="button">Close</button>
      <button id="completionSecondaryAction" type="button">Keep solving</button>
      <button id="completionPrimaryAction" type="button">Generate another</button>
    </dialog>
  </body>
</html>`;

const mprUiConfigStub = fs.readFileSync(
  path.join(__dirname, "mpr-ui-config.stub.js"),
  "utf8"
);

function json(status, body) {
  return {
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  };
}

function text(status, body) {
  return { status, contentType: "text/plain", body };
}

function createBillingSummary(overrides = {}) {
  return {
    enabled: false,
    provider_code: "",
    balance: null,
    packs: [],
    activity: [],
    portal_available: false,
    ...(overrides || {}),
  };
}

function createSession(overrides = {}) {
  return {
    ...defaultSession,
    ...(overrides || {}),
  };
}

/**
 * Stub common server-side resources that the page loads but which have no
 * real backend in tests.  Without this the browser sends real requests to
 * localhost which fail with net errors, affecting component rendering.
 */
async function setupBaseRoutes(page) {
  // /tauth.js is loaded via <script src="/tauth.js"> — stub it empty.
  await page.route("**/tauth.js", (route) =>
    route.fulfill(text(200, "/* tauth stub */"))
  );
  // /api/session may be called by admin.js — return 401 by default.
  await page.route("**/api/session", (route) =>
    route.fulfill(json(401, { error: "unauthorized" }))
  );
  // Stub mpr-ui-config.js so it doesn't fetch the CDN bundle.
  await page.route("**/mpr-ui-config.js", (route) =>
    route.fulfill(text(200, mprUiConfigStub))
  );
  await page.route("**/api/billing/summary", (route) =>
    route.fulfill(json(200, createBillingSummary()))
  );
  await page.route("**/api/billing/checkout", (route) =>
    route.fulfill(json(503, { message: "billing unavailable" }))
  );
  await page.route("**/api/billing/portal", (route) =>
    route.fulfill(json(503, { message: "billing unavailable" }))
  );
}

/**
 * Set up page.route() mocks for a logged-in user.
 *
 * @param {import('@playwright/test').Page} page
 * @param {object}  [opts]
 * @param {number}  [opts.coins=15]          — credit balance
 * @param {Array}   [opts.puzzles]           — puzzle payload (defaults to defaultPuzzles)
 * @param {string}  [opts.configYaml=""]     — raw config.yaml text
 * @param {Record<string, (route: import('@playwright/test').Route) => void>} [opts.extra]
 *        — additional route overrides keyed by URL glob
 */
async function setupLoggedInRoutes(page, opts = {}) {
  var coins = opts.coins != null ? opts.coins : 15;
  var puzzles = opts.puzzles || defaultPuzzles;
  var ownedPuzzles = opts.ownedPuzzles || [];
  var configYaml = opts.configYaml != null ? opts.configYaml : "";
  var session = createSession(opts.session);

  await setupBaseRoutes(page);
  // Override the default 401 /api/session with the provided session data.
  await page.unroute("**/api/session");
  await page.route("**/api/session", (route) =>
    route.fulfill(json(200, session))
  );
  await page.route("**/me", (route) => route.fulfill(json(200, {})));
  await page.route("**/api/bootstrap", (route) =>
    route.fulfill(json(200, { balance: { coins }, grants: { bootstrap_coins: 0, daily_login_coins: 0, low_balance_coins: 0 } }))
  );
  await page.route("**/api/puzzles", (route) =>
    route.fulfill(json(200, { puzzles: ownedPuzzles }))
  );
  await page.route("**/config.yaml", (route) =>
    route.fulfill(text(200, configYaml))
  );
  await page.route("**/crosswords.json", (route) =>
    route.fulfill(json(200, puzzles))
  );

  if (opts.extra) {
    for (var pattern of Object.keys(opts.extra)) {
      await page.route(pattern, opts.extra[pattern]);
    }
  }
}

/**
 * Set up page.route() mocks for a logged-out user.
 *
 * @param {import('@playwright/test').Page} page
 * @param {object}  [opts]
 * @param {number}  [opts.meStatus=401]      — status code for /me
 * @param {Array}   [opts.puzzles]           — puzzle payload
 * @param {string}  [opts.configYaml=""]     — raw config.yaml text
 * @param {Record<string, (route: import('@playwright/test').Route) => void>} [opts.extra]
 */
async function setupLoggedOutRoutes(page, opts = {}) {
  var meStatus = opts.meStatus || 401;
  var puzzles = opts.puzzles || defaultPuzzles;
  var configYaml = opts.configYaml != null ? opts.configYaml : "";

  await setupBaseRoutes(page);
  await page.route("**/me", (route) =>
    route.fulfill(json(meStatus, { error: "unauthorized" }))
  );
  await page.route("**/config.yaml", (route) =>
    route.fulfill(text(200, configYaml))
  );
  await page.route("**/crosswords.json", (route) =>
    route.fulfill(json(200, puzzles))
  );

  if (opts.extra) {
    for (var pattern of Object.keys(opts.extra)) {
      await page.route(pattern, opts.extra[pattern]);
    }
  }
}

async function mountAppShell(page) {
  await page.goto("/blank.html");
  await page.setContent(appShellHtml);
}

module.exports = {
  appShellHtml,
  createBillingSummary,
  createSession,
  defaultPuzzles,
  defaultSession,
  json,
  mountAppShell,
  text,
  setupLoggedInRoutes,
  setupLoggedOutRoutes,
};
