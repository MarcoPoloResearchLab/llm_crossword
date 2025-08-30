/* crossword.js - renderer for array payload with explicit placements & overlaps */
(function () {
  "use strict";

  const gridViewport = document.getElementById("gridViewport");
  const gridEl   = document.getElementById("grid");
  const acrossOl = document.getElementById("across");
  const downOl   = document.getElementById("down");
  const statusEl = document.getElementById("status");
  const errorBox = document.getElementById("errorBox");
  const titleEl  = document.getElementById("title");
  const subEl    = document.getElementById("subtitle");
  const selectEl = document.getElementById("puzzleSelect");

  /** cssViewportHeightProperty holds the name of the custom property for viewport height. */
  const cssViewportHeightProperty = "--viewport-height";
  /** resizeEventName identifies the resize event. */
  const resizeEventName = "resize";
  /** orientationChangeEventName identifies the orientation change event. */
  const orientationChangeEventName = "orientationchange";
  /** viewportResizeEventNames lists events that can change the viewport height. */
  const viewportResizeEventNames = [resizeEventName, orientationChangeEventName];
  /** solvedClueClassName identifies the CSS class for solved clues. */
  const solvedClueClassName = "clueSolved";
  /** puzzleDataPath identifies the path to the crossword specifications. */
  const puzzleDataPath = "assets/data/crosswords.json";
  /** selectChangeEventName identifies the change event. */
  const selectChangeEventName = "change";
  /** clickEventName identifies the click event. */
  const clickEventName = "click";
  /** optionTagName identifies the option element tag name. */
  const optionTagName = "option";
  /** initialPuzzleIndex holds the initial puzzle selection index. */
  const initialPuzzleIndex = "0";
  /** errorInvalidSpecificationMessage describes the invalid specification error. */
  const errorInvalidSpecificationMessage = "Crossword specification invalid";
  /** errorInvalidDataMessage describes the invalid data error. */
  const errorInvalidDataMessage = "Crossword data must be an array";
  /** hintContainerTagName identifies the container element for hint controls. */
  const hintContainerTagName = "span";
  /** buttonTagName identifies the button element tag name. */
  const buttonTagName = "button";
  /** hintTextTagName identifies the verbal hint element tag name. */
  const hintTextTagName = "div";
  /** hintContainerClassName identifies the CSS class for hint container. */
  const hintContainerClassName = "hintControls";
  /** hintTextClassName identifies the CSS class for verbal hints. */
  const hintTextClassName = "hintText";
  /** hintButtonClassName identifies the CSS class for the hint button. */
  const hintButtonClassName = "hintButton";
  /** hintButtonText specifies the text for the toggle hint button. */
  const hintButtonText = "H";
  /** correctClassName identifies the CSS class for correct letters. */
  const correctClassName = "correct";
  /** hiddenStyleValue specifies the display style value to hide elements. */
  const hiddenStyleValue = "none";
  /** emptyString represents an empty string. */
  const emptyString = "";
  /** hintStageInitial identifies the initial hint state with no hint visible. */
  const hintStageInitial = 0;
  /** hintStageVerbal identifies the state where the verbal hint is displayed. */
  const hintStageVerbal = 1;
  /** hintStageLetter identifies the state where a letter has been revealed. */
  const hintStageLetter = 2;

  /** updateViewportHeightProperty sets the viewport height custom property. */
  function updateViewportHeightProperty() {
    const viewportHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    document.documentElement.style.setProperty(cssViewportHeightProperty, `${viewportHeight}px`);
  }

  updateViewportHeightProperty();
  if (window.visualViewport) {
    window.visualViewport.addEventListener(resizeEventName, updateViewportHeightProperty);
  }
  for (const eventName of viewportResizeEventNames) {
    window.addEventListener(eventName, updateViewportHeightProperty);
  }

  function sanitizeClue(text) { return (text || "").replace(/^\s*\d+\.?\s*/, ""); }

  function computeGridSize(entries){
    let minRow = Infinity, minCol = Infinity;
    let maxRow = -1,       maxCol = -1;
    for (const e of entries){
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

  function validatePayload(p){
    const e = [];
    if (!p || typeof p !== "object") e.push("Payload missing.");
    if (!Array.isArray(p.entries) || p.entries.length === 0) e.push("entries[] is required.");

    const byId = new Map();
    for (const ent of p.entries) {
      for (const k of ["id","dir","row","col","answer","clue"]) {
        if (ent[k] === undefined) e.push(`Entry missing ${k}: ${JSON.stringify(ent)}`);
      }
      if (!/^(across|down)$/.test(ent.dir)) e.push(`Bad dir for ${ent.id}`);
      if (!/^[A-Za-z]+$/.test(ent.answer)) e.push(`Non-letters in answer for ${ent.id}`);
      if (byId.has(ent.id)) e.push(`Duplicate id: ${ent.id}`);
      byId.set(ent.id, ent);
    }

    if (!Array.isArray(p.overlaps)) e.push("overlaps[] is required (can be empty).");
    else {
      for (const o of p.overlaps) {
        if (o.a==null||o.b==null||o.aIndex==null||o.bIndex==null){ e.push(`Bad overlap: ${JSON.stringify(o)}`); continue; }
        const a = byId.get(o.a), b = byId.get(o.b);
        if (!a || !b) { e.push(`Overlap refers to unknown id: ${JSON.stringify(o)}`); continue; }
        const ar = a.dir==="across" ? a.row : a.row + o.aIndex;
        const ac = a.dir==="across" ? a.col + o.aIndex : a.col;
        const br = b.dir==="across" ? b.row : b.row + o.bIndex;
        const bc = b.dir==="across" ? b.col + o.bIndex : b.col;
        if (ar!==br || ac!==bc) e.push(`Overlap coords mismatch for ${o.a}~${o.b}`);
        const ca = a.answer[o.aIndex].toUpperCase();
        const cb = b.answer[o.bIndex].toUpperCase();
        if (ca !== cb) e.push(`Overlap letter mismatch ${o.a}(${ca}) vs ${o.b}(${cb})`);
      }
    }
    return e;
  }

  function buildModel(p, rows, cols, offsetRow, offsetCol){
    const model = Array.from({length: rows}, (_, r) =>
        Array.from({length: cols}, (_, c) => ({
          r, c, block: true, sol: null, num: null, input: null, prev: "",
          links: { across: {prev:null,next:null}, down: {prev:null,next:null} },
          belongs: new Set(),   // <- entry ids this cell belongs to
          el: null              // <- DOM node reference later
        }))
    );
    const getCell = (r,c) => (model[r] && model[r][c]) || null;

    // place letters
    for (const ent of p.entries) {
      const L = ent.answer.length;
      for (let i = 0; i < L; i++) {
        const r = (ent.dir === "across" ? ent.row         : ent.row + i) - offsetRow;
        const c = (ent.dir === "across" ? ent.col + i     : ent.col    ) - offsetCol;
        const ch = ent.answer[i].toUpperCase();
        const cell = model[r][c];
        cell.block = false;
        if (cell.sol && cell.sol !== ch) throw new Error(`Conflict at (${r},${c})`);
        cell.sol = ch;
        cell.belongs.add(ent.id);
      }
    }

    const refsById = new Map(p.entries.map(e => [e.id, { ...e }]));

    const starts = new Map();
    for (const ent of p.entries) {
      const r0 = ent.row - offsetRow;
      const c0 = ent.col - offsetCol;
      const k = `${r0}:${c0}`;
      const slot = starts.get(k) || {};
      slot[ent.dir] = refsById.get(ent.id);
      starts.set(k, slot);
    }

    // build navigation links along each entry
    for (const ent of p.entries) {
      const L = ent.answer.length;
      for (let i = 0; i < L; i++) {
        const r = (ent.dir === "across" ? ent.row         : ent.row + i) - offsetRow;
        const c = (ent.dir === "across" ? ent.col + i     : ent.col    ) - offsetCol;
        const cell = getCell(r,c);
        const dir = ent.dir;
        if (!cell) continue;
        if (i > 0)  cell.links[dir].prev = { r: dir==="across" ? r : r-1, c: dir==="across" ? c-1 : c };
        if (i < L-1)cell.links[dir].next = { r: dir==="across" ? r : r+1, c: dir==="across" ? c+1 : c };
      }
    }

    let nextNum = 1;
    const across = [];
    const down   = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const slot = starts.get(`${r}:${c}`);
        if (!slot) continue;
        if (model[r][c].block) continue;
        model[r][c].num = nextNum;
        if (slot.across) { slot.across.num = nextNum; across.push(slot.across); }
        if (slot.down)   { slot.down.num   = nextNum; down.push(slot.down); }
        nextNum++;
      }
    }
    across.sort((a,b) => a.num - b.num);
    down.sort((a,b)   => a.num - b.num);

    return { model, across, down, rows, cols, getCell, refsById };
  }

  function render(p){
    titleEl.textContent = p.title || "Crossword";
    subEl.textContent   = p.subtitle || "";

    statusEl.textContent = ""; statusEl.classList.remove("ok");
    gridEl.innerHTML = ""; acrossOl.innerHTML = ""; downOl.innerHTML = "";
    errorBox.style.display = "none"; errorBox.textContent = "";

    const errors = validatePayload(p);
    if (errors.length){
      errorBox.style.display = "block";
      errorBox.textContent = "Payload error:\n• " + errors.join("\n• ");
      return;
    }

    const size = computeGridSize(p.entries);
    let built;
    try { built = buildModel(p, size.rows, size.cols, size.offsetRow, size.offsetCol); }
    catch (err) { errorBox.style.display = "block"; errorBox.textContent = "Placement conflict: " + err.message; return; }

    const { model, across, down, rows, cols, getCell } = built;

    // define grid size (rows *and* cols)
    gridEl.style.gridTemplateColumns = `repeat(${cols}, var(--cell-size))`;
    gridEl.style.gridTemplateRows    = `repeat(${rows}, var(--cell-size))`;

    // --- Highlighting state/maps
    const clueById = new Map();      // id -> <li>
    const cellsById = new Map();     // id -> array of cell objects (for fast highlight)
    for (const ent of [...across, ...down]) {
      const arr = [];
      for (let i = 0; i < ent.answer.length; i++) {
        const r = ent.dir === "across" ? ent.row - size.offsetRow : ent.row - size.offsetRow + i;
        const c = ent.dir === "across" ? ent.col - size.offsetCol + i : ent.col - size.offsetCol;
        arr.push(getCell(r,c));
      }
      cellsById.set(ent.id, arr);
    }

    const addHL = (ids) => {
      // highlight cells
      for (const id of ids) {
        const cells = cellsById.get(id) || [];
        for (const cell of cells) cell.el.classList.add("hl");
        const li = clueById.get(id);
        if (li) li.classList.add("clueHL");
      }
    };
    const clearHL = () => {
      gridEl.querySelectorAll(".hl").forEach(n => n.classList.remove("hl"));
      acrossOl.querySelectorAll(".clueHL").forEach(n => n.classList.remove("clueHL"));
      downOl.querySelectorAll(".clueHL").forEach(n => n.classList.remove("clueHL"));
    };

    /** isEntrySolved reports whether the entry with the given identifier is complete and correct. */
    function isEntrySolved(entryIdentifier) {
      const cells = cellsById.get(entryIdentifier) || [];
      if (cells.length === 0) return false;
      for (const entryCell of cells) {
        if ((entryCell.input.value || "").toUpperCase() !== entryCell.sol) return false;
      }
      return true;
    }

    /** updateEntrySolvedState applies or removes the solved clue class for the entry identifier. */
    function updateEntrySolvedState(entryIdentifier) {
      const clueElement = clueById.get(entryIdentifier);
      if (!clueElement) return;
      if (isEntrySolved(entryIdentifier)) clueElement.classList.add(solvedClueClassName);
      else clueElement.classList.remove(solvedClueClassName);
    }

    /** updateSolvedStateForCell recalculates solved state for entries containing the cell. */
    function updateSolvedStateForCell(cell) {
      for (const entryIdentifier of cell.belongs) {
        updateEntrySolvedState(entryIdentifier);
      }
    }

    /** updateAllSolvedStates recalculates solved state for all entries. */
    function updateAllSolvedStates() {
      for (const entry of [...across, ...down]) {
        updateEntrySolvedState(entry.id);
      }
    }

    /**
     * revealLetter fills one unsolved cell for the entry identifier and returns
     * the affected cell alongside its previous value.
     */
    function revealLetter(entryIdentifier) {
      const cells = cellsById.get(entryIdentifier) || [];
      for (const entryCell of cells) {
        const currentValue = (entryCell.input.value || emptyString).toUpperCase();
        if (currentValue !== entryCell.sol) {
          const previousValue = entryCell.input.value;
          entryCell.input.value = entryCell.sol;
          entryCell.input.parentElement.classList.add(correctClassName);
          updateEntrySolvedState(entryIdentifier);
          return { cell: entryCell, previousValue };
        }
      }
      return null;
    }

    /**
    * attachHints adds a single toggle hint control that cycles through showing
    * the verbal hint, revealing one letter, and returning to the hidden state.
     */
    function attachHints(clueElement, entry) {
      const hintContainer = document.createElement(hintContainerTagName);
      hintContainer.className = hintContainerClassName;

      const hintButton = document.createElement(buttonTagName);
      hintButton.className = hintButtonClassName;
      hintButton.textContent = hintButtonText;
      const verbalSpan = document.createElement(hintTextTagName);
      verbalSpan.className = hintTextClassName;
      verbalSpan.textContent = entry.hint;
      verbalSpan.style.display = hiddenStyleValue;

      let hintStage = hintStageInitial;
      let revealedCellInfo = null;

      /** clearRevealedLetter hides any previously revealed cell. */
      function clearRevealedLetter() {
        if (!revealedCellInfo) {
          return;
        }
        revealedCellInfo.cell.input.value = revealedCellInfo.previousValue || emptyString;
        revealedCellInfo.cell.input.parentElement.classList.remove(correctClassName);
        updateEntrySolvedState(entry.id);
        revealedCellInfo = null;
      }

      /** resetHints hides the verbal hint and removes any revealed letter. */
      function resetHints() {
        clearRevealedLetter();
        verbalSpan.style.display = hiddenStyleValue;
      }

      hintButton.addEventListener(clickEventName, event => {
        event.preventDefault();
        if (hintStage === hintStageInitial) {
          verbalSpan.style.display = emptyString;
          hintStage = hintStageVerbal;
        } else if (hintStage === hintStageVerbal) {
          revealedCellInfo = revealLetter(entry.id);
          hintStage = hintStageLetter;
        } else {
          resetHints();
          hintStage = hintStageInitial;
        }
      });

      hintContainer.appendChild(hintButton);
      clueElement.appendChild(hintContainer);
      clueElement.appendChild(verbalSpan);
    }

    // nav helpers
    let activeDir = "across";
    const focusCell = (r,c) => {
      const d = getCell(r,c);
      if (!d || d.block) return;
      d.input.focus(); d.input.select();
    };
    const step = (d, dir, forward=true) => {
      const link = d.links[dir][forward ? "next" : "prev"];
      if (!link) return null;
      const t = getCell(link.r, link.c);
      return (t && !t.block) ? t : null;
    };

    // draw only real cells and place them at exact grid coords
    for (let r=0;r<rows;r++){
      for (let c=0;c<cols;c++){
        const d = model[r][c];
        if (d.block) continue;

        const cell = document.createElement("div");
        cell.className = "cell";
        cell.style.gridRowStart = (r + 1);
        cell.style.gridColumnStart = (c + 1);
        d.el = cell;

        const input = document.createElement("input");
        input.maxLength = 1;
        input.setAttribute("aria-label", `Row ${r+1} Col ${c+1}`);
        d.input = input;

        const updateWordHL = () => {
          // highlight every entry this cell participates in
          clearHL();
          addHL(d.belongs);
        };

        input.addEventListener("focus", () => {
          const hasAcross = !!(d.links.across.prev || d.links.across.next);
          const hasDown   = !!(d.links.down.prev   || d.links.down.next);
          if (hasAcross && !hasDown) activeDir = "across";
          else if (!hasAcross && hasDown) activeDir = "down";
          updateWordHL();
        });
        input.addEventListener("blur", () => {
          // keep highlight if new focus goes to another cell; we'll clear on next focus
          // but if the whole widget loses focus, remove highlight after a tick
          setTimeout(() => {
            if (!gridEl.contains(document.activeElement)) clearHL();
          }, 0);
        });

        input.addEventListener("input",(e)=>{
          let v = (e.target.value || "").replace(/[^A-Za-z]/g,"").toUpperCase();
          if (v.length > 1) v = v.slice(-1);
          e.target.value = v;
          cell.classList.remove("correct","wrong");
          updateSolvedStateForCell(d);
          if (v) {
            const nxt = step(d, activeDir, true);
            if (nxt) focusCell(nxt.r, nxt.c);
          }
        });

        input.addEventListener("paste",(e)=>{
          const text = (e.clipboardData || window.clipboardData).getData("text") || "";
          const letters = text.toUpperCase().replace(/[^A-Z]/g,"").split("");
          if (letters.length === 0) return;
          e.preventDefault();
          let cur = d;
          for (const ch of letters) {
            if (!cur) break;
            cur.input.value = ch;
            cur.input.parentElement.classList.remove("correct","wrong");
            updateSolvedStateForCell(cur);
            cur = step(cur, activeDir, true);
          }
          if (cur) focusCell(cur.r, cur.c);
        });

        input.addEventListener("keydown",(e)=>{
          const moveTo = (t)=>{ if(!t) return; focusCell(t.r, t.c); };
          if (e.key === "ArrowLeft"){ e.preventDefault(); activeDir = "across"; moveTo(step(d,"across",false)); return; }
          if (e.key === "ArrowRight"){ e.preventDefault(); activeDir = "across"; moveTo(step(d,"across",true));  return; }
          if (e.key === "ArrowUp"){ e.preventDefault(); activeDir = "down"; moveTo(step(d,"down",false)); return; }
          if (e.key === "ArrowDown"){ e.preventDefault(); activeDir = "down"; moveTo(step(d,"down",true));  return; }
          if (e.key === "Tab"){
            e.preventDefault();
            const forward = !e.shiftKey;
            const t = step(d, activeDir, forward);
            if (t) moveTo(t);
            return;
          }
          if (e.key === "Backspace" && !e.target.value){
            const t = step(d, activeDir, false);
            if (t){ e.preventDefault(); moveTo(t); }
          }
        });

        if (d.num){
          const n=document.createElement("div"); n.className="num"; n.textContent=d.num; cell.appendChild(n);
        }
        cell.appendChild(input);
        gridEl.appendChild(cell);
      }
    }

    // clues (create <li>, index by entry id, add hover highlight)
// clues (create <li>, index by entry id, add hover H/L + click-to-focus)
    function put(ol, list){
      for (const ent of list){
        const li = document.createElement("li");
        li.dataset.entryId = ent.id;
        li.textContent = `${ent.num}. ${sanitizeClue(ent.clue)} (${ent.answer.length})`;

        li.addEventListener("mouseenter", () => { clearHL(); addHL([ent.id]); });
        li.addEventListener("mouseleave", () => { clearHL(); });

        li.addEventListener(clickEventName, (e) => {
          e.preventDefault();
          const cells = cellsById.get(ent.id) || [];
          if (!cells.length) return;
          activeDir = ent.dir;                   // set current typing direction
          const first = cells[0];
          first.input.focus();
          first.input.select();
          // bring into view if the grid is scrollable
          first.el.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
          // make sure the highlight reflects the focused word
          clearHL();
          addHL([ent.id]);
        });

        attachHints(li, ent);
        clueById.set(ent.id, li);
        ol.appendChild(li);
      }
    }
    put(acrossOl, across); put(downOl, down);

    const checkBtn  = document.getElementById("check");
    const revealBtn = document.getElementById("reveal");
    let revealed = false;

    const revealAll = () => {
      for (const row of model) for (const d of row) if(!d.block){
        d.prev = d.input.value || "";
        d.input.value = d.sol;
        d.input.parentElement.classList.remove("wrong");
        d.input.parentElement.classList.add("correct");
      }
      updateAllSolvedStates();
      statusEl.textContent = "Revealed.";
      statusEl.classList.remove("ok");
    };
    const hideAll = () => {
      for (const row of model) for (const d of row) if(!d.block){
        d.input.value = d.prev || "";
        d.input.parentElement.classList.remove("correct","wrong");
      }
      updateAllSolvedStates();
      statusEl.textContent = "";
      statusEl.classList.remove("ok");
    };

    checkBtn.onclick = () => {
      let all=true;
      for (const row of model) for (const d of row) if(!d.block){
        const v=(d.input.value||"").toUpperCase();
        d.input.parentElement.classList.remove("correct","wrong");
        if (!v || v!==d.sol){ all=false; if(v) d.input.parentElement.classList.add("wrong"); }
        else d.input.parentElement.classList.add("correct");
      }
      statusEl.textContent = all ? "All correct — nice!" : "Checked.";
      statusEl.classList.toggle("ok", all);
    };

    revealBtn.onclick = () => {
      revealed = !revealed;
      if (revealed) { revealAll(); revealBtn.textContent = "Hide"; }
      else          { hideAll();   revealBtn.textContent = "Reveal"; }
    };

    selectEl.addEventListener("change", () => { revealed = false; revealBtn.textContent = "Reveal"; }, { once: true });
  }

  (function enablePanning(){
    let isDragging=false, startX=0, startY=0, scrollLeft=0, scrollTop=0;
    gridViewport.addEventListener("mousedown",(e)=>{
      isDragging=true; gridViewport.classList.add("dragging");
      startX = e.pageX - gridViewport.offsetLeft;
      startY = e.pageY - gridViewport.offsetTop;
      scrollLeft = gridViewport.scrollLeft;
      scrollTop  = gridViewport.scrollTop;
    });
    ["mouseleave","mouseup"].forEach(ev => gridViewport.addEventListener(ev, ()=>{ isDragging=false; gridViewport.classList.remove("dragging"); }));
    gridViewport.addEventListener("mousemove",(e)=>{
      if(!isDragging) return;
      e.preventDefault();
      const x = e.pageX - gridViewport.offsetLeft;
      const y = e.pageY - gridViewport.offsetTop;
      gridViewport.scrollLeft = scrollLeft - (x - startX);
      gridViewport.scrollTop  = scrollTop  - (y - startY);
    });
    gridViewport.addEventListener("touchstart",(e)=>{
      const t=e.touches[0]; isDragging=true;
      startX=t.pageX - gridViewport.offsetLeft; startY=t.pageY - gridViewport.offsetTop;
      scrollLeft=gridViewport.scrollLeft; scrollTop=gridViewport.scrollTop;
    },{passive:true});
    gridViewport.addEventListener("touchend",()=>{ isDragging=false; },{passive:true});
    gridViewport.addEventListener("touchmove",(e)=>{
      if(!isDragging) return;
      const t=e.touches[0];
      const x=t.pageX - gridViewport.offsetLeft;
      const y=t.pageY - gridViewport.offsetTop;
      gridViewport.scrollLeft = scrollLeft - (x - startX);
      gridViewport.scrollTop  = scrollTop  - (y - startY);
    },{passive:true});
  })();

  /** validatePuzzleSpecification ensures a puzzle specification adheres to the required schema. */
  function validatePuzzleSpecification(puzzleSpecification) {
    if (!puzzleSpecification || typeof puzzleSpecification !== "object") return false;
    if (typeof puzzleSpecification.title !== "string" || typeof puzzleSpecification.subtitle !== "string") return false;
    if (!Array.isArray(puzzleSpecification.items)) return false;
    for (const item of puzzleSpecification.items) {
      if (typeof item.word !== "string" || typeof item.definition !== "string" || typeof item.hint !== "string") return false;
    }
    return true;
  }

  /** loadAndRenderPuzzles retrieves puzzle specifications, builds puzzles, and renders them. */
  async function loadAndRenderPuzzles() {
    const response = await fetch(puzzleDataPath);
    const puzzleSpecifications = await response.json();
    if (!Array.isArray(puzzleSpecifications)) throw new Error(errorInvalidDataMessage);
    const generatedPuzzles = [];
    let puzzleIndex = 0;
    for (const puzzleSpecification of puzzleSpecifications) {
      if (!validatePuzzleSpecification(puzzleSpecification)) throw new Error(errorInvalidSpecificationMessage);
      const generatedPuzzle = generateCrossword(
        puzzleSpecification.items,
        { title: puzzleSpecification.title, subtitle: puzzleSpecification.subtitle }
      );
      validatePayload(generatedPuzzle);
      generatedPuzzles.push(generatedPuzzle);
      const optionElement = document.createElement(optionTagName);
      optionElement.value = String(puzzleIndex);
      optionElement.textContent = generatedPuzzle.title;
      selectEl.appendChild(optionElement);
      puzzleIndex += 1;
    }
    selectEl.addEventListener(selectChangeEventName, event => {
      render(generatedPuzzles[Number(event.target.value)]);
    });
    selectEl.value = initialPuzzleIndex;
    render(generatedPuzzles[0]);
  }

  loadAndRenderPuzzles().catch(error => { errorBox.textContent = error.message; });
})();
