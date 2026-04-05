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

  var services = window.LLMCrosswordServices || null;
  var _fetch = window.fetch.bind(window);
  var documentElement = document.documentElement;
  var emptyString = "";
  var cssCluesPanelOffsetProperty = "--clues-panel-offset";
  var cssFooterHeightProperty = "--footer-height";
  var cssHeaderHeightProperty = "--header-height";
  var cssViewportHeightProperty = "--viewport-height";
  var defaultFooterHeight = 40;
  var defaultHeaderHeight = 56;
  var puzzleDataPath = "assets/data/crosswords.json";
  var sharedPuzzleFallbackTitle = "Shared Crossword";
  var sharedPuzzleQueryParam = "puzzle";
  var sidebarCollapsedStorageKey = "llm-crossword-sidebar-collapsed";
  var defaultRewardPolicy = Object.freeze({
    owner_solve_coins: 3,
    owner_no_hint_bonus_coins: 1,
    owner_daily_solve_bonus_coins: 1,
    owner_daily_solve_bonus_limit: 3,
    creator_shared_solve_coins: 1,
    creator_shared_per_puzzle_cap: 10,
    creator_shared_daily_cap: 20,
  });

  function buildApiUrl(path) {
    if (services && typeof services.buildApiUrl === "function") {
      return services.buildApiUrl(path);
    }
    return path;
  }

  var elements = {
    acrossOl: document.getElementById("across"),
    cardList: document.getElementById("puzzleCardList"),
    checkBtn: document.getElementById("check"),
    downOl: document.getElementById("down"),
    descriptionContent: document.getElementById("descriptionContent"),
    descriptionPanel: document.getElementById("descriptionPanel"),
    errorBox: document.getElementById("errorBox"),
    footer: document.getElementById("page-footer"),
    generatePanel: document.getElementById("generatePanel"),
    gridEl: document.getElementById("grid"),
    gridViewport: document.getElementById("gridViewport"),
    header: document.getElementById("app-header"),
    puzzleToolbar: document.getElementById("puzzleToolbar"),
    puzzleControls: document.querySelector("#puzzleView .controls"),
    puzzleHeader: document.querySelector("#puzzleView .hdr"),
    puzzlePane: document.querySelector("#puzzleView .pane"),
    puzzleView: document.getElementById("puzzleView"),
    revealBtn: document.getElementById("reveal"),
    rewardStrip: document.getElementById("rewardStrip"),
    rewardStripLabel: document.getElementById("rewardStripLabel"),
    rewardStripMeta: document.getElementById("rewardStripMeta"),
    shareHint: document.getElementById("shareHint"),
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
    activePuzzleKey: null,
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
    ownedLoadPromise: null,
    recalculateQueued: false,
    loggedIn: false,
    ownedPuzzles: [],
    prebuiltPuzzles: [],
    sharedPuzzle: null,
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

  function readCluesPanelOffset() {
    var headerRect;
    var paneRect;

    if (!elements.puzzleHeader || !elements.puzzlePane || !elements.descriptionPanel || elements.descriptionPanel.hidden) {
      return 0;
    }

    headerRect = elements.puzzleHeader.getBoundingClientRect();
    paneRect = elements.puzzlePane.getBoundingClientRect();
    return Math.max(0, Math.round(paneRect.top - headerRect.top));
  }

  function applyLayoutMetrics() {
    var cluesPanelOffset = readCluesPanelOffset();
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
      documentElement.style.setProperty(cssCluesPanelOffsetProperty, cluesPanelOffset + "px");
      return;
    }

    state.lastLayout = nextLayout;
    documentElement.style.setProperty(cssCluesPanelOffsetProperty, cluesPanelOffset + "px");
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

  function coerceRewardSummary(summary) {
    if (!summary || typeof summary !== "object") return null;
    return {
      owner_reward_status: typeof summary.owner_reward_status === "string" ? summary.owner_reward_status : "practice",
      owner_reward_claim_total: Number(summary.owner_reward_claim_total || 0),
      shared_unique_solves: Number(summary.shared_unique_solves || 0),
      creator_credits_earned: Number(summary.creator_credits_earned || 0),
      creator_puzzle_cap_remaining: Number(summary.creator_puzzle_cap_remaining || 0),
      creator_daily_cap_remaining: Number(summary.creator_daily_cap_remaining || 0),
      reward_policy: coerceRewardPolicy(summary.reward_policy),
    };
  }

  function normalizePositiveInteger(value, fallbackValue) {
    var normalizedValue = Number(value);

    if (!Number.isFinite(normalizedValue) || normalizedValue <= 0) {
      return fallbackValue;
    }

    return Math.floor(normalizedValue);
  }

  function coerceRewardPolicy(policy) {
    var rawPolicy = policy && typeof policy === "object" ? policy : {};

    return {
      owner_solve_coins: normalizePositiveInteger(rawPolicy.owner_solve_coins, defaultRewardPolicy.owner_solve_coins),
      owner_no_hint_bonus_coins: normalizePositiveInteger(
        rawPolicy.owner_no_hint_bonus_coins,
        defaultRewardPolicy.owner_no_hint_bonus_coins
      ),
      owner_daily_solve_bonus_coins: normalizePositiveInteger(
        rawPolicy.owner_daily_solve_bonus_coins,
        defaultRewardPolicy.owner_daily_solve_bonus_coins
      ),
      owner_daily_solve_bonus_limit: normalizePositiveInteger(
        rawPolicy.owner_daily_solve_bonus_limit,
        defaultRewardPolicy.owner_daily_solve_bonus_limit
      ),
      creator_shared_solve_coins: normalizePositiveInteger(
        rawPolicy.creator_shared_solve_coins,
        defaultRewardPolicy.creator_shared_solve_coins
      ),
      creator_shared_per_puzzle_cap: normalizePositiveInteger(
        rawPolicy.creator_shared_per_puzzle_cap,
        defaultRewardPolicy.creator_shared_per_puzzle_cap
      ),
      creator_shared_daily_cap: normalizePositiveInteger(
        rawPolicy.creator_shared_daily_cap,
        defaultRewardPolicy.creator_shared_daily_cap
      ),
    };
  }

  function getRewardPolicy(summary) {
    return summary && summary.reward_policy ? summary.reward_policy : defaultRewardPolicy;
  }

  function formatCreditsLabel(credits) {
    return credits + " credit" + (credits === 1 ? "" : "s");
  }

  function ensurePuzzleKey(puzzle, fallbackPrefix, fallbackIndex) {
    if (!puzzle || typeof puzzle !== "object") return fallbackPrefix + ":" + fallbackIndex;
    if (puzzle.puzzleKey) return puzzle.puzzleKey;
    if (puzzle.id) {
      puzzle.puzzleKey = String(puzzle.id);
      return puzzle.puzzleKey;
    }
    puzzle.puzzleKey = fallbackPrefix + ":" + fallbackIndex;
    return puzzle.puzzleKey;
  }

  function preparePuzzle(puzzle, source, fallbackIndex) {
    if (!puzzle || typeof puzzle !== "object") return null;
    puzzle.source = source || puzzle.source || "practice";
    puzzle.rewardSummary = coerceRewardSummary(puzzle.rewardSummary || puzzle.reward_summary);
    ensurePuzzleKey(puzzle, puzzle.source, fallbackIndex);
    return puzzle;
  }

  function buildStoredPuzzleFromResponse(rawPuzzle, fallbackSource, fallbackIndex) {
    var specification;
    var puzzle;

    specification = {
      title: rawPuzzle && typeof rawPuzzle.title === "string" ? rawPuzzle.title : "Crossword",
      subtitle: rawPuzzle && typeof rawPuzzle.subtitle === "string" ? rawPuzzle.subtitle : emptyString,
      description: rawPuzzle && typeof rawPuzzle.description === "string" ? rawPuzzle.description : emptyString,
      items: rawPuzzle && Array.isArray(rawPuzzle.items) ? rawPuzzle.items : null,
    };

    if (!validatePuzzleSpecification(specification)) {
      throw new Error("Crossword specification invalid");
    }

    puzzle = buildPuzzleFromSpecification(specification);
    puzzle.id = rawPuzzle && rawPuzzle.id ? String(rawPuzzle.id) : null;
    puzzle.shareToken = rawPuzzle && typeof rawPuzzle.share_token === "string" ? rawPuzzle.share_token : null;
    puzzle.source = rawPuzzle && typeof rawPuzzle.source === "string" ? rawPuzzle.source : fallbackSource;
    puzzle.rewardSummary = coerceRewardSummary(rawPuzzle && rawPuzzle.reward_summary);
    ensurePuzzleKey(puzzle, puzzle.source || fallbackSource || "stored", fallbackIndex);
    return puzzle;
  }

  function getVisiblePuzzles() {
    var visiblePuzzles = [];
    var index;

    if (state.sharedPuzzle) {
      visiblePuzzles.push(state.sharedPuzzle);
    }
    for (index = 0; index < state.ownedPuzzles.length; index++) {
      visiblePuzzles.push(state.ownedPuzzles[index]);
    }
    for (index = 0; index < state.prebuiltPuzzles.length; index++) {
      visiblePuzzles.push(state.prebuiltPuzzles[index]);
    }
    return visiblePuzzles;
  }

  function findPuzzleIndexByKey(puzzleKey) {
    var visiblePuzzles = state.allPuzzles;
    var index;
    for (index = 0; index < visiblePuzzles.length; index++) {
      if (visiblePuzzles[index] && visiblePuzzles[index].puzzleKey === puzzleKey) {
        return index;
      }
    }
    return -1;
  }

  function findPuzzleByKey(puzzleKey) {
    var puzzleIndex = findPuzzleIndexByKey(puzzleKey);
    return puzzleIndex >= 0 ? state.allPuzzles[puzzleIndex] : null;
  }

  function setActivePuzzleByKey(puzzleKey) {
    state.activePuzzleKey = puzzleKey || null;
    state.activePuzzleIndex = state.activePuzzleKey ? findPuzzleIndexByKey(state.activePuzzleKey) : -1;
  }

  function rebuildVisiblePuzzles() {
    var nextPuzzles = getVisiblePuzzles();
    var activeIndex;

    state.allPuzzles = nextPuzzles;
    if (nextPuzzles.length === 0) {
      state.activePuzzleKey = null;
      state.activePuzzleIndex = -1;
      return;
    }
    activeIndex = state.activePuzzleKey ? findPuzzleIndexByKey(state.activePuzzleKey) : -1;
    if (activeIndex < 0 && nextPuzzles.length > 0) {
      setActivePuzzleByKey(nextPuzzles[0].puzzleKey);
      return;
    }
    state.activePuzzleIndex = activeIndex;
  }

  function replacePuzzleById(collection, puzzle) {
    var nextCollection = [];
    var replaced = false;
    var index;

    for (index = 0; index < collection.length; index++) {
      if (puzzle.id && collection[index].id === puzzle.id) {
        nextCollection.push(puzzle);
        replaced = true;
      } else {
        nextCollection.push(collection[index]);
      }
    }

    if (!replaced) {
      nextCollection.unshift(puzzle);
    }
    return nextCollection;
  }

  function buildCardDescription(puzzle) {
    if (!puzzle) return emptyString;
    if (typeof puzzle.description === "string" && puzzle.description.trim()) {
      return puzzle.description.trim();
    }
    if (typeof puzzle.subtitle === "string" && puzzle.subtitle.trim()) {
      return puzzle.subtitle.trim();
    }
    return emptyString;
  }

  function createPuzzleCard(puzzle) {
    var card = document.createElement("div");
    var thumb = document.createElement("div");
    var copy = document.createElement("div");
    var title = document.createElement("div");
    var description = document.createElement("div");

    card.className = "puzzle-card";
    card.dataset.puzzleKey = puzzle.puzzleKey;

    thumb.className = "puzzle-card__thumb";
    thumb.appendChild(renderMiniGrid(puzzle.entries));

    copy.className = "puzzle-card__copy";

    title.className = "puzzle-card__title";
    title.textContent = puzzle.title;

    description.className = "puzzle-card__description";
    description.textContent = buildCardDescription(puzzle);

    copy.appendChild(title);
    copy.appendChild(description);

    card.appendChild(thumb);
    card.appendChild(copy);
    return card;
  }

  function renderSidebarSection(title, puzzles) {
    var section = document.createElement("section");
    var heading = document.createElement("div");
    var list = document.createElement("div");
    var puzzleIndex;

    section.className = "puzzle-sidebar__section";
    heading.className = "puzzle-sidebar__section-title";
    heading.textContent = title;
    list.className = "puzzle-card-list";

    for (puzzleIndex = 0; puzzleIndex < puzzles.length; puzzleIndex++) {
      list.appendChild(createPuzzleCard(puzzles[puzzleIndex]));
    }

    section.appendChild(heading);
    section.appendChild(list);
    return section;
  }

  function notifyShareToken(puzzle) {
    var token = (puzzle && puzzle.shareToken) || null;

    if (elements.shareBtn) {
      elements.shareBtn.style.display = "";
      elements.shareBtn.disabled = !token;
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
    void isExpanded;
    scheduleLayoutSync();
    scheduleRecalculate();
  }

  function updatePuzzleDescription(description) {
    var normalizedDescription = typeof description === "string" ? description.trim() : emptyString;

    if (!elements.descriptionPanel || !elements.descriptionContent) return;

    elements.descriptionContent.textContent = normalizedDescription;
    elements.descriptionContent.hidden = normalizedDescription === emptyString;
    elements.descriptionPanel.hidden = normalizedDescription === emptyString;
    scheduleLayoutSync();
    scheduleRecalculate();
  }

  function updateRewardUI(puzzle) {
    var rewardPolicy;
    var rewardSummary = puzzle && puzzle.rewardSummary;
    var label = "";
    var meta = "";

    if (!elements.rewardStrip || !elements.rewardStripLabel || !elements.rewardStripMeta) return;
    if (!puzzle) {
      elements.rewardStrip.hidden = true;
      return;
    }

    rewardPolicy = getRewardPolicy(rewardSummary);

    if (puzzle.source === "owned") {
      if (rewardSummary && rewardSummary.owner_reward_status === "claimed") {
        label = "Reward claimed";
        meta = rewardSummary.owner_reward_claim_total > 0
          ? "You earned " + rewardSummary.owner_reward_claim_total + " credits. Shared solves: " +
            rewardSummary.shared_unique_solves + ". Creator credits earned: " +
            rewardSummary.creator_credits_earned + "."
          : "This puzzle has already recorded its solve outcome.";
      } else if (rewardSummary && rewardSummary.owner_reward_status === "ineligible") {
        label = "Reward unavailable";
        meta = "This puzzle no longer qualifies for solve credits.";
      } else {
        label = "Solve to earn credits";
        meta = "Base reward: " + rewardPolicy.owner_solve_coins + " credits. No hints: +" +
          rewardPolicy.owner_no_hint_bonus_coins + ". First " + rewardPolicy.owner_daily_solve_bonus_limit +
          " owner solves each UTC day: +" + rewardPolicy.owner_daily_solve_bonus_coins + ".";
      }
      if (rewardSummary && rewardSummary.owner_reward_status !== "claimed") {
        meta += " Shared solves: " + rewardSummary.shared_unique_solves + ". Creator credits earned: " +
          rewardSummary.creator_credits_earned + ".";
      }
    } else if (puzzle.source === "shared") {
      if (!state.loggedIn) {
        label = "Shared puzzle";
        meta = "Sign in if you want your solve to support the creator.";
      } else {
        label = "Support the creator";
        meta = "Finish without Reveal and your solve can give the creator " +
          formatCreditsLabel(rewardPolicy.creator_shared_solve_coins) + ".";
      }
    } else {
      label = "Practice puzzle";
      meta = "Prebuilt puzzles are for practice and do not affect credits.";
    }

    elements.rewardStripLabel.textContent = label;
    elements.rewardStripMeta.textContent = meta;
    elements.rewardStrip.hidden = false;
  }

  function updateShareHint(puzzle) {
    var rewardPolicy;

    if (!elements.shareHint) return;
    if (!puzzle || !puzzle.shareToken) {
      elements.shareHint.hidden = true;
      elements.shareHint.textContent = "";
      return;
    }

    rewardPolicy = getRewardPolicy(puzzle.rewardSummary);

    if (puzzle.source === "owned") {
      elements.shareHint.textContent =
        "Share to earn up to " + rewardPolicy.creator_shared_per_puzzle_cap + " credits from unique signed-in solvers. " +
        "Shared solves: " + (puzzle.rewardSummary ? puzzle.rewardSummary.shared_unique_solves : 0) + ". " +
        "Creator credits earned: " + (puzzle.rewardSummary ? puzzle.rewardSummary.creator_credits_earned : 0) + ". " +
        "Puzzle cap left: " + (
          puzzle.rewardSummary ? puzzle.rewardSummary.creator_puzzle_cap_remaining : rewardPolicy.creator_shared_per_puzzle_cap
        ) + ".";
      elements.shareHint.hidden = false;
      return;
    }

    elements.shareHint.hidden = true;
    elements.shareHint.textContent = "";
  }

  function showPuzzleBoard() {
    if (elements.generatePanel) {
      elements.generatePanel.style.display = "none";
    }
    if (elements.puzzleToolbar) {
      elements.puzzleToolbar.hidden = false;
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
    updateRewardUI(puzzle);
    updateShareHint(puzzle);
    widget.render(puzzle);
    notifyShareToken(puzzle);
    window.dispatchEvent(new CustomEvent("crossword:active-puzzle", {
      detail: puzzle,
    }));
    scheduleLayoutSync();
    scheduleRecalculate();
  }

  function renderSidebar() {
    if (!elements.cardList) return;

    elements.cardList.innerHTML = "";
    if (state.sharedPuzzle) {
      elements.cardList.appendChild(renderSidebarSection("Shared with you", [state.sharedPuzzle]));
    }
    if (state.loggedIn && state.ownedPuzzles.length > 0) {
      elements.cardList.appendChild(renderSidebarSection("My Section", state.ownedPuzzles));
    }
    if (state.prebuiltPuzzles.length > 0) {
      elements.cardList.appendChild(renderSidebarSection("Practice Session", state.prebuiltPuzzles));
    }

    if (state.activePuzzleKey) {
      setActiveCard(elements.cardList.querySelector('[data-puzzle-key="' + state.activePuzzleKey + '"]'));
    } else {
      setActiveCard(null);
    }
  }

  function selectPuzzleByKey(puzzleKey, cardElement) {
    var puzzleIndex = findPuzzleIndexByKey(puzzleKey);
    if (puzzleIndex < 0 || puzzleIndex >= state.allPuzzles.length) return;

    setActivePuzzleByKey(puzzleKey);
    showPuzzleBoard();
    if (cardElement) {
      setActiveCard(cardElement);
    } else {
      setActiveCard(elements.cardList.querySelector('[data-puzzle-key="' + puzzleKey + '"]'));
    }
    renderPuzzle(state.allPuzzles[puzzleIndex]);
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
    function createDeterministicLayoutRandom() {
      var state = 1;

      return function () {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 4294967296;
      };
    }

    return generateCrossword(specification.items, {
      title: specification.title,
      subtitle: specification.subtitle,
      description: typeof specification.description === "string" ? specification.description : emptyString,
      random: createDeterministicLayoutRandom(),
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
    puzzle.id = sharedPuzzle && sharedPuzzle.id ? String(sharedPuzzle.id) : null;
    puzzle.shareToken =
      sharedPuzzle && typeof sharedPuzzle.share_token === "string" && sharedPuzzle.share_token.trim()
        ? sharedPuzzle.share_token.trim()
        : sharedToken;
    puzzle.source = sharedPuzzle && typeof sharedPuzzle.source === "string" ? sharedPuzzle.source : "shared";
    puzzle.rewardSummary = coerceRewardSummary(sharedPuzzle && sharedPuzzle.reward_summary);
    ensurePuzzleKey(puzzle, "shared", 0);
    return puzzle;
  }

  function loadSharedPuzzle(sharedToken) {
    if (!sharedToken) return Promise.resolve(null);

    return _fetch(buildApiUrl("/api/shared/" + encodeURIComponent(sharedToken)))
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
          builtPuzzles.push(preparePuzzle(buildPuzzleFromSpecification(specification), "prebuilt", specificationIndex));
        }

        state.prebuiltPuzzles = builtPuzzles;

        if (sharedPuzzleResult.puzzle) {
          state.sharedPuzzle = sharedPuzzleResult.puzzle;
        } else if (sharedPuzzleResult.error) {
          state.sharedPuzzle = null;
          if (elements.errorBox) {
            elements.errorBox.style.display = "block";
            elements.errorBox.textContent = sharedPuzzleResult.error.message;
          }
        }

        rebuildVisiblePuzzles();
        renderSidebar();

        if (elements.statusEl) {
          elements.statusEl.textContent = "";
        }

        if (state.activePuzzleIndex >= 0) {
          selectPuzzleByKey(state.allPuzzles[state.activePuzzleIndex].puzzleKey);
        }

        if (sharedPuzzleResult.error && elements.errorBox) {
          elements.errorBox.style.display = "block";
          elements.errorBox.textContent = sharedPuzzleResult.error.message;
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

    preparePuzzle(puzzle, "owned", state.ownedPuzzles.length);
    state.ownedPuzzles = replacePuzzleById(state.ownedPuzzles, puzzle);
    state.loggedIn = true;
    setActivePuzzleByKey(puzzle.puzzleKey);
    rebuildVisiblePuzzles();
    showPuzzleBoard();
    renderSidebar();
    renderPuzzle(puzzle);
  }

  function loadOwnedPuzzles() {
    if (!state.loggedIn) {
      state.ownedPuzzles = [];
      rebuildVisiblePuzzles();
      renderSidebar();
      return Promise.resolve([]);
    }

    if (state.ownedLoadPromise) return state.ownedLoadPromise;

    state.ownedLoadPromise = _fetch(buildApiUrl("/api/puzzles"), {
      credentials: "include",
    })
      .then(function (response) {
        if (!response.ok) {
          throw new Error("Failed to load your puzzles");
        }
        return response.json();
      })
      .then(function (payload) {
        var puzzles = payload && Array.isArray(payload.puzzles) ? payload.puzzles : [];
        var builtPuzzles = [];
        var puzzleIndex;

        for (puzzleIndex = 0; puzzleIndex < puzzles.length; puzzleIndex++) {
          builtPuzzles.push(buildStoredPuzzleFromResponse(puzzles[puzzleIndex], "owned", puzzleIndex));
        }

        state.ownedPuzzles = builtPuzzles;
        rebuildVisiblePuzzles();
        renderSidebar();
        return builtPuzzles;
      })
      .finally(function () {
        state.ownedLoadPromise = null;
      });

    return state.ownedLoadPromise;
  }

  function clearOwnedPuzzles() {
    state.loggedIn = false;
    state.ownedPuzzles = [];
    rebuildVisiblePuzzles();
    renderSidebar();
    updateRewardUI(findPuzzleByKey(state.activePuzzleKey));
  }

  function updatePuzzleRewardData(puzzleId, rewardSummary) {
    var index;
    var nextRewardSummary = coerceRewardSummary(rewardSummary);
    var activePuzzle;

    if (!puzzleId || !nextRewardSummary) return;

    for (index = 0; index < state.ownedPuzzles.length; index++) {
      if (state.ownedPuzzles[index].id === puzzleId) {
        state.ownedPuzzles[index].rewardSummary = nextRewardSummary;
      }
    }
    if (state.sharedPuzzle && state.sharedPuzzle.id === puzzleId) {
      state.sharedPuzzle.rewardSummary = nextRewardSummary;
    }
    rebuildVisiblePuzzles();
    renderSidebar();
    activePuzzle = findPuzzleByKey(state.activePuzzleKey);
    updateRewardUI(activePuzzle);
    updateShareHint(activePuzzle);
  }

  function handleCardListClick(event) {
    var cardElement = event.target.closest(".puzzle-card");
    var puzzleKey;

    if (!cardElement || !elements.cardList || !elements.cardList.contains(cardElement)) return;

    puzzleKey = cardElement.dataset.puzzleKey;
    if (!puzzleKey) return;
    selectPuzzleByKey(puzzleKey, cardElement);
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

  window.CrosswordApp = {
    addGeneratedPuzzle: addGeneratedPuzzle,
    clearOwnedPuzzles: clearOwnedPuzzles,
    getActivePuzzle: function () {
      return findPuzzleByKey(state.activePuzzleKey);
    },
    isSidebarCollapsed: function () {
      return state.sidebarCollapsed;
    },
    loadOwnedPuzzles: loadOwnedPuzzles,
    loadPrebuilt: loadPrebuiltPuzzles,
    recalculate: scheduleRecalculate,
    render: function (puzzle) {
      renderPuzzle(preparePuzzle(puzzle, puzzle && puzzle.source ? puzzle.source : "practice", 0));
    },
    renderMiniGrid: renderMiniGrid,
    setActiveCard: setActiveCard,
    setSidebarCollapsed: setSidebarCollapsed,
    setViewerSession: function (sessionState) {
      state.loggedIn = !!(sessionState && sessionState.loggedIn);
      if (!state.loggedIn) {
        state.ownedPuzzles = [];
      }
      rebuildVisiblePuzzles();
      renderSidebar();
      updateRewardUI(findPuzzleByKey(state.activePuzzleKey));
      updateShareHint(findPuzzleByKey(state.activePuzzleKey));
    },
    updatePuzzleRewardData: updatePuzzleRewardData,
  };

  (window.__LLM_CROSSWORD_TEST__ || (window.__LLM_CROSSWORD_TEST__ = {})).crossword = {
    addGeneratedPuzzle: addGeneratedPuzzle,
    applySidebarState: applySidebarState,
    buildCardDescription: buildCardDescription,
    buildSharedPuzzleFromResponse: buildSharedPuzzleFromResponse,
    buildStoredPuzzleFromResponse: buildStoredPuzzleFromResponse,
    clearOwnedPuzzles: clearOwnedPuzzles,
    coerceRewardSummary: coerceRewardSummary,
    createPuzzleCard: createPuzzleCard,
    ensurePuzzleKey: ensurePuzzleKey,
    handleCardListClick: handleCardListClick,
    loadOwnedPuzzles: loadOwnedPuzzles,
    preparePuzzle: preparePuzzle,
    readSharedPuzzleToken: readSharedPuzzleToken,
    refreshObservedShellElements: refreshObservedShellElements,
    renderSidebar: renderSidebar,
    selectPuzzleByKey: selectPuzzleByKey,
    setActivePuzzleByKey: setActivePuzzleByKey,
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
