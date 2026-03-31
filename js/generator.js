/* generator.js — builds a crossword payload from [{word, definition}]
   Guarantees: returns a payload only if *all* words are placed with
   - ≥1 intersection per word
   - no side-touching except true crossings
*/

function generateCrossword(items, opts = {}) {
  var _random = (opts && opts.random) || Math.random;
  const BOUNDING_BOX_IMBALANCE_WEIGHT = 4;
  const CANDIDATE_CROSSING_WEIGHT = 100;

  const o = {
    title: opts.title ?? "Mini Crossword — Generated",
    subtitle: opts.subtitle ?? "Auto-generated from word list.",
    description: opts.description ?? "",
    maxAttempts: opts.maxAttempts ?? 4000,  // global backtracking budget per try
    seedTries: opts.seedTries ?? 24,        // how many distinct seed choices (word+dir+shuffles)
  };

  // ---------- sanitize input ----------
  let baseWords = items.map((item, itemIndex) => ({
    id: `W${itemIndex}`,
    answer: String(item.word || "").toUpperCase().replace(/[^A-Z]/g, ""),
    clue: String(item.definition || "").trim(),
    hint: String(item.hint || "").trim(),
  })).filter(word => word.answer.length > 1);

  if (baseWords.length === 0) {
    throw new Error("No valid words (need length ≥ 2, A–Z).");
  }

  // deterministic sort by length (desc), then alpha to stabilize
  baseWords.sort((a, b) =>
    (b.answer.length - a.answer.length) || (a.answer < b.answer ? -1 : 1)
  );

  // ---------- helpers to copy/reset state ----------
  const dirs = ["across", "down"];

  function scoreShapeMetrics(metrics) {
    return metrics.area + metrics.imbalance * BOUNDING_BOX_IMBALANCE_WEIGHT;
  }

  function measurePayloadLayout(payload) {
    let totalLetters = 0;
    let minRow = Infinity;
    let maxRow = -Infinity;
    let minCol = Infinity;
    let maxCol = -Infinity;
    const uniqueCells = new Set();

    for (const entry of payload.entries) {
      totalLetters += entry.answer.length;
      for (let index = 0; index < entry.answer.length; index++) {
        const row = entry.dir === "across" ? entry.row : entry.row + index;
        const col = entry.dir === "across" ? entry.col + index : entry.col;
        uniqueCells.add(`${row}:${col}`);
        if (row < minRow) minRow = row;
        if (row > maxRow) maxRow = row;
        if (col < minCol) minCol = col;
        if (col > maxCol) maxCol = col;
      }
    }

    const rows = maxRow - minRow + 1;
    const cols = maxCol - minCol + 1;
    const area = rows * cols;
    const uniqueCellCount = uniqueCells.size;

    return {
      rows,
      cols,
      area,
      uniqueCellCount,
      density: uniqueCellCount / area,
      crossings: totalLetters - uniqueCellCount,
      imbalance: Math.abs(rows - cols),
      longestSide: Math.max(rows, cols),
    };
  }

  function isBetterLayout(candidateLayout, bestLayout) {
    if (!bestLayout) return true;

    if (candidateLayout.metrics.crossings !== bestLayout.metrics.crossings) {
      return candidateLayout.metrics.crossings > bestLayout.metrics.crossings;
    }

    const candidateShapeScore = scoreShapeMetrics(candidateLayout.metrics);
    const bestShapeScore = scoreShapeMetrics(bestLayout.metrics);
    if (candidateShapeScore !== bestShapeScore) {
      return candidateShapeScore < bestShapeScore;
    }

    if (candidateLayout.metrics.density !== bestLayout.metrics.density) {
      return candidateLayout.metrics.density > bestLayout.metrics.density;
    }

    if (candidateLayout.metrics.longestSide !== bestLayout.metrics.longestSide) {
      return candidateLayout.metrics.longestSide < bestLayout.metrics.longestSide;
    }

    return candidateLayout.metrics.area < bestLayout.metrics.area;
  }

  generateCrossword.__test = {
    compareLayoutMetrics(candidateMetrics, bestMetrics) {
      return isBetterLayout(
        { metrics: candidateMetrics },
        bestMetrics ? { metrics: bestMetrics } : null
      );
    },
    measurePayloadLayout,
    scoreShapeMetrics,
  };

  function tryBuild(words) {
    // sparse grid (normalized integer coords)
    let grid = new Map();   // "r:c" -> 'A'
    let placed = [];        // { id, dir, row, col, answer, clue }
    let overlaps = [];      // { a, aIndex, b, bIndex }
    let attemptBudget = o.maxAttempts;

    const key = (r, c) => `${r}:${c}`;
    const get = (r, c) => grid.get(key(r, c));
    const set = (r, c, ch) => grid.set(key(r, c), ch);
    const del = (r, c) => grid.delete(key(r, c));

    function resetPlacementState() {
      grid = new Map();
      placed = [];
      overlaps = [];
    }

    function canPlace(answer, row, col, dir) {
      for (let i = 0; i < answer.length; i++) {
        const r = dir === "across" ? row : row + i;
        const c = dir === "across" ? col + i : col;
        const existing = get(r, c);

        // must match existing letter if present
        if (existing && existing !== answer[i]) return { ok: false };

        // adjacency rule: no touching except true intersections
        if (!existing) {
          if (dir === "across") {
            if (get(r - 1, c) || get(r + 1, c)) return { ok: false };
          } else {
            if (get(r, c - 1) || get(r, c + 1)) return { ok: false };
          }
        }

        // forbid touching at ends (caps)
        if (i === 0) {
          const pr = dir === "across" ? r : r - 1;
          const pc = dir === "across" ? c - 1 : c;
          if (get(pr, pc)) return { ok: false };
        }
        if (i === answer.length - 1) {
          const nr = dir === "across" ? r : r + 1;
          const nc = dir === "across" ? c + 1 : c;
          if (get(nr, nc)) return { ok: false };
        }
      }
      return { ok: true };
    }

    function place(wordObj, row, col, dir, anchor) {
      for (let i = 0; i < wordObj.answer.length; i++) {
        const r = dir === "across" ? row : row + i;
        const c = dir === "across" ? col + i : col;
        set(r, c, wordObj.answer[i]);
      }
      placed.push({ id: wordObj.id, dir, row, col, answer: wordObj.answer, clue: wordObj.clue, hint: wordObj.hint });

      if (anchor) {
        overlaps.push({ a: wordObj.id, aIndex: anchor.iNew, b: anchor.otherId, bIndex: anchor.iOld });
      }
    }

    function unplace(wordObj, row, col, dir) {
      // remove letters not used by others
      for (let i = 0; i < wordObj.answer.length; i++) {
        const r = dir === "across" ? row : row + i;
        const c = dir === "across" ? col + i : col;
        // check whether any other entry uses this cell
        let usedByOther = false;
        for (const e of placed) {
          if (e.id === wordObj.id) continue;
          for (let j = 0; j < e.answer.length; j++) {
            const rr = e.dir === "across" ? e.row : e.row + j;
            const cc = e.dir === "across" ? e.col + j : e.col;
            if (rr === r && cc === c) { usedByOther = true; break; }
          }
          if (usedByOther) break;
        }
        if (!usedByOther) del(r, c);
      }
      // remove placed record
      const idx = placed.findIndex(e => e.id === wordObj.id);
      placed.splice(idx, 1);
      // remove overlaps mentioning this id
      for (let k = overlaps.length - 1; k >= 0; k--) {
        if (overlaps[k].a === wordObj.id || overlaps[k].b === wordObj.id) overlaps.splice(k, 1);
      }
    }

    function scoreCrossings(wordObj, cand) {
      let count = 0;
      for (let i = 0; i < wordObj.answer.length; i++) {
        const r = cand.dir === "across" ? cand.row : cand.row + i;
        const c = cand.dir === "across" ? cand.col + i : cand.col;
        if (get(r, c) === wordObj.answer[i]) count++;
      }
      return count;
    }

    function measureBoundingBoxAfter(wordObj, cand) {
      let minRow = Infinity;
      let minCol = Infinity;
      let maxRow = -Infinity;
      let maxCol = -Infinity;

      for (const k of grid.keys()) {
        const [rowText, colText] = k.split(":");
        const row = Number(rowText);
        const col = Number(colText);
        if (row < minRow) minRow = row;
        if (row > maxRow) maxRow = row;
        if (col < minCol) minCol = col;
        if (col > maxCol) maxCol = col;
      }

      for (let i = 0; i < wordObj.answer.length; i++) {
        const row = cand.dir === "across" ? cand.row : cand.row + i;
        const col = cand.dir === "across" ? cand.col + i : cand.col;
        if (row < minRow) minRow = row;
        if (row > maxRow) maxRow = row;
        if (col < minCol) minCol = col;
        if (col > maxCol) maxCol = col;
      }

      const rows = maxRow - minRow + 1;
      const cols = maxCol - minCol + 1;

      return {
        rows,
        cols,
        area: rows * cols,
        imbalance: Math.abs(rows - cols),
        longestSide: Math.max(rows, cols),
      };
    }

    function candidatesFor(wordObj) {
      const out = [];
      for (const other of placed) {
        for (let iOld = 0; iOld < other.answer.length; iOld++) {
          const letter = other.answer[iOld];
          for (let iNew = 0; iNew < wordObj.answer.length; iNew++) {
            if (wordObj.answer[iNew] !== letter) continue;
            const crossR = other.dir === "across" ? other.row : other.row + iOld;
            const crossC = other.dir === "across" ? other.col + iOld : other.col;
            const dir = other.dir === "across" ? "down" : "across";
            const row = dir === "across" ? crossR : crossR - iNew;
            const col = dir === "across" ? crossC - iNew : crossC;
            const test = canPlace(wordObj.answer, row, col, dir);
            if (test.ok) {
              out.push({
                row,
                col,
                dir,
                anchor: { otherId: other.id, iNew, iOld },
                crossingCount: scoreCrossings(wordObj, { row, col, dir }),
                bbox: measureBoundingBoxAfter(wordObj, { row, col, dir }),
              });
            }
          }
        }
      }
      out.sort((a, b) => {
        const candidateScoreA = a.crossingCount * CANDIDATE_CROSSING_WEIGHT - scoreShapeMetrics(a.bbox);
        const candidateScoreB = b.crossingCount * CANDIDATE_CROSSING_WEIGHT - scoreShapeMetrics(b.bbox);
        if (candidateScoreA !== candidateScoreB) {
          return candidateScoreB - candidateScoreA;
        }
        if (a.bbox.longestSide !== b.bbox.longestSide) {
          return a.bbox.longestSide - b.bbox.longestSide;
        }
        return a.bbox.area - b.bbox.area;
      });
      return out;
    }

    function checkAllHaveCrossing() {
      const counts = new Map(words.map(w => [w.id, 0]));
      for (const o of overlaps) {
        counts.set(o.a, (counts.get(o.a) || 0) + 1);
        counts.set(o.b, (counts.get(o.b) || 0) + 1);
      }
      return placed.every(p => counts.get(p.id) > 0);
    }

    // backtracking
    function backtrack(idx, words) {
      if (idx >= words.length) {
        return checkAllHaveCrossing();
      }
      const w = words[idx];

      const cands = candidatesFor(w);

      for (const c of cands) {
        if (attemptBudget-- <= 0) return false;
        place(w, c.row, c.col, c.dir, c.anchor);
        if (backtrack(idx + 1, words)) return true;
        unplace(w, c.row, c.col, c.dir);
      }
      return false;
    }

    function buildPayload() {
      return {
        title: o.title,
        subtitle: o.subtitle,
        description: o.description,
        entries: placed.map(entry => ({
          id: entry.id,
          dir: entry.dir,
          row: entry.row,
          col: entry.col,
          answer: entry.answer,
          clue: entry.clue,
          hint: entry.hint,
        })),
        overlaps: overlaps.slice()
      };
    }

    // caller seeds the first word
    return {
      seed(wordIdx, dir) {
        if (attemptBudget <= 0) {
          return null;
        }

        resetPlacementState();
        const wordsCopy = words.slice(); // local copy
        // put chosen seed at index 0
        if (wordIdx !== 0) {
          const tmp = wordsCopy[0];
          wordsCopy[0] = wordsCopy[wordIdx];
          wordsCopy[wordIdx] = tmp;
        }

        const seedWord = wordsCopy[0];
        // The first seed always fits on an empty grid at (0, 0).
        place(seedWord, 0, 0, dir, null);
        if (backtrack(1, wordsCopy)) {
          return buildPayload();
        }
        return null;
      }
    };
  }

  // ---------- multi-seed, multi-shuffle strategy ----------
  // try several shuffles and each word×dir as the seed
  function shuffled(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(_random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  let tries = 0;
  let bestLayout = null;
  while (tries < o.seedTries) {
    const words = (tries === 0) ? baseWords : shuffled(baseWords);
    const engine = tryBuild(words);
    for (let wi = 0; wi < words.length; wi++) {
      for (const d of dirs) {
        const payload = engine.seed(wi, d);
        if (!payload) continue;

        const candidateLayout = {
          payload,
          metrics: measurePayloadLayout(payload),
        };

        if (isBetterLayout(candidateLayout, bestLayout)) {
          bestLayout = candidateLayout;
        }
      }
    }
    tries++;
  }

  if (bestLayout) {
    return bestLayout.payload;
  }

  throw new Error("Failed to generate a valid crossword for all words within attempt budget.");
}
