// Renderer — WebGL2 viewport: Z-up orbit camera, the two parts, cut plane, section
// outline, overhang highlights and an axis gizmo.

const Renderer = (() => {

  let gl, canvas, gizmo, progLit, progFlat;
  let frame = 0;
  const parts = { pos: null, neg: null };
  const over = { pos: null, neg: null };
  let gridBuf = null, sectionBuf = null;
  let bounds = null, cut = { axis: 'z', s: 0 };
  let mode = 'solid', opacity = 1, explode = 0, showOverhangs = true;
  let colors = {
    bg: [0.05, 0.06, 0.08], pos: [0.3, 0.75, 0.95], neg: [0.95, 0.66, 0.3],
    plane: [1, 0.78, 0.25], section: [0.3, 0.96, 0.77], grid: [0.5, 0.5, 0.55], overhang: [1, 0.3, 0.25],
  };
  const cam = { yaw: -2.2, pitch: 0.45, dist: 200, target: [0, 0, 0], fov: Math.PI / 4 };

  // ---------- shaders ----------

  const litVS = `#version 300 es
    in vec3 aPos; in vec3 aNorm;
    uniform mat4 uViewProj; uniform vec3 uOffset;
    out vec3 vNorm; out vec3 vBary; out vec3 vWorld;
    void main() {
      int k = gl_VertexID % 3;
      vBary = vec3(k == 0, k == 1, k == 2);
      vNorm = aNorm;
      vWorld = aPos + uOffset;
      gl_Position = uViewProj * vec4(vWorld, 1.0);
    }`;
  const litFS = `#version 300 es
    precision highp float;
    in vec3 vNorm; in vec3 vBary; in vec3 vWorld;
    uniform vec3 uColor; uniform float uAlpha; uniform vec3 uEye; uniform int uWire;
    out vec4 frag;
    void main() {
      if (uWire == 1) {
        vec3 w = fwidth(vBary);
        vec3 e = smoothstep(vec3(0.0), w * 1.3, vBary);
        float edge = 1.0 - min(min(e.x, e.y), e.z);
        if (edge < 0.05) discard;
        frag = vec4(uColor, uAlpha * edge);
        return;
      }
      vec3 n = normalize(vNorm);
      float head = abs(dot(n, normalize(uEye - vWorld)));
      float key = max(dot(n, normalize(vec3(0.35, 0.25, 1.0))), 0.0);
      frag = vec4(uColor * (0.32 + 0.5 * head + 0.25 * key), uAlpha);
    }`;
  const flatVS = `#version 300 es
    in vec3 aPos;
    uniform mat4 uViewProj; uniform vec3 uOffset;
    void main() { gl_Position = uViewProj * vec4(aPos + uOffset, 1.0); }`;
  const flatFS = `#version 300 es
    precision highp float;
    uniform vec4 uColor;
    out vec4 frag;
    void main() { frag = uColor; }`;

  function program(vsSrc, fsSrc) {
    const p = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, vsSrc], [gl.FRAGMENT_SHADER, fsSrc]]) {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      gl.attachShader(p, s);
    }
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {};
    for (let i = 0; i < gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i++) {
      const name = gl.getActiveUniform(p, i).name;
      u[name] = gl.getUniformLocation(p, name);
    }
    return { p, u, aPos: gl.getAttribLocation(p, 'aPos'), aNorm: gl.getAttribLocation(p, 'aNorm') };
  }

  // ---------- matrices (column-major) ----------

  function mul(a, b) {
    const r = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let row = 0; row < 4; row++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + row] * b[c * 4 + k];
      r[c * 4 + row] = s;
    }
    return r;
  }

  function eye() {
    const cp = Math.cos(cam.pitch);
    return [
      cam.target[0] + cam.dist * cp * Math.cos(cam.yaw),
      cam.target[1] + cam.dist * cp * Math.sin(cam.yaw),
      cam.target[2] + cam.dist * Math.sin(cam.pitch),
    ];
  }

  // Camera basis: right, up, back (towards the eye).
  function basis() {
    const e = eye(), t = cam.target;
    let z = [e[0] - t[0], e[1] - t[1], e[2] - t[2]];
    const zl = Math.hypot(...z); z = z.map(v => v / zl);
    let x = [-z[1], z[0], 0];
    const xl = Math.hypot(...x) || 1; x = x.map(v => v / xl);
    const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
    return { x, y, z, e };
  }

  function viewProj() {
    const { x, y, z, e } = basis();
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const view = new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, e), -dot(y, e), -dot(z, e), 1]);
    const diag = bounds ? Math.hypot(...bounds.size) : 100;
    const near = Math.max(cam.dist * 0.01, 0.01), far = cam.dist + diag * 4 + explode * 2;
    const f = 1 / Math.tan(cam.fov / 2), aspect = canvas.width / Math.max(canvas.height, 1);
    const proj = new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, 2 * far * near / (near - far), 0]);
    return { m: mul(proj, view), e };
  }

  // ---------- buffers ----------

  function interleave(soup) {
    const out = new Float32Array(soup.length * 2);
    for (let i = 0; i < soup.length; i += 9) {
      const ax = soup[i + 3] - soup[i], ay = soup[i + 4] - soup[i + 1], az = soup[i + 5] - soup[i + 2];
      const bx = soup[i + 6] - soup[i], by = soup[i + 7] - soup[i + 1], bz = soup[i + 8] - soup[i + 2];
      let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      for (let k = 0; k < 3; k++) {
        const o = (i + k * 3) * 2;
        out[o] = soup[i + k * 3]; out[o + 1] = soup[i + k * 3 + 1]; out[o + 2] = soup[i + k * 3 + 2];
        out[o + 3] = nx; out[o + 4] = ny; out[o + 5] = nz;
      }
    }
    return out;
  }

  function upload(old, data) {
    if (old) gl.deleteBuffer(old.buf);
    if (!data || !data.length) return null;
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return { buf, count: data.length };
  }

  function drawLit(b, color, alpha, offset, m, e, wire = false) {
    if (!b) return;
    const P = progLit;
    gl.useProgram(P.p);
    gl.uniformMatrix4fv(P.u.uViewProj, false, m);
    gl.uniform3fv(P.u.uOffset, offset);
    gl.uniform3fv(P.u.uColor, color);
    gl.uniform1f(P.u.uAlpha, alpha);
    gl.uniform3fv(P.u.uEye, e);
    gl.uniform1i(P.u.uWire, wire ? 1 : 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, b.buf);
    gl.enableVertexAttribArray(P.aPos);
    gl.vertexAttribPointer(P.aPos, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(P.aNorm);
    gl.vertexAttribPointer(P.aNorm, 3, gl.FLOAT, false, 24, 12);
    gl.drawArrays(gl.TRIANGLES, 0, b.count / 6);
  }

  function drawFlat(b, prim, color, alpha, offset, m, first = 0, count = null) {
    if (!b) return;
    const P = progFlat;
    gl.useProgram(P.p);
    gl.uniformMatrix4fv(P.u.uViewProj, false, m);
    gl.uniform3fv(P.u.uOffset, offset);
    gl.uniform4fv(P.u.uColor, [...color, alpha]);
    gl.bindBuffer(gl.ARRAY_BUFFER, b.buf);
    if (progLit.aNorm >= 0) gl.disableVertexAttribArray(progLit.aNorm);
    gl.enableVertexAttribArray(P.aPos);
    gl.vertexAttribPointer(P.aPos, 3, gl.FLOAT, false, 12, 0);
    gl.drawArrays(prim, first, count ?? b.count / 3 - first);
  }

  function buildGrid() {
    if (!bounds) return;
    const span = Math.max(bounds.size[0], bounds.size[1]) * 0.75 + 20;
    const step = 10 ** Math.floor(Math.log10(span / 4));
    const cx = Math.round(bounds.center[0] / step) * step, cy = Math.round(bounds.center[1] / step) * step;
    const n = Math.ceil(span / step), z = bounds.min[2], pts = [];
    for (let i = -n; i <= n; i++) {
      pts.push(cx + i * step, cy - n * step, z, cx + i * step, cy + n * step, z);
      pts.push(cx - n * step, cy + i * step, z, cx + n * step, cy + i * step, z);
    }
    gridBuf = upload(gridBuf, new Float32Array(pts));
  }

  // ---------- drawing ----------

  function requestRender() {
    if (!frame && gl) frame = requestAnimationFrame(draw);
  }

  function axisOffset(d) {
    const o = [0, 0, 0];
    o[{ x: 0, y: 1, z: 2 }[cut.axis]] = d;
    return o;
  }

  function planeQuad() {
    const a = { x: 0, y: 1, z: 2 }[cut.axis], [ui, vi] = { x: [1, 2], y: [2, 0], z: [0, 1] }[cut.axis];
    const pad = Math.max(bounds.size[ui], bounds.size[vi]) * 0.08 + 2;
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([su, sv]) => {
      const p = [0, 0, 0];
      p[a] = cut.s + explode / 2;
      p[ui] = su < 0 ? bounds.min[ui] - pad : bounds.max[ui] + pad;
      p[vi] = sv < 0 ? bounds.min[vi] - pad : bounds.max[vi] + pad;
      return p;
    });
    const [p0, p1, p2, p3] = corners;
    return new Float32Array([...p0, ...p1, ...p2, ...p0, ...p2, ...p3, ...p0, ...p1, ...p1, ...p2, ...p2, ...p3, ...p3, ...p0]);
  }

  let planeBuf = null;

  function draw() {
    frame = 0;
    resize();
    gl.clearColor(...colors.bg, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    drawGizmo();
    if (!bounds) return;
    const { m, e } = viewProj();
    const offPos = axisOffset(explode), zero = [0, 0, 0];

    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    drawFlat(gridBuf, gl.LINES, colors.grid, 0.25, zero, m);

    if (mode === 'xray') {
      gl.disable(gl.DEPTH_TEST);
      drawLit(parts.neg, colors.neg, 0.22, zero, m, e);
      drawLit(parts.pos, colors.pos, 0.22, offPos, m, e);
      gl.enable(gl.DEPTH_TEST);
    } else if (mode === 'wire') {
      drawLit(parts.neg, colors.neg, 0.9, zero, m, e, true);
      drawLit(parts.pos, colors.pos, 0.9, offPos, m, e, true);
    } else {
      drawLit(parts.neg, colors.neg, opacity, zero, m, e);
      drawLit(parts.pos, colors.pos, opacity, offPos, m, e);
      if (showOverhangs) {
        gl.enable(gl.POLYGON_OFFSET_FILL);
        gl.polygonOffset(-1, -2);
        drawLit(over.neg, colors.overhang, 1, zero, m, e);
        drawLit(over.pos, colors.overhang, 1, offPos, m, e);
        gl.disable(gl.POLYGON_OFFSET_FILL);
      }
    }

    // Cut plane: fill hidden by the model, outline and section always on top.
    planeBuf = upload(planeBuf, planeQuad());
    gl.depthMask(false);
    drawFlat(planeBuf, gl.TRIANGLES, colors.plane, 0.12, zero, m, 0, 6);
    gl.disable(gl.DEPTH_TEST);
    drawFlat(planeBuf, gl.LINES, colors.plane, 0.7, zero, m, 6, 8);
    drawFlat(sectionBuf, gl.LINES, colors.section, 0.95, axisOffset(explode / 2), m);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
  }

  function drawGizmo() {
    const ctx = gizmo.getContext('2d'), dpr = window.devicePixelRatio || 1, S = 64;
    if (gizmo.width !== S * dpr) { gizmo.width = gizmo.height = S * dpr; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, S, S);
    const { x, y, z } = basis();
    const axes = [['X', [1, 0, 0], '#e5534b'], ['Y', [0, 1, 0], '#3fb950'], ['Z', [0, 0, 1], '#4c8dff']]
      .map(([l, v, c]) => ({ l, c, sx: v[0] * x[0] + v[1] * x[1] + v[2] * x[2], sy: v[0] * y[0] + v[1] * y[1] + v[2] * y[2], d: v[0] * z[0] + v[1] * z[1] + v[2] * z[2] }))
      .sort((a, b) => a.d - b.d);
    const c = S / 2, r = 20;
    for (const a of axes) {
      ctx.strokeStyle = a.c; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(c, c); ctx.lineTo(c + a.sx * r, c - a.sy * r); ctx.stroke();
      ctx.fillStyle = a.c; ctx.font = '600 10px ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(a.l, c + a.sx * (r + 8), c - a.sy * (r + 8));
    }
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    gl.viewport(0, 0, canvas.width, canvas.height);
  }

  // ---------- input ----------

  function setupInput() {
    const pointers = new Map();
    let last = null;
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('pointerdown', e => {
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, button: e.button, shift: e.shiftKey });
      last = null;
    });
    const end = e => { pointers.delete(e.pointerId); last = null; };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('pointermove', e => {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (pointers.size === 1) {
        if (p.button === 0 && !p.shift && !e.shiftKey) orbit(dx, dy);
        else pan(dx, dy);
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y), mid = [(a.x + b.x) / 2, (a.y + b.y) / 2];
        if (last) { zoom(last.d / d); pan(mid[0] - last.mid[0], mid[1] - last.mid[1]); }
        last = { d, mid };
      }
    });
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
      zoom(Math.exp(dy * 0.0015));
    }, { passive: false });
    canvas.addEventListener('dblclick', () => resetView());
    new ResizeObserver(requestRender).observe(canvas);
  }

  function orbit(dx, dy) {
    cam.yaw -= dx * 0.008;
    cam.pitch = Math.max(-1.55, Math.min(1.55, cam.pitch + dy * 0.008));
    requestRender();
  }

  function pan(dx, dy) {
    const { x, y } = basis();
    const k = 2 * cam.dist * Math.tan(cam.fov / 2) / Math.max(canvas.clientHeight, 1);
    for (let i = 0; i < 3; i++) cam.target[i] += (-dx * x[i] + dy * y[i]) * k;
    requestRender();
  }

  function zoom(f) {
    const diag = bounds ? Math.hypot(...bounds.size) : 100;
    cam.dist = Math.max(diag * 0.02, Math.min(diag * 20, cam.dist * f));
    requestRender();
  }

  // ---------- public API ----------

  function init(cv, gz) {
    canvas = cv; gizmo = gz;
    gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
    if (!gl) return false;
    progLit = program(litVS, litFS);
    progFlat = program(flatVS, flatFS);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    setupInput();
    requestRender();
    return true;
  }

  function setModel(b) {
    bounds = b;
    buildGrid();
    resetView();
  }

  function setParts(pos, neg) {
    parts.pos = upload(parts.pos, pos && interleave(pos));
    parts.neg = upload(parts.neg, neg && interleave(neg));
    requestRender();
  }

  function setOverhangs(pos, neg) {
    over.pos = upload(over.pos, pos && interleave(pos));
    over.neg = upload(over.neg, neg && interleave(neg));
    requestRender();
  }

  // outlines: per island, a list of flat [u, v, ...] loops. markers: [{u, v}] with radius r.
  function setSection(axis, s, outlines, markers, r) {
    cut = { axis, s };
    const a = { x: 0, y: 1, z: 2 }[axis], [ui, vi] = { x: [1, 2], y: [2, 0], z: [0, 1] }[axis];
    const pts = [];
    const P = (u, v) => { const p = [0, 0, 0]; p[a] = s; p[ui] = u; p[vi] = v; pts.push(...p); };
    for (const loops of outlines || []) for (const xy of loops)
      for (let i = 0, j = xy.length - 2; i < xy.length; j = i, i += 2) { P(xy[j], xy[j + 1]); P(xy[i], xy[i + 1]); }
    for (const m of markers || []) for (let k = 0; k < 24; k++) {
      const t0 = 2 * Math.PI * k / 24, t1 = 2 * Math.PI * (k + 1) / 24;
      P(m.u + r * Math.cos(t0), m.v + r * Math.sin(t0));
      P(m.u + r * Math.cos(t1), m.v + r * Math.sin(t1));
    }
    sectionBuf = upload(sectionBuf, new Float32Array(pts));
    requestRender();
  }

  function setCut(axis, s) { cut = { axis, s }; requestRender(); }

  function resetView() {
    if (bounds) {
      cam.target = bounds.center.slice();
      cam.dist = Math.hypot(...bounds.size) / 2 / Math.tan(cam.fov / 2) * 1.25;
    }
    cam.yaw = -2.2; cam.pitch = 0.45;
    requestRender();
  }

  function setColors(c) { Object.assign(colors, c); requestRender(); }
  function setMode(m) { mode = m; requestRender(); }
  function setOpacity(v) { opacity = v; requestRender(); }
  function setExplode(v) { explode = v; requestRender(); }
  function setShowOverhangs(v) { showOverhangs = v; requestRender(); }

  return {
    init, setModel, setParts, setOverhangs, setSection, setCut, resetView,
    setColors, setMode, setOpacity, setExplode, setShowOverhangs, render: requestRender,
  };
})();
