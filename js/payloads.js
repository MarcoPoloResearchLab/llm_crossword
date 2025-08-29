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
            {word: "orbit", definition: "The Moon’s path around Earth"},
            {word: "mare", definition: "A lunar “sea” not made of water"},
            {word: "tides", definition: "Ocean rise-and-fall pulled by the Moon"},
            {word: "lunar", definition: "Relating to the Moon"},
            {word: "apollo", definition: "Program that took humans to the Moon"}
        ]
    },
    {
        title: "Mini Crossword — Sun Edition",
        subtitle: "Generated from solar terms.",
        items: [
            {word: "flare", definition: "Sudden solar burst"},
            {word: "dawn", definition: "First light of day"},
            {word: "rays", definition: "What sunlight travels as"},
            {word: "solar", definition: "Relating to the Sun"},
            {word: "corona", definition: "The Sun’s outer atmosphere"}
        ]
    },
    {
        title: "Mini Crossword — Greek Gods",
        subtitle: "Generated from Olympian names.",
        items: [
            {word: "zeus", definition: "King of the Olympians"},
            {word: "hera", definition: "Queen of the gods"},
            {word: "ares", definition: "God of war"},
            {word: "hermes", definition: "Messenger god with winged sandals"},
            {word: "athena", definition: "Goddess of wisdom and warfare"}
        ]
    },
    {
        title: "Greek Gods",
        subtitle: "Olympian and other Greek deities.",
        items: [
            {word: "zeus", definition: "King of the Olympians"},
            {word: "hera", definition: "Queen of the gods"},
            {word: "ares", definition: "God of war"},
            {word: "hermes", definition: "Messenger god with winged sandals"},
            {word: "athena", definition: "Goddess of wisdom and warfare"},
            {word: "poseidon", definition: "God of the sea, earthquakes, and horses"},
            {word: "hades", definition: "God of the underworld"},
            {word: "demeter", definition: "Goddess of agriculture and the harvest"},
            {word: "apollo", definition: "God of the sun, music, and prophecy"},
            {word: "artemis", definition: "Goddess of the hunt and the moon"},
            {word: "hephaestus", definition: "God of fire and metalworking"},
            {word: "dionysus", definition: "God of wine, festivity, and theatre"},
            {word: "hestia", definition: "Goddess of the hearth and home"},
            {word: "eros", definition: "God of love and desire"},
            {word: "nyx", definition: "Primordial goddess of the night"},
            {word: "chronos", definition: "Personification of time"},
            {word: "nike", definition: "Goddess of victory"},
            {word: "tyche", definition: "Goddess of fortune and chance"},
            {word: "nemesis", definition: "Goddess of retribution and justice"},
            {word: "thanatos", definition: "Personification of death"}
        ]
    },
    {
    title: "Mini Crossword — Common & Proper Nouns",
    subtitle: "Clues tell you which kind of noun to find.",
    items: [
        // Common nouns
        { word: "mountain", definition: "In the sentence 'We climbed a tall mountain,' what is the common noun?" },
        { word: "river", definition: "In the sentence 'The river flows quickly,' what is the common noun?" },
        { word: "teacher", definition: "In the sentence 'The teacher gave homework,' what is the common noun?" },
        { word: "school", definition: "In the sentence 'The school has a playground,' what is the common noun?" },
        { word: "animal", definition: "In the sentence 'The animal was sleeping,' what is the common noun?" },
        { word: "music", definition: "In the sentence 'We listened to music,' what is the common noun?" },
        { word: "city", definition: "In the sentence 'The city was very busy,' what is the common noun?" },
        { word: "ocean", definition: "In the sentence 'The ocean has big waves,' what is the common noun?" },

        // Proper nouns
        { word: "everest", definition: "In the sentence 'Mount Everest is very high,' what is the proper noun?" },
        { word: "pacific", definition: "In the sentence 'The Pacific is the largest ocean,' what is the proper noun?" },
        { word: "nile", definition: "In the sentence 'The Nile flows through Egypt,' what is the proper noun?" },
        { word: "london", definition: "In the sentence 'London is a capital city,' what is the proper noun?" },
        { word: "jupiter", definition: "In the sentence 'Jupiter is the biggest planet,' what is the proper noun?" },
        { word: "africa", definition: "In the sentence 'Africa is a large continent,' what is the proper noun?" },
        { word: "february", definition: "In the sentence 'February is the second month,' what is the proper noun?" },
        { word: "google", definition: "In the sentence 'Google is a famous company,' what is the proper noun?" }
    ]
}
];

/* Build the array the renderer expects */
const CROSSWORD_PUZZLES = PUZZLE_SPECS.map(spec =>
    generateCrossword(spec.items, {title: spec.title, subtitle: spec.subtitle})
);
