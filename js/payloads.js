/* payloads.js — build puzzles at runtime using the generator.
   Input format: [{ word: string, definition: string }]
   Output schema matches the renderer: { title, subtitle, entries[], overlaps[] }
*/

/* Theme wordlists (clean, real words only) */
const PUZZLE_SPECS = [
  {
    title: "Mini Crossword — Moon Edition",
    subtitle: "Generated from lunar terms.",
    items: [
      { word: "orbit",  definition: "The Moon’s path around Earth" },
      { word: "mare",   definition: "A lunar “sea” not made of water" },
      { word: "tides",  definition: "Ocean rise-and-fall pulled by the Moon" },
      { word: "lunar",  definition: "Relating to the Moon" },
      { word: "apollo", definition: "Program that took humans to the Moon" }
    ]
  },
  {
    title: "Mini Crossword — Sun Edition",
    subtitle: "Generated from solar terms.",
    items: [
      { word: "flare",  definition: "Sudden solar burst" },
      { word: "dawn",   definition: "First light of day" },
      { word: "rays",   definition: "What sunlight travels as" },
      { word: "solar",  definition: "Relating to the Sun" },
      { word: "corona", definition: "The Sun’s outer atmosphere" }
    ]
  },
  {
    title: "Mini Crossword — Greek Gods",
    subtitle: "Generated from Olympian names.",
    items: [
      { word: "zeus",   definition: "King of the Olympians" },
      { word: "hera",   definition: "Queen of the gods" },
      { word: "ares",   definition: "God of war" },
      { word: "hermes", definition: "Messenger god with winged sandals" },
      { word: "athena", definition: "Goddess of wisdom and warfare" }
    ]
  }
];

/* Build the array the renderer expects */
const CROSSWORD_PUZZLES = PUZZLE_SPECS.map(spec =>
  generateCrossword(spec.items, { title: spec.title, subtitle: spec.subtitle })
);

/* If you want to add puzzles dynamically later:
   CROSSWORD_PUZZLES.push(generateCrossword(newItems, {title: "..."}));
*/
