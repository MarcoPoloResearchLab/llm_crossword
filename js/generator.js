/* generator.js — builds a crossword payload from [{word, definition}]
   Guarantees: returns a payload only if *all* words are placed with
   - ≥1 intersection per word
   - no side-touching except true crossings
*/

function generateCrossword(items, opts = {}) {
  const o = {
    title: opts.title ?? "Mini Crossword — Generated",
    subtitle: opts.subtitle ?? "Auto-generated from word list.",
    maxAttempts: opts.maxAttempts ?? 4000,  // global backtracking budget per try
    seedTries: opts.seedTries ?? 24,        // how many distinct seed choices (word+dir+shuffles)
  };

  // ---------- sanitize input ----------
  let baseWords = items.map((x, i) => ({
    id: `W${i}`,
    answer: String(x.word || "").toUpperCase().replace(/[^A-Z]/g, ""),
    clue: String(x.definition || "").trim(),
  })).filter(w => w.answer.length > 1);

  if (baseWords.length === 0) {
    throw new Error("No valid words (need length ≥ 2, A–Z).");
  }

  // deterministic sort by length (desc), then alpha to stabilize
  baseWords.sort((a, b) =>
    (b.answer.length - a.answer.length) || (a.answer < b.answer ? -1 : 1)
  );

  // ---------- helpers to copy/reset state ----------
  const dirs = ["across", "down"];

  function tryBuild(words) {
    // sparse grid (normalized integer coords)
    const grid = new Map(); // "r:c" -> 'A'
    const placed = [];      // { id, dir, row, col, answer, clue }
    const overlaps = [];    // { a, aIndex, b, bIndex }
    let attemptBudget = o.maxAttempts;

    const key = (r, c) => `${r}:${c}`;
    const get = (r, c) => grid.get(key(r, c));
    const set = (r, c, ch) => grid.set(key(r, c), ch);
    const del = (r, c) => grid.delete(key(r, c));

    function canPlace(answer, row, col, dir) {
      let crosses = 0;
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
        } else {
          crosses++;
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

      // require ≥1 crossing except for very first word
      if (grid.size > 0 && crosses === 0) return { ok: false };
      return { ok: true };
    }

    function place(wordObj, row, col, dir, anchor) {
      for (let i = 0; i < wordObj.answer.length; i++) {
        const r = dir === "across" ? row : row + i;
        const c = dir === "across" ? col + i : col;
        set(r, c, wordObj.answer[i]);
      }
      placed.push({ id: wordObj.id, dir, row, col, answer: wordObj.answer, clue: wordObj.clue });

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
      if (idx >= 0) placed.splice(idx, 1);
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

    function bboxAfter(wordObj, cand) {
      // approximate area after placing candidate
      let minR = 0, minC = 0, maxR = 0, maxC = 0;
      let first = true;
      for (const k of grid.keys()) {
        const [rs, cs] = k.split(":"); const r = +rs, c = +cs;
        if (first) { minR = maxR = r; minC = maxC = c; first = false; }
        else { if (r < minR) minR = r; if (r > maxR) maxR = r; if (c < minC) minC = c; if (c > maxC) maxC = c; }
      }
      for (let i = 0; i < wordObj.answer.length; i++) {
        const r = cand.dir === "across" ? cand.row : cand.row + i;
        const c = cand.dir === "across" ? cand.col + i : cand.col;
        if (first) { minR = maxR = r; minC = maxC = c; first = false; }
        else { if (r < minR) minR = r; if (r > maxR) maxR = r; if (c < minC) minC = c; if (c > maxC) maxC = c; }
      }
      return (maxR - minR + 1) * (maxC - minC + 1);
    }

    function candidatesFor(wordObj) {
      const out = [];
      if (grid.size === 0) {
        // seeding handled by caller
        return out;
      }
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
            if (test.ok) out.push({ row, col, dir, anchor: { otherId: other.id, iNew, iOld } });
          }
        }
      }
      // prefer more crossings, then smaller box
      out.sort((a, b) => {
        const dx = scoreCrossings(wordObj, b) - scoreCrossings(wordObj, a);
        if (dx) return dx;
        return bboxAfter(wordObj, a) - bboxAfter(wordObj, b);
      });
      return out;
    }

    function checkAllHaveCrossing() {
      const counts = new Map(words.map(w => [w.id, 0]));
      for (const o of overlaps) {
        counts.set(o.a, (counts.get(o.a) || 0) + 1);
        counts.set(o.b, (counts.get(o.b) || 0) + 1);
      }
      return placed.every(p => (counts.get(p.id) || 0) > 0);
    }

    // backtracking
    function backtrack(idx, words) {
      if (idx >= words.length) {
        return checkAllHaveCrossing();
      }
      const w = words[idx];

      const cands = grid.size === 0
        ? [] // seed placement is handled before calling backtrack
        : candidatesFor(w);

      for (const c of cands) {
        if (attemptBudget-- <= 0) return false;
        place(w, c.row, c.col, c.dir, c.anchor);
        if (backtrack(idx + 1, words)) return true;
        unplace(w, c.row, c.col, c.dir);
      }
      return false;
    }

    // caller seeds the first word
    return {
      seed(wordIdx, dir) {
        const wordsCopy = words.slice(); // local copy
        // put chosen seed at index 0
        if (wordIdx !== 0) {
          const tmp = wordsCopy[0];
          wordsCopy[0] = wordsCopy[wordIdx];
          wordsCopy[wordIdx] = tmp;
        }

        const seedWord = wordsCopy[0];
        // try the seed at (0,0) in desired dir
        const ok = canPlace(seedWord.answer, 0, 0, dir).ok;
        if (!ok) return null;
        place(seedWord, 0, 0, dir, null);
        if (backtrack(1, wordsCopy)) {
          // build payload
          return {
            title: o.title,
            subtitle: o.subtitle,
            entries: placed.map(e => ({
              id: e.id, dir: e.dir, row: e.row, col: e.col, answer: e.answer, clue: e.clue
            })),
            overlaps: overlaps.slice()
          };
        }
        // undo seed and fail
        unplace(seedWord, 0, 0, dir);
        return null;
      }
    };
  }

  // ---------- multi-seed, multi-shuffle strategy ----------
  // try several shuffles and each word×dir as the seed
  function shuffled(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  let tries = 0;
  while (tries < o.seedTries) {
    const words = (tries === 0) ? baseWords : shuffled(baseWords);
    const engine = tryBuild(words);
    for (let wi = 0; wi < words.length; wi++) {
      for (const d of dirs) {
        const payload = engine.seed(wi, d);
        if (payload) return payload; // success: all words placed
      }
    }
    tries++;
  }

  throw new Error("Failed to generate a valid crossword for all words within attempt budget.");
}
