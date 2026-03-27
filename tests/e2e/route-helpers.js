// Shared Playwright route helpers — replaces the old __testOverrides shim.
//
// These use page.route() to intercept at the network level, so tests exercise
// the real window.fetch (including credentials: "include") rather than a
// monkey-patched wrapper.  If app code ever drops credentials or changes the
// /me check, the tests will notice.

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
  // Register minimal custom elements so layout tests work without CDN access.
  await page.route("**/mpr-ui-config.js", (route) =>
    route.fulfill(
      text(
        200,
        [
          "(function(){",
          "  if (!customElements.get('mpr-header')) {",
          "    customElements.define('mpr-header', class extends HTMLElement {",
          "      connectedCallback() {",
          "        this.style.display = 'block';",
          "        this.style.width = '100%';",
          "        this.style.height = '56px';",
          "      }",
          "    });",
          "  }",
          "  if (!customElements.get('mpr-user')) {",
          "    customElements.define('mpr-user', class extends HTMLElement {",
          "      static get observedAttributes() { return ['menu-items', 'logout-url', 'logout-label']; }",
          "      connectedCallback() { this._render(); }",
          "      attributeChangedCallback() { this._render(); }",
          "      _render() {",
          "        var logoutLabel = this.getAttribute('logout-label') || 'Log out';",
          "        var logoutUrl = this.getAttribute('logout-url') || '/';",
          "        var items = [];",
          "        try { items = JSON.parse(this.getAttribute('menu-items') || '[]'); } catch(e) {}",
          "        this.innerHTML = '<div class=\"mpr-user__layout\">' +",
          "          '<button type=\"button\" class=\"mpr-user__trigger\" data-mpr-user=\"trigger\" ' +",
          "            'aria-haspopup=\"true\" aria-expanded=\"false\">U</button>' +",
          "          '<div class=\"mpr-user__menu\" data-mpr-user=\"menu\" role=\"menu\" ' +",
          "            'style=\"display:none;position:absolute;right:0;top:100%;min-width:160px;' +",
          "            'padding:8px;background:#1e293b;border:1px solid rgba(148,163,184,0.25);' +",
          "            'border-radius:12px;z-index:999\">' +",
          "          items.map(function(it, i) {",
          "            return '<button type=\"button\" class=\"mpr-user__menu-item\" role=\"menuitem\" ' +",
          "              'data-mpr-user=\"menu-item\" data-mpr-user-action=\"' + (it.action||'') + '\" ' +",
          "              'data-mpr-user-index=\"' + i + '\">' + (it.label||'') + '</button>';",
          "          }).join('') +",
          "          '<a class=\"mpr-user__menu-item\" role=\"menuitem\" href=\"' + logoutUrl + '\" ' +",
          "            'data-mpr-user=\"logout\">' + logoutLabel + '</a>' +",
          "          '</div></div>';",
          "        var trigger = this.querySelector('[data-mpr-user=\"trigger\"]');",
          "        var menu = this.querySelector('[data-mpr-user=\"menu\"]');",
          "        if (trigger && menu) {",
          "          trigger.addEventListener('click', function() {",
          "            var open = menu.style.display !== 'none';",
          "            menu.style.display = open ? 'none' : 'block';",
          "            trigger.setAttribute('aria-expanded', open ? 'false' : 'true');",
          "          });",
          "        }",
          "        var self = this;",
          "        this.querySelectorAll('[data-mpr-user=\"menu-item\"]').forEach(function(btn) {",
          "          btn.addEventListener('click', function() {",
          "            var action = btn.getAttribute('data-mpr-user-action');",
          "            var idx = parseInt(btn.getAttribute('data-mpr-user-index'), 10);",
          "            self.dispatchEvent(new CustomEvent('mpr-user:menu-item', {",
          "              bubbles: true, detail: { action: action, index: idx, label: btn.textContent }",
          "            }));",
          "            menu.style.display = 'none';",
          "            trigger.setAttribute('aria-expanded', 'false');",
          "          });",
          "        });",
          "      }",
          "    });",
          "  }",
          "  if (!customElements.get('mpr-detail-drawer')) {",
          "    customElements.define('mpr-detail-drawer', class extends HTMLElement {",
          "      static get observedAttributes() { return ['open', 'heading', 'subheading']; }",
          "      connectedCallback() { this._init(); this._sync(); }",
          "      attributeChangedCallback() { if (this._panel) this._sync(); }",
          "      _init() {",
          "        if (this._panel) return;",
          "        var heading = this.getAttribute('heading') || 'Details';",
          "        var slotBody = this.querySelector('[slot=\"body\"]');",
          "        var backdrop = document.createElement('div');",
          "        backdrop.className = 'mpr-detail-drawer__backdrop';",
          "        var panel = document.createElement('aside');",
          "        panel.className = 'mpr-detail-drawer__panel';",
          "        panel.innerHTML = '<div class=\"mpr-detail-drawer__header\" style=\"display:flex;' +",
          "          'justify-content:space-between;align-items:center\">' +",
          "          '<h2 class=\"mpr-detail-drawer__heading\">' + heading + '</h2>' +",
          "          '<button class=\"mpr-detail-drawer__close\" ' +",
          "            'data-mpr-detail-drawer=\"close\">Close</button></div>' +",
          "          '<div class=\"mpr-detail-drawer__body\"></div>';",
          "        var body = panel.querySelector('.mpr-detail-drawer__body');",
          "        if (slotBody) {",
          "          while (slotBody.firstChild) body.appendChild(slotBody.firstChild);",
          "          slotBody.remove();",
          "        }",
          "        this.appendChild(backdrop);",
          "        this.appendChild(panel);",
          "        this._backdrop = backdrop;",
          "        this._panel = panel;",
          "        var self = this;",
          "        panel.querySelector('[data-mpr-detail-drawer=\"close\"]')",
          "          .addEventListener('click', function() {",
          "            self.removeAttribute('open');",
          "            self.dispatchEvent(new CustomEvent('mpr-ui:detail-drawer:close',{bubbles:true}));",
          "          });",
          "        backdrop.addEventListener('click', function() {",
          "          self.removeAttribute('open');",
          "          self.dispatchEvent(new CustomEvent('mpr-ui:detail-drawer:close',{bubbles:true}));",
          "        });",
          "      }",
          "      _sync() {",
          "        var isOpen = this.hasAttribute('open');",
          "        this.style.cssText = 'position:fixed;inset:0;z-index:80;display:block;' +",
          "          (isOpen ? '' : 'pointer-events:none;');",
          "        this._backdrop.style.cssText = 'position:absolute;inset:0;' +",
          "          'background:rgba(15,23,42,0.65);opacity:' + (isOpen?'1':'0') + ';' +",
          "          'pointer-events:' + (isOpen?'auto':'none') + ';';",
          "        this._panel.style.cssText = 'position:absolute;top:0;bottom:0;right:0;' +",
          "          'width:min(38rem,100vw);padding:1.25rem;background:rgba(15,23,42,0.98);' +",
          "          'border-left:1px solid rgba(148,163,184,0.25);display:flex;' +",
          "          'flex-direction:column;gap:1rem;overflow:auto;pointer-events:auto;' +",
          "          'transform:translateX(' + (isOpen?'0':'100%') + ');';",
          "      }",
          "    });",
          "  }",
          "})();",
        ].join("\n")
      )
    )
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
  var configYaml = opts.configYaml != null ? opts.configYaml : "";
  var session = opts.session || {
    email: "user@example.com",
    name: "Test User",
    picture: "",
  };

  await setupBaseRoutes(page);
  // Override the default 401 /api/session with the provided session data.
  await page.unroute("**/api/session");
  await page.route("**/api/session", (route) =>
    route.fulfill(json(200, session))
  );
  await page.route("**/me", (route) => route.fulfill(json(200, {})));
  await page.route("**/api/bootstrap", (route) =>
    route.fulfill(json(200, { balance: { coins } }))
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

module.exports = {
  defaultPuzzles,
  json,
  text,
  setupLoggedInRoutes,
  setupLoggedOutRoutes,
};
