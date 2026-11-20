# AGENTS.md

Static browser tool that cuts an STL on an axis plane, caps both faces and adds peg, snap or dowel connectors. Plain JavaScript, no build step, no dependencies besides the vendored earcut.

## Commands

- Tests: `npm test` (node:test, loads the `src/` scripts through `vm`)
- Syntax check: `for f in src/*.js; do node --check "$f"; done`
- Run: `python3 -m http.server <port>` in the repo root
- Layout and details: [BUILDING.md](BUILDING.md)

## Conventions

- Branches: work on `development`; `main` only gets tested releases.
- `src/split.js` is pure geometry with no DOM access. Keep it that way so the tests run in Node.
- Everything stays in the browser. No uploads, analytics or external requests.
- Light, dark and system themes, defaulting to the system, with the choice remembered.
- Keep README.md short. User how-to goes in `docs/guide.md`, developer detail in BUILDING.md.

## Design decisions

- Z is up. The "pos" part is the side with the larger axis coordinate.
- Pegs go on the "neg" (bottom) part by default. Print orientation puts peg parts cut face up and everything else cut face down.
- Placement works per island (each separate piece of the cut). A connector is skipped if there's no room for the socket depth plus a 0.8 mm floor.
- Every exported part must be watertight. The tests check this with a welded edge check; don't weaken it.

## Traps

- OpenSCAD isn't part of the test setup, so the `.scad` export hasn't been compile-tested. Check it by hand if you change it.
- UI testing needs a browser with WebGL2. Headless Chromium works with SwiftShader.
