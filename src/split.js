// Split — welds an STL triangle soup, cuts it with an axis-aligned plane, caps both cut
// faces and adds connector geometry. Pure functions with no DOM access, so it also runs
// under the Node tests.
//
// Naming: the "pos" part is the side of the cut where the axis coordinate is greater
// than the cut value (top for Z), the "neg" part is the other side.

const Split = (() => {

  const AXES = { x: 0, y: 1, z: 2 };
  // In-plane axes (u, v) for each cut axis, chosen so that u × v points along +axis.
  const PLANE = { x: [1, 2], y: [2, 0], z: [0, 1] };
  const SEGMENTS = 32;
  const FLOOR = 0.8;             // material that must remain beyond a socket (mm)
  const SOCKET_GAP = 0.4;        // extra socket depth so pegs bottom out cleanly (mm)
  const SNAP_INTERFERENCE = 0.25; // how far a snap bead overlaps the socket mouth (mm)

  // ---------- small helpers ----------

  class Soup {
    constructor() { this.a = new Float32Array(9 * 256); this.n = 0; }
    reserve(k) {
      if (this.n + k <= this.a.length) return;
      const b = new Float32Array(Math.max(this.a.length * 2, this.n + k));
      b.set(this.a.subarray(0, this.n));
      this.a = b;
    }
    p(p) { this.reserve(3); this.a[this.n++] = p[0]; this.a[this.n++] = p[1]; this.a[this.n++] = p[2]; }
    tri(a, b, c) { this.p(a); this.p(b); this.p(c); }
    data() { return this.a.slice(0, this.n); }
  }

  function pointInPoly(xy, x, y) {
    let inside = false;
    for (let i = 0, j = xy.length - 2; i < xy.length; j = i, i += 2) {
      const yi = xy[i + 1], yj = xy[j + 1];
      if ((yi > y) !== (yj > y) && x < (xy[j] - xy[i]) * (y - yi) / (yj - yi) + xy[i]) inside = !inside;
    }
    return inside;
  }

  function distToPoly(xy, x, y) {
    let best = Infinity;
    for (let i = 0, j = xy.length - 2; i < xy.length; j = i, i += 2) {
      const ax = xy[j], ay = xy[j + 1], bx = xy[i], by = xy[i + 1];
      const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
      const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
      const ex = ax + t * dx - x, ey = ay + t * dy - y;
      const d = ex * ex + ey * ey;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  }

  function inBox(b, x, y) { return x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3]; }

  // ---------- mesh preparation ----------

  // Welds coincident vertices (0.1 µm grid), drops degenerate triangles and reports
  // whether the result is a closed, consistently oriented surface.
  function prepare(positions) {
    const q = 1e4, map = new Map(), verts = [], ids = new Uint32Array(positions.length / 3);
    for (let i = 0, k = 0; i < positions.length; i += 3, k++) {
      const x = positions[i], y = positions[i + 1], z = positions[i + 2];
      const key = Math.round(x * q) + ',' + Math.round(y * q) + ',' + Math.round(z * q);
      let id = map.get(key);
      if (id === undefined) { id = verts.length / 3; map.set(key, id); verts.push(x, y, z); }
      ids[k] = id;
    }
    const tris = [];
    for (let k = 0; k < ids.length; k += 3) {
      const a = ids[k], b = ids[k + 1], c = ids[k + 2];
      if (a !== b && b !== c && a !== c) tris.push(a, b, c);
    }
    if (!tris.length) throw new Error('Model has no usable triangles');
    const v = Float64Array.from(verts);
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < v.length; i += 3) for (let k = 0; k < 3; k++) {
      if (v[i + k] < min[k]) min[k] = v[i + k];
      if (v[i + k] > max[k]) max[k] = v[i + k];
    }
    const size = [0, 1, 2].map(k => max[k] - min[k]);
    const center = [0, 1, 2].map(k => (max[k] + min[k]) / 2);
    const t = Uint32Array.from(tris);
    return {
      verts: v, tris: t, vertCount: v.length / 3, triCount: t.length / 3,
      bounds: { min, max, size, center },
      edges: edgeReport(t, v.length / 3),
      volume: volumeIndexed(v, t),
    };
  }

  // open: edges used by one triangle; bad: edges shared by >2 triangles or by two
  // triangles with the same direction (inconsistent winding).
  function edgeReport(tris, vertCount) {
    const m = new Map();
    for (let i = 0; i < tris.length; i += 3) for (let e = 0; e < 3; e++) {
      const a = tris[i + e], b = tris[i + (e + 1) % 3];
      const key = a < b ? a * vertCount + b : b * vertCount + a;
      m.set(key, (m.get(key) || 0) + (a < b ? 1 : 1024));
    }
    let open = 0, bad = 0;
    for (const c of m.values()) {
      const f = c % 1024, r = Math.floor(c / 1024);
      if (f === 1 && r === 1) continue;
      if (f + r === 1) open++; else bad++;
    }
    return { open, bad, watertight: open === 0 && bad === 0 };
  }

  function volumeIndexed(v, t) {
    let vol = 0;
    for (let i = 0; i < t.length; i += 3) {
      const a = t[i] * 3, b = t[i + 1] * 3, c = t[i + 2] * 3;
      vol += v[a] * (v[b + 1] * v[c + 2] - v[b + 2] * v[c + 1])
           - v[a + 1] * (v[b] * v[c + 2] - v[b + 2] * v[c])
           + v[a + 2] * (v[b] * v[c + 1] - v[b + 1] * v[c]);
    }
    return vol / 6;
  }

  function volume(soup) {
    let vol = 0;
    for (let i = 0; i < soup.length; i += 9) {
      const [ax, ay, az, bx, by, bz, cx, cy, cz] = soup.subarray(i, i + 9);
      vol += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
    }
    return vol / 6;
  }

  // ---------- ray casting along the cut axis (for socket depth checks) ----------

  function rayGrid(mesh, axis) {
    mesh._grids = mesh._grids || {};
    if (mesh._grids[axis]) return mesh._grids[axis];
    const [ui, vi] = PLANE[axis], { verts, tris, bounds } = mesh;
    const G = Math.max(8, Math.min(256, Math.round(Math.sqrt(mesh.triCount / 4))));
    const u0 = bounds.min[ui], v0 = bounds.min[vi];
    const du = (bounds.size[ui] || 1) / G, dv = (bounds.size[vi] || 1) / G;
    const cell = (x, o, d) => {
      const i = ((x - o) / d) | 0;
      return i < 0 ? 0 : i >= G ? G - 1 : i;
    };
    // Two passes into one packed index array (cell k owns items[start[k]..start[k+1]]).
    const T = mesh.triCount, box = new Int32Array(T * 4), start = new Uint32Array(G * G + 1);
    for (let t = 0; t < T; t++) {
      const A = tris[t * 3] * 3, B = tris[t * 3 + 1] * 3, C = tris[t * 3 + 2] * 3;
      const ua = verts[A + ui], ub = verts[B + ui], uc = verts[C + ui];
      const va = verts[A + vi], vb = verts[B + vi], vc = verts[C + vi];
      const i0 = cell(Math.min(ua, ub, uc), u0, du), i1 = cell(Math.max(ua, ub, uc), u0, du);
      const j0 = cell(Math.min(va, vb, vc), v0, dv), j1 = cell(Math.max(va, vb, vc), v0, dv);
      box[t * 4] = i0; box[t * 4 + 1] = i1; box[t * 4 + 2] = j0; box[t * 4 + 3] = j1;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) start[j * G + i + 1]++;
    }
    for (let k = 0; k < G * G; k++) start[k + 1] += start[k];
    const items = new Uint32Array(start[G * G]), fill = start.slice(0, G * G);
    for (let t = 0; t < T; t++)
      for (let j = box[t * 4 + 2]; j <= box[t * 4 + 3]; j++)
        for (let i = box[t * 4]; i <= box[t * 4 + 1]; i++) items[fill[j * G + i]++] = t * 3;
    return (mesh._grids[axis] = { G, u0, v0, du, dv, start, items, cell });
  }

  // Distance from the cut plane to the first surface in direction dir (+1/-1) at (u, v).
  function materialDepth(mesh, axis, s, u, v, dir) {
    const g = rayGrid(mesh, axis), a = AXES[axis], [ui, vi] = PLANE[axis], { verts, tris } = mesh;
    const k = g.cell(v, g.v0, g.dv) * g.G + g.cell(u, g.u0, g.du);
    let best = Infinity;
    for (let q = g.start[k]; q < g.start[k + 1]; q++) {
      const t = g.items[q];
      const A = tris[t] * 3, B = tris[t + 1] * 3, C = tris[t + 2] * 3;
      const au = verts[A + ui], av = verts[A + vi], bu = verts[B + ui], bv = verts[B + vi], cu = verts[C + ui], cv = verts[C + vi];
      const det = (bv - cv) * (au - cu) + (cu - bu) * (av - cv);
      if (Math.abs(det) < 1e-12) continue;
      const l1 = ((bv - cv) * (u - cu) + (cu - bu) * (v - cv)) / det;
      const l2 = ((cv - av) * (u - cu) + (au - cu) * (v - cv)) / det;
      const l3 = 1 - l1 - l2;
      if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue;
      const w = l1 * verts[A + a] + l2 * verts[B + a] + l3 * verts[C + a];
      const d = (w - s) * dir;
      if (d > 0 && d < best) best = d;
    }
    return best;
  }

  // ---------- cutting ----------

  // Moves the cut slightly if any vertex sits on it, so every triangle is strictly on
  // one side or crosses the plane. Keeps the cut topology simple and watertight.
  function nudge(verts, a, s) {
    const eps = 1e-4;
    for (let tries = 0; tries < 50; tries++) {
      let hit = false;
      for (let i = a; i < verts.length; i += 3) if (Math.abs(verts[i] - s) < eps) { hit = true; break; }
      if (!hit) return s;
      s += 3 * eps;
    }
    return s;
  }

  function cutMesh(mesh, a, s) {
    const { verts, tris, vertCount } = mesh;
    const pos = new Soup(), neg = new Soup();
    const pts = [], memo = new Map(), segs = [];
    const V = i => [verts[i * 3], verts[i * 3 + 1], verts[i * 3 + 2]];
    // Intersection points are memoised per edge and always computed in the same
    // vertex order, so neighbouring triangles share bit-identical points.
    const xpt = (i, j) => {
      const lo = Math.min(i, j), hi = Math.max(i, j), key = lo * vertCount + hi;
      let id = memo.get(key);
      if (id === undefined) {
        const da = verts[lo * 3 + a] - s, db = verts[hi * 3 + a] - s, t = da / (da - db);
        const p = [0, 1, 2].map(k => verts[lo * 3 + k] + (verts[hi * 3 + k] - verts[lo * 3 + k]) * t);
        p[a] = s;
        id = pts.length;
        pts.push(p);
        memo.set(key, id);
      }
      return id;
    };
    for (let t = 0; t < tris.length; t += 3) {
      const i0 = tris[t], i1 = tris[t + 1], i2 = tris[t + 2];
      const s0 = verts[i0 * 3 + a] > s, s1 = verts[i1 * 3 + a] > s, s2 = verts[i2 * 3 + a] > s;
      if (s0 && s1 && s2) { pos.tri(V(i0), V(i1), V(i2)); continue; }
      if (!s0 && !s1 && !s2) { neg.tri(V(i0), V(i1), V(i2)); continue; }
      // Rotate (keeping winding) so A is the vertex alone on its side.
      let A, B, C, loneUp;
      if (s0 === s1) { A = i2; B = i0; C = i1; loneUp = s2; }
      else if (s0 === s2) { A = i1; B = i2; C = i0; loneUp = s1; }
      else { A = i0; B = i1; C = i2; loneUp = s0; }
      const P = xpt(A, B), Q = xpt(A, C);
      const lone = loneUp ? pos : neg, pair = loneUp ? neg : pos;
      lone.tri(V(A), pts[P], pts[Q]);
      pair.tri(pts[P], V(B), V(C));
      pair.tri(pts[P], V(C), pts[Q]);
      segs.push(loneUp ? [Q, P] : [P, Q]);
    }
    return { pos, neg, pts, segs };
  }

  // Chains cut segments into closed loops. Small gaps from non-manifold input are
  // bridged; chains that can't be closed are counted and dropped.
  function buildLoops(segs, pts, ui, vi, tol) {
    const next = new Map();
    for (const [f, t] of segs) {
      if (f === t) continue;
      let l = next.get(f);
      if (!l) next.set(f, (l = []));
      l.push(t);
    }
    const loops = [], chains = [];
    for (const start of next.keys()) {
      while (next.get(start).length) {
        const loop = [start];
        let cur = next.get(start).pop();
        while (cur !== start) {
          loop.push(cur);
          const l = next.get(cur);
          if (!l || !l.length) break;
          cur = l.pop();
        }
        (cur === start ? loops : chains).push(loop);
      }
    }
    const d2 = (p, q) => (p[ui] - q[ui]) ** 2 + (p[vi] - q[vi]) ** 2, tol2 = tol * tol;
    for (let merged = true; merged && chains.length;) {
      merged = false;
      for (let i = 0; i < chains.length && !merged; i++) {
        const c = chains[i], end = pts[c[c.length - 1]];
        if (c.length > 2 && d2(end, pts[c[0]]) < tol2) { loops.push(c); chains.splice(i, 1); merged = true; break; }
        for (let j = 0; j < chains.length; j++) {
          if (j !== i && d2(end, pts[chains[j][0]]) < tol2) {
            chains[i] = c.concat(chains[j]);
            chains.splice(j, 1);
            merged = true;
            break;
          }
        }
      }
    }
    const out = [];
    for (const ids of loops) {
      if (ids.length < 3) continue;
      const xy = new Float64Array(ids.length * 2);
      const box = [Infinity, Infinity, -Infinity, -Infinity];
      ids.forEach((id, k) => {
        const x = pts[id][ui], y = pts[id][vi];
        xy[k * 2] = x; xy[k * 2 + 1] = y;
        box[0] = Math.min(box[0], x); box[1] = Math.min(box[1], y);
        box[2] = Math.max(box[2], x); box[3] = Math.max(box[3], y);
      });
      let area = 0;
      for (let i = 0, j = xy.length - 2; i < xy.length; j = i, i += 2) area += xy[j] * xy[i + 1] - xy[i] * xy[j + 1];
      if (Math.abs(area / 2) < 1e-9) continue;
      out.push({ ids, xy, box, area: Math.abs(area / 2) });
    }
    return { loops: out, open: chains.length };
  }

  // Groups loops into islands (an outer boundary plus its holes). Uses nesting depth,
  // not winding, so models with flipped normals still cap correctly.
  function buildIslands(loops) {
    const depth = loops.map(() => 0), parent = loops.map(() => -1);
    loops.forEach((L, i) => {
      const x = L.xy[0], y = L.xy[1];
      loops.forEach((M, j) => {
        if (i === j || !inBox(M.box, x, y) || !pointInPoly(M.xy, x, y)) return;
        depth[i]++;
        if (parent[i] < 0 || M.area < loops[parent[i]].area) parent[i] = j;
      });
    });
    const islands = [], byLoop = new Map();
    loops.forEach((L, i) => {
      if (depth[i] % 2) return;
      byLoop.set(i, islands.length);
      islands.push({ outer: L, holes: [], area: L.area });
    });
    loops.forEach((L, i) => {
      if (!(depth[i] % 2)) return;
      const isl = islands[byLoop.get(parent[i])];
      if (!isl) return;
      isl.holes.push(L);
      isl.area -= L.area;
    });
    for (const isl of islands) {
      // Area centroid, used for the "center" pattern.
      let cx = 0, cy = 0, A = 0;
      for (const [L, sign] of [[isl.outer, 1], ...isl.holes.map(h => [h, -1])]) {
        const xy = L.xy;
        let a = 0, mx = 0, my = 0;
        for (let i = 0, j = xy.length - 2; i < xy.length; j = i, i += 2) {
          const c = xy[j] * xy[i + 1] - xy[i] * xy[j + 1];
          a += c; mx += (xy[j] + xy[i]) * c; my += (xy[j + 1] + xy[i + 1]) * c;
        }
        // Signed area and moments flip together with winding; normalise to the loop's role.
        const k = sign * Math.sign(a);
        A += k * a / 2; cx += k * mx / 6; cy += k * my / 6;
      }
      isl.centroid = A > 1e-9 ? [cx / A, cy / A] : [(isl.outer.box[0] + isl.outer.box[2]) / 2, (isl.outer.box[1] + isl.outer.box[3]) / 2];
    }
    return islands;
  }

  // ---------- connector placement ----------

  function patternPoints(pattern, grid, box, centroid) {
    let [x0, y0, x1, y1] = box;
    if (x1 < x0) x0 = x1 = (x0 + x1) / 2;
    if (y1 < y0) y0 = y1 = (y0 + y1) / 2;
    const xm = (x0 + x1) / 2, ym = (y0 + y1) / 2;
    switch (pattern) {
      case 'center': return [centroid];
      case 'mid': return [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [xm, y0], [x1, ym], [xm, y1], [x0, ym]];
      case 'grid': {
        const out = [];
        for (let i = 0; i < grid; i++) for (let j = 0; j < grid; j++)
          out.push([grid > 1 ? x0 + (x1 - x0) * i / (grid - 1) : xm, grid > 1 ? y0 + (y1 - y0) * j / (grid - 1) : ym]);
        return out;
      }
      default: return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    }
  }

  // Places connectors per island, nudging each pattern point to the nearest spot that
  // is inside material, clear of every edge and deep enough for its socket.
  function placeConnectors(islands, o, depthOk) {
    const clear = o.reach + o.margin, minSpacing = 2 * o.reach + o.margin;
    const placed = [];
    let skipped = 0;
    islands.forEach((isl, ii) => {
      const loops = [isl.outer, ...isl.holes];
      const fits = (x, y) => inBox(isl.outer.box, x, y) && pointInPoly(isl.outer.xy, x, y) &&
        !isl.holes.some(h => inBox(h.box, x, y) && pointInPoly(h.xy, x, y)) &&
        loops.every(L => distToPoly(L.xy, x, y) >= clear) &&
        placed.every(p => Math.hypot(p.u - x, p.v - y) >= minSpacing);
      const ok = (x, y) => fits(x, y) && depthOk(x, y);
      const b = isl.outer.box;
      const cands = [];
      for (const c of patternPoints(o.pattern, o.grid, [b[0] + clear, b[1] + clear, b[2] - clear, b[3] - clear], isl.centroid))
        if (cands.every(q => Math.hypot(q[0] - c[0], q[1] - c[1]) >= minSpacing * 0.5)) cands.push(c);
      const step = Math.max(o.reach * 0.5, 0.5), maxR = Math.max(b[2] - b[0], b[3] - b[1]);
      for (const [cx, cy] of cands) {
        let found = ok(cx, cy) ? [cx, cy] : null;
        for (let r = step; !found && r <= maxR; r += step) {
          const n = Math.max(8, Math.ceil(2 * Math.PI * r / step));
          let best = null, bestD = Infinity;
          for (let k = 0; k < n; k++) {
            const x = cx + r * Math.cos(2 * Math.PI * k / n), y = cy + r * Math.sin(2 * Math.PI * k / n);
            // Prefer moving toward the island centre so corners pull inward evenly.
            const d = Math.hypot(x - isl.centroid[0], y - isl.centroid[1]);
            if (d < bestD && ok(x, y)) { best = [x, y]; bestD = d; }
          }
          found = best;
        }
        if (found) placed.push({ u: found[0], v: found[1], island: ii });
        else skipped++;
      }
    });
    return { placed, skipped };
  }

  // ---------- connector geometry ----------

  function ringPoint(f, u, v, r, k, h) {
    const t = 2 * Math.PI * k / SEGMENTS, p = [0, 0, 0];
    p[f.ui] = u + r * Math.cos(t);
    p[f.vi] = v + r * Math.sin(t);
    p[f.a] = f.s + h;
    return p;
  }

  function ring(f, u, v, r, h) {
    return Array.from({ length: SEGMENTS }, (_, k) => ringPoint(f, u, v, r, k, h));
  }

  // Revolves a profile of [radius, distance] pairs around the connector axis, starting
  // at the cut plane and travelling in direction dir. A radius of 0 is an apex.
  function revolve(out, f, u, v, profile, dir, outward) {
    const rings = profile.map(([r, h]) => r > 0 ? ring(f, u, v, r, dir * h) : ringPoint(f, u, v, 0, 0, dir * h));
    const flip = (dir < 0) !== outward;
    const emit = (a, b, c) => flip ? out.tri(a, c, b) : out.tri(a, b, c);
    for (let k = 0; k + 1 < rings.length; k++) {
      const A = rings[k], B = rings[k + 1], aRing = Array.isArray(A[0]), bRing = Array.isArray(B[0]);
      for (let j = 0; j < SEGMENTS; j++) {
        const n = (j + 1) % SEGMENTS;
        if (aRing && bRing) { emit(A[j], B[j], B[n]); emit(A[j], B[n], A[n]); }
        else if (aRing) emit(A[j], B, A[n]);
        else if (bRing) emit(A, B[j], B[n]);
      }
    }
  }

  function profiles(o) {
    const r = o.diameter / 2, R = r + o.clearance, d = o.depth, D = d + SOCKET_GAP;
    const c = Math.min(0.4, 0.3 * r, 0.2 * d);
    if (o.type === 'snap') {
      const b = o.clearance + SNAP_INTERFERENCE;
      return {
        r, R, reach: R + b, socketDepth: D,
        stud: [[r, 0], [r, 0.45 * d], [r + b, 0.6 * d], [r, 0.75 * d], [r, d - c], [r - c, d], [0, d]],
        socket: [[R, 0], [R, 0.45 * d], [R + b, 0.6 * d], [R, 0.75 * d], [R, D], [0, D]],
      };
    }
    return {
      r, R, reach: R, socketDepth: D,
      stud: [[r, 0], [r, d - c], [r - c, d], [0, d]],
      socket: [[R, 0], [R, D], [0, D]],
    };
  }

  // Loose dowel pins for the 'dowel' type, laid out on the bed in a row.
  function buildPins(count, r, len) {
    const out = new Soup(), c = Math.min(0.4, 0.3 * r), gap = 2 * r + 3, cols = Math.ceil(Math.sqrt(count));
    const f = { a: 2, ui: 0, vi: 1, s: 0 };
    for (let i = 0; i < count; i++) {
      const x = (i % cols) * gap, y = Math.floor(i / cols) * gap;
      revolve(out, f, x, y, [[0, 0], [r - c, 0], [r, c], [r, len - c], [r - c, len], [0, len]], 1, true);
    }
    return out.data();
  }

  // ---------- caps ----------

  // Triangulates each island (with its holes and connector openings) and orients the
  // triangles so the cap faces away from its part.
  function cap(out, islands, pts, circles, f, normalSign) {
    islands.forEach((isl, ii) => {
      const coords = [], ref = [], holes = [];
      const addIds = ids => ids.forEach(id => { coords.push(pts[id][f.ui], pts[id][f.vi]); ref.push(pts[id]); });
      addIds(isl.outer.ids);
      for (const h of isl.holes) { holes.push(ref.length); addIds(h.ids); }
      for (const c of circles.filter(c => c.island === ii)) {
        holes.push(ref.length);
        for (const p of c.ring) { coords.push(p[f.ui], p[f.vi]); ref.push(p); }
      }
      // earcut winds all its triangles the same way, so orient the whole island from the
      // total area; per-triangle signs are noise on the slivers collinear points produce.
      const t = earcut(coords, holes);
      let total = 0;
      for (let k = 0; k < t.length; k += 3) {
        const [A, B, C] = [t[k], t[k + 1], t[k + 2]];
        total += (coords[B * 2] - coords[A * 2]) * (coords[C * 2 + 1] - coords[A * 2 + 1]) -
                 (coords[C * 2] - coords[A * 2]) * (coords[B * 2 + 1] - coords[A * 2 + 1]);
      }
      const keep = total * normalSign >= 0;
      for (let k = 0; k < t.length; k += 3) {
        if (keep) out.tri(ref[t[k]], ref[t[k + 1]], ref[t[k + 2]]);
        else out.tri(ref[t[k]], ref[t[k + 2]], ref[t[k + 1]]);
      }
    });
  }

  // ---------- main entry ----------

  // o: { axis, offset (absolute cut coordinate), type: 'peg'|'snap'|'dowel'|'none',
  //      pattern: 'center'|'corners'|'mid'|'grid', grid, diameter, depth, clearance,
  //      margin, studSide: 'pos'|'neg' }
  function split(mesh, o) {
    const a = AXES[o.axis], [ui, vi] = PLANE[o.axis];
    const s = nudge(mesh.verts, a, o.offset);
    const f = { a, ui, vi, s };
    const { pos, neg, pts, segs } = cutMesh(mesh, a, s);
    const diag = Math.hypot(...mesh.bounds.size);
    const { loops, open } = buildLoops(segs, pts, ui, vi, Math.max(1e-3, diag * 1e-5));
    const islands = buildIslands(loops);

    const P = profiles(o);
    const kinds = o.type === 'none' ? { pos: null, neg: null }
      : o.type === 'dowel' ? { pos: 'socket', neg: 'socket' }
      : o.studSide === 'pos' ? { pos: 'stud', neg: 'socket' } : { pos: 'socket', neg: 'stud' };
    const into = { pos: 1, neg: -1 };

    let placed = [], skipped = 0;
    if (o.type !== 'none' && islands.length) {
      const need = P.socketDepth + FLOOR;
      const sides = ['pos', 'neg'].filter(k => kinds[k] === 'socket');
      const depthOk = (u, v) => {
        for (let k = 0; k <= 8; k++) {
          const x = k ? u + P.reach * Math.cos(k * Math.PI / 4) : u;
          const y = k ? v + P.reach * Math.sin(k * Math.PI / 4) : v;
          for (const side of sides) if (materialDepth(mesh, o.axis, s, x, y, into[side]) < need) return false;
        }
        return true;
      };
      ({ placed, skipped } = placeConnectors(islands, { pattern: o.pattern, grid: o.grid, reach: P.reach, margin: o.margin }, depthOk));
    }

    const holes = { pos: [], neg: [] };
    for (const side of ['pos', 'neg']) {
      const kind = kinds[side], out = side === 'pos' ? pos : neg;
      if (!kind) continue;
      for (const c of placed) {
        if (kind === 'stud') revolve(out, f, c.u, c.v, P.stud, -into[side], true);
        else revolve(out, f, c.u, c.v, P.socket, into[side], false);
        holes[side].push({ island: c.island, ring: ring(f, c.u, c.v, kind === 'stud' ? P.r : P.R, 0) });
      }
    }
    // The pos part's cap faces -axis; in (u, v) that means clockwise triangles.
    cap(pos, islands, pts, holes.pos, f, -1);
    cap(neg, islands, pts, holes.neg, f, 1);

    const connectors = placed.map((c, i) => {
      const p = [0, 0, 0];
      p[a] = s; p[ui] = c.u; p[vi] = c.v;
      return { id: i + 1, x: p[0], y: p[1], z: p[2], u: c.u, v: c.v, island: c.island };
    });
    const posData = pos.data(), negData = neg.data();
    return {
      s, axis: o.axis, kinds, profiles: P, connectors, skipped,
      pos: posData, neg: negData,
      pins: o.type === 'dowel' && placed.length ? buildPins(placed.length, P.r, 2 * o.depth) : null,
      section: {
        islands: islands.length,
        area: islands.reduce((t, i) => t + i.area, 0),
        loops: loops.length,
        open,
        outlines: islands.map(i => [i.outer.xy, ...i.holes.map(h => h.xy)]),
      },
    };
  }

  // ---------- print orientation & overhangs ----------

  // 3x3 row-major rotation taking unit axis vector n onto unit axis vector t.
  function rotationBetween(n, t) {
    const dot = n[0] * t[0] + n[1] * t[1] + n[2] * t[2];
    if (dot > 0.5) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
    if (dot < -0.5) {
      const k = Math.abs(n[0]) < 0.5 ? [1, 0, 0] : [0, 1, 0];
      return [0, 1, 2].flatMap(i => [0, 1, 2].map(j => 2 * k[i] * k[j] - (i === j ? 1 : 0)));
    }
    const k = [n[1] * t[2] - n[2] * t[1], n[2] * t[0] - n[0] * t[2], n[0] * t[1] - n[1] * t[0]];
    return [
      k[0] * k[0], k[0] * k[1] - k[2], k[0] * k[2] + k[1],
      k[1] * k[0] + k[2], k[1] * k[1], k[1] * k[2] - k[0],
      k[2] * k[0] - k[1], k[2] * k[1] + k[0], k[2] * k[2],
    ];
  }

  // Parts print best with the cut face on the bed, except a part carrying studs,
  // which goes cut face up so the studs print vertically.
  function printRotation(axis, side, kind) {
    const n = [0, 0, 0];
    n[AXES[axis]] = side === 'pos' ? -1 : 1;
    return rotationBetween(n, [0, 0, kind === 'stud' ? 1 : -1]);
  }

  // Rotates a soup and moves it so it sits on z = 0, centred on the origin.
  function placeOnBed(soup, M) {
    const out = new Float32Array(soup.length);
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < soup.length; i += 3) {
      const x = soup[i], y = soup[i + 1], z = soup[i + 2];
      for (let k = 0; k < 3; k++) {
        const w = M[k * 3] * x + M[k * 3 + 1] * y + M[k * 3 + 2] * z;
        out[i + k] = w;
        if (w < min[k]) min[k] = w;
        if (w > max[k]) max[k] = w;
      }
    }
    const shift = [-(min[0] + max[0]) / 2, -(min[1] + max[1]) / 2, -min[2]];
    for (let i = 0; i < out.length; i++) out[i] += shift[i % 3];
    return out;
  }

  // Faces steeper than `angle` from vertical that face downward in the given
  // orientation, ignoring faces resting on the bed. Returns the area and the matching
  // triangles in the soup's own coordinates for highlighting.
  function overhangs(soup, M, angle = 45) {
    const lim = -Math.sin(angle * Math.PI / 180);
    let minZ = Infinity;
    for (let i = 0; i < soup.length; i += 3) minZ = Math.min(minZ, M[6] * soup[i] + M[7] * soup[i + 1] + M[8] * soup[i + 2]);
    const hl = new Soup();
    let area = 0;
    for (let i = 0; i < soup.length; i += 9) {
      const ax = soup[i + 3] - soup[i], ay = soup[i + 4] - soup[i + 1], az = soup[i + 5] - soup[i + 2];
      const bx = soup[i + 6] - soup[i], by = soup[i + 7] - soup[i + 1], bz = soup[i + 8] - soup[i + 2];
      const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      const l = Math.hypot(nx, ny, nz);
      if (!l) continue;
      if ((M[6] * nx + M[7] * ny + M[8] * nz) / l >= lim) continue;
      let onBed = true;
      for (let k = 0; k < 9; k += 3)
        if (M[6] * soup[i + k] + M[7] * soup[i + k + 1] + M[8] * soup[i + k + 2] > minZ + 0.05) onBed = false;
      if (onBed) continue;
      area += l / 2;
      hl.tri(soup.subarray(i, i + 3), soup.subarray(i + 3, i + 6), soup.subarray(i + 6, i + 9));
    }
    return { area, tris: hl.data() };
  }

  return {
    AXES, PLANE, prepare, split, edgeReport, volume, printRotation, placeOnBed, overhangs,
    materialDepth, constants: { SEGMENTS, FLOOR, SOCKET_GAP, SNAP_INTERFERENCE },
  };
})();

if (typeof module !== 'undefined') module.exports = Split;
