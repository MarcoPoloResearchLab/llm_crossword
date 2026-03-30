/* billing.js — credit-pack checkout coordinator */
(function () {
  "use strict";

  var billingSummaryPath = "/api/billing/summary";
  var billingCheckoutPath = "/api/billing/checkout";
  var billingPortalPath = "/api/billing/portal";
  var completedTransactionEventType = "transaction.completed";
  var returnTransactionQueryKey = "billing_transaction_id";
  var restoreDrawerStorageKey = "llm-crossword-billing-restore-drawer";
  var pollIntervalMs = 2500;
  var pollTimeoutMs = 90000;

  var state = {
    activeTransactionId: "",
    lastStatus: null,
    loggedIn: false,
    pendingSummaryRequest: null,
    pollDeadlineTimestamp: 0,
    pollTimerId: null,
    summary: createEmptySummary(),
  };

  function createEmptySummary() {
    return {
      enabled: false,
      provider_code: "",
      balance: null,
      packs: [],
      activity: [],
      portal_available: false,
    };
  }

  function getFetcher() {
    return window.authFetch || window.fetch.bind(window);
  }

  function dispatchBillingEvent(name, detail) {
    window.dispatchEvent(new CustomEvent("llm-crossword:" + name, {
      detail: detail || {},
    }));
  }

  function updateBillingStatus(message, tone, isBusy) {
    state.lastStatus = {
      isBusy: isBusy === true,
      message: message || "",
      tone: tone || "",
    };
    dispatchBillingEvent("billing-status", state.lastStatus);
  }

  function parseJSONResponse(response) {
    return response.json().catch(function () {
      return {};
    });
  }

  function normalizeSummary(rawSummary) {
    var summary = rawSummary && typeof rawSummary === "object" ? rawSummary : {};

    return {
      enabled: summary.enabled === true,
      provider_code: typeof summary.provider_code === "string" ? summary.provider_code : "",
      balance: summary.balance || null,
      packs: Array.isArray(summary.packs) ? summary.packs : [],
      activity: Array.isArray(summary.activity) ? summary.activity : [],
      portal_available: summary.portal_available === true,
    };
  }

  function applySummary(rawSummary) {
    state.summary = normalizeSummary(rawSummary);
    dispatchBillingEvent("billing-summary", state.summary);
    return state.summary;
  }

  function describeBillingError(result, fallbackMessage) {
    if (result && result.data && typeof result.data.message === "string" && result.data.message.trim() !== "") {
      return result.data.message.trim();
    }
    return fallbackMessage;
  }

  function loadSummary(options) {
    var loadOptions = options || {};
    var fetcher = getFetcher();

    if (!state.loggedIn) {
      return Promise.resolve(applySummary(createEmptySummary()));
    }
    if (state.pendingSummaryRequest && loadOptions.force !== true) {
      return state.pendingSummaryRequest;
    }

    state.pendingSummaryRequest = fetcher(billingSummaryPath, {
      cache: "no-store",
      credentials: "include",
    })
      .then(function (response) {
        return parseJSONResponse(response).then(function (data) {
          return {
            data: data,
            ok: response.ok,
            status: response.status,
          };
        });
      })
      .then(function (result) {
        if (result.ok) {
          return applySummary(result.data);
        }
        if (result.status === 401 || result.status === 403 || result.status === 404 || result.status === 503) {
          return applySummary(createEmptySummary());
        }
        throw new Error(describeBillingError(result, "We couldn't load billing right now."));
      })
      .catch(function (error) {
        if (loadOptions.suppressErrors !== true) {
          updateBillingStatus(error.message || "We couldn't load billing right now.", "error", false);
        }
        throw error;
      })
      .finally(function () {
        state.pendingSummaryRequest = null;
      });

    return state.pendingSummaryRequest;
  }

  function clearPollTimer() {
    if (!state.pollTimerId) return;
    window.clearTimeout(state.pollTimerId);
    state.pollTimerId = null;
  }

  function stopTransactionPolling() {
    clearPollTimer();
    state.activeTransactionId = "";
    state.pollDeadlineTimestamp = 0;
  }

  function getReturnTransactionID() {
    try {
      return new URL(window.location.href).searchParams.get(returnTransactionQueryKey) || "";
    } catch {
      return "";
    }
  }

  function setRestoreDrawerPending(isPending) {
    try {
      if (isPending) {
        window.sessionStorage.setItem(restoreDrawerStorageKey, "1");
        return;
      }
      window.sessionStorage.removeItem(restoreDrawerStorageKey);
    } catch {}
  }

  function clearReturnTransactionID() {
    var currentURL;

    try {
      currentURL = new URL(window.location.href);
    } catch {
      return;
    }

    if (!currentURL.searchParams.has(returnTransactionQueryKey)) {
      return;
    }

    currentURL.searchParams.delete(returnTransactionQueryKey);
    window.history.replaceState({}, "", currentURL.pathname + currentURL.search + currentURL.hash);
  }

  function findTransactionActivity(summary, transactionID) {
    var matchingEntries;

    if (!summary || !Array.isArray(summary.activity) || !transactionID) {
      return null;
    }

    matchingEntries = summary.activity.filter(function (entry) {
      return entry && entry.transaction_id === transactionID;
    });
    if (matchingEntries.length === 0) {
      return null;
    }

    return matchingEntries.find(isCompletedTransactionActivity) || matchingEntries[0];
  }

  function isCompletedTransactionActivity(activity) {
    if (!activity) return false;
    return activity.event_type === completedTransactionEventType || activity.status === "completed";
  }

  function finishTransactionPolling(message, tone) {
    stopTransactionPolling();
    clearReturnTransactionID();
    updateBillingStatus(message, tone, false);
  }

  function scheduleTransactionPoll() {
    clearPollTimer();
    state.pollTimerId = window.setTimeout(function () {
      pollForTransactionResult();
    }, pollIntervalMs);
  }

  function pollForTransactionResult() {
    if (!state.activeTransactionId || !state.loggedIn) {
      stopTransactionPolling();
      return Promise.resolve();
    }

    return loadSummary({ force: true, suppressErrors: true })
      .then(function (summary) {
        var activity = findTransactionActivity(summary, state.activeTransactionId);

        if (activity && isCompletedTransactionActivity(activity)) {
          finishTransactionPolling("Payment confirmed. Your credits are ready to use.", "success");
          dispatchBillingEvent("billing-transaction-complete", {
            activity: activity,
            transaction_id: state.activeTransactionId,
          });
          return;
        }

        if (Date.now() >= state.pollDeadlineTimestamp) {
          if (activity) {
            finishTransactionPolling("Payment is still processing. Refresh billing in a moment if credits do not appear.", "", false);
          } else {
            finishTransactionPolling("Checkout closed before payment completed.", "", false);
          }
          dispatchBillingEvent("billing-transaction-timeout", {
            activity: activity,
            transaction_id: state.activeTransactionId,
          });
          return;
        }

        if (activity) {
          updateBillingStatus("Waiting for payment confirmation...", "", true);
        } else {
          updateBillingStatus("Returning from checkout. Waiting for billing activity...", "", true);
        }
        scheduleTransactionPoll();
      })
      .catch(function () {
        if (Date.now() >= state.pollDeadlineTimestamp) {
          finishTransactionPolling("We couldn't confirm payment automatically. Refresh billing in a moment.", "error");
          return;
        }
        scheduleTransactionPoll();
      });
  }

  function startTransactionPolling(transactionID) {
    var normalizedTransactionID = typeof transactionID === "string" ? transactionID.trim() : "";

    if (!normalizedTransactionID) return;
    if (state.activeTransactionId === normalizedTransactionID) return;

    state.activeTransactionId = normalizedTransactionID;
    state.pollDeadlineTimestamp = Date.now() + pollTimeoutMs;
    setRestoreDrawerPending(true);
    dispatchBillingEvent("billing-open-request", {
      restore: true,
      source: "checkout_return",
      transaction_id: normalizedTransactionID,
    });
    updateBillingStatus("Waiting for payment confirmation...", "", true);
    return pollForTransactionResult();
  }

  function requestCheckout(packID) {
    var normalizedPackID = typeof packID === "string" ? packID.trim() : "";
    var fetcher = getFetcher();

    if (!normalizedPackID) {
      updateBillingStatus("Choose a credit pack first.", "error", false);
      return Promise.reject(new Error("Choose a credit pack first."));
    }

    updateBillingStatus("Redirecting to secure checkout...", "", true);

    return fetcher(billingCheckoutPath, {
      body: JSON.stringify({ pack_id: normalizedPackID }),
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      method: "POST",
    })
      .then(function (response) {
        return parseJSONResponse(response).then(function (data) {
          return {
            data: data,
            ok: response.ok,
            status: response.status,
          };
        });
      })
      .then(function (result) {
        if (!result.ok) {
          throw new Error(describeBillingError(result, "We couldn't start checkout."));
        }
        if (!result.data || typeof result.data.checkout_url !== "string" || result.data.checkout_url.trim() === "") {
          throw new Error("Checkout did not return a URL.");
        }

        window.location.assign(result.data.checkout_url);
        return result.data;
      })
      .catch(function (error) {
        updateBillingStatus(error.message || "We couldn't start checkout.", "error", false);
        throw error;
      });
  }

  function requestPortalSession() {
    var fetcher = getFetcher();

    updateBillingStatus("Opening billing portal...", "", true);

    return fetcher(billingPortalPath, {
      credentials: "include",
      method: "POST",
    })
      .then(function (response) {
        return parseJSONResponse(response).then(function (data) {
          return {
            data: data,
            ok: response.ok,
            status: response.status,
          };
        });
      })
      .then(function (result) {
        if (!result.ok) {
          throw new Error(describeBillingError(result, "We couldn't open billing right now."));
        }
        if (!result.data || typeof result.data.url !== "string" || result.data.url.trim() === "") {
          throw new Error("Billing portal did not return a URL.");
        }

        window.location.assign(result.data.url);
        return result.data;
      })
      .catch(function (error) {
        updateBillingStatus(error.message || "We couldn't open billing right now.", "error", false);
        throw error;
      });
  }

  function openAccountBilling(options) {
    var detail = options || {};

    dispatchBillingEvent("billing-open-request", detail);
    if (detail.message) {
      updateBillingStatus(detail.message, detail.tone || "", detail.isBusy === true);
    }
    return loadSummary({
      force: detail.force === true,
      suppressErrors: detail.suppressErrors === true,
    }).catch(function () {
      return state.summary;
    });
  }

  function setLoggedIn(loggedIn) {
    state.loggedIn = loggedIn === true;

    if (!state.loggedIn) {
      stopTransactionPolling();
      setRestoreDrawerPending(false);
      applySummary(createEmptySummary());
      return Promise.resolve(state.summary);
    }

    return loadSummary({ force: true, suppressErrors: true })
      .catch(function () {
        return state.summary;
      })
      .then(function (summary) {
        var returnTransactionID = getReturnTransactionID();

        if (returnTransactionID) {
          startTransactionPolling(returnTransactionID);
        }

        return summary;
      });
  }

  window.CrosswordBilling = Object.freeze({
    getState: function () {
      return {
        activeTransactionId: state.activeTransactionId,
        lastStatus: state.lastStatus,
        loggedIn: state.loggedIn,
        summary: state.summary,
      };
    },
    loadSummary: loadSummary,
    openAccountBilling: openAccountBilling,
    requestCheckout: requestCheckout,
    requestPortalSession: requestPortalSession,
    setLoggedIn: setLoggedIn,
    startTransactionPolling: startTransactionPolling,
  });

  (window.__LLM_CROSSWORD_TEST__ || (window.__LLM_CROSSWORD_TEST__ = {})).billing = {
    applySummary: applySummary,
    clearReturnTransactionID: clearReturnTransactionID,
    clearPollTimer: clearPollTimer,
    createEmptySummary: createEmptySummary,
    describeBillingError: describeBillingError,
    dispatchBillingEvent: dispatchBillingEvent,
    findTransactionActivity: findTransactionActivity,
    getReturnTransactionID: getReturnTransactionID,
    isCompletedTransactionActivity: isCompletedTransactionActivity,
    loadSummary: loadSummary,
    normalizeSummary: normalizeSummary,
    openAccountBilling: openAccountBilling,
    pollForTransactionResult: pollForTransactionResult,
    requestCheckout: requestCheckout,
    requestPortalSession: requestPortalSession,
    setState: function (nextState) {
      Object.assign(state, nextState || {});
    },
    setLoggedIn: setLoggedIn,
    setRestoreDrawerPending: setRestoreDrawerPending,
    startTransactionPolling: startTransactionPolling,
    updateBillingStatus: updateBillingStatus,
  };
})();
