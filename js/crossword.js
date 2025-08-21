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
  /** cssCellSizeProperty holds the name of the custom property for cell size. */
  const cssCellSizeProperty = "--cell-size";
  /** cssGapSizeProperty holds the name of the custom property for gap size between cells. */
  const cssGapSizeProperty = "--gap-size";
  /** focusEventName identifies the focus event. */
  const focusEventName = "focus";
  /** blurEventName identifies the blur event. */
  const blurEventName = "blur";
  /** inputEventName identifies the input event. */
  const inputEventName = "input";
  /** pasteEventName identifies the paste event. */
  const pasteEventName = "paste";
  /** keydownEventName identifies the keydown event. */
  const keydownEventName = "keydown";
  /** mouseEnterEventName identifies the mouseenter event. */
  const mouseEnterEventName = "mouseenter";
  /** mouseLeaveEventName identifies the mouseleave event. */
  const mouseLeaveEventName = "mouseleave";
  /** clickEventName identifies the click event. */
  const clickEventName = "click";
  /** changeEventName identifies the change event. */
  const changeEventName = "change";
  /** mouseDownEventName identifies the mousedown event. */
  const mouseDownEventName = "mousedown";
  /** mouseUpEventName identifies the mouseup event. */
  const mouseUpEventName = "mouseup";
  /** mouseMoveEventName identifies the mousemove event. */
  const mouseMoveEventName = "mousemove";
  /** touchStartEventName identifies the touchstart event. */
  const touchStartEventName = "touchstart";
  /** touchEndEventName identifies the touchend event. */
  const touchEndEventName = "touchend";
  /** touchMoveEventName identifies the touchmove event. */
  const touchMoveEventName = "touchmove";
  /** currentRowCount holds the number of grid rows for cell size calculations. */
  let currentRowCount = 0;
  /** currentColumnCount holds the number of grid columns for cell size calculations. */
  let currentColumnCount = 0;

  /** cssCellSizeProperty identifies the custom property for cell size. */
  const cssCellSizeProperty = "--cell-size";
  /** cssGapSizeProperty identifies the custom property for gap size. */
  const cssGapSizeProperty = "--gap-size";
  /** pixelUnit is the unit suffix for pixel values. */
  const pixelUnit = "px";
  /** maximumCellSize is the largest allowed size for a cell in pixels. */
  const maximumCellSize = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(cssCellSizeProperty));

  /** updateViewportHeightProperty sets the viewport height custom property. */
  function updateViewportHeightProperty() {
    const viewportHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    document.documentElement.style.setProperty(cssViewportHeightProperty, `${viewportHeight}px`);
  }

  /** updateCellSizeVariables adjusts cell related custom properties to fit the viewport. */
  function updateCellSizeVariables(rowCount, columnCount) {
    if (!rowCount || !columnCount) return;
    const rootStyles = getComputedStyle(document.documentElement);
    const gapSize = parseFloat(rootStyles.getPropertyValue(cssGapSizeProperty)) || 0;
    const viewportWidth = gridViewport.clientWidth;
    const viewportHeight = gridViewport.clientHeight;
    const widthAvailable = viewportWidth - (columnCount - 1) * gapSize;
    const heightAvailable = viewportHeight - (rowCount - 1) * gapSize;
    const cellSize = Math.floor(Math.min(widthAvailable / columnCount, heightAvailable / rowCount));
    document.documentElement.style.setProperty(cssCellSizeProperty, `${cellSize}px`);
  }

  /** handleViewportResize updates viewport and cell size properties on resize-like events. */
  function handleViewportResize() {
    updateViewportHeightProperty();
    updateCellSizeVariables(currentRowCount, currentColumnCount);
  }

  updateViewportHeightProperty();
  if (window.visualViewport) {
    window.visualViewport.addEventListener(resizeEventName, handleViewportResize);
  }
  for (const eventName of viewportResizeEventNames) {
    window.addEventListener(eventName, handleViewportResize);
  }

  /** updateCellSizeVariables adjusts the grid cell size to fit within the viewport. */
  function updateCellSizeVariables(numberOfRows, numberOfColumns) {
    const rootStyles = getComputedStyle(document.documentElement);
    const gapSize = parseFloat(rootStyles.getPropertyValue(cssGapSizeProperty)) || 0;
    const widthAvailable = gridViewport.clientWidth - gapSize * (numberOfColumns - 1);
    const heightAvailable = gridViewport.clientHeight - gapSize * (numberOfRows - 1);
    const widthBasedCellSize = widthAvailable / numberOfColumns;
    const heightBasedCellSize = heightAvailable / numberOfRows;
    const cellSize = Math.min(widthBasedCellSize, heightBasedCellSize, maximumCellSize);
    document.documentElement.style.setProperty(cssCellSizeProperty, `${cellSize}${pixelUnit}`);
    gridEl.style.gridTemplateColumns = `repeat(${numberOfColumns}, ${cellSize}${pixelUnit})`;
    gridEl.style.gridTemplateRows = `repeat(${numberOfRows}, ${cellSize}${pixelUnit})`;
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

    currentRowCount = rows;
    currentColumnCount = cols;
    updateCellSizeVariables(currentRowCount, currentColumnCount);

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

        input.addEventListener(focusEventName, () => {
          const hasAcross = !!(d.links.across.prev || d.links.across.next);
          const hasDown   = !!(d.links.down.prev   || d.links.down.next);
          if (hasAcross && !hasDown) activeDir = "across";
          else if (!hasAcross && hasDown) activeDir = "down";
          updateWordHL();
        });
        input.addEventListener(blurEventName, () => {
          // keep highlight if new focus goes to another cell; we'll clear on next focus
          // but if the whole widget loses focus, remove highlight after a tick
          setTimeout(() => {
            if (!gridEl.contains(document.activeElement)) clearHL();
          }, 0);
        });

        input.addEventListener(inputEventName,(event)=>{
          let value = (event.target.value || "").replace(/[^A-Za-z]/g,"").toUpperCase();
          if (value.length > 1) value = value.slice(-1);
          event.target.value = value;
          cell.classList.remove("correct","wrong");
          if (value) {
            const nextCell = step(d, activeDir, true);
            if (nextCell) focusCell(nextCell.r, nextCell.c);
          }
        });

        input.addEventListener(pasteEventName,(event)=>{
          const text = (event.clipboardData || window.clipboardData).getData("text") || "";
          const letters = text.toUpperCase().replace(/[^A-Z]/g,"").split("");
          if (letters.length === 0) return;
          event.preventDefault();
          let currentCell = d;
          for (const letter of letters) {
            if (!currentCell) break;
            currentCell.input.value = letter;
            currentCell.input.parentElement.classList.remove("correct","wrong");
            currentCell = step(currentCell, activeDir, true);
          }
          if (currentCell) focusCell(currentCell.r, currentCell.c);
        });

        input.addEventListener(keydownEventName,(event)=>{
          const moveTo = (target)=>{ if(!target) return; focusCell(target.r, target.c); };
          if (event.key === "ArrowLeft"){ event.preventDefault(); activeDir = "across"; moveTo(step(d,"across",false)); return; }
          if (event.key === "ArrowRight"){ event.preventDefault(); activeDir = "across"; moveTo(step(d,"across",true));  return; }
          if (event.key === "ArrowUp"){ event.preventDefault(); activeDir = "down"; moveTo(step(d,"down",false)); return; }
          if (event.key === "ArrowDown"){ event.preventDefault(); activeDir = "down"; moveTo(step(d,"down",true));  return; }
          if (event.key === "Tab"){
            event.preventDefault();
            const forward = !event.shiftKey;
            const target = step(d, activeDir, forward);
            if (target) moveTo(target);
            return;
          }
          if (event.key === "Backspace" && !event.target.value){
            const target = step(d, activeDir, false);
            if (target){ event.preventDefault(); moveTo(target); }
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

        // highlight on hover
        li.addEventListener(mouseEnterEventName, () => { clearHL(); addHL([ent.id]); });
        li.addEventListener(mouseLeaveEventName, () => { clearHL(); });

        // CLICK -> focus first square of this entry
        li.addEventListener(clickEventName, (event) => {
          event.preventDefault();
          const cells = cellsById.get(ent.id) || [];
          if (!cells.length) return;
          activeDir = ent.dir;
          const firstCell = cells[0];
          firstCell.input.focus();
          firstCell.input.select();
          firstCell.el.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
          clearHL();
          addHL([ent.id]);
        });

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
      statusEl.textContent = "Revealed.";
      statusEl.classList.remove("ok");
    };
    const hideAll = () => {
      for (const row of model) for (const d of row) if(!d.block){
        d.input.value = d.prev || "";
        d.input.parentElement.classList.remove("correct","wrong");
      }
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

    selectEl.addEventListener(changeEventName, () => { revealed = false; revealBtn.textContent = "Reveal"; }, { once: true });
  }

  (function enablePanning(){
    let isDragging=false, startX=0, startY=0, scrollLeft=0, scrollTop=0;
    gridViewport.addEventListener(mouseDownEventName,(event)=>{
      isDragging=true; gridViewport.classList.add("dragging");
      startX = event.pageX - gridViewport.offsetLeft;
      startY = event.pageY - gridViewport.offsetTop;
      scrollLeft = gridViewport.scrollLeft;
      scrollTop  = gridViewport.scrollTop;
    });
    [mouseLeaveEventName, mouseUpEventName].forEach(eventName => gridViewport.addEventListener(eventName, ()=>{ isDragging=false; gridViewport.classList.remove("dragging"); }));
    gridViewport.addEventListener(mouseMoveEventName,(event)=>{
      if(!isDragging) return;
      event.preventDefault();
      const pointerX = event.pageX - gridViewport.offsetLeft;
      const pointerY = event.pageY - gridViewport.offsetTop;
      gridViewport.scrollLeft = scrollLeft - (pointerX - startX);
      gridViewport.scrollTop  = scrollTop  - (pointerY - startY);
    });
    gridViewport.addEventListener(touchStartEventName,(event)=>{
      const touch=event.touches[0]; isDragging=true;
      startX=touch.pageX - gridViewport.offsetLeft; startY=touch.pageY - gridViewport.offsetTop;
      scrollLeft=gridViewport.scrollLeft; scrollTop=gridViewport.scrollTop;
    },{passive:true});
    gridViewport.addEventListener(touchEndEventName,()=>{ isDragging=false; },{passive:true});
    gridViewport.addEventListener(touchMoveEventName,(event)=>{
      if(!isDragging) return;
      const touch=event.touches[0];
      const pointerX=touch.pageX - gridViewport.offsetLeft;
      const pointerY=touch.pageY - gridViewport.offsetTop;
      gridViewport.scrollLeft = scrollLeft - (pointerX - startX);
      gridViewport.scrollTop  = scrollTop  - (pointerY - startY);
    },{passive:true});
  })();

  CROSSWORD_PUZZLES.forEach((p, idx) => {
    const opt = document.createElement("option");
    opt.value = idx; opt.textContent = p.title;
    document.getElementById("puzzleSelect").appendChild(opt);
  });
  document.getElementById("puzzleSelect").addEventListener(changeEventName, (event)=>{
    render(CROSSWORD_PUZZLES[Number(event.target.value)]);
  });
  document.getElementById("puzzleSelect").value = 0;
  render(CROSSWORD_PUZZLES[0]);
})();
