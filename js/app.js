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
      modePrebuiltBtn.classList.remove("active");
      prebuiltPanel.style.display = "none";
      generatePanel.style.display = "";
    } else {
      modePrebuiltBtn.classList.add("active");
      modeGenerateBtn.classList.remove("active");
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
      creditBadge.textContent = "Log in to generate";
      creditBadge.classList.add("logged-out");
    } else {
      creditBadge.classList.remove("logged-out");
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

  // Listen for mpr-ui auth events.
  document.addEventListener("mpr-ui:auth:login", onLogin);
  document.addEventListener("mpr-ui:auth:logout", onLogout);

  // Also check session on load (cookie may already be present).
  (async function checkSession() {
    try {
      const resp = await fetch("/api/session", { credentials: "include" });
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
      generateStatus.textContent = "Puzzle ready!";
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
