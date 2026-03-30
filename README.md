# LLM crossword

A crossword puzzle builder, powered by LLM.

## Auth config

Set `GOOGLE_CLIENT_ID` in `.env.tauth`. The browser runtime auth config is generated into `js/runtime-auth-config.js`, and the Docker and Playwright entry points render it automatically before startup.

## Local Docker

Use `make up` to start the stack and `make down` to stop it. If the default site port `8000` or one of the other exposed host ports is already occupied, `make up` automatically picks the next available port and writes the resolved values to `.runtime/ports.env`.

To force a specific host port instead of auto-allocation, pass it explicitly, for example `make up CROSSWORD_PORT=8010`.

## Planning Docs

- [Word Illustration Feature Plan](./docs/word-illustrations-plan.md)

## Using the Crossword

1. Choose a puzzle from the selector at the top of the page. Each puzzle loads with its own grid and clue list.
2. Click any cell and type to fill in letters. Use the arrow keys or the Tab key to move around the grid.
3. Drag the grid with the mouse or touch to pan around large puzzles.
4. Selecting a clue or a cell highlights the entire word and its clue. Solved clues are marked to show progress.
5. Press **Check** to verify your work. Correct letters are highlighted in green, while incorrect letters are marked in red.
6. Press **Reveal** to show all answers. The button toggles to **Hide** so you can return to your previous entries.
7. The status bar provides feedback after checking or revealing answers.

## License

This project is proprietary software. All rights reserved by Marco Polo Research Lab LLC.  
See the [LICENSE](./LICENSE) file for details.
