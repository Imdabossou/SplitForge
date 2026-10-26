// Geometry tests: every split part must be a closed, consistently oriented solid.
// Run with: npm test

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Load the browser scripts into one context, the same way index.html does.
const ctx = vm.createContext({ console, TextDecoder, TextEncoder });
for (const f of ['vendor/earcut.js', 'stl.js', 'split.js', 'sample.js'])
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src', f), 'utf8'), ctx, { filename: f });
const { Split, STL, Sample } = vm.runInContext('({ Split, STL, Sample })', ctx);

function sphere(r, rings = 24, segs = 32) {
  const out = [];
  const P = (i, j) => {
    const th = Math.PI * i / rings, ph = 2 * Math.PI * j / segs;
    return [r * Math.sin(th) * Math.cos(ph), r * Math.sin(th) * Math.sin(ph), r * Math.cos(th)];
  };
  for (let i = 0; i < rings; i++) for (let j = 0; j < segs; j++) {
    const a = P(i, j), b = P(i + 1, j), c = P(i + 1, j + 1), d = P(i, j + 1);
    if (i > 0) out.push(...a, ...b, ...d);
    if (i < rings - 1) out.push(...b, ...c, ...d);
  }
  return new Float32Array(out);
}

function torus(R, r, n = 48, m = 24) {
  const out = [];
  const P = (i, j) => {
    const u = 2 * Math.PI * i / n, v = 2 * Math.PI * j / m;
    return [(R + r * Math.cos(v)) * Math.cos(u), (R + r * Math.cos(v)) * Math.sin(u), r * Math.sin(v)];
  };
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) {
    const a = P(i, j), b = P(i + 1, j), c = P(i + 1, j + 1), d = P(i, j + 1);
    out.push(...a, ...b, ...c, ...a, ...c, ...d);
  }
  return new Float32Array(out);
}

const box = (w, d, h) => Sample.extrude([[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]], [], h);

const defaults = { type: 'peg', pattern: 'corners', grid: 2, diameter: 5, depth: 4, clearance: 0.2, margin: 1.5, studSide: 'neg' };

function run(positions, opts) {
  const mesh = Split.prepare(positions);
  const o = { ...defaults, ...opts };
  const a = Split.AXES[o.axis];
  if (o.offset === undefined) o.offset = mesh.bounds.min[a] + mesh.bounds.size[a] * (o.t ?? 0.5);
  return { mesh, res: Split.split(mesh, o) };
}

function assertSolid(soup, label) {
  const m = Split.prepare(soup);
  assert.equal(m.edges.open, 0, `${label}: open edges`);
  assert.equal(m.edges.bad, 0, `${label}: non-manifold / flipped edges`);
  assert.ok(Split.volume(soup) > 0, `${label}: volume should be positive`);
}

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

test('input meshes are watertight', () => {
  for (const [name, m] of [['sphere', sphere(20)], ['torus', torus(30, 8)], ['box', box(40, 30, 50)], ['demo', Sample.demoBlock()]]) {
    const mesh = Split.prepare(m);
    assert.ok(mesh.edges.watertight, name);
    assert.ok(mesh.volume > 0, name);
  }
});

test('plain cut: parts are closed and volumes add up', () => {
  for (const [name, m] of [['sphere', sphere(20)], ['torus', torus(30, 8)], ['box', box(40, 30, 50)], ['demo', Sample.demoBlock()]]) {
    for (const axis of ['x', 'y', 'z']) for (const t of [0.3, 0.5, 0.77]) {
      const { mesh, res } = run(m, { axis, t, type: 'none' });
      assertSolid(res.pos, `${name} ${axis}@${t} pos`);
      assertSolid(res.neg, `${name} ${axis}@${t} neg`);
      near(Split.volume(res.pos) + Split.volume(res.neg), mesh.volume, mesh.volume * 1e-4, `${name} ${axis}@${t} volume`);
      assert.equal(res.section.open, 0);
    }
  }
});

test('section topology: torus has a hole on Z and two islands on X', () => {
  assert.equal(run(torus(30, 8), { axis: 'z', type: 'none' }).res.section.islands, 1);
  assert.equal(run(torus(30, 8), { axis: 'z', type: 'none' }).res.section.loops, 2);
  assert.equal(run(torus(30, 8), { axis: 'x', type: 'none' }).res.section.islands, 2);
});

test('cut exactly through vertices is handled', () => {
  // The sphere has a ring of vertices exactly on z = 0 and a meridian on x = 0.
  for (const axis of ['z', 'x']) {
    const { res } = run(sphere(20), { axis, offset: 0 });
    assertSolid(res.pos, `sphere ${axis} pos`); assertSolid(res.neg, `sphere ${axis} neg`);
    assert.equal(res.connectors.length, 4);
  }
  // Cutting right at the top cap of a box must not produce a broken part.
  const { res } = run(box(40, 30, 50), { axis: 'z', offset: 50 - 1e-5, type: 'none' });
  assertSolid(res.neg, 'box neg');
});

test('peg, snap and dowel connectors keep parts watertight', () => {
  for (const type of ['peg', 'snap', 'dowel']) for (const axis of ['x', 'y', 'z']) for (const studSide of ['neg', 'pos']) {
    const { res } = run(box(60, 50, 70), { axis, type, studSide });
    assert.equal(res.connectors.length, 4, `${type} ${axis}: 4 connectors`);
    assertSolid(res.pos, `${type} ${axis} ${studSide} pos`);
    assertSolid(res.neg, `${type} ${axis} ${studSide} neg`);
    if (type === 'dowel') {
      assert.ok(res.pins);
      assertSolid(res.pins, 'pins');
      near(Split.volume(res.pins), 4 * Math.PI * 2.5 ** 2 * 8, 4 * Math.PI * 2.5 ** 2 * 8 * 0.05, 'pin volume');
    }
  }
});

