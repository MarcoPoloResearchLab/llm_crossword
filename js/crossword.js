/* crossword.js - renderer for array payload with explicit placements & overlaps */
 (function () {
  "use strict";

  const DIRECTION_ACROSS = "across";
  const DIRECTION_DOWN = "down";
  const GRID_VIEWPORT_ID = "gridViewport";
  const CLASS_DRAGGING = "dragging";
  const CLASS_HIGHLIGHT = "hl";
  const CLASS_CLUE_HIGHLIGHT = "clueHL";
  const CLASS_CORRECT = "correct";
  const CLASS_WRONG = "wrong";
  const CLASS_OK = "ok";
  const TEXT_HIDE = "Hide";
  const TEXT_REVEAL = "Reveal";
  const MESSAGE_REVEALED = "Revealed.";
  const MESSAGE_ALL_CORRECT = "All correct — nice!";
  const MESSAGE_CHECKED = "Checked.";

  const gridViewport = document.getElementById(GRID_VIEWPORT_ID);
  const gridElement = document.getElementById("grid");
  const acrossListElement = document.getElementById("across");
  const downListElement = document.getElementById("down");
  const statusElement = document.getElementById("status");
  const errorBox = document.getElementById("errorBox");
  const titleElement = document.getElementById("title");
  const subtitleElement = document.getElementById("subtitle");
  const puzzleSelect = document.getElementById("puzzleSelect");

  /** sanitizeClue removes leading numbers from a clue. */
  function sanitizeClue(clueText) { return (clueText || "").replace(/^\s*\d+\.?\s*/, ""); }

  /** computeGridSize derives grid dimensions from entries. */
  function computeGridSize(entryList){
    let minRow = Infinity;
    let minCol = Infinity;
    let maxRow = -1;
    let maxCol = -1;
    for (const entry of entryList){
      minRow = Math.min(minRow, entry.row);
      minCol = Math.min(minCol, entry.col);
      if (entry.dir === DIRECTION_ACROSS) {
        maxRow = Math.max(maxRow, entry.row);
        maxCol = Math.max(maxCol, entry.col + entry.answer.length - 1);
      } else {
        maxRow = Math.max(maxRow, entry.row + entry.answer.length - 1);
        maxCol = Math.max(maxCol, entry.col);
      }
    }
    if (!isFinite(minRow)) {
      minRow = 0;
      minCol = 0;
      maxRow = 0;
      maxCol = 0;
    }
    return { rows: (maxRow - minRow + 1), cols: (maxCol - minCol + 1), offsetRow: minRow, offsetCol: minCol };
  }

  /** validatePayload checks the structure of a puzzle payload. */
  function validatePayload(payload){
    const errors = [];
    if (!payload || typeof payload !== "object") errors.push("Payload missing.");
    if (!Array.isArray(payload.entries) || payload.entries.length === 0) errors.push("entries[] is required.");

    const entriesById = new Map();
    for (const entry of payload.entries) {
      for (const key of ["id","dir","row","col","answer","clue"]) {
        if (entry[key] === undefined) errors.push(`Entry missing ${key}: ${JSON.stringify(entry)}`);
      }
      if (!/^(across|down)$/.test(entry.dir)) errors.push(`Bad dir for ${entry.id}`);
      if (!/^[A-Za-z]+$/.test(entry.answer)) errors.push(`Non-letters in answer for ${entry.id}`);
      if (entriesById.has(entry.id)) errors.push(`Duplicate id: ${entry.id}`);
      entriesById.set(entry.id, entry);
    }

    if (!Array.isArray(payload.overlaps)) errors.push("overlaps[] is required (can be empty).");
    else {
      for (const overlap of payload.overlaps) {
        if (overlap.a==null||overlap.b==null||overlap.aIndex==null||overlap.bIndex==null){ errors.push(`Bad overlap: ${JSON.stringify(overlap)}`); continue; }
        const entryA = entriesById.get(overlap.a), entryB = entriesById.get(overlap.b);
        if (!entryA || !entryB) { errors.push(`Overlap refers to unknown id: ${JSON.stringify(overlap)}`); continue; }
        const rowA = entryA.dir===DIRECTION_ACROSS ? entryA.row : entryA.row + overlap.aIndex;
        const colA = entryA.dir===DIRECTION_ACROSS ? entryA.col + overlap.aIndex : entryA.col;
        const rowB = entryB.dir===DIRECTION_ACROSS ? entryB.row : entryB.row + overlap.bIndex;
        const colB = entryB.dir===DIRECTION_ACROSS ? entryB.col + overlap.bIndex : entryB.col;
        if (rowA!==rowB || colA!==colB) errors.push(`Overlap coords mismatch for ${overlap.a}~${overlap.b}`);
        const charA = entryA.answer[overlap.aIndex].toUpperCase();
        const charB = entryB.answer[overlap.bIndex].toUpperCase();
        if (charA !== charB) errors.push(`Overlap letter mismatch ${overlap.a}(${charA}) vs ${overlap.b}(${charB})`);
      }
    }
    return errors;
  }

  /** buildModel constructs the internal grid representation. */
  function buildModel(payload, rowCount, columnCount, rowOffset, columnOffset){
    const model = Array.from({length: rowCount}, (_, rowIndex) =>
        Array.from({length: columnCount}, (_, columnIndex) => ({
          row: rowIndex,
          col: columnIndex,
          block: true,
          solution: null,
          number: null,
          input: null,
          previous: "",
          links: { across: {prev:null,next:null}, down: {prev:null,next:null} },
          belongs: new Set(),
          element: null
        }))
    );
    const getCell = (rowIndex,columnIndex) => (model[rowIndex] && model[rowIndex][columnIndex]) || null;

    for (const entry of payload.entries) {
      const entryLength = entry.answer.length;
      for (let offset = 0; offset < entryLength; offset++) {
        const rowIndex = (entry.dir === DIRECTION_ACROSS ? entry.row         : entry.row + offset) - rowOffset;
        const columnIndex = (entry.dir === DIRECTION_ACROSS ? entry.col + offset     : entry.col    ) - columnOffset;
        const character = entry.answer[offset].toUpperCase();
        const cell = model[rowIndex][columnIndex];
        cell.block = false;
        if (cell.solution && cell.solution !== character) throw new Error(`Conflict at (${rowIndex},${columnIndex})`);
        cell.solution = character;
        cell.belongs.add(entry.id);
      }
    }

    const referencesById = new Map(payload.entries.map(entry => [entry.id, { ...entry }]));

    const starts = new Map();
    for (const entry of payload.entries) {
      const startRow = entry.row - rowOffset;
      const startCol = entry.col - columnOffset;
      const key = `${startRow}:${startCol}`;
      const slot = starts.get(key) || {};
      slot[entry.dir] = referencesById.get(entry.id);
      starts.set(key, slot);
    }

    for (const entry of payload.entries) {
      const entryLength = entry.answer.length;
      for (let offset = 0; offset < entryLength; offset++) {
        const rowIndex = (entry.dir === DIRECTION_ACROSS ? entry.row         : entry.row + offset) - rowOffset;
        const columnIndex = (entry.dir === DIRECTION_ACROSS ? entry.col + offset     : entry.col    ) - columnOffset;
        const cell = getCell(rowIndex,columnIndex);
        const direction = entry.dir;
        if (!cell) continue;
        if (offset > 0)  cell.links[direction].prev = { row: direction===DIRECTION_ACROSS ? rowIndex : rowIndex-1, col: direction===DIRECTION_ACROSS ? columnIndex-1 : columnIndex };
        if (offset < entryLength-1)cell.links[direction].next = { row: direction===DIRECTION_ACROSS ? rowIndex : rowIndex+1, col: direction===DIRECTION_ACROSS ? columnIndex+1 : columnIndex };
      }
    }

    let nextNumber = 1;
    const acrossEntries = [];
    const downEntries   = [];
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
      for (let columnIndex = 0; columnIndex < columnCount; columnIndex++) {
        const slot = starts.get(`${rowIndex}:${columnIndex}`);
        if (!slot) continue;
        if (model[rowIndex][columnIndex].block) continue;
        model[rowIndex][columnIndex].number = nextNumber;
        if (slot.across) { slot.across.num = nextNumber; acrossEntries.push(slot.across); }
        if (slot.down)   { slot.down.num   = nextNumber; downEntries.push(slot.down); }
        nextNumber++;
      }
    }
    acrossEntries.sort((entryA,entryB) => entryA.num - entryB.num);
    downEntries.sort((entryA,entryB)   => entryA.num - entryB.num);

    return { model, across: acrossEntries, down: downEntries, rows: rowCount, cols: columnCount, getCell, referencesById };
  }

  /** render displays a puzzle. */
  function render(payload){
    titleElement.textContent = payload.title || "Crossword";
    subtitleElement.textContent = payload.subtitle || "";

    statusElement.textContent = "";
    statusElement.classList.remove(CLASS_OK);
    gridElement.innerHTML = "";
    acrossListElement.innerHTML = "";
    downListElement.innerHTML = "";
    errorBox.style.display = "none";
    errorBox.textContent = "";

    const errors = validatePayload(payload);
    if (errors.length){
      errorBox.style.display = "block";
      errorBox.textContent = "Payload error:\n• " + errors.join("\n• ");
      return;
    }

    const gridSize = computeGridSize(payload.entries);
    let modelData;
    try { modelData = buildModel(payload, gridSize.rows, gridSize.cols, gridSize.offsetRow, gridSize.offsetCol); }
    catch (err) { errorBox.style.display = "block"; errorBox.textContent = "Placement conflict: " + err.message; return; }

    const { model, across: acrossEntries, down: downEntries, rows, cols, getCell } = modelData;

    gridElement.style.gridTemplateColumns = `repeat(${cols}, var(--cell-size))`;
    gridElement.style.gridTemplateRows    = `repeat(${rows}, var(--cell-size))`;

    const clueById = new Map();
    const cellsById = new Map();
    for (const entry of [...acrossEntries, ...downEntries]) {
      const cellArray = [];
      for (let offset = 0; offset < entry.answer.length; offset++) {
        const rowIndex = entry.dir === DIRECTION_ACROSS ? entry.row - gridSize.offsetRow : entry.row - gridSize.offsetRow + offset;
        const columnIndex = entry.dir === DIRECTION_ACROSS ? entry.col - gridSize.offsetCol + offset : entry.col - gridSize.offsetCol;
        cellArray.push(getCell(rowIndex,columnIndex));
      }
      cellsById.set(entry.id, cellArray);
    }

    const addHighlight = (ids) => {
      for (const id of ids) {
        const cells = cellsById.get(id) || [];
        for (const cell of cells) cell.element.classList.add(CLASS_HIGHLIGHT);
        const listItem = clueById.get(id);
        if (listItem) listItem.classList.add(CLASS_CLUE_HIGHLIGHT);
      }
    };
    const clearHighlight = () => {
      gridElement.querySelectorAll("." + CLASS_HIGHLIGHT).forEach(node => node.classList.remove(CLASS_HIGHLIGHT));
      acrossListElement.querySelectorAll("." + CLASS_CLUE_HIGHLIGHT).forEach(node => node.classList.remove(CLASS_CLUE_HIGHLIGHT));
      downListElement.querySelectorAll("." + CLASS_CLUE_HIGHLIGHT).forEach(node => node.classList.remove(CLASS_CLUE_HIGHLIGHT));
    };

    let activeDirection = DIRECTION_ACROSS;
    const focusCell = (rowIndex,columnIndex) => {
      const cell = getCell(rowIndex,columnIndex);
      if (!cell || cell.block) return;
      cell.input.focus();
      cell.input.select();
    };
    const stepCell = (cell, direction, forward=true) => {
      const link = cell.links[direction][forward ? "next" : "prev"];
      if (!link) return null;
      const target = getCell(link.row, link.col);
      return (target && !target.block) ? target : null;
    };

    for (let rowIndex=0;rowIndex<rows;rowIndex++){
      for (let columnIndex=0;columnIndex<cols;columnIndex++){
        const cellData = model[rowIndex][columnIndex];
        if (cellData.block) continue;

        const cellElement = document.createElement("div");
        cellElement.className = "cell";
        cellElement.style.gridRowStart = (rowIndex + 1);
        cellElement.style.gridColumnStart = (columnIndex + 1);
        cellData.element = cellElement;

        const input = document.createElement("input");
        input.maxLength = 1;
        input.setAttribute("aria-label", `Row ${rowIndex+1} Col ${columnIndex+1}`);
        cellData.input = input;

        const updateWordHighlight = () => { clearHighlight(); addHighlight(cellData.belongs); };

        input.addEventListener("focus", () => {
          const hasAcross = !!(cellData.links.across.prev || cellData.links.across.next);
          const hasDown   = !!(cellData.links.down.prev   || cellData.links.down.next);
          if (hasAcross && !hasDown) activeDirection = DIRECTION_ACROSS;
          else if (!hasAcross && hasDown) activeDirection = DIRECTION_DOWN;
          updateWordHighlight();
        });
        input.addEventListener("blur", () => {
          setTimeout(() => {
            if (!gridElement.contains(document.activeElement)) clearHighlight();
          }, 0);
        });

        input.addEventListener("input",(event)=>{
          let value = (event.target.value || "").replace(/[^A-Za-z]/g,"").toUpperCase();
          if (value.length > 1) value = value.slice(-1);
          event.target.value = value;
          cellElement.classList.remove(CLASS_CORRECT,CLASS_WRONG);
          if (value) {
            const nextCell = stepCell(cellData, activeDirection, true);
            if (nextCell) focusCell(nextCell.row, nextCell.col);
          }
        });

        input.addEventListener("paste",(event)=>{
          const text = (event.clipboardData || window.clipboardData).getData("text") || "";
          const letters = text.toUpperCase().replace(/[^A-Z]/g,"").split("");
          if (letters.length === 0) return;
          event.preventDefault();
          let current = cellData;
          for (const character of letters) {
            if (!current) break;
            current.input.value = character;
            current.input.parentElement.classList.remove(CLASS_CORRECT,CLASS_WRONG);
            current = stepCell(current, activeDirection, true);
          }
          if (current) focusCell(current.row, current.col);
        });
        input.addEventListener("keydown",(event)=>{
          const moveTo = (target)=>{ if(!target) return; focusCell(target.row, target.col); };
          if (event.key === "ArrowLeft"){ event.preventDefault(); activeDirection = DIRECTION_ACROSS; moveTo(stepCell(cellData,DIRECTION_ACROSS,false)); return; }
          if (event.key === "ArrowRight"){ event.preventDefault(); activeDirection = DIRECTION_ACROSS; moveTo(stepCell(cellData,DIRECTION_ACROSS,true));  return; }
          if (event.key === "ArrowUp"){ event.preventDefault(); activeDirection = DIRECTION_DOWN; moveTo(stepCell(cellData,DIRECTION_DOWN,false)); return; }
          if (event.key === "ArrowDown"){ event.preventDefault(); activeDirection = DIRECTION_DOWN; moveTo(stepCell(cellData,DIRECTION_DOWN,true));  return; }
          if (event.key === "Tab"){
            event.preventDefault();
            const forward = !event.shiftKey;
            const target = stepCell(cellData, activeDirection, forward);
            if (target) moveTo(target);
            return;
          }
          if (event.key === "Backspace" && !event.target.value){
            const target = stepCell(cellData, activeDirection, false);
            if (target){ event.preventDefault(); moveTo(target); }
          }
        });

        if (cellData.number){
          const numberElement=document.createElement("div"); numberElement.className="num"; numberElement.textContent=cellData.number; cellElement.appendChild(numberElement);
        }
        cellElement.appendChild(input);
        gridElement.appendChild(cellElement);
      }
    }

    function appendClues(listElement, entries){
      for (const entry of entries){
        const listItem = document.createElement("li");
        listItem.dataset.entryId = entry.id;
        listItem.textContent = `${entry.num}. ${sanitizeClue(entry.clue)} (${entry.answer.length})`;
        listItem.addEventListener("mouseenter", () => { clearHighlight(); addHighlight([entry.id]); });
        listItem.addEventListener("mouseleave", () => { clearHighlight(); });
        listItem.addEventListener("click", (event) => {
          event.preventDefault();
          const cells = cellsById.get(entry.id) || [];
          if (!cells.length) return;
          activeDirection = entry.dir;
          const first = cells[0];
          first.input.focus();
          first.input.select();
          first.element.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
          clearHighlight();
          addHighlight([entry.id]);
        });
        clueById.set(entry.id, listItem);
        listElement.appendChild(listItem);
      }
    }
    appendClues(acrossListElement, acrossEntries); appendClues(downListElement, downEntries);

    const checkButton  = document.getElementById("check");
    const revealButton = document.getElementById("reveal");
    let revealed = false;

    const revealAll = () => {
      for (const row of model) for (const cell of row) if(!cell.block){
        cell.previous = cell.input.value || "";
        cell.input.value = cell.solution;
        cell.input.parentElement.classList.remove(CLASS_WRONG);
        cell.input.parentElement.classList.add(CLASS_CORRECT);
      }
      statusElement.textContent = MESSAGE_REVEALED;
      statusElement.classList.remove(CLASS_OK);
    };
    const hideAll = () => {
      for (const row of model) for (const cell of row) if(!cell.block){
        cell.input.value = cell.previous || "";
        cell.input.parentElement.classList.remove(CLASS_CORRECT,CLASS_WRONG);
      }
      statusElement.textContent = "";
      statusElement.classList.remove(CLASS_OK);
    };

    checkButton.onclick = () => {
      let allCorrect=true;
      for (const row of model) for (const cell of row) if(!cell.block){
        const value=(cell.input.value||"").toUpperCase();
        cell.input.parentElement.classList.remove(CLASS_CORRECT,CLASS_WRONG);
        if (!value || value!==cell.solution){ allCorrect=false; if(value) cell.input.parentElement.classList.add(CLASS_WRONG); }
        else cell.input.parentElement.classList.add(CLASS_CORRECT);
      }
      statusElement.textContent = allCorrect ? MESSAGE_ALL_CORRECT : MESSAGE_CHECKED;
      statusElement.classList.toggle(CLASS_OK, allCorrect);
    };

    revealButton.onclick = () => {
      revealed = !revealed;
      if (revealed) { revealAll(); revealButton.textContent = TEXT_HIDE; }
      else          { hideAll();   revealButton.textContent = TEXT_REVEAL; }
    };

    puzzleSelect.addEventListener("change", () => { revealed = false; revealButton.textContent = TEXT_REVEAL; }, { once: true });
  }

  /** enablePanning adds mouse and touch panning to the grid viewport. */
  (function enablePanning(){
    let isDragging=false, startX=0, startY=0, scrollLeft=0, scrollTop=0;
    gridViewport.addEventListener("mousedown",(event)=>{
      isDragging=true; gridViewport.classList.add(CLASS_DRAGGING);
      startX = event.pageX - gridViewport.offsetLeft;
      startY = event.pageY - gridViewport.offsetTop;
      scrollLeft = gridViewport.scrollLeft;
      scrollTop  = gridViewport.scrollTop;
    });
    ["mouseleave","mouseup"].forEach(eventName => gridViewport.addEventListener(eventName, ()=>{ isDragging=false; gridViewport.classList.remove(CLASS_DRAGGING); }));
    gridViewport.addEventListener("mousemove",(event)=>{
      if(!isDragging) return;
      event.preventDefault();
      const currentX = event.pageX - gridViewport.offsetLeft;
      const currentY = event.pageY - gridViewport.offsetTop;
      gridViewport.scrollLeft = scrollLeft - (currentX - startX);
      gridViewport.scrollTop  = scrollTop  - (currentY - startY);
    });
    gridViewport.addEventListener("touchstart",(event)=>{
      const touchPoint=event.touches[0]; isDragging=true;
      startX=touchPoint.pageX - gridViewport.offsetLeft; startY=touchPoint.pageY - gridViewport.offsetTop;
      scrollLeft=gridViewport.scrollLeft; scrollTop=gridViewport.scrollTop;
    },{passive:true});
    gridViewport.addEventListener("touchend",()=>{ isDragging=false; },{passive:true});
    gridViewport.addEventListener("touchmove",(event)=>{
      if(!isDragging) return;
      const touchPoint=event.touches[0];
      const currentX=touchPoint.pageX - gridViewport.offsetLeft;
      const currentY=touchPoint.pageY - gridViewport.offsetTop;
      gridViewport.scrollLeft = scrollLeft - (currentX - startX);
      gridViewport.scrollTop  = scrollTop  - (currentY - startY);
    },{passive:true});
  })();

  CROSSWORD_PUZZLES.forEach((puzzle, index) => {
    const optionElement = document.createElement("option");
    optionElement.value = index; optionElement.textContent = puzzle.title;
    puzzleSelect.appendChild(optionElement);
  });
  puzzleSelect.addEventListener("change", (event)=>{
    render(CROSSWORD_PUZZLES[Number(event.target.value)]);
  });
  puzzleSelect.value = 0;
  render(CROSSWORD_PUZZLES[0]);
})();
