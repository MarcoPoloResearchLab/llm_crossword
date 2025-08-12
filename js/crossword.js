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

  function sanitizeClue(text) { return (text || "").replace(/^\s*\d+\.?\s*/, ""); }

  // --- auto compute minimal board size from entries (0-based)
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

    return {
      rows: (maxRow - minRow + 1),
      cols: (maxCol - minCol + 1),
      offsetRow: minRow,
      offsetCol: minCol
    };
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

  // build grid model
  function buildModel(p, rows, cols, offsetRow, offsetCol){
    // 1) empty grid
    const model = Array.from({length: rows}, (_, r) =>
      Array.from({length: cols}, (_, c) => ({
        r, c, block: true, sol: null, num: null, input: null, prev: ""
      }))
    );

    // 2) place letters (normalized coords)
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
      }
    }

    // 3) canonical entry objects (single source of truth for numbers)
    const refsById = new Map(p.entries.map(e => [e.id, { ...e }]));

    // map of normalized start-cells -> { across?:ref, down?:ref }
    const starts = new Map();
    for (const ent of p.entries) {
      const r0 = ent.row - offsetRow;
      const c0 = ent.col - offsetCol;
      const k = `${r0}:${c0}`;
      const slot = starts.get(k) || {};
      slot[ent.dir] = refsById.get(ent.id); // use the canonical ref
      starts.set(k, slot);
    }

    // 4) global numbering in row-major order
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

    return { model, across, down, rows, cols };
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
    catch (err) {
      errorBox.style.display = "block";
      errorBox.textContent = "Placement conflict: " + err.message;
      return;
    }
    const { model, across, down, rows, cols } = built;

    // set CSS grid tracks (rows/cols)
    gridEl.style.gridTemplateColumns = `repeat(${cols}, var(--cell))`;
    gridEl.style.gridTemplateRows    = `repeat(${rows}, var(--cell))`;

    // --- draw only NON-BLOCK cells, placed sparsely on the grid
    for (let r = 0; r < rows; r++){
      for (let c = 0; c < cols; c++){
        const d = model[r][c];
        if (d.block) continue;                     // <<< skip empty squares

        const cell = document.createElement("div");
        cell.className = "cell";
        cell.style.gridColumnStart = c + 1;        // <<< absolute placement
        cell.style.gridRowStart    = r + 1;

        const input = document.createElement("input");
        input.maxLength = 1;
        input.setAttribute("aria-label", `Row ${r+1} Col ${c+1}`);
        input.addEventListener("input",(e)=>{
          e.target.value = e.target.value.replace(/[^A-Za-z]/g,"").toUpperCase();
          cell.classList.remove("correct","wrong");
        });

        // smarter nav: skip over gaps/blocks until a real cell is found
        input.addEventListener("keydown",(e)=>{
          const step = (dr, dc) => {
            let rr = r + dr, cc = c + dc;
            while (rr >= 0 && rr < rows && cc >= 0 && cc < cols) {
              const d2 = model[rr][cc];
              if (!d2.block && d2.input) { d2.input.focus(); d2.input.select(); return; }
              rr += dr; cc += dc;
            }
          };
          if (e.key === "ArrowLeft")  { e.preventDefault(); step(0, -1); }
          if (e.key === "ArrowRight") { e.preventDefault(); step(0,  1); }
          if (e.key === "ArrowUp")    { e.preventDefault(); step(-1, 0); }
          if (e.key === "ArrowDown")  { e.preventDefault(); step( 1, 0); }
          if (e.key === "Backspace" && !e.target.value) { step(0, -1); }
        });

        d.input = input;
        cell.appendChild(input);

        if (d.num){
          const n = document.createElement("div");
          n.className = "num";
          n.textContent = d.num;
          cell.appendChild(n);
        }

        gridEl.appendChild(cell);
      }
    }

    // clues (we print real numbers; <ol> list-style is none in CSS)
    function put(ol, list){
      for (const ent of list){
        const li = document.createElement("li");
        li.textContent = `${ent.num}. ${sanitizeClue(ent.clue)} (${ent.answer.length})`;
        ol.appendChild(li);
      }
    }
    put(acrossOl, across); put(downOl, down);

    // controls
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

    // reset reveal state when puzzle changes
    selectEl.addEventListener("change", () => { revealed = false; revealBtn.textContent = "Reveal"; }, { once: true });
  }

  // --- Simple drag-to-pan for oversized boards (also scrollbars work)
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
    // touch
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

  // dropdown binds to array payload
  CROSSWORD_PUZZLES.forEach((p, idx) => {
    const opt = document.createElement("option");
    opt.value = idx; opt.textContent = p.title;
    document.getElementById("puzzleSelect").appendChild(opt);
  });
  document.getElementById("puzzleSelect").addEventListener("change", (e)=>{
    render(CROSSWORD_PUZZLES[Number(e.target.value)]);
  });
  document.getElementById("puzzleSelect").value = 0;
  render(CROSSWORD_PUZZLES[0]);
})();
