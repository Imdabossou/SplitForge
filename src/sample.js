// Sample — built-in demo model so the tool can be tried without an STL to hand

const Sample = (() => {

  function signedArea(pts) {
    let a = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
    return a / 2;
  }

  // Extrudes a 2D outline (with holes) from z = 0 to z = h. Returns a triangle soup.
  function extrude(outer, holes, h) {
    const out = [];
    const tri = (a, b, c) => out.push(...a, ...b, ...c);
    const ccw = signedArea(outer) > 0 ? outer : outer.slice().reverse();
    const cws = holes.map(p => signedArea(p) < 0 ? p : p.slice().reverse());
    for (const loop of [ccw, ...cws]) {
      for (let i = 0; i < loop.length; i++) {
        const [x0, y0] = loop[i], [x1, y1] = loop[(i + 1) % loop.length];
        tri([x0, y0, 0], [x1, y1, 0], [x1, y1, h]);
        tri([x0, y0, 0], [x1, y1, h], [x0, y0, h]);
      }
    }
    const flat = [], holeIdx = [];
    ccw.forEach(p => flat.push(...p));
    for (const hl of cws) { holeIdx.push(flat.length / 2); hl.forEach(p => flat.push(...p)); }
    const t = earcut(flat, holeIdx);
    for (let k = 0; k < t.length; k += 3) {
      const P = i => [flat[i * 2], flat[i * 2 + 1]];
      let [a, b, c] = [P(t[k]), P(t[k + 1]), P(t[k + 2])];
      if (signedArea([a, b, c]) < 0) [b, c] = [c, b];
      tri([...a, h], [...b, h], [...c, h]);
      tri([...a, 0], [...c, 0], [...b, 0]);
    }
    return new Float32Array(out);
  }

  function circle(cx, cy, r, n = 48) {
    return Array.from({ length: n }, (_, i) => [cx + r * Math.cos(2 * Math.PI * i / n), cy + r * Math.sin(2 * Math.PI * i / n)]);
  }

  function roundedRect(w, h, r, n = 8) {
    const pts = [];
    const corners = [[w / 2 - r, h / 2 - r, 0], [-w / 2 + r, h / 2 - r, 90], [-w / 2 + r, -h / 2 + r, 180], [w / 2 - r, -h / 2 + r, 270]];
    for (const [cx, cy, start] of corners)
      for (let i = 0; i <= n; i++) {
        const t = (start + 90 * i / n) * Math.PI / 180;
        pts.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
      }
    return pts;
  }

  // A rounded block with a round and a slot-shaped hole through it.
  function demoBlock() {
    const slot = roundedRect(14, 36, 6).map(([x, y]) => [x + 16, y]);
    return extrude(roundedRect(70, 50, 8), [circle(-12, 0, 13), slot], 90);
  }

  return { extrude, circle, roundedRect, demoBlock };
})();

if (typeof module !== 'undefined') module.exports = Sample;
