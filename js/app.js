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
    backToLanding: requireElement("backToLanding"),
    creditBadge: requireElement("headerCreditBadge"),
    descriptionContent: document.getElementById("descriptionContent"),
    descriptionPanel: document.getElementById("descriptionPanel"),
    descriptionToggle: document.getElementById("descriptionToggle"),
    generateBtn: requireElement("generateBtn"),
    generatePanel: requireElement("generatePanel"),
    generateStatus: requireElement("generateStatus"),
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
    elements.generatePanel.style.display = "";
    setPuzzleContentVisible(false);
    elements.title.textContent = "Generate a New Crossword";
    elements.subtitle.textContent = "Enter a topic and choose the number of words.";
    if (elements.descriptionPanel) {
      elements.descriptionPanel.hidden = true;
    }
    if (elements.descriptionContent) {
      elements.descriptionContent.hidden = true;
      elements.descriptionContent.textContent = "";
    }
    if (elements.descriptionToggle) {
      elements.descriptionToggle.textContent = "Show details";
      elements.descriptionToggle.setAttribute("aria-expanded", "false");
    }
    if (window.CrosswordApp && window.CrosswordApp.setActiveCard) {
      window.CrosswordApp.setActiveCard(elements.newCrosswordCard);
    }
    elements.topicInput.focus();
  }

  function hideGenerateForm() {
    elements.generatePanel.style.display = "none";
    setPuzzleContentVisible(true);
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
    elements.shareBtn.style.display = state.currentShareToken ? "" : "none";
  }

  function setShareToken(value) {
    state.currentShareToken = value || null;
    updateShareButton();
  }

  function updateAuthUI() {
    elements.generateBtn.disabled = !state.loggedIn;

    if (!state.loggedIn) {
      elements.generateBtn.textContent = "Generate";
      elements.creditBadge.textContent = "";
      elements.creditBadge.style.display = "none";
      elements.generateStatus.textContent = "";
      elements.generateStatus.classList.remove("loading");
      elements.landingSignIn.textContent = "Sign in to generate";
      hideGenerateForm();
      return;
    }

    elements.generateBtn.textContent = "Generate (5 credits)";
    elements.creditBadge.style.display = "";
    elements.creditBadge.classList.remove("logged-out");
    elements.generateStatus.textContent = "";
    elements.landingSignIn.textContent = "Go to generator";
  }

  function updateBalance(balance) {
    var coins;

    if (!balance) return;

    coins = balance.coins != null ? balance.coins : Math.floor(balance.available_cents / 100);
    state.currentCoins = coins;
    elements.creditBadge.textContent = coins + " credits";
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
    showPuzzle();

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
    if (state.currentCoins !== null && state.currentCoins < 5) {
      showGenerateForm();
      elements.generateBtn.disabled = true;
      elements.generateStatus.textContent = "Not enough credits. You need 5 credits to generate a puzzle.";
      return;
    }

    showGenerateForm();
    elements.generateBtn.disabled = !state.loggedIn;
    elements.generateStatus.textContent = "";
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

  elements.backToLanding.addEventListener("click", function () {
    if (state.loggedIn) {
      hideGenerateForm();
      showPuzzle();
      return;
    }
    showLanding();
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
      return;
    }
    if (!state.loggedIn) {
      elements.generateStatus.textContent = "Please log in first.";
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
            elements.generateStatus.textContent = "Not enough credits. You need 5 credits per puzzle.";
          } else if (result.data.error === "llm_timeout") {
            elements.generateStatus.textContent = "The AI model timed out. Your credits have been refunded — please try again.";
          } else if (result.data.error === "llm_error") {
            elements.generateStatus.textContent = "Generation failed. Your credits have been refunded — please try again.";
          } else {
            elements.generateStatus.textContent = result.data.message || "Generation failed. Please try again.";
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
        payload.shareToken = state.currentShareToken;

        if (window.CrosswordApp && window.CrosswordApp.addGeneratedPuzzle) {
          window.CrosswordApp.addGeneratedPuzzle(payload);
        } else if (window.CrosswordApp && window.CrosswordApp.render) {
          window.CrosswordApp.render(payload);
        }

        elements.generatePanel.style.display = "none";
        elements.generateStatus.textContent = "";
      })
      .catch(function (err) {
        console.error("generate error:", err);
        elements.generateStatus.textContent = "Network error. Please try again.";
      })
      .finally(function () {
        elements.generateBtn.disabled = !state.loggedIn;
        elements.generateStatus.classList.remove("loading");
      });
  });

  window.addEventListener("crossword:share-token", function (e) {
    setShareToken(e.detail);
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

  elements.topicInput.addEventListener("keydown", function (e) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    elements.generateBtn.click();
  });

  updateAuthUI();
  updateShareButton();
  applyView();

  (window.__LLM_CROSSWORD_TEST__ || (window.__LLM_CROSSWORD_TEST__ = {})).app = {
    clearPendingAuthRestoreTimer: clearPendingAuthRestoreTimer,
    clearAuthPending: clearAuthPending,
    clearPostLoginView: clearPostLoginView,
    finalizePendingAuthRestoreFailure: finalizePendingAuthRestoreFailure,
    getPostLoginView: getPostLoginView,
    getState: function () {
      return {
        authCheckPending: state.authCheckPending,
        currentCoins: state.currentCoins,
        currentShareToken: state.currentShareToken,
        currentView: state.currentView,
        loggedIn: state.loggedIn,
      };
    },
    isAuthPending: isAuthPending,
    requireChild: requireChild,
    requireElement: requireElement,
    schedulePendingAuthRestoreRetry: schedulePendingAuthRestoreRetry,
    setAuthPending: setAuthPending,
    setLoggedIn: function (value) {
      state.loggedIn = !!value;
      updateAuthUI();
    },
    setPendingAuthRestoreTimer: function (timerId) {
      state.pendingAuthRestoreTimer = timerId;
    },
    setPostLoginView: setPostLoginView,
    setShareToken: setShareToken,
    showGenerateForm: showGenerateForm,
    showPuzzle: showPuzzle,
    updateBalance: updateBalance,
  };
})();