test('peg volumes: stud adds and socket removes material', () => {
  const plain = run(box(60, 50, 70), { axis: 'z', type: 'none' }).res;
  const peg = run(box(60, 50, 70), { axis: 'z', type: 'peg', studSide: 'neg' }).res;
  const stud = Split.volume(peg.neg) - Split.volume(plain.neg);
  const socket = Split.volume(plain.pos) - Split.volume(peg.pos);
  assert.ok(stud > 4 * 0.9 * Math.PI * 2.5 ** 2 * 4 * 0.9, `stud volume ${stud}`);
  assert.ok(socket > stud, 'socket is bigger than the stud');
});

test('connectors stay inside material and clear of holes', () => {
  const { mesh, res } = run(Sample.demoBlock(), { axis: 'z', pattern: 'grid', grid: 3 });
  assert.ok(res.connectors.length >= 4, `placed ${res.connectors.length}`);
  for (const c of res.connectors) {
    // Every connector must have solid material for the full socket depth above it.
    const d = Split.materialDepth(mesh, 'z', res.s, c.u, c.v, 1);
    assert.ok(d >= 4.4, `connector ${c.id} depth ${d}`);
    // ...and must not sit in the round hole (centre -12,0 r=13) or the slot.
    assert.ok(Math.hypot(c.u + 12, c.v) > 13 + 2.7, `connector ${c.id} clear of round hole`);
  }
  assertSolid(res.pos, 'pos'); assertSolid(res.neg, 'neg');
});

test('connectors land in the real section, not the bounding box', () => {
  // A sphere's bounding-box corners are all outside the circular section.
  const { res } = run(sphere(25), { axis: 'z' });
  assert.equal(res.connectors.length, 4);
  for (const c of res.connectors) assert.ok(Math.hypot(c.u, c.v) < 25 - 2.7, 'inside circle');
  assertSolid(res.pos, 'pos'); assertSolid(res.neg, 'neg');
});

test('each island gets its own connectors', () => {
  const { res } = run(torus(30, 8), { axis: 'x', pattern: 'center' });
  assert.equal(res.connectors.length, 2);
  assert.notEqual(res.connectors[0].island, res.connectors[1].island);
});

test('thin sections are skipped rather than broken through', () => {
  // Cut 2 mm from the top: no room for a 4.4 mm socket + floor.
  const { res } = run(box(60, 50, 70), { axis: 'z', offset: 68, studSide: 'neg' });
  assert.equal(res.connectors.length, 0);
  assert.equal(res.skipped, 4);
  assertSolid(res.pos, 'pos'); assertSolid(res.neg, 'neg');
});

test('STL round trip (binary and ASCII)', () => {
  const soup = box(10, 20, 30);
  const back = STL.parse(STL.encodeBinary(soup));
  assert.deepEqual(Array.from(back), Array.from(soup));
  let ascii = 'solid t\n';
  for (let i = 0; i < soup.length; i += 9) {
    ascii += 'facet normal 0 0 0\nouter loop\n';
    for (let k = 0; k < 9; k += 3) ascii += `vertex ${soup[i + k]} ${soup[i + k + 1]} ${soup[i + k + 2]}\n`;
    ascii += 'endloop\nendfacet\n';
  }
  ascii += 'endsolid t\n';
  const parsed = STL.parse(new TextEncoder().encode(ascii).buffer);
  assert.equal(parsed.length, soup.length);
  // Binary file whose header starts with "solid" must still parse as binary.
  const buf = STL.encodeBinary(soup, 'solid but binary');
  assert.equal(STL.parse(buf).length, soup.length);
  assert.throws(() => STL.parse(new TextEncoder().encode('hello').buffer));
});

test('print orientation puts the cut face on the bed', () => {
  const { res } = run(box(60, 50, 70), { axis: 'x', type: 'dowel' });
  for (const side of ['pos', 'neg']) {
    const M = Split.printRotation('x', side, res.kinds[side]);
    const placed = Split.placeOnBed(res[side], M);
    assertSolid(placed, `${side} on bed`);
    // The cut face (60 wide in x → part is 30 long) becomes the bed: height 30.
    let maxZ = -Infinity, minZ = Infinity;
    for (let i = 2; i < placed.length; i += 3) { maxZ = Math.max(maxZ, placed[i]); minZ = Math.min(minZ, placed[i]); }
    near(minZ, 0, 1e-4, 'sits on bed'); near(maxZ, 30, 1e-3, 'height');
    // Only the dowel-hole ceilings overhang (four small bridged discs).
    near(Split.overhangs(res[side], M).area, 4 * Math.PI * 2.7 ** 2, 5, 'hole ceilings only');
  }
  // Stud part goes cut face up: studs stick out of the top.
  const peg = run(box(60, 50, 70), { axis: 'z', type: 'peg', studSide: 'neg' }).res;
  const placed = Split.placeOnBed(peg.neg, Split.printRotation('z', 'neg', 'stud'));
  let maxZ = -Infinity;
  for (let i = 2; i < placed.length; i += 3) maxZ = Math.max(maxZ, placed[i]);
  near(maxZ, 35 + 4, 1e-3, 'studs on top');
});

test('overhangs: a sphere has its lower cap flagged, a box has none', () => {
  const I = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  assert.ok(Split.overhangs(sphere(20), I).area > 100);
  assert.equal(Split.overhangs(box(10, 10, 10), I).area, 0);
});
