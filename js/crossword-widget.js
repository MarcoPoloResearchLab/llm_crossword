/* crossword-widget.js - reusable CrosswordWidget class */
(function () {
  "use strict";

  /** defaultCellSize stores the maximum cell dimension in pixels. */
  var defaultCellSize = 44;
  /** pixelUnit identifies the CSS pixel unit. */
  var pixelUnit = "px";
  /** cssCellSizeProperty identifies the CSS property for grid cell size. */
  var cssCellSizeProperty = "--cell-size";
  /** cssGapSizeProperty identifies the CSS property for the gap between cells. */
  var cssGapSizeProperty = "--gap-size";
  /** solvedClueClassName identifies the CSS class for solved clues. */
  var solvedClueClassName = "clueSolved";
  /** correctClassName identifies the CSS class for correct letters. */
  var correctClassName = "correct";
  /** hiddenStyleValue specifies the display style value to hide elements. */
  var hiddenStyleValue = "none";
  /** emptyString represents an empty string. */
  var emptyString = "";
  /** Emoji pool for celebration confetti. */
  var confettiEmojis = ["🎉", "⭐", "🏆", "✨", "🎊", "💫", "🌟", "🎯"];
  /** Colors for square confetti pieces. */
  var confettiColors = ["#6366f1", "#34d399", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4", "#f97316"];

  /**
   * launchConfetti spawns celebratory particles inside a container element.
   * Particles are a mix of colored squares and emoji, animated with CSS.
   */
  function launchConfetti(container) {
    var rect = container.getBoundingClientRect();
    var count = 60;
    var overlay = document.createElement("div");
    overlay.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;overflow:hidden;z-index:100;";
    container.style.position = container.style.position || "relative";
    container.appendChild(overlay);

    for (var i = 0; i < count; i++) {
      var piece = document.createElement("div");
      var useEmoji = Math.random() < 0.35;
      var size = useEmoji ? (14 + Math.random() * 12) : (6 + Math.random() * 8);
      var startX = Math.random() * 100;
      var drift = (Math.random() - 0.5) * 120;
      var delay = Math.random() * 0.6;
      var duration = 1.8 + Math.random() * 1.4;
      var spin = (Math.random() - 0.5) * 1080;

      if (useEmoji) {
        piece.textContent = confettiEmojis[Math.floor(Math.random() * confettiEmojis.length)];
        piece.style.cssText = "position:absolute;font-size:" + size + "px;left:" + startX + "%;top:-20px;" +
          "pointer-events:none;animation:cw-confetti-fall " + duration + "s ease-out " + delay + "s forwards;";
      } else {
        var color = confettiColors[Math.floor(Math.random() * confettiColors.length)];
        piece.style.cssText = "position:absolute;width:" + size + "px;height:" + size + "px;" +
          "background:" + color + ";border-radius:2px;left:" + startX + "%;top:-20px;" +
          "pointer-events:none;animation:cw-confetti-fall " + duration + "s ease-out " + delay + "s forwards;";
      }
      piece.style.setProperty("--cw-drift", drift + "px");
      piece.style.setProperty("--cw-spin", spin + "deg");
      overlay.appendChild(piece);
    }

    // Remove overlay when all confetti animations complete
    var animationsRemaining = count;
    overlay.addEventListener("animationend", function () {
      animationsRemaining--;
      if (animationsRemaining <= 0 && overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
      }
    });
  }

  // Inject confetti keyframes once
  (function () {
    var style = document.createElement("style");
    style.textContent =
      "@keyframes cw-confetti-fall {" +
      "  0% { transform: translateY(0) translateX(0) rotate(0deg) scale(1); opacity: 1; }" +
      "  80% { opacity: 1; }" +
      "  100% { transform: translateY(calc(100vh * 0.7)) translateX(var(--cw-drift)) rotate(var(--cw-spin)) scale(0.3); opacity: 0; }" +
      "}";
    document.head.appendChild(style);
  })();

  /** hintStageInitial identifies the initial hint state with no hint visible. */
  var hintStageInitial = 0;
  /** hintStageVerbal identifies the state where the verbal hint is displayed. */
  var hintStageVerbal = 1;
  /** hintStageLetter identifies the state where a letter has been revealed. */
  var hintStageLetter = 2;
  /** errorInvalidSpecificationMessage describes the invalid specification error. */
  var errorInvalidSpecificationMessage = "Crossword specification invalid";
  /** errorInvalidDataMessage describes the invalid data error. */
  var errorInvalidDataMessage = "Puzzles data must be an array";

  /** widgetInstanceCounter ensures unique IDs across widget instances. */
  var widgetInstanceCounter = 0;

  /* ── Helper functions (stateless, shared across instances) ────────── */

  function sanitizeClue(text) {
    return (text || "").replace(/^\s*\d+\.?\s*/, "");
  }

  function computeGridSize(entries) {
    var minRow = Infinity, minCol = Infinity;
    var maxRow = -1, maxCol = -1;
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
    if (!isFinite(minRow)) { minRow = 0; minCol = 0; maxRow = 0; maxCol = 0; }
    return { rows: (maxRow - minRow + 1), cols: (maxCol - minCol + 1), offsetRow: minRow, offsetCol: minCol };
  }

  function validatePayload(p) {
    var errors = [];
    if (!p || typeof p !== "object") {
      errors.push("Payload missing.");
      return errors;
    }
    if (!Array.isArray(p.entries) || p.entries.length === 0) errors.push("entries[] is required.");

    var byId = {};
    var idx, ent, keys, ki, k;
    for (idx = 0; idx < p.entries.length; idx++) {
      ent = p.entries[idx];
      keys = ["id", "dir", "row", "col", "answer", "clue"];
      for (ki = 0; ki < keys.length; ki++) {
        k = keys[ki];
        if (ent[k] === undefined) errors.push("Entry missing " + k + ": " + JSON.stringify(ent));
      }
      if (!/^(across|down)$/.test(ent.dir)) errors.push("Bad dir for " + ent.id);
      if (!/^[A-Za-z]+$/.test(ent.answer)) errors.push("Non-letters in answer for " + ent.id);
      if (byId[ent.id]) errors.push("Duplicate id: " + ent.id);
      byId[ent.id] = ent;
    }

    if (!Array.isArray(p.overlaps)) errors.push("overlaps[] is required (can be empty).");
    else {
      var oi, o, a, b, ar, ac, br, bc, ca, cb;
      for (oi = 0; oi < p.overlaps.length; oi++) {
        o = p.overlaps[oi];
        if (o.a == null || o.b == null || o.aIndex == null || o.bIndex == null) { errors.push("Bad overlap: " + JSON.stringify(o)); continue; }
        a = byId[o.a]; b = byId[o.b];
        if (!a || !b) { errors.push("Overlap refers to unknown id: " + JSON.stringify(o)); continue; }
        ar = a.dir === "across" ? a.row : a.row + o.aIndex;
        ac = a.dir === "across" ? a.col + o.aIndex : a.col;
        br = b.dir === "across" ? b.row : b.row + o.bIndex;
        bc = b.dir === "across" ? b.col + o.bIndex : b.col;
        if (ar !== br || ac !== bc) errors.push("Overlap coords mismatch for " + o.a + "~" + o.b);
        ca = a.answer[o.aIndex].toUpperCase();
        cb = b.answer[o.bIndex].toUpperCase();
        if (ca !== cb) errors.push("Overlap letter mismatch " + o.a + "(" + ca + ") vs " + o.b + "(" + cb + ")");
      }
    }
    return errors;
  }

  function buildModel(p, rows, cols, offsetRow, offsetCol) {
    var r, c, model, getCell;
    model = [];
    for (r = 0; r < rows; r++) {
      var row = [];
      for (c = 0; c < cols; c++) {
        row.push({
          r: r, c: c, block: true, sol: null, num: null, input: null, prev: "",
          links: { across: { prev: null, next: null }, down: { prev: null, next: null } },
          belongs: [],
          el: null
        });
      }
      model.push(row);
    }
    getCell = function (r, c) { return (model[r] && model[r][c]) || null; };

    // place letters
    var idx, ent, L, i, cr, cc, ch, cell;
    for (idx = 0; idx < p.entries.length; idx++) {
      ent = p.entries[idx];
      L = ent.answer.length;
      for (i = 0; i < L; i++) {
        cr = (ent.dir === "across" ? ent.row : ent.row + i) - offsetRow;
        cc = (ent.dir === "across" ? ent.col + i : ent.col) - offsetCol;
        ch = ent.answer[i].toUpperCase();
        cell = model[cr][cc];
        cell.block = false;
        if (cell.sol && cell.sol !== ch) throw new Error("Conflict at (" + cr + "," + cc + ")");
        cell.sol = ch;
        if (cell.belongs.indexOf(ent.id) === -1) cell.belongs.push(ent.id);
      }
    }

    var refsById = {};
    for (idx = 0; idx < p.entries.length; idx++) {
      ent = p.entries[idx];
      refsById[ent.id] = {};
      for (var k in ent) {
        if (ent.hasOwnProperty(k)) refsById[ent.id][k] = ent[k];
      }
    }

    var starts = {};
    for (idx = 0; idx < p.entries.length; idx++) {
      ent = p.entries[idx];
      var r0 = ent.row - offsetRow;
      var c0 = ent.col - offsetCol;
      var key = r0 + ":" + c0;
      var slot = starts[key] || {};
      slot[ent.dir] = refsById[ent.id];
      starts[key] = slot;
    }

    // build navigation links along each entry
    for (idx = 0; idx < p.entries.length; idx++) {
      ent = p.entries[idx];
      L = ent.answer.length;
      for (i = 0; i < L; i++) {
        cr = (ent.dir === "across" ? ent.row : ent.row + i) - offsetRow;
        cc = (ent.dir === "across" ? ent.col + i : ent.col) - offsetCol;
        cell = getCell(cr, cc);
        var dir = ent.dir;
        if (i > 0) cell.links[dir].prev = { r: dir === "across" ? cr : cr - 1, c: dir === "across" ? cc - 1 : cc };
        if (i < L - 1) cell.links[dir].next = { r: dir === "across" ? cr : cr + 1, c: dir === "across" ? cc + 1 : cc };
      }
    }

    var nextNum = 1;
    var across = [];
    var down = [];
    for (r = 0; r < rows; r++) {
      for (c = 0; c < cols; c++) {
        var slotKey = r + ":" + c;
        var sl = starts[slotKey];
        if (!sl) continue;
        model[r][c].num = nextNum;
        if (sl.across) { sl.across.num = nextNum; across.push(sl.across); }
        if (sl.down) { sl.down.num = nextNum; down.push(sl.down); }
        nextNum++;
      }
    }
    across.sort(function (a, b) { return a.num - b.num; });
    down.sort(function (a, b) { return a.num - b.num; });

    return { model: model, across: across, down: down, rows: rows, cols: cols, getCell: getCell, refsById: refsById };
  }

  function validatePuzzleSpecification(puzzleSpecification) {
    if (!puzzleSpecification || typeof puzzleSpecification !== "object") return false;
    if (typeof puzzleSpecification.title !== "string" || typeof puzzleSpecification.subtitle !== "string") return false;
    if (!Array.isArray(puzzleSpecification.items)) return false;
    var i;
    for (i = 0; i < puzzleSpecification.items.length; i++) {
      var item = puzzleSpecification.items[i];
      if (typeof item.word !== "string" || typeof item.definition !== "string" || typeof item.hint !== "string") return false;
    }
    return true;
  }

  /* ── CrosswordWidget constructor ─────────────────────────────────── */

  function CrosswordWidget(container, options) {
    if (!(this instanceof CrosswordWidget)) {
      return new CrosswordWidget(container, options);
    }
    var opts = options || {};

    this._id = ++widgetInstanceCounter;
    this._container = container;
    this._hints = opts.hints !== undefined ? !!opts.hints : true;
    this._responsive = opts.responsive !== undefined ? !!opts.responsive : true;
    this._draggable = opts.draggable !== undefined ? !!opts.draggable : true;
    this._keyboard = opts.keyboard !== undefined ? !!opts.keyboard : true;
    this._showTitle = opts.showTitle !== undefined ? !!opts.showTitle : true;
    this._showControls = opts.showControls !== undefined ? !!opts.showControls : true;
    this._showSelector = opts.showSelector !== undefined ? !!opts.showSelector : false;

    this._currentColumnCount = 0;
    this._resizeObserver = null;
    this._dragCleanup = null;
    this._puzzles = [];
    this._destroyed = false;
    this._testApi = null;

    // Event handler references for cleanup
    this._boundHandlers = [];

    // Support injecting existing DOM elements (for backward compatibility).
    var existing = opts._existingElements;
    if (existing) {
      this._gridViewport = existing.gridViewport;
      this._gridEl = existing.gridEl;
      this._acrossOl = existing.acrossOl;
      this._downOl = existing.downOl;
      this._checkBtn = existing.checkBtn || null;
      this._revealBtn = existing.revealBtn || null;
      this._statusEl = existing.statusEl || null;
      this._errorBox = existing.errorBox || null;
      this._titleEl = existing.titleEl || null;
      this._subEl = existing.subEl || null;
      this._selectEl = existing.selectEl || null;
      this._setupResponsive();
      this._setupDragging();
    } else {
      this._buildDOM();
    }

    // Auto-render if a puzzle was provided.
    if (opts.puzzle) {
      this.render(opts.puzzle);
    }
  }

  /* ── DOM scaffold ────────────────────────────────────────────────── */

  CrosswordWidget.prototype._buildDOM = function () {
    var self = this;
    var doc = this._container.ownerDocument || document;

    // Clear container
    this._container.innerHTML = "";

    // Header (title + subtitle)
    if (this._showTitle) {
      var header = doc.createElement("div");
      header.className = "widgetHeader";
      this._titleEl = doc.createElement("h2");
      this._titleEl.className = "widgetTitle";
      this._subEl = doc.createElement("p");
      this._subEl.className = "widgetSubtitle";
      header.appendChild(this._titleEl);
      header.appendChild(this._subEl);
      this._container.appendChild(header);
    } else {
      this._titleEl = null;
      this._subEl = null;
    }

    // Puzzle selector
    if (this._showSelector) {
      var selectorWrap = doc.createElement("div");
      selectorWrap.className = "widgetSelector";
      this._selectEl = doc.createElement("select");
      this._selectEl.className = "puzzleSelect";
      selectorWrap.appendChild(this._selectEl);
      this._container.appendChild(selectorWrap);
    } else {
      this._selectEl = null;
    }

    // Body: flex row with grid + clues (same layout as .pane)
    var body = doc.createElement("div");
    body.className = "pane";

    // Grid viewport + grid
    this._gridViewport = doc.createElement("div");
    this._gridViewport.className = "gridViewport";
    this._gridEl = doc.createElement("div");
    this._gridEl.className = "grid";
    this._gridViewport.appendChild(this._gridEl);
    body.appendChild(this._gridViewport);

    // Clues
    var cluesWrap = doc.createElement("div");
    cluesWrap.className = "clues";

    var acrossGroup = doc.createElement("div");
    acrossGroup.className = "cluegrp";
    var acrossTitle = doc.createElement("h3");
    acrossTitle.textContent = "Across";
    this._acrossOl = doc.createElement("ol");
    acrossGroup.appendChild(acrossTitle);
    acrossGroup.appendChild(this._acrossOl);

    var downGroup = doc.createElement("div");
    downGroup.className = "cluegrp";
    var downTitle = doc.createElement("h3");
    downTitle.textContent = "Down";
    this._downOl = doc.createElement("ol");
    downGroup.appendChild(downTitle);
    downGroup.appendChild(this._downOl);

    cluesWrap.appendChild(acrossGroup);
    cluesWrap.appendChild(downGroup);
    body.appendChild(cluesWrap);
    this._container.appendChild(body);

    // Controls
    if (this._showControls) {
      var controlsWrap = doc.createElement("div");
      controlsWrap.className = "controls";
      this._checkBtn = doc.createElement("button");
      this._checkBtn.textContent = "Check";
      this._checkBtn.className = "checkBtn";
      this._revealBtn = doc.createElement("button");
      this._revealBtn.textContent = "Reveal";
      this._revealBtn.className = "revealBtn";
      controlsWrap.appendChild(this._checkBtn);
      controlsWrap.appendChild(this._revealBtn);
      this._container.appendChild(controlsWrap);
    } else {
      this._checkBtn = null;
      this._revealBtn = null;
    }

    // Status + Error
    this._statusEl = doc.createElement("div");
    this._statusEl.className = "status";
    this._container.appendChild(this._statusEl);

    this._errorBox = doc.createElement("div");
    this._errorBox.className = "error";
    this._errorBox.style.display = hiddenStyleValue;
    this._container.appendChild(this._errorBox);

    this._setupResponsive();
    this._setupDragging();
  };

  CrosswordWidget.prototype._setupResponsive = function () {
    var self = this;
    if (this._responsive && typeof ResizeObserver !== "undefined") {
      this._resizeObserver = new ResizeObserver(function () {
        self.recalculate();
      });
      this._resizeObserver.observe(this._gridViewport);
    }
  };

  CrosswordWidget.prototype._setupDragging = function () {
    if (this._draggable) {
      this._enablePanning();
    }
  };

  /* ── Responsive cell sizing ──────────────────────────────────────── */

  CrosswordWidget.prototype.recalculate = function () {
    if (!this._currentColumnCount) return;
    var viewportWidth = this._gridViewport.clientWidth;
    if (viewportWidth < 1) return;
    var computedStyles = getComputedStyle(this._gridViewport);
    var gapSize = parseInt(computedStyles.getPropertyValue(cssGapSizeProperty), 10) || 0;
    // Cell size is fixed — the grid viewport scrolls/pans when the grid is wider.
    this._gridViewport.style.setProperty(cssCellSizeProperty, defaultCellSize + pixelUnit);
  };

  /* ── Drag panning ────────────────────────────────────────────────── */

  CrosswordWidget.prototype._enablePanning = function () {
    var gv = this._gridViewport;
    var isDragging = false, startX = 0, startY = 0, scrollL = 0, scrollT = 0;

    var onMouseDown = function (e) {
      isDragging = true; gv.classList.add("dragging");
      startX = e.pageX - gv.offsetLeft;
      startY = e.pageY - gv.offsetTop;
      scrollL = gv.scrollLeft;
      scrollT = gv.scrollTop;
    };
    var stopDrag = function () { isDragging = false; gv.classList.remove("dragging"); };
    var onMouseMove = function (e) {
      if (!isDragging) return;
      e.preventDefault();
      var x = e.pageX - gv.offsetLeft;
      var y = e.pageY - gv.offsetTop;
      gv.scrollLeft = scrollL - (x - startX);
      gv.scrollTop = scrollT - (y - startY);
    };
    var onTouchStart = function (e) {
      var t = e.touches[0]; isDragging = true;
      startX = t.pageX - gv.offsetLeft; startY = t.pageY - gv.offsetTop;
      scrollL = gv.scrollLeft; scrollT = gv.scrollTop;
    };
    var onTouchEnd = function () { isDragging = false; };
    var onTouchMove = function (e) {
      if (!isDragging) return;
      var t = e.touches[0];
      var x = t.pageX - gv.offsetLeft;
      var y = t.pageY - gv.offsetTop;
      gv.scrollLeft = scrollL - (x - startX);
      gv.scrollTop = scrollT - (y - startY);
    };

    gv.addEventListener("mousedown", onMouseDown);
    gv.addEventListener("mouseleave", stopDrag);
    gv.addEventListener("mouseup", stopDrag);
    gv.addEventListener("mousemove", onMouseMove);
    gv.addEventListener("touchstart", onTouchStart, { passive: true });
    gv.addEventListener("touchend", onTouchEnd, { passive: true });
    gv.addEventListener("touchmove", onTouchMove, { passive: true });

    this._dragCleanup = function () {
      gv.removeEventListener("mousedown", onMouseDown);
      gv.removeEventListener("mouseleave", stopDrag);
      gv.removeEventListener("mouseup", stopDrag);
      gv.removeEventListener("mousemove", onMouseMove);
      gv.removeEventListener("touchstart", onTouchStart);
      gv.removeEventListener("touchend", onTouchEnd);
      gv.removeEventListener("touchmove", onTouchMove);
    };
  };

  /* ── render(payload) ─────────────────────────────────────────────── */

  CrosswordWidget.prototype.render = function (p) {
    if (this._destroyed) return;

    var self = this;
    var gridEl = this._gridEl;
    var acrossOl = this._acrossOl;
    var downOl = this._downOl;
    var statusEl = this._statusEl;
    var errorBox = this._errorBox;
    var enableKeyboard = this._keyboard;
    var enableHints = this._hints;

    // Set title/subtitle on widget's own elements
    if (this._titleEl) this._titleEl.textContent = p.title || "Crossword";
    if (this._subEl) this._subEl.textContent = p.subtitle || "";

    // Reset state
    statusEl.textContent = ""; statusEl.classList.remove("ok");
    gridEl.innerHTML = ""; acrossOl.innerHTML = ""; downOl.innerHTML = "";
    errorBox.style.display = hiddenStyleValue; errorBox.textContent = "";

    // Validate
    var errors = validatePayload(p);
    if (errors.length) {
      errorBox.style.display = "block";
      errorBox.textContent = "Payload error:\n" + errors.join("\n");
      return;
    }

    // Build model
    var size = computeGridSize(p.entries);
    var built;
    try { built = buildModel(p, size.rows, size.cols, size.offsetRow, size.offsetCol); }
    catch (err) { errorBox.style.display = "block"; errorBox.textContent = "Placement conflict: " + err.message; return; }

    var model = built.model;
    var across = built.across;
    var down = built.down;
    var rows = built.rows;
    var cols = built.cols;
    var getCell = built.getCell;
    var solveSession = {
      completionEmitted: false,
      revealNotified: false,
      usedHint: false,
      usedReveal: false,
    };

    // Set grid template
    gridEl.style.gridTemplateColumns = "repeat(" + cols + ", var(" + cssCellSizeProperty + "))";
    gridEl.style.gridTemplateRows = "repeat(" + rows + ", var(" + cssCellSizeProperty + "))";
    this._currentColumnCount = cols;
    this.recalculate();

    // Highlighting state maps
    var clueById = {};
    var cellsById = {};
    var allEntries = across.concat(down);
    var ei, ent, arr, ci;

    for (ei = 0; ei < allEntries.length; ei++) {
      ent = allEntries[ei];
      arr = [];
      for (ci = 0; ci < ent.answer.length; ci++) {
        var cr = ent.dir === "across" ? ent.row - size.offsetRow : ent.row - size.offsetRow + ci;
        var cc = ent.dir === "across" ? ent.col - size.offsetCol + ci : ent.col - size.offsetCol;
        arr.push(getCell(cr, cc));
      }
      cellsById[ent.id] = arr;
    }

    var addHL = function (ids) {
      var i, j, id, cells, cell, li;
      for (i = 0; i < ids.length; i++) {
        id = ids[i];
        cells = cellsById[id] || [];
        for (j = 0; j < cells.length; j++) {
          cell = cells[j];
          if (cell.el) cell.el.classList.add("hl");
        }
        li = clueById[id];
        if (li) li.classList.add("clueHL");
      }
    };

    var clearHL = function () {
      var hlCells = gridEl.querySelectorAll(".hl");
      var i;
      for (i = 0; i < hlCells.length; i++) hlCells[i].classList.remove("hl");
      var hlCluesA = acrossOl.querySelectorAll(".clueHL");
      for (i = 0; i < hlCluesA.length; i++) hlCluesA[i].classList.remove("clueHL");
      var hlCluesD = downOl.querySelectorAll(".clueHL");
      for (i = 0; i < hlCluesD.length; i++) hlCluesD[i].classList.remove("clueHL");
    };

    /* Solved-clue tracking */

    function isEntrySolved(entryIdentifier) {
      var cells = cellsById[entryIdentifier] || [];
      if (cells.length === 0) return false;
      var i;
      for (i = 0; i < cells.length; i++) {
        if ((cells[i].input.value || "").toUpperCase() !== cells[i].sol) return false;
      }
      return true;
    }

    function updateEntrySolvedState(entryIdentifier) {
      var clueElement = clueById[entryIdentifier];
      if (!clueElement) return;
      if (isEntrySolved(entryIdentifier)) clueElement.classList.add(solvedClueClassName);
      else clueElement.classList.remove(solvedClueClassName);
    }

    function updateSolvedStateForCell(cell) {
      var i;
      for (i = 0; i < cell.belongs.length; i++) {
        updateEntrySolvedState(cell.belongs[i]);
      }
    }

    function updateAllSolvedStates() {
      var i;
      for (i = 0; i < allEntries.length; i++) {
        updateEntrySolvedState(allEntries[i].id);
      }
    }

    function isPuzzleSolved() {
      var i;
      for (i = 0; i < allEntries.length; i++) {
        if (!isEntrySolved(allEntries[i].id)) return false;
      }
      return allEntries.length > 0;
    }

    function dispatchWidgetEvent(eventName, detail) {
      window.dispatchEvent(new CustomEvent(eventName, {
        detail: detail,
      }));
    }

    function emitCompletionIfNeeded(trigger) {
      if (solveSession.completionEmitted || solveSession.usedReveal || !isPuzzleSolved()) return;
      solveSession.completionEmitted = true;
      dispatchWidgetEvent("crossword:completed", {
        trigger: trigger,
        usedHint: solveSession.usedHint,
        usedReveal: solveSession.usedReveal,
      });
    }

    function emitRevealIfNeeded() {
      if (solveSession.revealNotified) return;
      solveSession.usedReveal = true;
      solveSession.revealNotified = true;
      dispatchWidgetEvent("crossword:reveal-used", {
        usedHint: solveSession.usedHint,
        usedReveal: true,
      });
    }

    /* Hint helpers */

    function revealLetter(entryIdentifier) {
      var cells = cellsById[entryIdentifier] || [];
      var i, entryCell, currentValue, previousValue;
      for (i = 0; i < cells.length; i++) {
        entryCell = cells[i];
        currentValue = (entryCell.input.value || emptyString).toUpperCase();
        if (currentValue !== entryCell.sol) {
          previousValue = entryCell.input.value;
          entryCell.input.value = entryCell.sol;
          entryCell.input.parentElement.classList.add(correctClassName);
          updateEntrySolvedState(entryIdentifier);
          return { cell: entryCell, previousValue: previousValue };
        }
      }
      return null;
    }

    function attachHints(clueElement, entry) {
      var hintContainer = document.createElement("span");
      hintContainer.className = "hintControls";
      var hintButton = document.createElement("button");
      hintButton.className = "hintButton";
      hintButton.textContent = "H";
      var verbalSpan = document.createElement("div");
      verbalSpan.className = "hintText";
      verbalSpan.textContent = entry.hint;
      verbalSpan.style.display = hiddenStyleValue;

      var hintStage = hintStageInitial;
      var revealedCellInfo = null;

      function clearRevealedLetter() {
        if (!revealedCellInfo) return;
        revealedCellInfo.cell.input.value = revealedCellInfo.previousValue || emptyString;
        revealedCellInfo.cell.input.parentElement.classList.remove(correctClassName);
        updateEntrySolvedState(entry.id);
        revealedCellInfo = null;
      }

      function resetHints() {
        clearRevealedLetter();
        verbalSpan.style.display = hiddenStyleValue;
      }

      hintButton.addEventListener("click", function (event) {
        event.preventDefault();
        solveSession.usedHint = true;
        if (hintStage === hintStageInitial) {
          verbalSpan.style.display = emptyString;
          hintStage = hintStageVerbal;
        } else if (hintStage === hintStageVerbal) {
          revealedCellInfo = revealLetter(entry.id);
          hintStage = hintStageLetter;
          emitCompletionIfNeeded("hint");
        } else {
          resetHints();
          hintStage = hintStageInitial;
        }
      });

      hintContainer.appendChild(hintButton);
      clueElement.appendChild(hintContainer);
      clueElement.appendChild(verbalSpan);
    }

    /* Navigation helpers */

    var activeDir = "across";

    var focusCell = function (r, c) {
      var d = getCell(r, c);
      if (!d || d.block) return;
      d.input.focus(); d.input.select();
    };

    var step = function (d, dir, forward) {
      if (forward === undefined) forward = true;
      var link = d.links[dir][forward ? "next" : "prev"];
      if (!link) return null;
      var t = getCell(link.r, link.c);
      return (t && !t.block) ? t : null;
    };

    this._testApi = {
      cellsById: cellsById,
      clueById: clueById,
      getCell: getCell,
      focusCell: focusCell,
      step: step,
      isEntrySolved: isEntrySolved,
      updateEntrySolvedState: updateEntrySolvedState,
      updateSolvedStateForCell: updateSolvedStateForCell,
      revealLetter: revealLetter,
      solveSession: solveSession,
    };

    /* Draw grid cells */

    var r, c, d;
    for (r = 0; r < rows; r++) {
      for (c = 0; c < cols; c++) {
        d = model[r][c];
        if (d.block) continue;

        var cellDiv = document.createElement("div");
        cellDiv.className = "cell";
        cellDiv.style.gridRowStart = (r + 1);
        cellDiv.style.gridColumnStart = (c + 1);
        d.el = cellDiv;

        var input = document.createElement("input");
        input.maxLength = 1;
        input.setAttribute("aria-label", "Row " + (r + 1) + " Col " + (c + 1));
        d.input = input;

        // Use a closure to capture cell data per iteration
        (function (d, input, cellDiv) {
          var updateWordHL = function () {
            clearHL();
            addHL(d.belongs);
          };

          input.addEventListener("focus", function () {
            var hasAcross = !!(d.links.across.prev || d.links.across.next);
            var hasDown = !!(d.links.down.prev || d.links.down.next);
            if (hasAcross && !hasDown) activeDir = "across";
            else if (!hasAcross && hasDown) activeDir = "down";
            updateWordHL();
          });

          input.addEventListener("blur", function () {
            setTimeout(function () {
              if (!gridEl.contains(document.activeElement)) clearHL();
            }, 0);
          });

          input.addEventListener("input", function (e) {
            var v = (e.target.value || "").replace(/[^A-Za-z]/g, "").toUpperCase();
            if (v.length > 1) v = v.slice(-1);
            e.target.value = v;
            cellDiv.classList.remove("correct", "wrong");
            updateSolvedStateForCell(d);
            emitCompletionIfNeeded("input");
            if (v) {
              var nxt = step(d, activeDir, true);
              if (nxt) focusCell(nxt.r, nxt.c);
            }
          });

          input.addEventListener("paste", function (e) {
            var text = (e.clipboardData || window.clipboardData).getData("text") || "";
            var letters = text.toUpperCase().replace(/[^A-Z]/g, "").split("");
            if (letters.length === 0) return;
            e.preventDefault();
            var cur = d;
            var li;
            for (li = 0; li < letters.length; li++) {
              if (!cur) break;
              cur.input.value = letters[li];
              cur.input.parentElement.classList.remove("correct", "wrong");
              updateSolvedStateForCell(cur);
              cur = step(cur, activeDir, true);
            }
            emitCompletionIfNeeded("paste");
            if (cur) focusCell(cur.r, cur.c);
          });

          if (enableKeyboard) {
            input.addEventListener("keydown", function (e) {
              var moveTo = function (t) { if (!t) return; focusCell(t.r, t.c); };
              if (e.key === "ArrowLeft") { e.preventDefault(); activeDir = "across"; moveTo(step(d, "across", false)); return; }
              if (e.key === "ArrowRight") { e.preventDefault(); activeDir = "across"; moveTo(step(d, "across", true)); return; }
              if (e.key === "ArrowUp") { e.preventDefault(); activeDir = "down"; moveTo(step(d, "down", false)); return; }
              if (e.key === "ArrowDown") { e.preventDefault(); activeDir = "down"; moveTo(step(d, "down", true)); return; }
              if (e.key === "Tab") {
                e.preventDefault();
                var forward = !e.shiftKey;
                var t = step(d, activeDir, forward);
                if (t) moveTo(t);
                return;
              }
              if (e.key === "Backspace" && !e.target.value) {
                var tb = step(d, activeDir, false);
                if (tb) { e.preventDefault(); moveTo(tb); }
              }
            });
          }
        })(d, input, cellDiv);

        if (d.num) {
          var numDiv = document.createElement("div");
          numDiv.className = "num";
          numDiv.textContent = d.num;
          cellDiv.appendChild(numDiv);
        }
        cellDiv.appendChild(input);
        gridEl.appendChild(cellDiv);
      }
    }

    /* Clue lists */

    function putClues(ol, list) {
      var i, ent, li;
      for (i = 0; i < list.length; i++) {
        ent = list[i];
        li = document.createElement("li");
        li.setAttribute("data-entry-id", ent.id);
        li.textContent = ent.num + ". " + sanitizeClue(ent.clue) + " (" + ent.answer.length + ")";

        (function (ent, li) {
          li.addEventListener("mouseenter", function () { clearHL(); addHL([ent.id]); });
          li.addEventListener("mouseleave", function () { clearHL(); });
          li.addEventListener("click", function (e) {
            e.preventDefault();
            var cells = cellsById[ent.id] || [];
            if (!cells.length) return;
            activeDir = ent.dir;
            var first = cells[0];
            first.input.focus();
            first.input.select();
            first.el.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
            clearHL();
            addHL([ent.id]);
          });
        })(ent, li);

        if (enableHints) {
          attachHints(li, ent);
        }
        clueById[ent.id] = li;
        ol.appendChild(li);
      }
    }

    putClues(acrossOl, across);
    putClues(downOl, down);

    /* Check / Reveal buttons */

    var revealed = false;

    var revealAll = function () {
      var ri, ci2, d2;
      for (ri = 0; ri < model.length; ri++) {
        for (ci2 = 0; ci2 < model[ri].length; ci2++) {
          d2 = model[ri][ci2];
          if (d2.block) continue;
          d2.prev = d2.input.value || "";
          d2.input.value = d2.sol;
          d2.input.parentElement.classList.remove("wrong");
          d2.input.parentElement.classList.add("correct");
        }
      }
      updateAllSolvedStates();
      statusEl.textContent = "Revealed.";
      statusEl.classList.remove("ok");
    };

    var hideAll = function () {
      var ri, ci2, d2;
      for (ri = 0; ri < model.length; ri++) {
        for (ci2 = 0; ci2 < model[ri].length; ci2++) {
          d2 = model[ri][ci2];
          if (d2.block) continue;
          d2.input.value = d2.prev || "";
          d2.input.parentElement.classList.remove("correct", "wrong");
        }
      }
      updateAllSolvedStates();
      statusEl.textContent = "";
      statusEl.classList.remove("ok");
    };

    if (this._checkBtn) {
      var checkHandler = function () {
        var allCorrect = true;
        var ri, ci2, d2, v;
        for (ri = 0; ri < model.length; ri++) {
          for (ci2 = 0; ci2 < model[ri].length; ci2++) {
            d2 = model[ri][ci2];
            if (d2.block) continue;
            v = (d2.input.value || "").toUpperCase();
            d2.input.parentElement.classList.remove("correct", "wrong");
            if (!v || v !== d2.sol) { allCorrect = false; if (v) d2.input.parentElement.classList.add("wrong"); }
            else d2.input.parentElement.classList.add("correct");
          }
        }
        statusEl.textContent = allCorrect ? "All correct \u2014 nice!" : "Checked.";
        if (allCorrect) {
          statusEl.classList.add("ok");
          launchConfetti(gridEl.parentElement);
          emitCompletionIfNeeded("check");
        } else {
          statusEl.classList.remove("ok");
        }
      };
      this._checkBtn.onclick = checkHandler;
    }

    if (this._revealBtn) {
      var revealBtnRef = this._revealBtn;
      revealBtnRef.textContent = "Reveal";
      revealBtnRef.onclick = function () {
        revealed = !revealed;
        if (revealed) { emitRevealIfNeeded(); revealAll(); revealBtnRef.textContent = "Hide"; }
        else { hideAll(); revealBtnRef.textContent = "Reveal"; }
      };
    }
  };

  /* ── loadPuzzles(puzzlesArray) ────────────────────────────────────── */

  CrosswordWidget.prototype.loadPuzzles = function (puzzlesArray) {
    if (this._destroyed) return;

    if (!Array.isArray(puzzlesArray)) throw new Error(errorInvalidDataMessage);

    var self = this;
    var generatedPuzzles = [];
    var i, spec, puzzle, optionEl;

    for (i = 0; i < puzzlesArray.length; i++) {
      spec = puzzlesArray[i];
      if (!validatePuzzleSpecification(spec)) throw new Error(errorInvalidSpecificationMessage);
      puzzle = window.generateCrossword(
        spec.items,
        { title: spec.title, subtitle: spec.subtitle }
      );
      validatePayload(puzzle);
      generatedPuzzles.push(puzzle);
    }

    this._puzzles = generatedPuzzles;

    // Populate dropdown if selector is shown
    if (this._selectEl) {
      this._selectEl.innerHTML = "";
      for (i = 0; i < generatedPuzzles.length; i++) {
        optionEl = document.createElement("option");
        optionEl.value = String(i);
        optionEl.textContent = generatedPuzzles[i].title;
        this._selectEl.appendChild(optionEl);
      }

      var selectHandler = function (event) {
        var idx = Number(event.target.value);
        if (generatedPuzzles[idx]) {
          self.render(generatedPuzzles[idx]);
        }
      };
      this._selectEl.addEventListener("change", selectHandler);
      this._boundHandlers.push({ el: this._selectEl, ev: "change", fn: selectHandler, opts: undefined });

      this._selectEl.value = "0";
    }

    // Render the first puzzle
    if (generatedPuzzles.length > 0) {
      this.render(generatedPuzzles[0]);
    }
  };

  /* ── destroy() ───────────────────────────────────────────────────── */

  CrosswordWidget.prototype.destroy = function () {
    if (this._destroyed) return;
    this._destroyed = true;

    // Remove per-render event handlers
    var i;
    for (i = 0; i < this._boundHandlers.length; i++) {
      var h = this._boundHandlers[i];
      h.el.removeEventListener(h.ev, h.fn, h.opts);
    }
    this._boundHandlers = [];

    // Disconnect ResizeObserver
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }

    // Remove drag listeners
    if (this._dragCleanup) {
      this._dragCleanup();
      this._dragCleanup = null;
    }

    // Clear button handlers
    if (this._checkBtn) this._checkBtn.onclick = null;
    if (this._revealBtn) this._revealBtn.onclick = null;

    // Clear container
    this._container.innerHTML = "";
    this._puzzles = [];
    this._testApi = null;
  };

  /* ── Expose globally ─────────────────────────────────────────────── */

  CrosswordWidget.__test = {
    launchConfetti: launchConfetti,
    sanitizeClue: sanitizeClue,
    computeGridSize: computeGridSize,
    validatePayload: validatePayload,
    buildModel: buildModel,
    validatePuzzleSpecification: validatePuzzleSpecification,
  };

  window.CrosswordWidget = CrosswordWidget;

})();
