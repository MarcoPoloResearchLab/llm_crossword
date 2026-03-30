// @ts-check

const { test, expect } = require("./coverage-fixture");
const { mountAppShell, setupLoggedOutRoutes } = require("./route-helpers");

async function loadScript(page, fileName) {
  await page.addScriptTag({ url: `/js/${fileName}` });
}

function jsonResponse(status, body) {
  return {
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  };
}

test.describe("Billing coverage", () => {
  test("covers billing helpers and error handling through the test hook", async ({ page }) => {
    await page.goto("/blank.html");
    await page.evaluate(() => {
      window.__LLM_CROSSWORD_TEST__ = {};
      window.__billingEvents = [];
      [
        "billing-no-detail",
        "billing-open-request",
        "billing-summary",
        "billing-status",
      ].forEach(function (name) {
        window.addEventListener("llm-crossword:" + name, function (event) {
          window.__billingEvents.push({
            detail: event.detail || null,
            name: name,
          });
        });
      });
    });
    await loadScript(page, "billing.js");

    const result = await page.evaluate(async () => {
      var billing = window.__LLM_CROSSWORD_TEST__.billing;
      var knownSummary = {
        activity: [],
        balance: null,
        enabled: true,
        packs: [{ code: "starter" }],
        portal_available: false,
        provider_code: "paddle",
      };
      var outcomes = {};

      billing.dispatchBillingEvent("billing-no-detail");
      billing.updateBillingStatus();
      outcomes.defaultStatus = window.CrosswordBilling.getState().lastStatus;
      outcomes.normalized = billing.normalizeSummary(null);
      outcomes.messageError = billing.describeBillingError({
        data: { message: "  Checkout denied  " },
      }, "fallback");
      outcomes.fallbackError = billing.describeBillingError({}, "fallback");

      billing.setState({
        loggedIn: true,
        summary: knownSummary,
      });
      window.fetch = function () {
        return Promise.resolve({
          json: function () {
            return Promise.reject(new Error("bad json"));
          },
          ok: false,
          status: 500,
        });
      };
      delete window.authFetch;
      try {
        await billing.loadSummary();
      } catch (error) {
        outcomes.summaryError = error.message;
      }
      outcomes.summaryErrorStatus = window.CrosswordBilling.getState().lastStatus;

      window.fetch = function () {
        return Promise.reject({});
      };
      try {
        await billing.loadSummary({
          force: true,
        });
      } catch (error) {}
      outcomes.fallbackSummaryStatus = window.CrosswordBilling.getState().lastStatus;

      billing.updateBillingStatus("Suppressed status", "info", true);
      window.fetch = function () {
        return Promise.reject(new Error("suppressed"));
      };
      try {
        await billing.loadSummary({
          force: true,
          suppressErrors: true,
        });
      } catch (error) {}
      outcomes.suppressedSummaryStatus = window.CrosswordBilling.getState().lastStatus;

      window.authFetch = function () {
        return Promise.resolve({
          json: function () {
            return Promise.resolve({});
          },
          ok: false,
          status: 401,
        });
      };
      outcomes.unauthorizedSummary = await billing.loadSummary();

      billing.setState({
        loggedIn: false,
        summary: knownSummary,
      });
      outcomes.loggedOutSummary = await billing.loadSummary();

      billing.setState({ summary: knownSummary });
      window.fetch = function () {
        return Promise.reject(new Error("offline"));
      };
      delete window.authFetch;
      outcomes.setLoggedInSummary = await window.CrosswordBilling.setLoggedIn(true);

      window.fetch = function () {
        return Promise.resolve({
          json: function () {
            return Promise.resolve({ message: "  Pack unavailable  " });
          },
          ok: false,
          status: 400,
        });
      };
      try {
        await billing.requestCheckout("starter");
      } catch (error) {
        outcomes.checkoutError = error.message;
      }

      window.fetch = function () {
        return Promise.resolve({
          json: function () {
            return Promise.resolve({});
          },
          ok: true,
          status: 200,
        });
      };
      try {
        await billing.requestCheckout("starter");
      } catch (error) {
        outcomes.checkoutMissingURL = error.message;
      }

      try {
        await billing.requestCheckout("   ");
      } catch (error) {
        outcomes.checkoutBlankPack = error.message;
      }

      window.fetch = function () {
        return Promise.resolve({
          json: function () {
            return Promise.resolve({});
          },
          ok: false,
          status: 500,
        });
      };
      try {
        await billing.requestPortalSession();
      } catch (error) {
        outcomes.portalError = error.message;
      }

      window.fetch = function () {
        return Promise.resolve({
          json: function () {
            return Promise.resolve({});
          },
          ok: true,
          status: 200,
        });
      };
      try {
        await billing.requestPortalSession();
      } catch (error) {
        outcomes.portalMissingURL = error.message;
      }

      billing.setState({
        loggedIn: true,
        summary: knownSummary,
      });
      window.authFetch = function () {
        return Promise.reject(new Error("offline"));
      };
      outcomes.restoredSummary = await billing.openAccountBilling({
        force: true,
        isBusy: true,
        message: "Open drawer",
        suppressErrors: true,
        tone: "info",
      });
      outcomes.openDrawerStatus = window.CrosswordBilling.getState().lastStatus;
      outcomes.events = window.__billingEvents.slice();
      return outcomes;
    });

    expect(result.defaultStatus).toEqual({
      isBusy: false,
      message: "",
      tone: "",
    });
    expect(result.normalized).toEqual({
      activity: [],
      balance: null,
      enabled: false,
      packs: [],
      portal_available: false,
      provider_code: "",
    });
    expect(result.messageError).toBe("Checkout denied");
    expect(result.fallbackError).toBe("fallback");
    expect(result.summaryError).toBe("We couldn't load billing right now.");
    expect(result.summaryErrorStatus).toEqual({
      isBusy: false,
      message: "We couldn't load billing right now.",
      tone: "error",
    });
    expect(result.fallbackSummaryStatus).toEqual({
      isBusy: false,
      message: "We couldn't load billing right now.",
      tone: "error",
    });
    expect(result.suppressedSummaryStatus).toEqual({
      isBusy: true,
      message: "Suppressed status",
      tone: "info",
    });
    expect(result.unauthorizedSummary).toEqual({
      activity: [],
      balance: null,
      enabled: false,
      packs: [],
      portal_available: false,
      provider_code: "",
    });
    expect(result.loggedOutSummary).toEqual({
      activity: [],
      balance: null,
      enabled: false,
      packs: [],
      portal_available: false,
      provider_code: "",
    });
    expect(result.setLoggedInSummary).toEqual({
      activity: [],
      balance: null,
      enabled: true,
      packs: [{ code: "starter" }],
      portal_available: false,
      provider_code: "paddle",
    });
    expect(result.checkoutError).toBe("Pack unavailable");
    expect(result.checkoutMissingURL).toBe("Checkout did not return a URL.");
    expect(result.checkoutBlankPack).toBe("Choose a credit pack first.");
    expect(result.portalError).toBe("We couldn't open billing right now.");
    expect(result.portalMissingURL).toBe("Billing portal did not return a URL.");
    expect(result.restoredSummary).toEqual({
      activity: [],
      balance: null,
      enabled: true,
      packs: [{ code: "starter" }],
      portal_available: false,
      provider_code: "paddle",
    });
    expect(result.openDrawerStatus).toEqual({
      isBusy: true,
      message: "Open drawer",
      tone: "info",
    });
    expect(result.events.find((event) => event.name === "billing-no-detail")).toEqual({
      detail: {},
      name: "billing-no-detail",
    });
    expect(result.events.find((event) => event.name === "billing-open-request")).toEqual({
      detail: {
        force: true,
        isBusy: true,
        message: "Open drawer",
        suppressErrors: true,
        tone: "info",
      },
      name: "billing-open-request",
    });
  });

  test("covers billing polling, timers, and url helpers", async ({ page }) => {
    await page.goto("/blank.html");
    await page.evaluate(() => {
      window.__LLM_CROSSWORD_TEST__ = {};
      window.__billingEvents = [];
      [
        "billing-open-request",
        "billing-status",
        "billing-transaction-complete",
        "billing-transaction-timeout",
      ].forEach(function (name) {
        window.addEventListener("llm-crossword:" + name, function (event) {
          window.__billingEvents.push({
            detail: event.detail || null,
            name: name,
          });
        });
      });
    });
    await loadScript(page, "billing.js");

    const result = await page.evaluate(async () => {
      var billing = window.__LLM_CROSSWORD_TEST__.billing;
      var clearTimeoutCalls = [];
      var replaceCalls = [];
      var scheduledCallbacks = [];
      var scheduledTimeouts = [];
      var originalClearTimeout = window.clearTimeout;
      var originalHistoryReplaceState = window.history.replaceState.bind(window.history);
      var originalSetTimeout = window.setTimeout;
      var originalURL = window.URL;
      var outcomes = {};

      window.clearTimeout = function (timerId) {
        clearTimeoutCalls.push(timerId);
      };
      window.setTimeout = function (callback, delay) {
        scheduledCallbacks.push(callback);
        scheduledTimeouts.push(delay);
        return scheduledTimeouts.length;
      };
      window.history.replaceState = function (state, title, url) {
        replaceCalls.push(url);
      };

      outcomes.guardNoSummary = billing.findTransactionActivity(null, "txn");
      outcomes.noMatch = billing.findTransactionActivity({
        activity: [{ transaction_id: "other", status: "pending" }],
      }, "txn");
      outcomes.firstMatch = billing.findTransactionActivity({
        activity: [
          { transaction_id: "txn", status: "pending" },
          { transaction_id: "txn", status: "open" },
        ],
      }, "txn");
      outcomes.completedMatch = billing.findTransactionActivity({
        activity: [
          { transaction_id: "txn", status: "pending" },
          { event_type: "transaction.completed", transaction_id: "txn" },
        ],
      }, "txn");
      outcomes.completedChecks = {
        event: billing.isCompletedTransactionActivity({ event_type: "transaction.completed" }),
        pending: billing.isCompletedTransactionActivity({ status: "pending" }),
        status: billing.isCompletedTransactionActivity({ status: "completed" }),
      };

      window.URL = function () {
        throw new Error("bad url");
      };
      outcomes.badReturnTransactionID = billing.getReturnTransactionID();
      billing.clearReturnTransactionID();
      window.URL = originalURL;

      billing.clearReturnTransactionID();
      outcomes.replaceCallsWithoutQuery = replaceCalls.slice();

      billing.setState({ pollTimerId: 77 });
      billing.clearPollTimer();

      billing.setState({
        activeTransactionId: "txn-stop",
        loggedIn: false,
        pollDeadlineTimestamp: Date.now() + 1000,
        pollTimerId: 88,
      });
      await billing.pollForTransactionResult();
      outcomes.afterEarlyStop = window.CrosswordBilling.getState();

      window.authFetch = function () {
        return Promise.resolve({
          json: function () {
            return Promise.resolve({
              activity: [{ status: "pending", transaction_id: "txn-timeout-activity" }],
              enabled: true,
            });
          },
          ok: true,
          status: 200,
        });
      };
      billing.setState({
        activeTransactionId: "txn-timeout-activity",
        loggedIn: true,
        pollDeadlineTimestamp: 0,
      });
      await billing.pollForTransactionResult();
      outcomes.timeoutWithActivity = window.CrosswordBilling.getState().lastStatus.message;

      window.authFetch = function () {
        return Promise.resolve({
          json: function () {
            return Promise.resolve({
              activity: [],
              enabled: true,
            });
          },
          ok: true,
          status: 200,
        });
      };
      billing.setState({
        activeTransactionId: "txn-timeout-empty",
        loggedIn: true,
        pollDeadlineTimestamp: 0,
      });
      await billing.pollForTransactionResult();
      outcomes.timeoutWithoutActivity = window.CrosswordBilling.getState().lastStatus.message;

      window.authFetch = function () {
        return Promise.resolve({
          json: function () {
            return Promise.resolve({
              activity: [{ status: "pending", transaction_id: "txn-pending" }],
              enabled: true,
            });
          },
          ok: true,
          status: 200,
        });
      };
      billing.setState({
        activeTransactionId: "txn-pending",
        loggedIn: true,
        pollDeadlineTimestamp: Date.now() + 1000,
      });
      await billing.pollForTransactionResult();
      outcomes.pendingWithActivity = window.CrosswordBilling.getState().lastStatus.message;

      window.authFetch = function () {
        return Promise.resolve({
          json: function () {
            return Promise.resolve({
              activity: [],
              enabled: true,
            });
          },
          ok: true,
          status: 200,
        });
      };
      billing.setState({
        activeTransactionId: "txn-waiting",
        loggedIn: true,
        pollDeadlineTimestamp: Date.now() + 1000,
      });
      await billing.pollForTransactionResult();
      outcomes.pendingWithoutActivity = window.CrosswordBilling.getState().lastStatus.message;

      window.authFetch = function () {
        return Promise.resolve({
          json: function () {
            return Promise.resolve({
              activity: [{ event_type: "transaction.completed", transaction_id: "txn-complete" }],
              enabled: true,
            });
          },
          ok: true,
          status: 200,
        });
      };
      billing.setState({
        activeTransactionId: "txn-complete",
        loggedIn: true,
        pollDeadlineTimestamp: Date.now() + 1000,
      });
      await billing.pollForTransactionResult();
      outcomes.completedMessage = window.CrosswordBilling.getState().lastStatus.message;

      window.authFetch = function () {
        return Promise.reject(new Error("offline"));
      };
      billing.setState({
        activeTransactionId: "txn-error-timeout",
        loggedIn: true,
        pollDeadlineTimestamp: 0,
      });
      await billing.pollForTransactionResult();
      outcomes.errorTimeoutMessage = window.CrosswordBilling.getState().lastStatus.message;

      window.authFetch = function () {
        return Promise.reject(new Error("offline"));
      };
      billing.setState({
        activeTransactionId: "txn-error-retry",
        loggedIn: true,
        pollDeadlineTimestamp: Date.now() + 1000,
      });
      await billing.pollForTransactionResult();

      billing.setState({
        activeTransactionId: "",
        loggedIn: true,
      });
      billing.startTransactionPolling("   ");
      outcomes.blankStartTransactionID = window.CrosswordBilling.getState().activeTransactionId;

      window.authFetch = function () {
        return Promise.reject(new Error("offline"));
      };
      billing.setState({
        activeTransactionId: "",
        loggedIn: true,
        pollDeadlineTimestamp: 0,
      });
      await billing.startTransactionPolling("txn-same");
      outcomes.afterStartTransaction = window.CrosswordBilling.getState();
      await billing.startTransactionPolling("txn-same");

      outcomes.clearTimeoutCalls = clearTimeoutCalls.slice();
      billing.setState({
        activeTransactionId: "",
        loggedIn: false,
      });
      if (scheduledCallbacks.length > 0) {
        scheduledCallbacks[0]();
      }
      outcomes.scheduledTimeouts = scheduledTimeouts.slice();
      outcomes.restoreDrawerPending = window.sessionStorage.getItem("llm-crossword-billing-restore-drawer");
      outcomes.events = window.__billingEvents.slice();

      window.clearTimeout = originalClearTimeout;
      window.history.replaceState = originalHistoryReplaceState;
      window.setTimeout = originalSetTimeout;
      return outcomes;
    });

    expect(result.guardNoSummary).toBeNull();
    expect(result.noMatch).toBeNull();
    expect(result.firstMatch).toEqual({
      status: "pending",
      transaction_id: "txn",
    });
    expect(result.completedMatch).toEqual({
      event_type: "transaction.completed",
      transaction_id: "txn",
    });
    expect(result.completedChecks).toEqual({
      event: true,
      pending: false,
      status: true,
    });
    expect(result.badReturnTransactionID).toBe("");
    expect(result.replaceCallsWithoutQuery).toEqual([]);
    expect(result.afterEarlyStop.activeTransactionId).toBe("");
    expect(result.timeoutWithActivity).toBe("Payment is still processing. Refresh billing in a moment if credits do not appear.");
    expect(result.timeoutWithoutActivity).toBe("Checkout closed before payment completed.");
    expect(result.pendingWithActivity).toBe("Waiting for payment confirmation...");
    expect(result.pendingWithoutActivity).toBe("Returning from checkout. Waiting for billing activity...");
    expect(result.completedMessage).toBe("Payment confirmed. Your credits are ready to use.");
    expect(result.errorTimeoutMessage).toBe("We couldn't confirm payment automatically. Refresh billing in a moment.");
    expect(result.blankStartTransactionID).toBe("");
    expect(result.afterStartTransaction.activeTransactionId).toBe("txn-same");
    expect(result.clearTimeoutCalls).toEqual(expect.arrayContaining([77, 88]));
    expect(result.scheduledTimeouts).toEqual(expect.arrayContaining([2500]));
    expect(result.restoreDrawerPending).toBe("1");
    expect(result.events.filter((event) => event.name === "billing-open-request")).toEqual([
      {
        detail: {
          restore: true,
          source: "checkout_return",
          transaction_id: "txn-same",
        },
        name: "billing-open-request",
      },
    ]);
    expect(result.events.find((event) => event.name === "billing-transaction-complete")).toEqual({
      detail: {
        activity: {
          event_type: "transaction.completed",
          transaction_id: "txn-complete",
        },
        transaction_id: "",
      },
      name: "billing-transaction-complete",
    });
    expect(result.events.filter((event) => event.name === "billing-transaction-timeout")).toEqual([
      {
        detail: {
          activity: {
            status: "pending",
            transaction_id: "txn-timeout-activity",
          },
          transaction_id: "",
        },
        name: "billing-transaction-timeout",
      },
      {
        detail: {
          activity: null,
          transaction_id: "",
        },
        name: "billing-transaction-timeout",
      },
    ]);
  });

  test("covers checkout success handling without losing billing coverage", async ({ page }) => {
    await page.route("**/api/billing/checkout", (route) =>
      route.fulfill(jsonResponse(200, { checkout_url: "#checkout-success" }))
    );

    await page.goto("/blank.html");
    await loadScript(page, "billing.js");

    const result = await page.evaluate(async () => {
      return window.CrosswordBilling.requestCheckout("starter").then(function (data) {
        return {
          checkoutURL: data.checkout_url,
          locationHash: window.location.hash,
        };
      });
    });

    expect(result).toEqual({
      checkoutURL: "#checkout-success",
      locationHash: "#checkout-success",
    });
  });

  test("covers portal success handling without losing billing coverage", async ({ page }) => {
    await page.route("**/api/billing/portal", (route) =>
      route.fulfill(jsonResponse(200, { url: "#portal-success" }))
    );

    await page.goto("/blank.html");
    await page.evaluate(() => {
      window.__LLM_CROSSWORD_TEST__ = {};
    });
    await loadScript(page, "billing.js");

    const result = await page.evaluate(async () => {
      return window.CrosswordBilling.requestPortalSession().then(function (data) {
        return {
          portalURL: data.url,
          locationHash: window.location.hash,
        };
      });
    });

    expect(result).toEqual({
      portalURL: "#portal-success",
      locationHash: "#portal-success",
    });
  });

  test("covers billing redirect fallbacks and default hook paths", async ({ page }) => {
    await page.goto("/blank.html");
    await loadScript(page, "billing.js");

    const result = await page.evaluate(async () => {
      var billing = window.__LLM_CROSSWORD_TEST__.billing;
      var outcomes = {};

      billing.updateBillingStatus("Keep this status", "info", true);
      billing.setState({
        loggedIn: true,
      });

      window.fetch = function () {
        return Promise.reject({});
      };
      try {
        await billing.loadSummary({
          suppressErrors: true,
        });
      } catch (error) {}

      outcomes.suppressedStatus = window.CrosswordBilling.getState().lastStatus;
      outcomes.completedNullActivity = billing.isCompletedTransactionActivity(null);

      try {
        await billing.requestCheckout(null);
      } catch (error) {
        outcomes.nullPackError = error.message;
      }

      try {
        await billing.requestCheckout("starter");
      } catch (error) {
        outcomes.checkoutFallbackStatus = window.CrosswordBilling.getState().lastStatus;
      }

      window.fetch = function () {
        return Promise.resolve({
          json: function () {
            return Promise.resolve({ checkout_url: "#checkout-direct-success" });
          },
          ok: true,
          status: 200,
        });
      };
      outcomes.checkoutSuccess = await billing.requestCheckout("starter");
      outcomes.checkoutHash = window.location.hash;

      window.fetch = function () {
        return Promise.reject({});
      };
      try {
        await billing.requestPortalSession();
      } catch (error) {
        outcomes.portalFallbackStatus = window.CrosswordBilling.getState().lastStatus;
      }

      window.fetch = function () {
        return Promise.resolve({
          json: function () {
            return Promise.resolve({ url: "#portal-direct-success" });
          },
          ok: true,
          status: 200,
        });
      };
      outcomes.portalSuccess = await billing.requestPortalSession();
      outcomes.portalHash = window.location.hash;

      outcomes.openWithoutOptions = await billing.openAccountBilling();
      outcomes.statusAfterOpenWithoutOptions = window.CrosswordBilling.getState().lastStatus;

      outcomes.nullStartPolling = billing.startTransactionPolling(null);
      billing.setState();
      outcomes.testHookExists = Boolean(window.__LLM_CROSSWORD_TEST__ && billing);
      return outcomes;
    });

    expect(result.suppressedStatus).toEqual({
      isBusy: true,
      message: "Keep this status",
      tone: "info",
    });
    expect(result.completedNullActivity).toBe(false);
    expect(result.nullPackError).toBe("Choose a credit pack first.");
    expect(result.checkoutFallbackStatus).toEqual({
      isBusy: false,
      message: "We couldn't start checkout.",
      tone: "error",
    });
    expect(result.checkoutSuccess).toEqual({
      checkout_url: "#checkout-direct-success",
    });
    expect(result.checkoutHash).toBe("#checkout-direct-success");
    expect(result.portalFallbackStatus).toEqual({
      isBusy: false,
      message: "We couldn't open billing right now.",
      tone: "error",
    });
    expect(result.portalSuccess).toEqual({
      url: "#portal-direct-success",
    });
    expect(result.portalHash).toBe("#portal-direct-success");
    expect(result.openWithoutOptions).toEqual({
      activity: [],
      balance: null,
      enabled: false,
      packs: [],
      portal_available: false,
      provider_code: "",
    });
    expect(result.statusAfterOpenWithoutOptions).toEqual({
      isBusy: true,
      message: "Opening billing portal...",
      tone: "",
    });
    expect(result.nullStartPolling).toBeUndefined();
    expect(result.testHookExists).toBe(true);
  });

  test("covers app billing hooks and summary fallbacks", async ({ page }) => {
    await setupLoggedOutRoutes(page);
    await mountAppShell(page);
    await loadScript(page, "app.js");

    const result = await page.evaluate(async () => {
      var app = window.__LLM_CROSSWORD_TEST__.app;

      window.__billingOpenCalls = [];
      document.getElementById("shareBtn").dispatchEvent(new MouseEvent("click", { bubbles: true }));
      document.getElementById("headerCreditBadge").dispatchEvent(new MouseEvent("click", { bubbles: true }));
      app.setLoggedIn(true);
      window.CrosswordBilling = {
        openAccountBilling: function (options) {
          window.__billingOpenCalls.push(options);
        },
      };
      app.openBillingDrawer();
      document.getElementById("headerCreditBadge").dispatchEvent(new MouseEvent("click", { bubbles: true }));

      delete window.CrosswordBilling;
      document.getElementById("headerCreditBadge").dispatchEvent(new MouseEvent("click", { bubbles: true }));

      app.showGenerateForm();
      document.getElementById("generateStatus").textContent = "Not enough credits right now";
      app.updateBalance({ coins: 5 });
      window.dispatchEvent(new CustomEvent("llm-crossword:billing-summary"));
      var generateStatus = document.getElementById("generateStatus").textContent;

      window.CrosswordBilling = {
        openAccountBilling: function (options) {
          window.__billingOpenCalls.push(options);
        },
        setLoggedIn: function () {
          return Promise.reject(new Error("sync failed"));
        },
      };
      app.setLoggedIn(false);
      document.dispatchEvent(new CustomEvent("mpr-ui:auth:authenticated"));
      await Promise.resolve();
      await Promise.resolve();

      return {
        billingOpenCalls: window.__billingOpenCalls.slice(),
        generateStatus: generateStatus,
        loggedIn: app.getState().loggedIn,
      };
    });

    expect(result.billingOpenCalls).toEqual([
      {
        force: true,
        message: "",
        source: "app",
      },
      {
        force: true,
        message: "",
        source: "header_credit_badge",
      },
    ]);
    expect(result.generateStatus).toBe("Credits updated. You can generate a new puzzle.");
    expect(result.loggedIn).toBe(true);
  });
});
