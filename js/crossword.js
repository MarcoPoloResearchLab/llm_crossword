/* crossword.js - main puzzle view controller */
(function () {
  "use strict";

  if (window.__LLM_CROSSWORD_MAIN_PAGE_BOOTED__) {
    return;
  }
  window.__LLM_CROSSWORD_MAIN_PAGE_BOOTED__ = true;

  if (typeof window.CrosswordWidget !== "function") {
    throw new Error("CrosswordWidget is required before crossword.js");
  }

  var _fetch = window.fetch.bind(window);
  var documentElement = document.documentElement;
  var emptyString = "";
  var cssFooterHeightProperty = "--footer-height";
  var cssHeaderHeightProperty = "--header-height";
  var cssViewportHeightProperty = "--viewport-height";
  var defaultFooterHeight = 40;
  var defaultHeaderHeight = 56;
  var puzzleDataPath = "assets/data/crosswords.json";
  var sharedPuzzleFallbackTitle = "Shared Crossword";
  var sharedPuzzleQueryParam = "puzzle";
  var sidebarCollapsedStorageKey = "llm-crossword-sidebar-collapsed";

  var elements = {
    acrossOl: document.getElementById("across"),
    cardList: document.getElementById("puzzleCardList"),
    checkBtn: document.getElementById("check"),
    downOl: document.getElementById("down"),
    descriptionContent: document.getElementById("descriptionContent"),
    descriptionPanel: document.getElementById("descriptionPanel"),
    descriptionToggle: document.getElementById("descriptionToggle"),
    errorBox: document.getElementById("errorBox"),
    footer: document.getElementById("page-footer"),
    generatePanel: document.getElementById("generatePanel"),
    gridEl: document.getElementById("grid"),
    gridViewport: document.getElementById("gridViewport"),
    header: document.getElementById("app-header"),
    puzzleControls: document.querySelector("#puzzleView .controls"),
    puzzlePane: document.querySelector("#puzzleView .pane"),
    puzzleView: document.getElementById("puzzleView"),
    revealBtn: document.getElementById("reveal"),
    shareBtn: document.getElementById("shareBtn"),
    sidebar: document.getElementById("puzzleSidebar"),
    sidebarToggle: document.getElementById("puzzleSidebarToggle"),
    sidebarToggleIcon: document.querySelector("#puzzleSidebarToggle .puzzle-sidebar__toggle-icon"),
    statusEl: document.getElementById("status"),
    subEl: document.getElementById("subtitle"),
    titleEl: document.getElementById("title"),
  };

  if (!elements.puzzleView || !elements.gridViewport || !elements.gridEl || !elements.acrossOl || !elements.downOl) {
    return;
  }

  var state = {
    activeCardElement: null,
    activePuzzleIndex: -1,
    allPuzzles: [],
    lastLayout: {
      footerHeight: 0,
      headerHeight: 0,
      viewportHeight: window.innerHeight,
    },
    layoutObserver: null,
    layoutObserverFooterElement: null,
    layoutObserverHeaderElement: null,
    layoutSyncQueued: false,
    layoutMutationObserver: null,
    prebuiltLoadPromise: null,
    recalculateQueued: false,
    descriptionExpanded: false,
    sidebarCollapsed: false,
  };

  var widget = new window.CrosswordWidget(null, {
    hints: true,
    responsive: true,
    draggable: true,
    keyboard: true,
    showTitle: false,
    showControls: false,
    showSelector: false,
    _existingElements: {
      acrossOl: elements.acrossOl,
      checkBtn: elements.checkBtn,
      downOl: elements.downOl,
      errorBox: elements.errorBox,
      gridEl: elements.gridEl,
      gridViewport: elements.gridViewport,
      revealBtn: elements.revealBtn,
      statusEl: elements.statusEl,
    },
  });

  function getHeaderElement() {
    return document.querySelector("#app-header .mpr-header") || elements.header;
  }

  function getFooterElement() {
    return document.querySelector("#page-footer footer.mpr-footer") || elements.footer;
  }

  function readElementHeight(element) {
    if (!element) return 0;
    return Math.round(element.getBoundingClientRect().height);
  }

  function readCssPixelValue(propertyName, fallbackValue) {
    var parsedValue = parseFloat(getComputedStyle(documentElement).getPropertyValue(propertyName));
    return isFinite(parsedValue) && parsedValue > 0 ? Math.round(parsedValue) : fallbackValue;
  }

  function normalizeShellHeight(measuredHeight, previousHeight, fallbackHeight) {
    if (measuredHeight > 0) return measuredHeight;
    if (previousHeight > 0) return previousHeight;
    return fallbackHeight;
  }

  function applyLayoutMetrics() {
    var nextLayout = {
      footerHeight: normalizeShellHeight(
        readElementHeight(getFooterElement()),
        state.lastLayout.footerHeight,
        readCssPixelValue(cssFooterHeightProperty, defaultFooterHeight)
      ),
      headerHeight: normalizeShellHeight(
        readElementHeight(getHeaderElement()),
        state.lastLayout.headerHeight,
        readCssPixelValue(cssHeaderHeightProperty, defaultHeaderHeight)
      ),
      viewportHeight: window.innerHeight,
    };

    if (
      nextLayout.footerHeight === state.lastLayout.footerHeight &&
      nextLayout.headerHeight === state.lastLayout.headerHeight &&
      nextLayout.viewportHeight === state.lastLayout.viewportHeight
    ) {
      return;
    }

    state.lastLayout = nextLayout;
    documentElement.style.setProperty(cssFooterHeightProperty, nextLayout.footerHeight + "px");
    documentElement.style.setProperty(cssHeaderHeightProperty, nextLayout.headerHeight + "px");
    documentElement.style.setProperty(cssViewportHeightProperty, nextLayout.viewportHeight + "px");
  }

  function scheduleLayoutSync() {
    if (state.layoutSyncQueued) return;
    state.layoutSyncQueued = true;
    requestAnimationFrame(function () {
      state.layoutSyncQueued = false;
      applyLayoutMetrics();
    });
  }

  function scheduleRecalculate() {
    if (state.recalculateQueued) return;
    state.recalculateQueued = true;
    requestAnimationFrame(function () {
      state.recalculateQueued = false;
      widget.recalculate();
    });
  }

  function readStoredSidebarCollapsed() {
    var storedValue;

    try {
      storedValue = window.localStorage.getItem(sidebarCollapsedStorageKey);
    } catch {}

    return storedValue === "true";
  }

  function persistSidebarCollapsed() {
    try {
      window.localStorage.setItem(sidebarCollapsedStorageKey, state.sidebarCollapsed ? "true" : "false");
    } catch {}
  }

  function applySidebarState() {
    var isCollapsed = !!state.sidebarCollapsed;
    var toggleLabel;
    var toggleIcon;

    if (!elements.puzzleView || !elements.sidebar || !elements.sidebarToggle) return;

    toggleLabel = isCollapsed ? "Expand puzzle list" : "Collapse puzzle list";
    toggleIcon = isCollapsed ? "\u203A" : "\u2039";

    elements.puzzleView.setAttribute("data-sidebar-collapsed", isCollapsed ? "true" : "false");
    elements.sidebar.setAttribute("data-collapsed", isCollapsed ? "true" : "false");
    elements.sidebarToggle.setAttribute("aria-expanded", isCollapsed ? "false" : "true");
    elements.sidebarToggle.setAttribute("aria-label", toggleLabel);
    elements.sidebarToggle.setAttribute("title", toggleLabel);

    if (elements.sidebarToggleIcon) {
      elements.sidebarToggleIcon.textContent = toggleIcon;
    } else {
      elements.sidebarToggle.textContent = toggleIcon;
    }

    persistSidebarCollapsed();
    scheduleLayoutSync();
    scheduleRecalculate();
  }

  function setSidebarCollapsed(nextValue) {
    state.sidebarCollapsed = !!nextValue;
    applySidebarState();
  }

  function toggleSidebarCollapsed() {
    setSidebarCollapsed(!state.sidebarCollapsed);
  }

  function setActiveCard(cardElement) {
    var cards = elements.puzzleView.querySelectorAll(".puzzle-card");
    var index;

    for (index = 0; index < cards.length; index++) {
      cards[index].classList.remove("puzzle-card--active");
    }

    state.activeCardElement = cardElement || null;
    if (state.activeCardElement) {
      state.activeCardElement.classList.add("puzzle-card--active");
    }
  }

  function renderMiniGrid(entries) {
    var minRow = Infinity;
    var minCol = Infinity;
    var maxRow = -1;
    var maxCol = -1;
    var entryIndex;
    var entry;
    var rowIndex;
    var columnIndex;
    var lengthIndex;

    for (entryIndex = 0; entryIndex < entries.length; entryIndex++) {
      entry = entries[entryIndex];
      minRow = Math.min(minRow, entry.row);
      minCol = Math.min(minCol, entry.col);
      if (entry.dir === "across") {
        maxRow = Math.max(maxRow, entry.row);
        maxCol = Math.max(maxCol, entry.col + entry.answer.length - 1);
      } else {
        maxRow = Math.max(maxRow, entry.row + entry.answer.length - 1);
        maxCol = Math.max(maxCol, entry.col);
      }
    }

    if (!isFinite(minRow)) return document.createElement("div");

    var rows = maxRow - minRow + 1;
    var cols = maxCol - minCol + 1;
    var occupied = [];

    for (rowIndex = 0; rowIndex < rows; rowIndex++) {
      occupied[rowIndex] = [];
      for (columnIndex = 0; columnIndex < cols; columnIndex++) {
        occupied[rowIndex][columnIndex] = false;
      }
    }

    for (entryIndex = 0; entryIndex < entries.length; entryIndex++) {
      entry = entries[entryIndex];
      for (lengthIndex = 0; lengthIndex < entry.answer.length; lengthIndex++) {
        if (entry.dir === "across") {
          occupied[entry.row - minRow][entry.col - minCol + lengthIndex] = true;
        } else {
          occupied[entry.row - minRow + lengthIndex][entry.col - minCol] = true;
        }
      }
    }

    var thumbSize = 36;
    var gapSize = 1;
    var cellWidth = Math.floor((thumbSize - (cols - 1) * gapSize) / cols);
    var cellHeight = Math.floor((thumbSize - (rows - 1) * gapSize) / rows);
    var cellSize = Math.max(1, Math.min(cellWidth, cellHeight));
    var element = document.createElement("div");

    element.className = "mini-grid";
    element.style.gridTemplateColumns = "repeat(" + cols + ", " + cellSize + "px)";
    element.style.gridTemplateRows = "repeat(" + rows + ", " + cellSize + "px)";

    for (rowIndex = 0; rowIndex < rows; rowIndex++) {
      for (columnIndex = 0; columnIndex < cols; columnIndex++) {
        var cell = document.createElement("div");
        cell.className = "mini-grid__cell " + (occupied[rowIndex][columnIndex] ? "mini-grid__cell--letter" : "mini-grid__cell--blank");
        element.appendChild(cell);
      }
    }

    return element;
  }

  function createPuzzleCard(puzzle, index) {
    var card = document.createElement("div");
    var thumb = document.createElement("div");
    var title = document.createElement("div");

    card.className = "puzzle-card";
    card.dataset.puzzleIndex = String(index);

    thumb.className = "puzzle-card__thumb";
    thumb.appendChild(renderMiniGrid(puzzle.entries));

    title.className = "puzzle-card__title";
    title.textContent = puzzle.title;

    card.appendChild(thumb);
    card.appendChild(title);
    return card;
  }

  function notifyShareToken(puzzle) {
    var token = (puzzle && puzzle.shareToken) || null;

    if (elements.shareBtn) {
      elements.shareBtn.style.display = token ? "" : "none";
    }

    window.dispatchEvent(new CustomEvent("crossword:share-token", {
      detail: token,
    }));
  }

  function updatePuzzleMetadata(puzzle) {
    if (elements.titleEl) {
      elements.titleEl.textContent = puzzle.title || "Crossword";
    }
    if (elements.subEl) {
      elements.subEl.textContent = puzzle.subtitle || emptyString;
    }
    updatePuzzleDescription(puzzle.description || emptyString);
  }

  function setDescriptionExpanded(isExpanded) {
    if (!elements.descriptionToggle || !elements.descriptionContent || !elements.descriptionPanel) return;

    state.descriptionExpanded = !!isExpanded && !elements.descriptionPanel.hidden && !!elements.descriptionContent.textContent;
    elements.descriptionToggle.textContent = state.descriptionExpanded ? "Hide details" : "Show details";
    elements.descriptionToggle.setAttribute("aria-expanded", state.descriptionExpanded ? "true" : "false");
    elements.descriptionContent.hidden = !state.descriptionExpanded;
    scheduleLayoutSync();
    scheduleRecalculate();
  }

  function updatePuzzleDescription(description) {
    var normalizedDescription = typeof description === "string" ? description.trim() : emptyString;

    if (!elements.descriptionPanel || !elements.descriptionToggle || !elements.descriptionContent) return;

    elements.descriptionContent.textContent = normalizedDescription;
    elements.descriptionPanel.hidden = normalizedDescription === emptyString;
    setDescriptionExpanded(false);
  }

  function showPuzzleBoard() {
    if (elements.generatePanel) {
      elements.generatePanel.style.display = "none";
    }
    if (elements.puzzlePane) {
      elements.puzzlePane.style.display = "";
    }
    if (elements.puzzleControls) {
      elements.puzzleControls.style.display = "";
    }
  }

  function renderPuzzle(puzzle) {
    updatePuzzleMetadata(puzzle);
    widget.render(puzzle);
    notifyShareToken(puzzle);
    scheduleLayoutSync();
    scheduleRecalculate();
  }

  function renderSidebar() {
    var puzzleIndex;
    var card;

    if (!elements.cardList) return;

    elements.cardList.innerHTML = "";
    for (puzzleIndex = 0; puzzleIndex < state.allPuzzles.length; puzzleIndex++) {
      card = createPuzzleCard(state.allPuzzles[puzzleIndex], puzzleIndex);
      elements.cardList.appendChild(card);
    }

    if (state.activePuzzleIndex >= 0 && state.activePuzzleIndex < elements.cardList.children.length) {
      setActiveCard(elements.cardList.children[state.activePuzzleIndex]);
      return;
    }

    setActiveCard(null);
  }

  function selectPuzzle(index, cardElement) {
    if (index < 0 || index >= state.allPuzzles.length) return;

    state.activePuzzleIndex = index;
    showPuzzleBoard();
    if (cardElement) {
      setActiveCard(cardElement);
    } else if (elements.cardList && index < elements.cardList.children.length) {
      setActiveCard(elements.cardList.children[index]);
    } else {
      setActiveCard(null);
    }
    renderPuzzle(state.allPuzzles[index]);
  }

  function validatePuzzleSpecification(specification) {
    var itemIndex;
    var item;

    if (!specification || typeof specification !== "object") return false;
    if (typeof specification.title !== "string" || typeof specification.subtitle !== "string") return false;
    if (specification.description != null && typeof specification.description !== "string") return false;
    if (!Array.isArray(specification.items)) return false;

    for (itemIndex = 0; itemIndex < specification.items.length; itemIndex++) {
      item = specification.items[itemIndex];
      if (typeof item.word !== "string" || typeof item.definition !== "string" || typeof item.hint !== "string") {
        return false;
      }
    }

    return true;
  }

  function buildPuzzleFromSpecification(specification) {
    return generateCrossword(specification.items, {
      title: specification.title,
      subtitle: specification.subtitle,
      description: typeof specification.description === "string" ? specification.description : emptyString,
    });
  }

  function readSharedPuzzleToken() {
    var params = new URLSearchParams(window.location.search);
    var sharedToken = params.get(sharedPuzzleQueryParam);

    if (!sharedToken) return null;

    sharedToken = sharedToken.trim();
    return sharedToken || null;
  }

  function buildSharedPuzzleFromResponse(sharedPuzzle, sharedToken) {
    var specification = {
      title:
        sharedPuzzle && typeof sharedPuzzle.title === "string" && sharedPuzzle.title.trim()
          ? sharedPuzzle.title
          : sharedPuzzleFallbackTitle,
      subtitle: sharedPuzzle && typeof sharedPuzzle.subtitle === "string" ? sharedPuzzle.subtitle : emptyString,
      description: sharedPuzzle && typeof sharedPuzzle.description === "string" ? sharedPuzzle.description : emptyString,
      items: sharedPuzzle && Array.isArray(sharedPuzzle.items) ? sharedPuzzle.items : null,
    };
    var puzzle;

    if (!validatePuzzleSpecification(specification)) {
      throw new Error("Shared crossword specification invalid");
    }

    puzzle = buildPuzzleFromSpecification(specification);
    puzzle.shareToken =
      sharedPuzzle && typeof sharedPuzzle.share_token === "string" && sharedPuzzle.share_token.trim()
        ? sharedPuzzle.share_token.trim()
        : sharedToken;
    return puzzle;
  }

  function loadSharedPuzzle(sharedToken) {
    if (!sharedToken) return Promise.resolve(null);

    return _fetch("/api/shared/" + encodeURIComponent(sharedToken))
      .then(function (response) {
        if (!response.ok) {
          throw new Error("Shared puzzle not found");
        }
        return response.json();
      })
      .then(function (sharedPuzzle) {
        return buildSharedPuzzleFromResponse(sharedPuzzle, sharedToken);
      });
  }

  function loadPrebuiltPuzzles() {
    if (state.prebuiltLoadPromise) return state.prebuiltLoadPromise;

    if (elements.statusEl) {
      elements.statusEl.textContent = "Loading puzzles...";
    }

    state.prebuiltLoadPromise = Promise.all([
      _fetch(puzzleDataPath).then(function (response) {
        return response.json();
      }),
      loadSharedPuzzle(readSharedPuzzleToken())
        .then(function (sharedPuzzle) {
          return {
            error: null,
            puzzle: sharedPuzzle,
          };
        })
        .catch(function (error) {
          return {
            error: error,
            puzzle: null,
          };
        }),
    ])
      .then(function (results) {
        var builtPuzzles = [];
        var puzzleSpecifications = results[0];
        var sharedPuzzleResult = results[1];
        var specificationIndex;
        var specification;

        if (!Array.isArray(puzzleSpecifications)) {
          throw new Error("Crossword data must be an array");
        }

        for (specificationIndex = 0; specificationIndex < puzzleSpecifications.length; specificationIndex++) {
          specification = puzzleSpecifications[specificationIndex];
          if (!validatePuzzleSpecification(specification)) {
            throw new Error("Crossword specification invalid");
          }
          builtPuzzles.push(buildPuzzleFromSpecification(specification));
        }

        state.allPuzzles = builtPuzzles;

        if (sharedPuzzleResult.puzzle) {
          state.allPuzzles.unshift(sharedPuzzleResult.puzzle);
          state.activePuzzleIndex = 0;
        } else if (sharedPuzzleResult.error) {
          state.activePuzzleIndex = -1;
          if (elements.errorBox) {
            elements.errorBox.style.display = "block";
            elements.errorBox.textContent = sharedPuzzleResult.error.message;
          }
        } else {
          state.activePuzzleIndex = builtPuzzles.length > 0 ? 0 : -1;
        }

        renderSidebar();

        if (elements.statusEl) {
          elements.statusEl.textContent = "";
        }

        if (state.activePuzzleIndex >= 0) {
          selectPuzzle(state.activePuzzleIndex);
        }

        return state.allPuzzles;
      })
      .finally(function () {
        state.prebuiltLoadPromise = null;
      });

    return state.prebuiltLoadPromise;
  }

  function addGeneratedPuzzle(puzzle) {
    if (!elements.cardList) {
      renderPuzzle(puzzle);
      return;
    }

    state.allPuzzles.unshift(puzzle);
    state.activePuzzleIndex = 0;
    showPuzzleBoard();
    renderSidebar();
    renderPuzzle(puzzle);
  }

  function handleCardListClick(event) {
    var cardElement = event.target.closest(".puzzle-card");
    var index;

    if (!cardElement || !elements.cardList || !elements.cardList.contains(cardElement)) return;

    index = Number(cardElement.dataset.puzzleIndex);
    if (isNaN(index)) return;
    selectPuzzle(index, cardElement);
  }

  function startLayoutObservers() {
    scheduleLayoutSync();
    window.addEventListener("resize", scheduleLayoutSync);
    window.addEventListener("orientationchange", scheduleLayoutSync);
    window.addEventListener("load", scheduleLayoutSync);

    if (typeof ResizeObserver !== "undefined") {
      state.layoutObserver = new ResizeObserver(function () {
        scheduleLayoutSync();
      });
      refreshObservedShellElements();
    }

    if (typeof MutationObserver !== "undefined") {
      state.layoutMutationObserver = new MutationObserver(function () {
        refreshObservedShellElements();
        scheduleLayoutSync();
      });

      if (elements.header) {
        state.layoutMutationObserver.observe(elements.header, { childList: true, subtree: true });
      }

      if (elements.footer) {
        state.layoutMutationObserver.observe(elements.footer, { childList: true, subtree: true });
      }
    }
  }

  function refreshObservedShellElements() {
    var nextHeaderElement;
    var nextFooterElement;

    if (!state.layoutObserver) return;

    nextHeaderElement = getHeaderElement();
    nextFooterElement = getFooterElement();

    if (state.layoutObserverHeaderElement !== nextHeaderElement) {
      if (state.layoutObserverHeaderElement) {
        state.layoutObserver.unobserve(state.layoutObserverHeaderElement);
      }
      state.layoutObserverHeaderElement = nextHeaderElement;
      if (state.layoutObserverHeaderElement) {
        state.layoutObserver.observe(state.layoutObserverHeaderElement);
      }
    }

    if (state.layoutObserverFooterElement !== nextFooterElement) {
      if (state.layoutObserverFooterElement) {
        state.layoutObserver.unobserve(state.layoutObserverFooterElement);
      }
      state.layoutObserverFooterElement = nextFooterElement;
      if (state.layoutObserverFooterElement) {
        state.layoutObserver.observe(state.layoutObserverFooterElement);
      }
    }
  }

  if (elements.cardList) {
    elements.cardList.addEventListener("click", handleCardListClick);
  }

  if (elements.sidebarToggle) {
    state.sidebarCollapsed = readStoredSidebarCollapsed();
    elements.sidebarToggle.addEventListener("click", function () {
      toggleSidebarCollapsed();
    });
    applySidebarState();
  }

  if (elements.descriptionToggle) {
    elements.descriptionToggle.addEventListener("click", function () {
      setDescriptionExpanded(!state.descriptionExpanded);
    });
  }

  window.CrosswordApp = {
    addGeneratedPuzzle: addGeneratedPuzzle,
    isSidebarCollapsed: function () {
      return state.sidebarCollapsed;
    },
    loadPrebuilt: loadPrebuiltPuzzles,
    recalculate: scheduleRecalculate,
    render: function (puzzle) {
      renderPuzzle(puzzle);
    },
    renderMiniGrid: renderMiniGrid,
    setActiveCard: setActiveCard,
    setSidebarCollapsed: setSidebarCollapsed,
  };

  (window.__LLM_CROSSWORD_TEST__ || (window.__LLM_CROSSWORD_TEST__ = {})).crossword = {
    addGeneratedPuzzle: addGeneratedPuzzle,
    applySidebarState: applySidebarState,
    buildSharedPuzzleFromResponse: buildSharedPuzzleFromResponse,
    handleCardListClick: handleCardListClick,
    readSharedPuzzleToken: readSharedPuzzleToken,
    refreshObservedShellElements: refreshObservedShellElements,
    setDescriptionExpanded: setDescriptionExpanded,
    setState: function (nextState) {
      Object.assign(state, nextState || {});
    },
    updatePuzzleDescription: updatePuzzleDescription,
    validatePuzzleSpecification: validatePuzzleSpecification,
  };

  startLayoutObservers();

  loadPrebuiltPuzzles().catch(function (error) {
    if (elements.errorBox) {
      elements.errorBox.style.display = "block";
      elements.errorBox.textContent = error.message;
    }
  });
})();
