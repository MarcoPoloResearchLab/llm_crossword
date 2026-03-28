/* landing-puzzle.js — renders the landing-page sample puzzle or a shared puzzle */
(function () {
  "use strict";

  if (window.__LLM_CROSSWORD_LANDING_SAMPLE_BOOTED__) {
    return;
  }
  window.__LLM_CROSSWORD_LANDING_SAMPLE_BOOTED__ = true;

  var _fetch = window.fetch.bind(window);
  var container = document.getElementById("landingSamplePuzzle");
  var landingTitle = document.querySelector(".landing__title");
  var landingSubtitle = document.querySelector(".landing__subtitle");

  if (!container || typeof generateCrossword !== "function" || typeof window.CrosswordWidget !== "function") {
    return;
  }

  function createWidgetPayload(items, title, subtitle) {
    return generateCrossword(items, {
      title: title,
      subtitle: subtitle,
    });
  }

  function renderWidget(payload, keyboardEnabled) {
    container.textContent = "";

    new window.CrosswordWidget(container, {
      puzzle: payload,
      hints: true,
      responsive: true,
      draggable: false,
      keyboard: keyboardEnabled,
      showTitle: true,
      showControls: true,
      showSelector: false,
    });
  }

  function renderDefaultSample() {
    var sampleItems = [
      { word: "lunar", definition: "Relating to the Moon", hint: "Earth's companion" },
      { word: "apollo", definition: "Program that took humans to the Moon", hint: "Saturn V missions" },
      { word: "orbit", definition: "The Moon's path around Earth", hint: "elliptical route" },
      { word: "tides", definition: "Ocean rise-and-fall pulled by the Moon", hint: "regular shoreline shifts" },
      { word: "mare", definition: "A lunar 'sea' not made of water", hint: "shares name with horse" },
    ];

    renderWidget(
      createWidgetPayload(sampleItems, "Mini Crossword \u2014 Moon Edition", "Try solving this mini puzzle right here!"),
      false
    );
  }

  function applySharedPuzzleCopy(title) {
    if (landingTitle) {
      landingTitle.textContent = title || "Shared Crossword";
    }
    if (landingSubtitle) {
      landingSubtitle.textContent = "Someone shared this crossword with you. Give it a try!";
    }
  }

  function renderSharedPuzzle(sharedToken) {
    container.textContent = "Loading shared puzzle...";

    _fetch("/api/shared/" + encodeURIComponent(sharedToken))
      .then(function (response) {
        if (!response.ok) throw new Error("Puzzle not found");
        return response.json();
      })
      .then(function (puzzle) {
        var title = puzzle.title || "Shared Crossword";
        var subtitle = puzzle.subtitle || "";
        var payload = createWidgetPayload(puzzle.items, title, subtitle);

        applySharedPuzzleCopy(title);
        renderWidget(payload, true);
      })
      .catch(function (error) {
        container.textContent = "Could not load shared puzzle. It may have been deleted. (" + error.message + ")";
      });
  }

  var params = new URLSearchParams(window.location.search);
  var sharedToken = params.get("puzzle");

  if (sharedToken) {
    renderSharedPuzzle(sharedToken);
    return;
  }

  renderDefaultSample();
})();
