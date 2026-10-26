# SplitForge

A browser tool for splitting 3D models into printable parts, with connectors so the parts line up when you join them. Load an STL, pick a cut plane, choose a connector type and export the parts ready to slice. Nothing is uploaded: it all runs locally in the browser.

## Features

- **Clean cuts.** Both cut faces are capped and every exported part is a closed, watertight solid. This holds for sections with holes and for cuts that produce several separate pieces.
- **Connectors that fit the real section.** Connectors are placed inside the actual cut outline, not its bounding box. They keep clear of holes and edges, and each separate piece gets its own set. A connector is skipped if there isn't enough material behind it for its socket, so a socket never breaks through the far side of a part.
- **Connector types**
  - **Peg:** chamfered pegs on one part and sockets in the other.
  - **Snap:** pegs with a small bead that clicks into a groove in the socket.
  - **Dowel:** holes in both parts plus separate pins, so both parts can print cut face down.
  - **None:** just the cut.
- **Patterns:** center, corners, corners + midpoints, or an N×N grid. You can set diameter, depth, clearance and edge margin, and choose which part carries the pegs.
- **Print orientation.** Exported parts are rotated to sit on the bed: cut face down, or cut face up for the part carrying pegs, so the pegs print vertically.
- **Viewer:** solid, wireframe and X-ray modes, an exploded view, the cut outline drawn on the plane, and overhang highlighting in print orientation.
- **Exports:** each part as STL, the dowel pins as STL, everything as a `.zip`, a parametric OpenSCAD file that rebuilds the split from the original STL, and connector positions as JSON or CSV.
- Light and dark themes (follows the system setting by default) and a layout that works on phones.

## Using it

Open `index.html` through any static web server, for example:

```sh
python3 -m http.server
```

Then drop an STL onto the page, or click **Try the sample model**.

Controls in the viewport: drag to rotate, right-drag or Shift-drag to pan, scroll to zoom, double-click to reset the view. On touch screens, use one finger to rotate and two to pinch and pan.

### Tips

- **Clearance** is the radial gap between peg and socket. 0.15–0.25 mm suits most FDM printers. Print a small test first.
- If connectors are skipped, the cut is too thin for the socket depth. Reduce the depth or diameter, lower the edge margin, or move the cut.
- The model should be watertight. If it isn't, SplitForge warns you, and the cut face may have gaps where the mesh is open.

## Development

There is no build step. The page loads plain scripts from `src/`:

| File | Purpose |
| --- | --- |
| `src/stl.js` | Binary and ASCII STL parsing and binary STL writing |
| `src/split.js` | Welding, cutting, cap triangulation, connector placement and geometry, print orientation, overhangs (no DOM access) |
| `src/sample.js` | The built-in sample model |
| `src/renderer.js` | WebGL2 viewport |
| `src/exporters.js` | STL, zip, OpenSCAD, JSON and CSV export |
| `src/app.js` | UI wiring |
| `src/vendor/earcut.js` | [earcut](https://github.com/mapbox/earcut) 2.2.4 polygon triangulation (ISC licence) |

The geometry tests check that every part from every axis and connector type is a closed, consistently oriented solid. Run them with Node 18 or later:

```sh
npm test
```
