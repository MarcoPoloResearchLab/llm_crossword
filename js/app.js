/* app.js — auth-aware orchestration for LLM crossword generation */
(function () {
  "use strict";

  const modePrebuiltBtn = document.getElementById("modePrebuilt");
  const modeGenerateBtn = document.getElementById("modeGenerate");
  const prebuiltPanel   = document.getElementById("prebuiltPanel");
  const generatePanel   = document.getElementById("generatePanel");
  const topicInput      = document.getElementById("topicInput");
  const wordCountSelect = document.getElementById("wordCount");
  const generateBtn     = document.getElementById("generateBtn");
  const creditBadge     = document.getElementById("creditBalance");
  const generateStatus  = document.getElementById("generateStatus");

  let loggedIn = false;

  // --- Mode tabs ---
  function setMode(mode) {
    if (mode === "generate") {
      modeGenerateBtn.classList.add("active");
      modeGenerateBtn.setAttribute("aria-selected", "true");
      modePrebuiltBtn.classList.remove("active");
      modePrebuiltBtn.setAttribute("aria-selected", "false");
      prebuiltPanel.style.display = "none";
      generatePanel.style.display = "";
    } else {
      modePrebuiltBtn.classList.add("active");
      modePrebuiltBtn.setAttribute("aria-selected", "true");
      modeGenerateBtn.classList.remove("active");
      modeGenerateBtn.setAttribute("aria-selected", "false");
      generatePanel.style.display = "none";
      prebuiltPanel.style.display = "";
    }
  }

  modePrebuiltBtn.addEventListener("click", () => setMode("prebuilt"));
  modeGenerateBtn.addEventListener("click", () => setMode("generate"));

  // --- Auth events ---
  function updateAuthUI() {
    generateBtn.disabled = !loggedIn;
    if (!loggedIn) {
      generateBtn.textContent = "Generate";
      creditBadge.textContent = "";
      creditBadge.style.display = "none";
      generateStatus.textContent = "Log in to generate puzzles";
      generateStatus.classList.remove("loading");
    } else {
      generateBtn.textContent = "Generate (5 credits)";
      creditBadge.style.display = "";
      creditBadge.classList.remove("logged-out");
      generateStatus.textContent = "";
    }
  }

  function updateBalance(balance) {
    if (!balance) return;
    const coins = balance.coins != null ? balance.coins : Math.floor(balance.available_cents / 100);
    creditBadge.textContent = coins + " credits";
  }

  async function onLogin() {
    loggedIn = true;
    updateAuthUI();
    try {
      const resp = await fetch("/api/bootstrap", { method: "POST", credentials: "include" });
      if (resp.ok) {
        const data = await resp.json();
        if (data.balance) updateBalance(data.balance);
      }
    } catch (err) {
      console.warn("bootstrap failed:", err);
    }
  }

  function onLogout() {
    loggedIn = false;
    updateAuthUI();
    setMode("prebuilt");
  }

  // Listen for mpr-ui auth events (bubble up from mpr-header).
  document.addEventListener("mpr-ui:auth:authenticated", onLogin);
  document.addEventListener("mpr-ui:auth:unauthenticated", onLogout);

  // Also check session on load (cookie may already be present).
  (async function checkSession() {
    try {
      const resp = await fetch("/me", { credentials: "include" });
      if (resp.ok) {
        onLogin();
      }
    } catch (_) { /* not logged in */ }
  })();

  // --- Generate ---
  generateBtn.addEventListener("click", async () => {
    const topic = topicInput.value.trim();
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

    try {
      const resp = await fetch("/api/generate", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: topic,
          word_count: Number(wordCountSelect.value),
        }),
      });

      const data = await resp.json();

      if (!resp.ok) {
        if (data.error === "insufficient_credits") {
          generateStatus.textContent = "Not enough credits. You need 5 credits per puzzle.";
        } else {
          generateStatus.textContent = data.message || "Generation failed. Please try again.";
        }
        return;
      }

      // Update balance.
      if (data.balance) updateBalance(data.balance);

      // Build the grid from the LLM word list.
      const payload = generateCrossword(data.items, {
        title: data.title || "Crossword — " + topic,
        subtitle: data.subtitle || "Generated from LLM.",
      });

      // Render using the exposed API.
      window.CrosswordApp.render(payload);
      generateStatus.textContent = "Puzzle ready! Tip: this puzzle won\u2019t be saved after reload.";
    } catch (err) {
      console.error("generate error:", err);
      generateStatus.textContent = "Network error. Please try again.";
    } finally {
      generateBtn.disabled = !loggedIn;
      generateStatus.classList.remove("loading");
    }
  });

  // Allow Enter key in topic input to trigger generation.
  topicInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      generateBtn.click();
    }
  });

  updateAuthUI();
})();
