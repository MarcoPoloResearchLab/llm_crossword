/* app.js — auth-aware orchestration for LLM crossword generation */
(function () {
  "use strict";

  var _fetch = (window.__testOverrides && window.__testOverrides.fetch) || window.fetch.bind(window);

  // --- DOM references ---
  var landingPage       = document.getElementById("landingPage");
  var puzzleView        = document.getElementById("puzzleView");
  var prebuiltPanel     = document.getElementById("prebuiltPanel");
  var generatePanel     = document.getElementById("generatePanel");
  var topicInput        = document.getElementById("topicInput");
  var wordCountSelect   = document.getElementById("wordCount");
  var generateBtn       = document.getElementById("generateBtn");
  var creditBadge       = document.getElementById("headerCreditBadge");
  var generateStatus    = document.getElementById("generateStatus");
  var landingTryBtn     = document.getElementById("landingTryPrebuilt");
  var landingSignIn     = document.getElementById("landingSignIn");
  var backToLanding     = document.getElementById("backToLanding");

  var loggedIn = false;

  // --- View navigation ---
  function showLanding() {
    landingPage.style.display = "";
    puzzleView.style.display = "none";
  }

  function showPuzzle(source) {
    landingPage.style.display = "none";
    puzzleView.style.display = "";
    // Show/hide panels based on source.
    if (prebuiltPanel) {
      prebuiltPanel.style.display = source === "generated" ? "none" : "";
    }
    if (generatePanel) {
      generatePanel.style.display = loggedIn ? "" : "none";
    }
    // Recalculate cell sizes after the browser reflows the now-visible puzzle view.
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        if (window.CrosswordApp && window.CrosswordApp.recalculate) {
          window.CrosswordApp.recalculate();
        }
      });
    });
  }

  // --- Landing page buttons ---
  landingTryBtn.addEventListener("click", function () {
    showPuzzle("prebuilt");
  });

  landingSignIn.addEventListener("click", function () {
    if (loggedIn) {
      // Already logged in — go to puzzle view.
      showPuzzle("prebuilt");
      if (topicInput) topicInput.focus();
      return;
    }
    // Trigger Google Sign-In by clicking the header's sign-in button.
    var headerSignIn = document.querySelector("[data-mpr-header='google-signin'] div[role='button']");
    if (headerSignIn) {
      headerSignIn.click();
    } else {
      // Fallback: go to puzzle view.
      showPuzzle("prebuilt");
    }
  });

  if (backToLanding) {
    backToLanding.addEventListener("click", function () {
      showLanding();
    });
  }

  // --- Auth state ---
  function updateAuthUI() {
    generateBtn.disabled = !loggedIn;
    if (!loggedIn) {
      generateBtn.textContent = "Generate";
      creditBadge.textContent = "";
      creditBadge.style.display = "none";
      generateStatus.textContent = "";
      generateStatus.classList.remove("loading");
      landingSignIn.textContent = "Sign in to generate";
      if (generatePanel) generatePanel.style.display = "none";
    } else {
      generateBtn.textContent = "Generate (5 credits)";
      creditBadge.style.display = "";
      creditBadge.classList.remove("logged-out");
      generateStatus.textContent = "";
      landingSignIn.textContent = "Go to generator";
      if (generatePanel) generatePanel.style.display = "";
    }
  }

  function updateBalance(balance) {
    if (!balance) return;
    var coins = balance.coins != null ? balance.coins : Math.floor(balance.available_cents / 100);
    creditBadge.textContent = coins + " credits";
  }

  function onLogin() {
    loggedIn = true;
    updateAuthUI();
    // Logged-in users skip landing and go to puzzle view.
    showPuzzle("prebuilt");
    // Bootstrap credits.
    _fetch("/api/bootstrap", { method: "POST", credentials: "include" })
      .then(function (resp) {
        if (resp.ok) return resp.json();
        return null;
      })
      .then(function (data) {
        if (data && data.balance) updateBalance(data.balance);
      })
      .catch(function (err) {
        console.warn("bootstrap failed:", err);
      });
  }

  function onLogout() {
    loggedIn = false;
    updateAuthUI();
    showLanding();
  }

  // Listen for mpr-ui auth events (bubble up from mpr-header).
  document.addEventListener("mpr-ui:auth:authenticated", onLogin);
  document.addEventListener("mpr-ui:auth:unauthenticated", onLogout);

  // Check session on load.
  _fetch("/me", { credentials: "include" })
    .then(function (resp) {
      if (resp.ok && !loggedIn) onLogin();
    })
    .catch(function () { /* not logged in */ });

  // --- Generate ---
  generateBtn.addEventListener("click", function () {
    var topic = topicInput.value.trim();
    if (!topic) {
      generateStatus.textContent = "Please enter a topic.";
      return;
    }
    if (!loggedIn) {
      generateStatus.textContent = "Please log in first.";
      return;
    }

    generateBtn.disabled = true;
    generateStatus.textContent = "Generating crossword...";
    generateStatus.classList.add("loading");

    _fetch("/api/generate", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic: topic,
        word_count: Number(wordCountSelect.value),
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
            generateStatus.textContent = "Not enough credits. You need 5 credits per puzzle.";
          } else {
            generateStatus.textContent = result.data.message || "Generation failed. Please try again.";
          }
          return;
        }

        // Update balance.
        if (result.data.balance) updateBalance(result.data.balance);

        // Build the grid from the LLM word list.
        var payload = generateCrossword(result.data.items, {
          title: result.data.title || "Crossword \u2014 " + topic,
          subtitle: result.data.subtitle || "Generated from LLM.",
        });

        // Switch to generated view and render.
        showPuzzle("generated");
        window.CrosswordApp.render(payload);
        generateStatus.textContent = "Puzzle ready! Tip: this puzzle won\u2019t be saved after reload.";
      })
      .catch(function (err) {
        console.error("generate error:", err);
        generateStatus.textContent = "Network error. Please try again.";
      })
      .finally(function () {
        generateBtn.disabled = !loggedIn;
        generateStatus.classList.remove("loading");
      });
  });

  // Allow Enter key in topic input to trigger generation.
  topicInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      generateBtn.click();
    }
  });

  // Initial state: show landing page.
  updateAuthUI();
  showLanding();
})();
