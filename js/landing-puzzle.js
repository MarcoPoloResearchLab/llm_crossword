/* landing-puzzle.js — renders a sample moon crossword on the landing page using CrosswordWidget */
(function () {
  "use strict";

  var container = document.getElementById("landingSamplePuzzle");
  if (!container) return;

  // Hardcoded moon puzzle items (same format as crosswords.json).
  var moonItems = [
    { word: "lunar", definition: "Relating to the Moon", hint: "Earth's companion" },
    { word: "apollo", definition: "Program that took humans to the Moon", hint: "Saturn V missions" },
    { word: "orbit", definition: "The Moon's path around Earth", hint: "elliptical route" },
    { word: "tides", definition: "Ocean rise-and-fall pulled by the Moon", hint: "regular shoreline shifts" },
    { word: "mare", definition: "A lunar 'sea' not made of water", hint: "shares name with horse" },
  ];

  // Generate the crossword payload using the global generator.
  if (typeof generateCrossword !== "function") return;
  var payload = generateCrossword(moonItems, {
    title: "Mini Crossword \u2014 Moon Edition",
    subtitle: "Try solving this mini puzzle right here!",
  });

  // Create a lightweight widget (no hints, no panning, no keyboard nav).
  var widget = new window.CrosswordWidget(container, {
    puzzle: payload,
    hints: false,
    responsive: true,
    draggable: false,
    keyboard: false,
    showTitle: true,
    showControls: true,
    showSelector: false,
  });
})();
