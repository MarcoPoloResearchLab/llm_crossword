# AGENTS.md

## Spinning Allergy Wheel

I want a game written in JavaScript, using CDN only (no local npm, node, etc)

The game starts with the screen to select an allergy (e.g. peanuts, Italian sausage, and other food ingredients that
children often are allergic to)

After the selection a spinning wheel is present with the names of popular dishes from various cuisines. There is a stop
button to stop the wheel.

When we say start game, the allergens' selection disappears and the wheel starts spinning. there is a large red button
that says stop; otherwise the wheel spins for 30 seconds, progressively slowing down

When the wheel stops:

1. there are Spin and Restart buttons on the wheel.
2. the ingredients are revealed in a modal window. if there was an ingredient that a player was allergic to, then an
   ambulance sound is played and a puffed face is displayed. If there are no ingredients the player is allergic to, they
   Yum-yum sound is played.

The game is full screen with bright colors and bold graphics. There is a button that sends the browser full screen,
There is also a mute button to disable sounds.

There is a menu screen that allows selecting the dishes based on the allergic

## JavaScript Coding Standards (Browser ES Modules)

### 1. Naming & Identifiers

* No single-letter or non-descriptive names.
* camelCase → variables & functions.
* PascalCase → classes.
* SCREAMING_SNAKE_CASE → constants.
* Handlers named by behavior (`handleSpinButtonClick`, not `onClick`).

### 2. Dead Code & Duplication

* No unused variables, imports, or exports.
* No duplicated logic; extract helpers.
* One source of truth for repeated values or logic.

### 3. Strings & Enums

* All user-facing strings live in `constants.js`.
* Use `Object.freeze` for enums.
* Map keys must be constants or symbols, not ad-hoc strings.

### 4. Code Style

* ES modules (`type="module"`), strict mode.
* Pure functions for transforms; classes/factories for stateful logic.
* No mutation of imports; no parameter mutation.
* DOM operations live in `ui/`; business logic in `core/`.

### 5. Dependencies & Organization

* CDN-hosted dependencies only; no npm, bundlers, or Node tooling.
* Layout:

  ```
  /assets/{css,img,audio}
  /data/*.json
  /js/
    constants.js
    types.d.js
    utils/
    core/
    ui/
    app.js
  index.html
  ```

### 6. Testing

* Tests run in browser: `tests/index.html`.
* Table-driven cases, iterate array of inputs/outputs.
* Black-box only: test public APIs and DOM, not internals.
* Provide `assertEqual`, `assertDeepEqual`, `assertThrows` in `tests/assert.js`.

### 7. Documentation

* JSDoc required for public functions & classes.
* `// @ts-check` enabled at file top.
* `types.d.js` defines typedefs (e.g. `Dish`, `SpinResult`).
* Each domain module documented in `doc.md` or `README.md`.

### 8. Refactors

* Plan changes before coding; write bullets in PR description.
* Split files >300–400 lines by concern.
* `app.js` is composition root — dependencies wired there.

### 9. Error Handling & Logging

* Throw `Error`, never raw strings.
* Try/catch around user entry points; errors surface visibly in dev.
* `utils/logging.js` as adapter, no stray `console.log`.

### 10. Performance & UX

* Batch DOM writes with `requestAnimationFrame`.
* Cache selectors, avoid forced reflows.
* Animations async; no blocking waits.
* Optional deterministic RNG injection for replay/testing.

### 11. Linting & Formatting

* ESLint run manually (Dockerized).
* Prettier only on explicit trigger, never autosave.
* Core enforced rules: no-unused-vars, no-implicit-globals, no-var, prefer-const, eqeqeq, no-magic-numbers (allowlist:
  0,1,-1,100,360).

### 12. Data > Logic

* Validate catalogs (JSON) at boot.
* Logic assumes valid data; no scattered defensive checks.
* Fail fast on schema errors or missing assets.

### 13. Security & Boundaries

* No eval, no inline event handlers.
* CSP-friendly ES modules only.
* External calls go through `core/gateway.js`, mockable in tests.
