// App — UI wiring: loading, controls, rebuilds, panels, theme

const App = (() => {

  const $ = id => document.getElementById(id);
  const SIDE_NAMES = Exporters.SIDE_NAMES;
  const TYPE_HINTS = {
    peg: 'Plain pegs on one part, matching sockets in the other. Strongest and easiest to print.',
    snap: 'Pegs with a small bead that clicks into a groove. Works best in PETG or with larger diameters.',
    dowel: 'Holes in both parts plus separate pins to print. Lets both parts print cut face down.',
    none: 'Just cut the model. Glue or add your own joinery.',
  };

  const state = {
    mesh: null, name: null, result: null,
    axis: 'z', type: 'peg', pattern: 'corners', studSide: 'neg', display: 'solid',
    overhangs: false, orient: true, lastBuildMs: 0,
  };
  let timer = null;

  // ---------- theme ----------

  function readTheme() {
    try { return localStorage.getItem('splitforge-theme') || 'system'; } catch { return 'system'; }
  }

  function applyTheme(choice) {
    if (choice === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', choice);
    try { localStorage.setItem('splitforge-theme', choice); } catch { /* storage unavailable */ }
    setSeg('theme', choice);
    syncViewportColors();
  }

  function syncViewportColors() {
    const css = getComputedStyle(document.documentElement);
    const rgb = name => {
      const hex = css.getPropertyValue(name).trim().replace('#', '');
      return [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
    };
    Renderer.setColors({
      bg: rgb('--vp-bg'), pos: rgb('--part-pos'), neg: rgb('--part-neg'), plane: rgb('--plane'),
      section: rgb('--section'), grid: rgb('--grid'), overhang: rgb('--overhang'),
    });
  }

  // ---------- small UI helpers ----------

  function setSeg(group, value) {
    document.querySelectorAll(`[data-seg="${group}"] [data-value]`).forEach(b => {
      const on = b.dataset.value === value;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on);
    });
  }

  function toast(msg, kind = 'info') {
    const el = $('toast');
    el.textContent = msg;
    el.className = 'show ' + kind;
    clearTimeout(el._t);
    el._t = setTimeout(() => (el.className = ''), kind === 'error' ? 6000 : 3000);
  }

  function progress(text) {
    $('progress').hidden = !text;
    if (text) $('pg-text').textContent = text;
  }

  const num = id => parseFloat($(id).value);
  const fmt = (n, d = 1) => n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  // ---------- loading ----------

  function loadBuffer(buffer, name) {
    progress('Reading model…');
    // Let the overlay paint before the heavy synchronous work.
    setTimeout(() => {
      try {
        const positions = STL.parse(buffer);
        progress('Preparing mesh…');
        setTimeout(() => {
          try {
            state.mesh = Split.prepare(positions);
            state.name = name;
            state.result = null;
            Renderer.setModel(state.mesh.bounds);
            Renderer.setOverhangs(null, null);
            $('empty-state').hidden = true;
            updateModelInfo();
            syncCutInputs(true);
            rebuild();
          } catch (err) { fail(err); }
          progress(null);
        }, 30);
      } catch (err) { fail(err); progress(null); }
    }, 30);
  }

  function fail(err) {
    console.error(err);
    toast('Could not load model: ' + err.message, 'error');
  }

  function loadFile(file) {
    if (!file) return;
    if (!/\.stl$/i.test(file.name)) { toast('Only .stl files are supported.', 'error'); return; }
    progress('Reading ' + file.name + '…');
    file.arrayBuffer().then(buf => loadBuffer(buf, file.name), fail);
  }

  function loadSample() {
    loadBuffer(STL.encodeBinary(Sample.demoBlock(), 'SplitForge sample'), 'sample-block.stl');
  }

  function updateModelInfo() {
    const m = state.mesh, b = m.bounds;
    $('model-info').hidden = false;
    $('mi-name').textContent = state.name;
    const warn = m.edges.watertight ? '' :
      `<div class="warn">Not watertight (${m.edges.open} open, ${m.edges.bad} bad edges). Cuts may have gaps. Repair the mesh first for best results.</div>`;
    $('mi-stats').innerHTML =
      `${m.triCount.toLocaleString()} triangles<br>` +
      `${fmt(b.size[0])} × ${fmt(b.size[1])} × ${fmt(b.size[2])} mm<br>` +
      `${fmt(Math.abs(m.volume) / 1000)} cm³` + warn;
    $('sb-tris').textContent = m.triCount.toLocaleString();
    $('sb-size').textContent = `${fmt(b.size[0], 0)}×${fmt(b.size[1], 0)}×${fmt(b.size[2], 0)} mm`;
  }

  // ---------- cut position ----------

  // The slider is a percentage of the model along the axis; the number box is in mm.
  function syncCutInputs(fromPct) {
    $('cut-pct-v').textContent = fmt(num('cut-pct')) + '%';
    if (!state.mesh) return;
    const a = Split.AXES[state.axis], b = state.mesh.bounds;
    const mm = $('cut-mm');
    mm.min = b.min[a].toFixed(2); mm.max = b.max[a].toFixed(2);
    if (fromPct) mm.value = (b.min[a] + b.size[a] * num('cut-pct') / 100).toFixed(2);
    else {
      const v = Math.min(b.max[a], Math.max(b.min[a], num('cut-mm')));
      if (Number.isFinite(v)) $('cut-pct').value = ((v - b.min[a]) / b.size[a] * 100).toFixed(1);
    }
    $('cut-pct-v').textContent = fmt(num('cut-pct')) + '%';
  }

  function cutValue() {
    const a = Split.AXES[state.axis], b = state.mesh.bounds;
    const v = num('cut-mm');
    const lo = b.min[a] + b.size[a] * 0.001, hi = b.max[a] - b.size[a] * 0.001;
    return Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : b.center[a]));
  }

  // ---------- options & rebuild ----------

  function options() {
    return {
      axis: state.axis, offset: cutValue(), type: state.type, pattern: state.pattern,
      grid: num('grid-n'), diameter: num('diameter'), depth: num('depth'), clearance: num('clearance'),
      margin: num('margin'), studSide: state.studSide,
    };
  }

  function syncLabels() {
    $('grid-n-v').textContent = `${$('grid-n').value}×${$('grid-n').value}`;
    $('diameter-v').textContent = `${num('diameter')} mm`;
    $('depth-v').textContent = `${num('depth')} mm`;
    $('clearance-v').textContent = `${num('clearance').toFixed(2)} mm`;
    $('margin-v').textContent = `${num('margin')} mm`;
    $('explode-v').textContent = `${$('explode').value}%`;
    $('opacity-v').textContent = `${$('opacity').value}%`;
    const names = SIDE_NAMES[state.axis];
    document.querySelector('[data-seg="stud-side"] [data-value="neg"]').textContent = cap(names.neg);
    document.querySelector('[data-seg="stud-side"] [data-value="pos"]').textContent = cap(names.pos);
    $('stud-side-row').hidden = !(state.type === 'peg' || state.type === 'snap');
    $('grid-row').hidden = state.pattern !== 'grid';
    $('conn-params').classList.toggle('disabled', state.type === 'none');
    $('type-hint').textContent = TYPE_HINTS[state.type];
    $('btn-pins').hidden = state.type !== 'dowel';
    $('btn-pos').textContent = `${cap(names.pos)} part (.stl)`;
    $('btn-neg').textContent = `${cap(names.neg)} part (.stl)`;
  }

  const cap = s => s[0].toUpperCase() + s.slice(1);

  function schedule() {
    syncLabels();
    if (!state.mesh) return;
    Renderer.setCut(state.axis, cutValue());
    $('sb-time').textContent = 'updating…';
    clearTimeout(timer);
    // Big models rebuild less eagerly while a slider is being dragged.
    timer = setTimeout(rebuild, Math.min(600, 60 + state.lastBuildMs));
  }

  function rebuild() {
    clearTimeout(timer);
    if (!state.mesh) return;
    const t0 = performance.now();
    const o = options();
    try {
      state.result = Split.split(state.mesh, o);
    } catch (err) {
      console.error(err);
      toast('Split failed: ' + err.message, 'error');
      return;
    }
    state.opts = o;
    const r = state.result;
    Renderer.setParts(r.pos, r.neg);
    Renderer.setSection(r.axis, r.s, r.section.outlines, r.connectors, r.profiles.reach);
    applyExplode();
    updateOverhangs();
    state.lastBuildMs = performance.now() - t0;

    const names = SIDE_NAMES[r.axis];
    $('sb-cut').textContent = `${r.axis.toUpperCase()} = ${fmt(r.s, 2)} mm`;
    $('sb-conns').textContent = r.connectors.length;
    $('sb-time').textContent = `${Math.round(state.lastBuildMs)} ms`;
    $('cut-info').textContent = r.section.islands
      ? `Section ${fmt(r.section.area)} mm² · ${r.section.islands} piece${r.section.islands > 1 ? 's' : ''}`
      : 'The plane does not cut the model.';
    renderConnectorList(names);
    if (!$('tab-analysis').hidden) renderAnalysis();
  }

  function applyExplode() {
    if (!state.mesh) return;
    const a = Split.AXES[state.axis];
    Renderer.setExplode(state.mesh.bounds.size[a] * 0.5 * num('explode') / 100);
  }

  function renderConnectorList(names) {
    const r = state.result, list = $('conn-list');
    const notes = [];
    if (r.section.open) notes.push(`<div class="warn">${r.section.open} gap${r.section.open > 1 ? 's' : ''} in the cut outline. The mesh is not closed here, so the cap may be incomplete.</div>`);
    if (r.skipped) notes.push(`<div class="warn">${r.skipped} connector${r.skipped > 1 ? 's' : ''} skipped: no spot with enough material. Try a smaller diameter or depth, a lower margin, or move the cut.</div>`);
    if (state.type !== 'none' && !r.connectors.length && !r.skipped && r.section.islands) notes.push('<div class="warn">No connectors fit this section.</div>');
    if (r.kinds.pos === 'stud' || r.kinds.neg === 'stud') {
      const studs = r.kinds.pos === 'stud' ? names.pos : names.neg;
      notes.push(`<div class="note">Pegs on the <b>${studs}</b> part, sockets in the other.</div>`);
    } else if (state.type === 'dowel' && r.connectors.length) {
      notes.push(`<div class="note">Print ${r.connectors.length} pin${r.connectors.length > 1 ? 's' : ''} (⌀${fmt(r.profiles.r * 2, 2)} × ${fmt(state.opts.depth * 2)} mm). They're in the Export tab.</div>`);
    }
    if (state.type === 'none') { list.innerHTML = '<div class="empty-msg">Connectors are turned off.</div>'; $('conn-notes').innerHTML = ''; return; }
    $('conn-notes').innerHTML = notes.join('');
    if (!r.connectors.length) { list.innerHTML = '<div class="empty-msg">No connectors placed.</div>'; return; }
    list.innerHTML = r.connectors.map(c => `
      <div class="conn-item">
        <span class="conn-num">#${c.id}</span>
        <span class="conn-pos">${fmt(c.x, 2)}, ${fmt(c.y, 2)}, ${fmt(c.z, 2)}</span>
        ${r.section.islands > 1 ? `<span class="conn-isl">piece ${c.island + 1}</span>` : ''}
      </div>`).join('');
  }

  // ---------- analysis ----------

  function updateOverhangs() {
    const r = state.result;
    if (!state.overhangs || !r) { Renderer.setOverhangs(null, null); return; }
    const I = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const rot = side => state.orient ? Split.printRotation(r.axis, side, r.kinds[side]) : I;
    r.over = { pos: Split.overhangs(r.pos, rot('pos')), neg: Split.overhangs(r.neg, rot('neg')) };
    Renderer.setOverhangs(r.over.pos.tris, r.over.neg.tris);
  }

  function renderAnalysis() {
    const el = $('analysis');
    const r = state.result;
    if (!r) { el.innerHTML = '<div class="empty-msg">Load a model to analyse the split.</div>'; return; }
    const names = SIDE_NAMES[r.axis];
    const holes = r.section.loops - r.section.islands;
    const row = (k, v) => `<div class="stat"><span>${k}</span><span>${v}</span></div>`;
    let html = '<div class="section-label">Cut section</div>' +
      row('Area', `${fmt(r.section.area)} mm²`) +
      row('Pieces', r.section.islands) +
      row('Holes', holes) +
      row('Outline gaps', r.section.open ? `<span class="bad">${r.section.open}</span>` : '<span class="good">none</span>');
    for (const side of ['pos', 'neg']) {
      const soup = r[side];
      html += `<div class="section-label">${cap(names[side])} part</div>` +
        row('Triangles', (soup.length / 9).toLocaleString()) +
        row('Volume', `${fmt(Math.abs(Split.volume(soup)) / 1000, 2)} cm³`);
      if (state.overhangs && r.over) html += row('Overhang area', `${fmt(r.over[side].area)} mm²`);
    }
    html += '<div class="section-label">Mesh check</div>' +
      `<div id="mesh-check"><button class="btn small" id="run-check">Check parts are watertight</button></div>`;
    el.innerHTML = html;
    $('run-check').onclick = runMeshCheck;
  }

  function runMeshCheck() {
    const r = state.result;
    $('mesh-check').textContent = 'Checking…';
    setTimeout(() => {
      const names = SIDE_NAMES[r.axis];
      $('mesh-check').innerHTML = ['pos', 'neg'].map(side => {
        const e = Split.prepare(r[side]).edges;
        return `<div class="stat"><span>${cap(names[side])}</span>${e.watertight ? '<span class="good">watertight</span>' : `<span class="bad">${e.open} open, ${e.bad} bad edges</span>`}</div>`;
      }).join('');
    }, 20);
  }

  // ---------- export ----------

  function doExport(kind) {
    if (!state.result) { toast('Load a model first.', 'error'); return; }
    const st = { name: state.name, result: state.result, opts: state.opts, orient: state.orient, bounds: state.mesh.bounds };
    let preview;
    if (kind === 'pos' || kind === 'neg') preview = Exporters.stl(st, kind);
    else if (kind === 'pins') preview = Exporters.pins(st) || 'No pins: switch the connector type to Dowel.';
    else if (kind === 'all') preview = Exporters.all(st);
    else preview = Exporters.text(st, kind);
    $('export-preview').textContent = preview;
  }

  // ---------- tabs ----------

  function switchTab(name) {
    document.querySelectorAll('[role="tab"]').forEach(t => {
      const on = t.dataset.tab === name;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', on);
    });
    document.querySelectorAll('.tab-content').forEach(p => (p.hidden = p.id !== 'tab-' + name));
    if (name === 'analysis') renderAnalysis();
  }

  // ---------- wiring ----------

  function bindSeg(group, fn) {
    document.querySelectorAll(`[data-seg="${group}"] [data-value]`).forEach(b =>
      b.addEventListener('click', () => { setSeg(group, b.dataset.value); fn(b.dataset.value); }));
  }

  function init() {
    if (!Renderer.init($('cv'), $('gizmo'))) {
      $('empty-state').innerHTML = '<p>WebGL2 is not available in this browser, so the 3D view cannot be shown.</p>';
    }
    applyTheme(readTheme());
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncViewportColors);
    bindSeg('theme', applyTheme);

    // File loading: dropzone, file input and dropping anywhere on the window.
    $('file-input').addEventListener('change', e => { loadFile(e.target.files[0]); e.target.value = ''; });
    $('load-sample').addEventListener('click', loadSample);
    $('empty-sample').addEventListener('click', loadSample);
    let depth = 0;
    window.addEventListener('dragenter', e => { e.preventDefault(); depth++; document.body.classList.add('dragging'); });
    window.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; document.body.classList.remove('dragging'); } });
    window.addEventListener('dragover', e => e.preventDefault());
    window.addEventListener('drop', e => {
      e.preventDefault();
      depth = 0;
      document.body.classList.remove('dragging');
      loadFile(e.dataTransfer.files[0]);
    });

    bindSeg('axis', v => { state.axis = v; syncCutInputs(true); schedule(); applyExplode(); });
    bindSeg('type', v => { state.type = v; schedule(); });
    bindSeg('pattern', v => { state.pattern = v; schedule(); });
    bindSeg('stud-side', v => { state.studSide = v; schedule(); });
    bindSeg('display', v => { state.display = v; Renderer.setMode(v); });

    $('cut-pct').addEventListener('input', () => { syncCutInputs(true); schedule(); });
    $('cut-mm').addEventListener('change', () => { syncCutInputs(false); syncCutInputs(true); schedule(); });
    for (const id of ['grid-n', 'diameter', 'depth', 'clearance', 'margin']) $(id).addEventListener('input', schedule);
    $('explode').addEventListener('input', () => { syncLabels(); applyExplode(); });
    $('opacity').addEventListener('input', () => { syncLabels(); Renderer.setOpacity(num('opacity') / 100); });

    $('show-overhangs').addEventListener('change', e => { state.overhangs = e.target.checked; updateOverhangs(); renderAnalysis(); });
    $('orient').addEventListener('change', e => { state.orient = e.target.checked; updateOverhangs(); if (!$('tab-analysis').hidden) renderAnalysis(); });

    document.querySelectorAll('[data-export]').forEach(b => b.addEventListener('click', () => doExport(b.dataset.export)));
    $('export-all').addEventListener('click', () => { switchTab('export'); doExport('all'); });
    $('reset-view').addEventListener('click', () => Renderer.resetView());
    document.querySelectorAll('[role="tab"]').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));

    Renderer.setOpacity(num('opacity') / 100);
    syncLabels();
  }

  return { init, get state() { return state; } };
})();

document.addEventListener('DOMContentLoaded', App.init);
