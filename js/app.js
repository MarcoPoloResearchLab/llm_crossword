/* app.js — auth-aware orchestration for LLM crossword generation */
(function () {
  "use strict";

  var authCheckPendingAttribute = "data-auth-check";
  var authPendingRetryDelayMs = 1000;
  var authStateFetch = window.authFetch || null;
  var nativeFetch = window.fetch.bind(window);
  var _fetch = window.authFetch || nativeFetch;
  var fetchTauth = window.fetchTauth || nativeFetch;
  var rootElement = document.documentElement;
  var persistedValues = Object.freeze({
    authPending: Object.freeze({
      storageKey: "llm-crossword-auth-pending",
      attribute: "data-auth-pending",
      fromAttributeValue: function (value) {
        return value === "true" ? "1" : null;
      },
      toAttributeValue: function () {
        return "true";
      },
    }),
    postLoginView: Object.freeze({
      storageKey: "llm-crossword-post-login-view",
      attribute: "data-post-login-view",
      fromAttributeValue: function (value) {
        return value;
      },
      toAttributeValue: function (value) {
        return value;
      },
    }),
  });
  var generationCostCredits = 4;
  var generateButtonLabel = "Generate (" + generationCostCredits + " credits)";
  var insufficientCreditsCardMessage = "Not enough credits. You need " + generationCostCredits + " credits to generate a puzzle.";
  var insufficientCreditsGenerateMessage = "Not enough credits. You need " + generationCostCredits + " credits per puzzle.";

  function requireElement(id) {
    var element = document.getElementById(id);
    if (!element) {
      throw new Error("Missing required app element #" + id);
    }
    return element;
  }

  function requireChild(parent, selector, label) {
    var element = parent.querySelector(selector);
    if (!element) {
      throw new Error("Missing required app element " + label);
    }
    return element;
  }

  var elements = {
    completionBreakdown: requireElement("completionBreakdown"),
    completionCloseButton: requireElement("completionCloseButton"),
    completionModal: requireElement("completionModal"),
    completionPrimaryAction: requireElement("completionPrimaryAction"),
    completionReason: requireElement("completionReason"),
    completionSecondaryAction: requireElement("completionSecondaryAction"),
    completionSummary: requireElement("completionSummary"),
    completionTitle: requireElement("completionTitle"),
    creditBadge: requireElement("headerCreditBadge"),
    descriptionContent: document.getElementById("descriptionContent"),
    descriptionPanel: document.getElementById("descriptionPanel"),
    generateBtn: requireElement("generateBtn"),
    generateBuyCreditsButton: document.getElementById("generateBuyCreditsButton"),
    generatePanel: requireElement("generatePanel"),
    generateStatus: requireElement("generateStatus"),
    headerPuzzleTabs: document.getElementById("headerPuzzleTabs"),
    landingPage: requireElement("landingPage"),
    landingSignIn: requireElement("landingSignIn"),
    landingTryBtn: requireElement("landingTryPrebuilt"),
    newCrosswordCard: requireElement("newCrosswordCard"),
    puzzleControls: null,
    puzzlePane: null,
    puzzleView: requireElement("puzzleView"),
    shareBtn: requireElement("shareBtn"),
    subtitle: requireElement("subtitle"),
    title: requireElement("title"),
    topicInput: requireElement("topicInput"),
    wordCountSelect: requireElement("wordCount"),
  };

  elements.puzzlePane = requireChild(elements.puzzleView, ".pane", "#puzzleView .pane");
  elements.puzzleControls = requireChild(elements.puzzleView, ".controls", "#puzzleView .controls");

  function readPersistedValue(config) {
    var attributeValue;

    try {
      attributeValue = window.sessionStorage.getItem(config.storageKey);
      if (attributeValue !== null) return attributeValue;
    } catch {}

    attributeValue = rootElement.getAttribute(config.attribute);
    if (attributeValue === null) return null;
    return config.fromAttributeValue(attributeValue);
  }

  function writePersistedValue(config, value) {
    var attributeValue;

    try {
      if (value === null) {
        window.sessionStorage.removeItem(config.storageKey);
      } else {
        window.sessionStorage.setItem(config.storageKey, value);
      }
    } catch {}

    attributeValue = value === null ? null : config.toAttributeValue(value);
    if (attributeValue === null) {
      rootElement.removeAttribute(config.attribute);
      return;
    }
    rootElement.setAttribute(config.attribute, attributeValue);
  }

  function isAuthPending() {
    return readPersistedValue(persistedValues.authPending) === "1";
  }

  function setAuthPending() {
    writePersistedValue(persistedValues.authPending, "1");
  }

  function clearAuthPending() {
    writePersistedValue(persistedValues.authPending, null);
  }

  function getPostLoginView() {
    return readPersistedValue(persistedValues.postLoginView);
  }

  function setPostLoginView(viewName) {
    writePersistedValue(persistedValues.postLoginView, viewName);
  }

  function clearPostLoginView() {
    writePersistedValue(persistedValues.postLoginView, null);
  }

  var state = {
    authCheckPending: !isAuthPending(),
    authStateVersion: 0,
    currentCoins: null,
    currentShareToken: null,
    currentView: isAuthPending() ? "puzzle" : "landing",
    loggedIn: false,
    pendingCompletionKey: null,
    pendingAuthRestoreTimer: null,
    pendingSessionVerification: null,
  };

  function applyAuthCheckState() {
    if (state.authCheckPending) {
      rootElement.setAttribute(authCheckPendingAttribute, "pending");
      return;
    }
    rootElement.removeAttribute(authCheckPendingAttribute);
  }

  function setAuthCheckPending(isPending) {
    state.authCheckPending = isPending;
    applyAuthCheckState();
  }

  function clearPendingAuthRestoreTimer() {
    if (!state.pendingAuthRestoreTimer) return;
    window.clearTimeout(state.pendingAuthRestoreTimer);
    state.pendingAuthRestoreTimer = null;
  }

  function applyView() {
    var showLandingView = state.currentView === "landing";
    elements.landingPage.style.display = showLandingView ? "" : "none";
    elements.puzzleView.style.display = showLandingView ? "none" : "";
    syncHeaderPuzzleTabsVisibility();
  }

  function syncHeaderPuzzleTabsVisibility() {
    if (!elements.headerPuzzleTabs) return;
    var shouldShowTabs = state.currentView === "puzzle" && elements.generatePanel.style.display === "none";
    elements.headerPuzzleTabs.hidden = !shouldShowTabs;
  }

  function setPuzzleContentVisible(isVisible) {
    elements.puzzlePane.style.display = isVisible ? "" : "none";
    elements.puzzleControls.style.display = isVisible ? "" : "none";
  }

  function showLanding() {
    state.currentView = "landing";
    setAuthCheckPending(false);
    applyView();
  }

  function showPuzzle() {
    state.currentView = "puzzle";
    setAuthCheckPending(false);
    applyView();
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        if (window.CrosswordApp && window.CrosswordApp.recalculate) {
          window.CrosswordApp.recalculate();
        }
      });
    });
  }

  function showGenerateForm() {
    var rewardStrip = document.getElementById("rewardStrip");
    var shareHint = document.getElementById("shareHint");

    elements.generatePanel.style.display = "";
    syncHeaderPuzzleTabsVisibility();
    setPuzzleContentVisible(false);
    elements.title.textContent = "Generate a New Crossword";
    elements.subtitle.textContent = "Enter a topic and choose the number of words.";
    if (rewardStrip) {
      rewardStrip.hidden = true;
    }
    if (shareHint) {
      shareHint.hidden = true;
      shareHint.textContent = "";
    }
    if (elements.descriptionPanel) {
      elements.descriptionPanel.hidden = true;
    }
    if (elements.descriptionContent) {
      elements.descriptionContent.hidden = true;
      elements.descriptionContent.textContent = "";
    }
    if (window.CrosswordApp && window.CrosswordApp.setActiveCard) {
      window.CrosswordApp.setActiveCard(elements.newCrosswordCard);
    }
    elements.topicInput.focus();
  }

  function hideGenerateForm() {
    elements.generatePanel.style.display = "none";
    syncHeaderPuzzleTabsVisibility();
    setPuzzleContentVisible(true);
  }

  function setGenerateBuyCreditsVisible(isVisible) {
    if (!elements.generateBuyCreditsButton) return;
    elements.generateBuyCreditsButton.hidden = !isVisible;
  }

  function clearGenerateStatus() {
    elements.generateStatus.textContent = "";
    elements.generateStatus.classList.remove("loading");
    setGenerateBuyCreditsVisible(false);
  }

  function showInsufficientCreditsMessage(message) {
    elements.generateStatus.textContent = message;
    elements.generateStatus.classList.remove("loading");
    setGenerateBuyCreditsVisible(state.loggedIn);
  }

  function openBillingDrawer(source, message) {
    if (!window.CrosswordBilling || typeof window.CrosswordBilling.openAccountBilling !== "function") {
      return;
    }
    window.CrosswordBilling.openAccountBilling({
      force: true,
      message: message || "",
      source: source || "app",
    });
  }

  function restorePendingAuthView() {
    showPuzzle();
    if (getPostLoginView() === "generator") {
      showGenerateForm();
      return;
    }
    hideGenerateForm();
  }

  function updateShareButton() {
    elements.shareBtn.style.display = "";
    elements.shareBtn.disabled = !state.currentShareToken;
  }

  function setShareToken(value) {
    state.currentShareToken = value || null;
    updateShareButton();
  }

  function syncShareTokenFromActivePuzzle() {
    var activePuzzle = window.CrosswordApp && window.CrosswordApp.getActivePuzzle
      ? window.CrosswordApp.getActivePuzzle()
      : null;
    setShareToken(activePuzzle && activePuzzle.shareToken ? activePuzzle.shareToken : null);
  }

  function pulseCreditBadge() {
    elements.creditBadge.classList.remove("header-credit-badge--pulse");
    void elements.creditBadge.offsetWidth;
    elements.creditBadge.classList.add("header-credit-badge--pulse");
  }

  function setViewerSessionState() {
    if (!window.CrosswordApp || !window.CrosswordApp.setViewerSession) return;
    window.CrosswordApp.setViewerSession({
      loggedIn: state.loggedIn,
    });
  }

  function renderCompletionRow(label, value, isTotal) {
    var row = document.createElement("div");
    var labelElement = document.createElement("span");
    var valueElement = document.createElement("strong");

    row.className = "completion-modal__row" + (isTotal ? " completion-modal__row--total" : "");
    labelElement.textContent = label;
    valueElement.textContent = value;
    row.appendChild(labelElement);
    row.appendChild(valueElement);
    return row;
  }

  function hideCompletionModal() {
    if (elements.completionModal.open) {
      elements.completionModal.close();
    }
  }

  function showCompletionModal(details) {
    var breakdown = details && Array.isArray(details.breakdown) ? details.breakdown : [];
    var index;

    elements.completionTitle.textContent = details && details.title ? details.title : "Puzzle complete";
    elements.completionSummary.textContent = details && details.summary ? details.summary : "";
    elements.completionReason.textContent = details && details.reason ? details.reason : "";
    elements.completionBreakdown.innerHTML = "";

    for (index = 0; index < breakdown.length; index++) {
      elements.completionBreakdown.appendChild(renderCompletionRow(
        breakdown[index].label,
        breakdown[index].value,
        !!breakdown[index].isTotal
      ));
    }

    elements.completionPrimaryAction.style.display = details && details.hidePrimary ? "none" : "";
    if (details && details.primaryLabel) {
      elements.completionPrimaryAction.textContent = details.primaryLabel;
    }

    if (!elements.completionModal.open) {
      elements.completionModal.showModal();
    }
  }

  function updateAuthUI() {
    elements.generateBtn.disabled = !state.loggedIn;

    if (!state.loggedIn) {
      elements.generateBtn.textContent = "Generate";
      elements.creditBadge.textContent = "";
      elements.creditBadge.style.display = "none";
      elements.creditBadge.disabled = true;
      clearGenerateStatus();
      elements.landingSignIn.textContent = "Sign in to generate";
      hideGenerateForm();
      return;
    }

    elements.generateBtn.textContent = generateButtonLabel;
    elements.creditBadge.style.display = "";
    elements.creditBadge.disabled = false;
    elements.creditBadge.classList.remove("logged-out");
    clearGenerateStatus();
    elements.landingSignIn.textContent = "Go to generator";
  }

  function updateBalance(balance) {
    var coins;
    var previousCoins = state.currentCoins;

    if (!balance) return;

    coins = balance.coins != null ? balance.coins : Math.floor(balance.available_cents / 100);
    state.currentCoins = coins;
    elements.creditBadge.textContent = coins + " credits";
    if (previousCoins !== null && coins > previousCoins) {
      pulseCreditBadge();
    }
    if (state.loggedIn && coins >= generationCostCredits) {
      setGenerateBuyCreditsVisible(false);
      if (elements.generatePanel.style.display !== "none" && elements.generateStatus.textContent.indexOf("Not enough credits") === 0) {
        elements.generateStatus.textContent = "Credits updated. You can generate a new puzzle.";
      }
      if (!elements.generateStatus.classList.contains("loading")) {
        elements.generateBtn.disabled = false;
      }
    }
  }

  function describeCompletionReason(reason) {
    if (reason === "revealed") return "Reveal was used, so this puzzle no longer qualifies for rewards.";
    if (reason === "anonymous_solver") return "Sign in if you want shared solves to support the creator.";
    if (reason === "creator_puzzle_cap_reached") return "This puzzle has already reached its creator reward cap.";
    if (reason === "creator_daily_cap_reached") return "The creator has already reached today’s shared reward cap.";
    if (reason === "already_recorded") return "This puzzle has already recorded its solve outcome.";
    if (!reason) return "";
    return "This solve did not qualify for extra credits.";
  }

  function getCompletionEndpoint(puzzle) {
    if (!puzzle) return null;
    if (puzzle.source === "shared" && puzzle.shareToken) {
      return "/api/shared/" + encodeURIComponent(puzzle.shareToken) + "/complete";
    }
    if (puzzle.id) {
      return "/api/puzzles/" + encodeURIComponent(puzzle.id) + "/complete";
    }
    return null;
  }

  function updatePuzzleRewardSummary(puzzle, result) {
    if (!puzzle || !puzzle.id || !result || !result.reward_summary) return;
    if (window.CrosswordApp && window.CrosswordApp.updatePuzzleRewardData) {
      window.CrosswordApp.updatePuzzleRewardData(puzzle.id, result.reward_summary);
    }
  }

  function showSolveCompletionModal(result) {
    var reward = result && result.reward ? result.reward : {};
    var total = Number(reward.total || 0);
    var breakdown = [];
    var reasonText = describeCompletionReason(result && result.reason);

    if (reward.base) breakdown.push({ label: "Base reward", value: "+" + reward.base });
    if (reward.no_hint_bonus) breakdown.push({ label: "No-hint bonus", value: "+" + reward.no_hint_bonus });
    if (reward.daily_bonus) breakdown.push({ label: "Daily owner bonus", value: "+" + reward.daily_bonus });
    breakdown.push({ label: "Total", value: "+" + total + " credits", isTotal: true });

    showCompletionModal({
      title: total > 0 ? "Reward claimed" : "Puzzle complete",
      summary: total > 0
        ? "You earned " + total + " credits."
        : "This puzzle completed without a reward payout.",
      reason: reasonText,
      breakdown: breakdown,
      primaryLabel: "Generate another",
    });
  }

  function showSharedCompletionModal(result) {
    var creatorCoins = Number(result && result.creator_coins || 0);
    var breakdown = [];

    if (creatorCoins > 0) {
      breakdown.push({ label: "Creator support", value: "+" + creatorCoins + " credit", isTotal: true });
      showCompletionModal({
        title: "Creator supported",
        summary: "Your solve counted and rewarded the creator.",
        reason: "",
        breakdown: breakdown,
        primaryLabel: "Generate another",
      });
      return;
    }

    showCompletionModal({
      title: "Shared puzzle complete",
      summary: "This solve did not generate a creator payout.",
      reason: describeCompletionReason(result && result.reason),
      breakdown: [],
      primaryLabel: "Generate another",
    });
  }

  function submitPuzzleCompletion(detail) {
    var activePuzzle = window.CrosswordApp && window.CrosswordApp.getActivePuzzle
      ? window.CrosswordApp.getActivePuzzle()
      : null;
    var endpoint = getCompletionEndpoint(activePuzzle);
    var requestKey;

    if (!activePuzzle || !endpoint) return;
    if (activePuzzle.source !== "owned" && activePuzzle.source !== "shared") return;
    if (activePuzzle.source === "shared" && !state.loggedIn) return;

    requestKey = endpoint + ":" + (detail && detail.usedReveal ? "reveal" : "complete");
    if (state.pendingCompletionKey === requestKey) return;
    state.pendingCompletionKey = requestKey;

    _fetch(endpoint, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        used_hint: !!(detail && detail.usedHint),
        used_reveal: !!(detail && detail.usedReveal),
      }),
    })
      .then(function (resp) {
        return resp.json().then(function (data) {
          return { ok: resp.ok, data: data };
        });
      })
      .then(function (result) {
        if (!result.ok) {
          throw new Error(result.data && result.data.message ? result.data.message : "Completion request failed");
        }

        if (result.data && result.data.balance) {
          updateBalance(result.data.balance);
        }
        updatePuzzleRewardSummary(activePuzzle, result.data);

        if (detail && detail.usedReveal) return;
        if (result.data && result.data.mode === "owner") {
          showSolveCompletionModal(result.data);
          return;
        }
        showSharedCompletionModal(result.data);
      })
      .catch(function (err) {
        console.warn("completion request failed:", err);
      })
      .finally(function () {
        state.pendingCompletionKey = null;
      });
  }

  function verifySessionStillValid() {
    if (state.pendingSessionVerification) return state.pendingSessionVerification;

    state.pendingSessionVerification = _fetch("/me", {
      cache: "no-store",
      credentials: "include",
    })
      .then(function (resp) {
        if (resp.ok) return true;
        if (resp.status === 401 || resp.status === 403) return false;
        return true;
      })
      .catch(function () {
        return true;
      })
      .finally(function () {
        state.pendingSessionVerification = null;
      });

    return state.pendingSessionVerification;
  }

  function onLogin() {
    var postLoginView = getPostLoginView();

    clearPendingAuthRestoreTimer();
    state.loggedIn = true;
    state.authStateVersion += 1;
    clearAuthPending();
    clearPostLoginView();
    setAuthCheckPending(false);
    updateAuthUI();
    setViewerSessionState();
    showPuzzle();
    if (window.CrosswordBilling && typeof window.CrosswordBilling.setLoggedIn === "function") {
      window.CrosswordBilling.setLoggedIn(true).catch(function () {});
    }

    if (postLoginView === "generator") {
      showGenerateForm();
    }

    _fetch("/api/bootstrap", { method: "POST", credentials: "include" })
      .then(function (resp) {
        if (!resp.ok) return null;
        return resp.json();
      })
      .then(function (data) {
        if (data && data.balance) updateBalance(data.balance);
        if (window.CrosswordApp && window.CrosswordApp.loadOwnedPuzzles) {
          return window.CrosswordApp.loadOwnedPuzzles();
        }
        return null;
      })
      .catch(function (err) {
        console.warn("bootstrap failed:", err);
      });
  }

  function onLogout() {
    clearPendingAuthRestoreTimer();
    state.loggedIn = false;
    state.authStateVersion += 1;
    clearAuthPending();
    clearPostLoginView();
    setAuthCheckPending(false);
    updateAuthUI();
    setViewerSessionState();
    if (window.CrosswordBilling && typeof window.CrosswordBilling.setLoggedIn === "function") {
      window.CrosswordBilling.setLoggedIn(false);
    }
    if (window.CrosswordApp && window.CrosswordApp.clearOwnedPuzzles) {
      window.CrosswordApp.clearOwnedPuzzles();
    }
    hideCompletionModal();
    showLanding();
  }

  function handleLoggedOutRestore() {
    var shouldRestoreLanding = state.currentView === "landing";

    if (state.loggedIn) return;

    clearPendingAuthRestoreTimer();
    clearAuthPending();
    clearPostLoginView();
    setAuthCheckPending(false);
    updateAuthUI();
    setViewerSessionState();
    if (window.CrosswordApp && window.CrosswordApp.clearOwnedPuzzles) {
      window.CrosswordApp.clearOwnedPuzzles();
    }

    if (shouldRestoreLanding) {
      showLanding();
      return;
    }

    applyView();
  }

  function finalizePendingAuthRestoreFailure() {
    if (state.loggedIn) return;

    clearPendingAuthRestoreTimer();
    clearAuthPending();
    clearPostLoginView();
    setAuthCheckPending(false);
    updateAuthUI();
    setViewerSessionState();
    if (window.CrosswordApp && window.CrosswordApp.clearOwnedPuzzles) {
      window.CrosswordApp.clearOwnedPuzzles();
    }
    showLanding();
  }

  function schedulePendingAuthRestoreRetry() {
    if (state.pendingAuthRestoreTimer || state.loggedIn || !isAuthPending()) return;

    restorePendingAuthView();
    state.pendingAuthRestoreTimer = window.setTimeout(function () {
      state.pendingAuthRestoreTimer = null;

      (authStateFetch || fetchTauth)("/me", { cache: "no-store", credentials: "include" })
        .then(function (resp) {
          if (resp.ok) {
            if (!state.loggedIn) onLogin();
            return;
          }

          if (resp.status === 401 || resp.status === 403) {
            finalizePendingAuthRestoreFailure();
            return;
          }

          restorePendingAuthView();
        })
        .catch(function () {
          finalizePendingAuthRestoreFailure();
        });
    }, authPendingRetryDelayMs);
  }

  elements.newCrosswordCard.addEventListener("click", function () {
    if (state.currentCoins !== null && state.currentCoins < generationCostCredits) {
      showGenerateForm();
      elements.generateBtn.disabled = true;
      showInsufficientCreditsMessage(insufficientCreditsCardMessage);
      return;
    }

    showGenerateForm();
    elements.generateBtn.disabled = !state.loggedIn;
    clearGenerateStatus();
  });

  elements.landingTryBtn.addEventListener("click", function () {
    showPuzzle();
  });

  elements.landingSignIn.addEventListener("click", function () {
    var headerSignIn;

    if (state.loggedIn) {
      showPuzzle();
      return;
    }

    headerSignIn = document.querySelector("[data-mpr-header='google-signin'] div[role='button']");
    if (!headerSignIn) {
      showPuzzle();
      return;
    }

    setPostLoginView("generator");
    setAuthPending();
    setAuthCheckPending(false);
    showPuzzle();
    showGenerateForm();
    headerSignIn.click();
  });

  document.addEventListener("mpr-ui:auth:authenticated", function () {
    if (!state.loggedIn) onLogin();
  });

  document.addEventListener("mpr-ui:auth:unauthenticated", function () {
    var eventAuthStateVersion;

    if (!state.loggedIn) return;

    eventAuthStateVersion = state.authStateVersion;
    verifySessionStillValid().then(function (sessionStillValid) {
      if (!state.loggedIn || state.authStateVersion !== eventAuthStateVersion) return;
      if (!sessionStillValid) onLogout();
    });
  });

  applyAuthCheckState();

  (authStateFetch || fetchTauth)("/me", { cache: "no-store", credentials: "include" })
    .then(function (resp) {
      if (resp.ok) {
        if (!state.loggedIn) onLogin();
        return;
      }

      if (resp.status === 401 || resp.status === 403) {
        if (isAuthPending() && !state.loggedIn) {
          schedulePendingAuthRestoreRetry();
          return;
        }
        handleLoggedOutRestore();
        return;
      }

      setAuthCheckPending(false);
      if (!state.loggedIn && !isAuthPending()) {
        showLanding();
      }
    })
    .catch(function () {
      if (isAuthPending() && !state.loggedIn) {
        schedulePendingAuthRestoreRetry();
        return;
      }
      setAuthCheckPending(false);
      if (!state.loggedIn) {
        showLanding();
      }
    });

  elements.generateBtn.addEventListener("click", function () {
    var topic = elements.topicInput.value.trim();
    var selectedWordCount = Number(elements.wordCountSelect.value);

    if (!topic) {
      elements.generateStatus.textContent = "Please enter a topic.";
      setGenerateBuyCreditsVisible(false);
      return;
    }
    if (!state.loggedIn) {
      elements.generateStatus.textContent = "Please log in first.";
      setGenerateBuyCreditsVisible(false);
      return;
    }

    elements.generateBtn.disabled = true;
    elements.generateStatus.textContent = "Generating crossword...";
    elements.generateStatus.classList.add("loading");

    _fetch("/api/generate", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic: topic,
        word_count: selectedWordCount,
      }),
    })
      .then(function (resp) {
        return resp.json().then(function (data) {
          return { ok: resp.ok, data: data };
        });
      })
      .then(function (result) {
        if (!result.ok) {
          if (result.data.error === "insufficient_credits") {
            showInsufficientCreditsMessage(insufficientCreditsGenerateMessage);
          } else if (result.data.error === "llm_timeout") {
            elements.generateStatus.textContent = "The AI model timed out. Your credits have been refunded — please try again.";
            setGenerateBuyCreditsVisible(false);
          } else if (result.data.error === "llm_error") {
            elements.generateStatus.textContent = "Generation failed. Your credits have been refunded — please try again.";
            setGenerateBuyCreditsVisible(false);
          } else {
            elements.generateStatus.textContent = result.data.message || "Generation failed. Please try again.";
            setGenerateBuyCreditsVisible(false);
          }

          if (result.data.error === "llm_timeout" || result.data.error === "llm_error") {
            _fetch("/api/balance", { credentials: "include" })
              .then(function (resp) {
                return resp.ok ? resp.json() : null;
              })
              .then(function (data) {
                if (data && data.balance) updateBalance(data.balance);
              })
              .catch(function () {});
          }

          return;
        }

        if (result.data.balance) updateBalance(result.data.balance);

        setShareToken(result.data.share_token || null);

        var payload = generateCrossword(result.data.items, {
          title: result.data.title || topic,
          subtitle: result.data.subtitle || "",
          description: result.data.description || "",
        });

        setPuzzleContentVisible(true);
        payload.id = result.data.id ? String(result.data.id) : null;
        payload.shareToken = state.currentShareToken;
        payload.source = result.data.source || "owned";
        payload.rewardSummary = result.data.reward_summary || null;

        if (window.CrosswordApp && window.CrosswordApp.addGeneratedPuzzle) {
          window.CrosswordApp.addGeneratedPuzzle(payload);
        } else if (window.CrosswordApp && window.CrosswordApp.render) {
          window.CrosswordApp.render(payload);
        }

        elements.generatePanel.style.display = "none";
        clearGenerateStatus();
      })
      .catch(function (err) {
        console.error("generate error:", err);
        elements.generateStatus.textContent = "Network error. Please try again.";
        setGenerateBuyCreditsVisible(false);
      })
      .finally(function () {
        elements.generateBtn.disabled = !state.loggedIn;
        elements.generateStatus.classList.remove("loading");
      });
  });

  window.addEventListener("crossword:share-token", function (e) {
    setShareToken(e.detail);
  });

  window.addEventListener("crossword:active-puzzle", function (event) {
    var puzzle = event && event.detail ? event.detail : null;
    setShareToken(puzzle && puzzle.shareToken ? puzzle.shareToken : null);
  });

  window.addEventListener("crossword:completed", function (event) {
    submitPuzzleCompletion(event.detail);
  });

  window.addEventListener("crossword:reveal-used", function (event) {
    submitPuzzleCompletion(event.detail);
  });

  elements.shareBtn.addEventListener("click", function () {
    var url;

    if (!state.currentShareToken) return;

    url = window.location.origin + window.location.pathname + "?puzzle=" + state.currentShareToken;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () {
        elements.shareBtn.textContent = "Copied!";
        elements.shareBtn.classList.add("copied-flash");
        elements.shareBtn.addEventListener("animationend", function onEnd() {
          elements.shareBtn.removeEventListener("animationend", onEnd);
          elements.shareBtn.classList.remove("copied-flash");
          elements.shareBtn.textContent = "Share";
        });
      });
      return;
    }

    window.prompt("Copy this link to share:", url);
  });

  elements.creditBadge.addEventListener("click", function () {
    if (!state.loggedIn) return;
    openBillingDrawer("header_credit_badge");
  });

  if (elements.generateBuyCreditsButton) {
    elements.generateBuyCreditsButton.addEventListener("click", function () {
      openBillingDrawer("generator_insufficient", "Choose a credit pack to keep generating.");
    });
  }

  elements.topicInput.addEventListener("keydown", function (e) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    elements.generateBtn.click();
  });

  elements.completionCloseButton.addEventListener("click", function () {
    hideCompletionModal();
  });

  elements.completionSecondaryAction.addEventListener("click", function () {
    hideCompletionModal();
  });

  elements.completionPrimaryAction.addEventListener("click", function () {
    hideCompletionModal();
    showPuzzle();
    showGenerateForm();
  });

  elements.completionModal.addEventListener("click", function (event) {
    if (event.target === elements.completionModal) {
      hideCompletionModal();
    }
  });

  window.addEventListener("llm-crossword:billing-summary", function (event) {
    var summary = event && event.detail ? event.detail : null;

    if (summary && summary.balance) {
      updateBalance(summary.balance);
    }
    if (!summary || summary.enabled !== true) {
      setGenerateBuyCreditsVisible(false);
      return;
    }
    if (state.loggedIn && state.currentCoins !== null && state.currentCoins < generationCostCredits) {
      setGenerateBuyCreditsVisible(true);
    }
  });

  updateAuthUI();
  setViewerSessionState();
  syncShareTokenFromActivePuzzle();
  applyView();

  (window.__LLM_CROSSWORD_TEST__ || (window.__LLM_CROSSWORD_TEST__ = {})).app = {
    clearPendingAuthRestoreTimer: clearPendingAuthRestoreTimer,
    clearAuthPending: clearAuthPending,
    clearPostLoginView: clearPostLoginView,
    describeCompletionReason: describeCompletionReason,
    finalizePendingAuthRestoreFailure: finalizePendingAuthRestoreFailure,
    getCompletionEndpoint: getCompletionEndpoint,
    getPostLoginView: getPostLoginView,
    getState: function () {
      return {
        authCheckPending: state.authCheckPending,
        authStateVersion: state.authStateVersion,
        currentCoins: state.currentCoins,
        currentShareToken: state.currentShareToken,
        currentView: state.currentView,
        loggedIn: state.loggedIn,
        pendingCompletionKey: state.pendingCompletionKey,
      };
    },
    isAuthPending: isAuthPending,
    openBillingDrawer: openBillingDrawer,
    requireChild: requireChild,
    requireElement: requireElement,
    schedulePendingAuthRestoreRetry: schedulePendingAuthRestoreRetry,
    setAuthPending: setAuthPending,
    setState: function (nextState) {
      Object.assign(state, nextState || {});
    },
    setLoggedIn: function (value) {
      state.loggedIn = !!value;
      updateAuthUI();
    },
    setPendingAuthRestoreTimer: function (timerId) {
      state.pendingAuthRestoreTimer = timerId;
    },
    setPostLoginView: setPostLoginView,
    setShareToken: setShareToken,
    showCompletionModal: showCompletionModal,
    showSharedCompletionModal: showSharedCompletionModal,
    showSolveCompletionModal: showSolveCompletionModal,
    showGenerateForm: showGenerateForm,
    showPuzzle: showPuzzle,
    submitPuzzleCompletion: submitPuzzleCompletion,
    updateBalance: updateBalance,
  };
})();
