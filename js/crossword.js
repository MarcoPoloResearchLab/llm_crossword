/* crossword.js - main puzzle view using CrosswordWidget */
(function () {
  "use strict";

  var _fetch = (window.__testOverrides && window.__testOverrides.fetch) || window.fetch.bind(window);

  var puzzleViewEl = document.getElementById("puzzleView");
  var titleEl      = document.getElementById("title");
  var subEl        = document.getElementById("subtitle");
  var selectEl     = document.getElementById("puzzleSelect");
  var statusEl     = document.getElementById("status");
  var errorBox     = document.getElementById("errorBox");
  var gridViewport = document.getElementById("gridViewport");
  var gridEl       = document.getElementById("grid");
  var acrossOl     = document.getElementById("across");
  var downOl       = document.getElementById("down");
  var checkBtn     = document.getElementById("check");
  var revealBtn    = document.getElementById("reveal");

  var puzzleDataPath = "assets/data/crosswords.json";

  // Create a CrosswordWidget using the existing DOM elements in #puzzleView.
  // We pass existing elements so the widget doesn't create its own DOM.
  var widget = new window.CrosswordWidget(null, {
    hints: true,
    responsive: true,
    draggable: true,
    keyboard: true,
    showTitle: false,
    showControls: false,
    showSelector: false,
    // Inject existing DOM elements for the main puzzle view.
    _existingElements: {
      gridViewport: gridViewport,
      gridEl: gridEl,
      acrossOl: acrossOl,
      downOl: downOl,
      checkBtn: checkBtn,
      revealBtn: revealBtn,
      statusEl: statusEl,
      errorBox: errorBox,
    },
  });

  /** Viewport height tracking */
  var cssViewportHeightProperty = "--viewport-height";
  function updateViewportHeightProperty() {
    var viewportHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    document.documentElement.style.setProperty(cssViewportHeightProperty, viewportHeight + "px");
  }
  updateViewportHeightProperty();
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", updateViewportHeightProperty);
  }
  window.addEventListener("resize", updateViewportHeightProperty);
  window.addEventListener("orientationchange", updateViewportHeightProperty);

  /** render wraps the widget's render and also updates the title/subtitle elements. */
  function render(p) {
    if (titleEl) titleEl.textContent = p.title || "Crossword";
    if (subEl) subEl.textContent = p.subtitle || "";
    widget.render(p);
  }

  /** validatePuzzleSpecification ensures a puzzle specification adheres to the required schema. */
  function validatePuzzleSpecification(spec) {
    if (!spec || typeof spec !== "object") return false;
    if (typeof spec.title !== "string" || typeof spec.subtitle !== "string") return false;
    if (!Array.isArray(spec.items)) return false;
    for (var i = 0; i < spec.items.length; i++) {
      var item = spec.items[i];
      if (typeof item.word !== "string" || typeof item.definition !== "string" || typeof item.hint !== "string") return false;
    }
    return true;
  }

  /** loadAndRenderPuzzles retrieves puzzle specifications, builds puzzles, and renders them. */
  async function loadAndRenderPuzzles() {
    if (statusEl) statusEl.textContent = "Loading puzzles...";
    var response = await _fetch(puzzleDataPath);
    var puzzleSpecifications = await response.json();
    if (!Array.isArray(puzzleSpecifications)) throw new Error("Crossword data must be an array");

    var generatedPuzzles = [];
    for (var i = 0; i < puzzleSpecifications.length; i++) {
      var spec = puzzleSpecifications[i];
      if (!validatePuzzleSpecification(spec)) throw new Error("Crossword specification invalid");
      var puzzle = generateCrossword(spec.items, { title: spec.title, subtitle: spec.subtitle });
      generatedPuzzles.push(puzzle);
      if (selectEl) {
        var opt = document.createElement("option");
        opt.value = String(i);
        opt.textContent = puzzle.title;
        selectEl.appendChild(opt);
      }
    }

    if (selectEl) {
      selectEl.addEventListener("change", function (event) {
        render(generatedPuzzles[Number(event.target.value)]);
      });
      selectEl.value = "0";
    }

    if (generatedPuzzles.length > 0) {
      render(generatedPuzzles[0]);
    }
  }

  // Expose public API for external callers (e.g. app.js).
  window.CrosswordApp = {
    render: render,
    loadPrebuilt: loadAndRenderPuzzles,
    recalculate: function () { widget.recalculate(); },
  };

  loadAndRenderPuzzles().catch(function (error) {
    if (errorBox) {
      errorBox.style.display = "block";
      errorBox.textContent = error.message;
    }
  });
})();
