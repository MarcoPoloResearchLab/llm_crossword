/* crossword.js - main puzzle view using CrosswordWidget */
(function () {
  "use strict";

  var _fetch = (window.__testOverrides && window.__testOverrides.fetch) || window.fetch.bind(window);

  var puzzleViewEl  = document.getElementById("puzzleView");
  var titleEl       = document.getElementById("title");
  var subEl         = document.getElementById("subtitle");
  var statusEl      = document.getElementById("status");
  var errorBox      = document.getElementById("errorBox");
  var gridViewport  = document.getElementById("gridViewport");
  var gridEl        = document.getElementById("grid");
  var acrossOl      = document.getElementById("across");
  var downOl        = document.getElementById("down");
  var checkBtn      = document.getElementById("check");
  var revealBtn     = document.getElementById("reveal");
  var cardListEl    = document.getElementById("puzzleCardList");

  var puzzleDataPath = "assets/data/crosswords.json";

  // Create a CrosswordWidget using the existing DOM elements in #puzzleView.
  var widget = new window.CrosswordWidget(null, {
    hints: true,
    responsive: true,
    draggable: true,
    keyboard: true,
    showTitle: false,
    showControls: false,
    showSelector: false,
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

  /** renderMiniGrid creates a small CSS grid thumbnail from puzzle entries. */
  function renderMiniGrid(entries) {
    // Compute grid bounds.
    var minRow = Infinity, minCol = Infinity, maxRow = -1, maxCol = -1;
    var i, e;
    for (i = 0; i < entries.length; i++) {
      e = entries[i];
      minRow = Math.min(minRow, e.row);
      minCol = Math.min(minCol, e.col);
      if (e.dir === "across") {
        maxRow = Math.max(maxRow, e.row);
        maxCol = Math.max(maxCol, e.col + e.answer.length - 1);
      } else {
        maxRow = Math.max(maxRow, e.row + e.answer.length - 1);
        maxCol = Math.max(maxCol, e.col);
      }
    }
    if (!isFinite(minRow)) return document.createElement("div");

    var rows = maxRow - minRow + 1;
    var cols = maxCol - minCol + 1;

    // Build a boolean grid of occupied cells.
    var occupied = [];
    var r, c;
    for (r = 0; r < rows; r++) {
      occupied[r] = [];
      for (c = 0; c < cols; c++) {
        occupied[r][c] = false;
      }
    }
    for (i = 0; i < entries.length; i++) {
      e = entries[i];
      var len = e.answer.length;
      for (var j = 0; j < len; j++) {
        if (e.dir === "across") {
          occupied[e.row - minRow][e.col - minCol + j] = true;
        } else {
          occupied[e.row - minRow + j][e.col - minCol] = true;
        }
      }
    }

    // Create the mini grid element, sizing cells to fit within 36x36.
    var thumbSize = 36;
    var gapPx = 1;
    var cellW = Math.floor((thumbSize - (cols - 1) * gapPx) / cols);
    var cellH = Math.floor((thumbSize - (rows - 1) * gapPx) / rows);
    var cellPx = Math.max(1, Math.min(cellW, cellH));

    var el = document.createElement("div");
    el.className = "mini-grid";
    el.style.gridTemplateColumns = "repeat(" + cols + ", " + cellPx + "px)";
    el.style.gridTemplateRows = "repeat(" + rows + ", " + cellPx + "px)";
    for (r = 0; r < rows; r++) {
      for (c = 0; c < cols; c++) {
        var cell = document.createElement("div");
        cell.className = "mini-grid__cell " + (occupied[r][c] ? "mini-grid__cell--letter" : "mini-grid__cell--blank");
        el.appendChild(cell);
      }
    }
    return el;
  }

  /** createPuzzleCard builds a sidebar card element for a puzzle. */
  function createPuzzleCard(puzzle, index) {
    var card = document.createElement("div");
    card.className = "puzzle-card";
    card.dataset.puzzleIndex = String(index);

    var thumb = document.createElement("div");
    thumb.className = "puzzle-card__thumb";
    thumb.appendChild(renderMiniGrid(puzzle.entries));
    card.appendChild(thumb);

    var title = document.createElement("div");
    title.className = "puzzle-card__title";
    title.textContent = puzzle.title;
    card.appendChild(title);

    return card;
  }

  /** setActiveCard highlights the selected card and removes active from others. */
  function setActiveCard(card) {
    var all = puzzleViewEl.querySelectorAll(".puzzle-card");
    for (var i = 0; i < all.length; i++) {
      all[i].classList.remove("puzzle-card--active");
    }
    if (card) card.classList.add("puzzle-card--active");
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

  // Store all puzzles for sidebar access.
  var allPuzzles = [];

  /** loadAndRenderPuzzles retrieves puzzle specifications, builds puzzles, and populates the sidebar. */
  async function loadAndRenderPuzzles() {
    if (statusEl) statusEl.textContent = "Loading puzzles...";
    var response = await _fetch(puzzleDataPath);
    var puzzleSpecifications = await response.json();
    if (!Array.isArray(puzzleSpecifications)) throw new Error("Crossword data must be an array");

    for (var i = 0; i < puzzleSpecifications.length; i++) {
      var spec = puzzleSpecifications[i];
      if (!validatePuzzleSpecification(spec)) throw new Error("Crossword specification invalid");
      var puzzle = generateCrossword(spec.items, { title: spec.title, subtitle: spec.subtitle });
      allPuzzles.push(puzzle);
    }

    // Populate sidebar cards.
    if (cardListEl) {
      for (var j = 0; j < allPuzzles.length; j++) {
        var card = createPuzzleCard(allPuzzles[j], j);
        cardListEl.appendChild(card);
      }

      // Click handler for puzzle cards (delegated).
      cardListEl.addEventListener("click", function (event) {
        var cardEl = event.target.closest(".puzzle-card");
        if (!cardEl) return;
        var idx = Number(cardEl.dataset.puzzleIndex);
        if (isNaN(idx) || !allPuzzles[idx]) return;
        selectPuzzle(idx, cardEl);
      });
    }

    // Render the first puzzle by default.
    if (allPuzzles.length > 0) {
      render(allPuzzles[0]);
      // Set first card active.
      if (cardListEl && cardListEl.children.length > 0) {
        setActiveCard(cardListEl.children[0]);
      }
    }
  }

  /** notifyShareToken tells app.js about the share token for the active puzzle. */
  function notifyShareToken(puzzle) {
    var token = (puzzle && puzzle.shareToken) || null;
    var shareBtn = document.getElementById("shareBtn");
    if (shareBtn) shareBtn.style.display = token ? "" : "none";
    // Update app.js currentShareToken via a custom event.
    window.dispatchEvent(new CustomEvent("crossword:share-token", { detail: token }));
  }

  /** selectPuzzle renders a puzzle and highlights its card. */
  function selectPuzzle(index, cardEl) {
    var generatePanel = document.getElementById("generatePanel");
    if (generatePanel) generatePanel.style.display = "none";

    // Show grid area.
    var pane = puzzleViewEl.querySelector(".pane");
    if (pane) pane.style.display = "";
    var controls = puzzleViewEl.querySelector(".controls");
    if (controls) controls.style.display = "";

    render(allPuzzles[index]);
    setActiveCard(cardEl);
    notifyShareToken(allPuzzles[index]);

    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        widget.recalculate();
      });
    });
  }

  /** addGeneratedPuzzle adds a dynamically generated puzzle to the sidebar and selects it. */
  function addGeneratedPuzzle(puzzle) {
    var index = allPuzzles.length;
    allPuzzles.push(puzzle);

    if (cardListEl) {
      // Insert at top of list (right after "New Crossword" card).
      var card = createPuzzleCard(puzzle, index);
      cardListEl.insertBefore(card, cardListEl.firstChild);
      selectPuzzle(index, card);
    } else {
      render(puzzle);
    }
  }

  // Expose public API for external callers (e.g. app.js).
  window.CrosswordApp = {
    render: render,
    loadPrebuilt: loadAndRenderPuzzles,
    recalculate: function () { widget.recalculate(); },
    addGeneratedPuzzle: addGeneratedPuzzle,
    setActiveCard: setActiveCard,
    renderMiniGrid: renderMiniGrid,
  };

  loadAndRenderPuzzles().catch(function (error) {
    if (errorBox) {
      errorBox.style.display = "block";
      errorBox.textContent = error.message;
    }
  });
})();
