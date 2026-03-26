/* landing-puzzle.js — renders a small hardcoded moon crossword on the landing page */
(function () {
  "use strict";

  var gridEl = document.getElementById("sampleGrid");
  var acrossOl = document.getElementById("sampleAcross");
  var downOl = document.getElementById("sampleDown");
  var checkBtn = document.getElementById("sampleCheck");
  var revealBtn = document.getElementById("sampleReveal");
  var statusEl = document.getElementById("sampleStatus");

  if (!gridEl || !acrossOl || !downOl) return;

  // Hardcoded mini moon crossword (5 words).
  var puzzle = {
    entries: [
      { id: "W0", dir: "down",   row: 0, col: 2, answer: "LUNAR", clue: "Relating to the Moon (5)" },
      { id: "W1", dir: "across", row: 2, col: 0, answer: "APOLLO", clue: "Program that took humans to the Moon (6)" },
      { id: "W2", dir: "down",   row: 2, col: 4, answer: "ORBIT", clue: "The Moon\u2019s path around Earth (5)" },
      { id: "W3", dir: "across", row: 4, col: 1, answer: "TIDES", clue: "Ocean rise-and-fall pulled by the Moon (5)" },
      { id: "W4", dir: "down",   row: 4, col: 3, answer: "MARE",  clue: "A lunar \u201csea\u201d not made of water (4)" },
    ],
  };

  // Build grid dimensions.
  var maxRow = 0, maxCol = 0;
  puzzle.entries.forEach(function (e) {
    var len = e.answer.length;
    if (e.dir === "across") {
      if (e.row > maxRow) maxRow = e.row;
      if (e.col + len - 1 > maxCol) maxCol = e.col + len - 1;
    } else {
      if (e.row + len - 1 > maxRow) maxRow = e.row + len - 1;
      if (e.col > maxCol) maxCol = e.col;
    }
  });
  var rows = maxRow + 1;
  var cols = maxCol + 1;

  // Build solution grid and cell metadata.
  var sol = [];
  var cellMeta = [];
  var r, c;
  for (r = 0; r < rows; r++) {
    sol[r] = [];
    cellMeta[r] = [];
    for (c = 0; c < cols; c++) {
      sol[r][c] = null;
      cellMeta[r][c] = { num: null, entries: [] };
    }
  }

  // Number assignment.
  var numberMap = {};
  var nextNum = 1;
  puzzle.entries.forEach(function (e) {
    var key = e.row + "," + e.col;
    if (!numberMap[key]) {
      numberMap[key] = nextNum++;
    }
    cellMeta[e.row][e.col].num = numberMap[key];
    for (var i = 0; i < e.answer.length; i++) {
      var cr = e.dir === "down" ? e.row + i : e.row;
      var cc = e.dir === "across" ? e.col + i : e.col;
      sol[cr][cc] = e.answer[i];
      cellMeta[cr][cc].entries.push(e.id);
    }
  });

  // Render grid.
  gridEl.style.gridTemplateColumns = "repeat(" + cols + ", var(--cell-size))";
  gridEl.style.gridTemplateRows = "repeat(" + rows + ", var(--cell-size))";

  var inputs = [];
  for (r = 0; r < rows; r++) {
    for (c = 0; c < cols; c++) {
      var div = document.createElement("div");
      div.className = sol[r][c] ? "cell" : "cell blk";
      if (cellMeta[r][c].num) {
        var numSpan = document.createElement("div");
        numSpan.className = "num";
        numSpan.textContent = cellMeta[r][c].num;
        div.appendChild(numSpan);
      }
      if (sol[r][c]) {
        var input = document.createElement("input");
        input.type = "text";
        input.maxLength = 1;
        input.setAttribute("data-r", r);
        input.setAttribute("data-c", c);
        input.setAttribute("data-sol", sol[r][c]);
        input.addEventListener("input", function () {
          this.value = this.value.toUpperCase().replace(/[^A-Z]/g, "");
        });
        div.appendChild(input);
        inputs.push(input);
      }
      gridEl.appendChild(div);
    }
  }

  // Render clues.
  var acrossClues = [];
  var downClues = [];
  puzzle.entries.forEach(function (e) {
    var num = cellMeta[e.row][e.col].num;
    var li = document.createElement("li");
    li.value = num;
    li.textContent = num + ". " + e.clue;
    if (e.dir === "across") {
      acrossClues.push({ num: num, li: li });
    } else {
      downClues.push({ num: num, li: li });
    }
  });
  acrossClues.sort(function (a, b) { return a.num - b.num; });
  downClues.sort(function (a, b) { return a.num - b.num; });
  acrossClues.forEach(function (c) { acrossOl.appendChild(c.li); });
  downClues.forEach(function (c) { downOl.appendChild(c.li); });

  // Check button.
  if (checkBtn) {
    checkBtn.addEventListener("click", function () {
      var correct = 0;
      var total = 0;
      inputs.forEach(function (inp) {
        total++;
        var expected = inp.getAttribute("data-sol");
        var parent = inp.parentElement;
        parent.classList.remove("correct", "wrong");
        if (inp.value === expected) {
          parent.classList.add("correct");
          correct++;
        } else if (inp.value) {
          parent.classList.add("wrong");
        }
      });
      if (statusEl) {
        if (correct === total) {
          statusEl.textContent = "All correct!";
          statusEl.className = "status ok";
        } else {
          statusEl.textContent = correct + " of " + total + " correct";
          statusEl.className = "status";
        }
      }
    });
  }

  // Reveal button.
  var revealed = false;
  if (revealBtn) {
    revealBtn.addEventListener("click", function () {
      if (!revealed) {
        inputs.forEach(function (inp) {
          inp.value = inp.getAttribute("data-sol");
          inp.parentElement.classList.remove("wrong");
          inp.parentElement.classList.add("correct");
        });
        revealBtn.textContent = "Hide";
        revealed = true;
      } else {
        inputs.forEach(function (inp) {
          inp.value = "";
          inp.parentElement.classList.remove("correct", "wrong");
        });
        revealBtn.textContent = "Reveal";
        revealed = false;
        if (statusEl) {
          statusEl.textContent = "";
          statusEl.className = "status";
        }
      }
    });
  }
})();
