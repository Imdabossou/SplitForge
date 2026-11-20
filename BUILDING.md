# Building SplitForge

There's no build step: `index.html` loads plain scripts from `src/`. Serve the folder with any static web server (`python3 -m http.server`) and open it in a browser with WebGL2.

## Tests

Node 18 or later:

```sh
npm test                                    # geometry tests
for f in src/*.js; do node --check "$f"; done   # syntax check, as CI does
```

The geometry tests split a range of shapes on every axis with every connector type. They check that each part is a closed, consistently oriented solid, that connectors stay inside the material, and that volumes add up.

## Source layout

| File | Purpose |
| --- | --- |
| `src/stl.js` | Binary and ASCII STL parsing, binary STL writing |
| `src/split.js` | Mesh welding, cutting, cap triangulation, connector placement and geometry, print orientation, overhangs. It has no DOM access, so it runs under Node |
| `src/sample.js` | The built-in sample model |
| `src/renderer.js` | WebGL2 viewport |
| `src/exporters.js` | STL, zip, OpenSCAD, JSON and CSV export |
| `src/app.js` | UI wiring |
| `src/vendor/earcut.js` | [earcut](https://github.com/mapbox/earcut) 2.2.4 polygon triangulation (ISC licence) |
