/* landing-puzzle.js — renders a sample crossword on the landing page.
   If a ?puzzle=TOKEN query param is present, fetches and renders the shared puzzle instead. */
(function () {
  "use strict";

  var _fetch = window.fetch.bind(window);
  var container = document.getElementById("landingSamplePuzzle");
  if (!container) return;
  if (typeof generateCrossword !== "function") return;

  var params = new URLSearchParams(window.location.search);
  var sharedToken = params.get("puzzle");
  console.log("[landing-puzzle] sharedToken:", sharedToken, "search:", window.location.search);

  if (sharedToken) {
    // Shared puzzle mode: fetch from API and render in the landing sample area.
    container.textContent = "Loading shared puzzle...";
    _fetch("/api/shared/" + encodeURIComponent(sharedToken))
      .then(function (resp) {
        if (!resp.ok) throw new Error("Puzzle not found");
        return resp.json();
      })
      .then(function (puzzle) {
        console.log("[landing-puzzle] got puzzle:", puzzle.title, "items:", puzzle.items.length);
        container.textContent = "";
        var payload = generateCrossword(puzzle.items, {
          title: puzzle.title || "Shared Crossword",
          subtitle: puzzle.subtitle || "",
        });

        new window.CrosswordWidget(container, {
          puzzle: payload,
          hints: true,
          responsive: true,
          draggable: false,
          keyboard: true,
          showTitle: true,
          showControls: true,
          showSelector: false,
        });

        // Update the landing page heading to indicate this is a shared puzzle.
        var heading = document.querySelector(".landing__title");
        if (heading) heading.textContent = puzzle.title || "Shared Crossword";
        var subtitle = document.querySelector(".landing__subtitle");
        if (subtitle) subtitle.textContent = "Someone shared this crossword with you. Give it a try!";
      })
      .catch(function (err) {
        container.textContent = "Could not load shared puzzle. It may have been deleted. (" + err.message + ")";
        console.error("[landing-puzzle] shared puzzle load error:", err);
      });
    return;
  }

  // Default: hardcoded moon puzzle.
  var moonItems = [
    { word: "lunar", definition: "Relating to the Moon", hint: "Earth's companion" },
    { word: "apollo", definition: "Program that took humans to the Moon", hint: "Saturn V missions" },
    { word: "orbit", definition: "The Moon's path around Earth", hint: "elliptical route" },
    { word: "tides", definition: "Ocean rise-and-fall pulled by the Moon", hint: "regular shoreline shifts" },
    { word: "mare", definition: "A lunar 'sea' not made of water", hint: "shares name with horse" },
  ];

  var payload = generateCrossword(moonItems, {
    title: "Mini Crossword \u2014 Moon Edition",
    subtitle: "Try solving this mini puzzle right here!",
  });

  new window.CrosswordWidget(container, {
    puzzle: payload,
    hints: true,
    responsive: true,
    draggable: false,
    keyboard: false,
    showTitle: true,
    showControls: true,
    showSelector: false,
  });
})();
