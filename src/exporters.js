// Exporters — STL parts, dowel pins, zip bundle, parametric OpenSCAD, JSON and CSV

const Exporters = (() => {

  const SIDE_NAMES = {
    z: { pos: 'top', neg: 'bottom' },
    x: { pos: 'right', neg: 'left' },
    y: { pos: 'back', neg: 'front' },
  };

  // ---------- zip (store only) ----------

  const CRC = new Uint32Array(256).map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });

  function crc32(u8) {
    let c = 0xffffffff;
    for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function zip(files) {
    const enc = new TextEncoder(), chunks = [], central = [];
    const now = new Date();
    const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name), data = f.data instanceof Uint8Array ? f.data : new Uint8Array(f.data);
      const crc = crc32(data);
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true);
      local.setUint16(10, time, true); local.setUint16(12, date, true); local.setUint32(14, crc, true);
      local.setUint32(18, data.length, true); local.setUint32(22, data.length, true); local.setUint16(26, name.length, true);
      chunks.push(local.buffer, name, data);
      const cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0x0800, true);
      cd.setUint16(12, time, true); cd.setUint16(14, date, true); cd.setUint32(16, crc, true);
      cd.setUint32(20, data.length, true); cd.setUint32(24, data.length, true); cd.setUint16(28, name.length, true);
      cd.setUint32(42, offset, true);
      central.push(cd.buffer, name);
      offset += 30 + name.length + data.length;
    }
    const cdSize = central.reduce((t, c) => t + c.byteLength, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    return new Blob([...chunks, ...central, end.buffer], { type: 'application/zip' });
  }

  // ---------- helpers ----------

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  const baseName = st => (st.name || 'model').replace(/\.stl$/i, '').replace(/[^\w.-]+/g, '_') || 'model';
  const fileFor = (st, side) => `${baseName(st)}_${SIDE_NAMES[st.result.axis][side]}.stl`;

  function partSoup(st, side) {
    const r = st.result, soup = r[side];
    return st.orient ? Split.placeOnBed(soup, Split.printRotation(r.axis, side, r.kinds[side])) : soup;
  }

  function partFiles(st) {
    const files = ['pos', 'neg'].map(side => ({
      name: fileFor(st, side),
      data: STL.encodeBinary(partSoup(st, side), `SplitForge ${SIDE_NAMES[st.result.axis][side]} part`),
    }));
    if (st.result.pins) files.push({ name: `${baseName(st)}_pins_x${st.result.connectors.length}.stl`, data: STL.encodeBinary(st.result.pins, 'SplitForge dowel pins') });
    return files;
  }

  // ---------- formats ----------

  function stl(st, side) {
    const name = fileFor(st, side), soup = partSoup(st, side);
    download(new Blob([STL.encodeBinary(soup, `SplitForge ${SIDE_NAMES[st.result.axis][side]} part`)], { type: 'model/stl' }), name);
    return `${name}\nBinary STL, ${(soup.length / 9).toLocaleString()} triangles` +
      (st.orient ? '\nOriented for printing (cut face on the bed).' : '\nOriginal model coordinates.');
  }

  function pins(st) {
    const r = st.result;
    if (!r.pins) return null;
    const name = `${baseName(st)}_pins_x${r.connectors.length}.stl`;
    download(new Blob([STL.encodeBinary(r.pins, 'SplitForge dowel pins')], { type: 'model/stl' }), name);
    return `${name}\n${r.connectors.length} dowel pins, ⌀${(r.profiles.r * 2).toFixed(2)} × ${(st.opts.depth * 2).toFixed(1)} mm`;
  }

  function all(st) {
    const files = partFiles(st);
    files.push({ name: `${baseName(st)}_connectors.json`, data: new TextEncoder().encode(json(st)) });
    files.push({ name: `${baseName(st)}_split.scad`, data: new TextEncoder().encode(scad(st)) });
    download(zip(files), `${baseName(st)}_split.zip`);
    return `${baseName(st)}_split.zip\n` + files.map(f => `  ${f.name}`).join('\n');
  }

  function json(st) {
    const r = st.result, o = st.opts;
    return JSON.stringify({
      generator: 'SplitForge',
      model: st.name,
      axis: r.axis,
      cut: +r.s.toFixed(4),
      connector: { type: o.type, diameter: o.diameter, depth: o.depth, clearance: o.clearance, studs: r.kinds.pos === 'stud' ? SIDE_NAMES[r.axis].pos : r.kinds.neg === 'stud' ? SIDE_NAMES[r.axis].neg : null },
      connectors: r.connectors.map(c => ({ id: c.id, x: +c.x.toFixed(4), y: +c.y.toFixed(4), z: +c.z.toFixed(4) })),
    }, null, 2);
  }

  function csv(st) {
    return 'id,x,y,z\n' + st.result.connectors.map(c => `${c.id},${c.x.toFixed(4)},${c.y.toFixed(4)},${c.z.toFixed(4)}`).join('\n') + '\n';
  }

  // A parametric re-creation of the split in OpenSCAD: imports the original STL, cuts
  // it with a half-space and adds the same connector profiles.
  function scad(st) {
    const r = st.result, a = Split.AXES[r.axis], b = st.bounds;
    const big = Math.ceil(Math.hypot(...b.size) * 2 + 100);
    const f = n => +n.toFixed(4);
    const pt = p => `[${p.map(f).join(', ')}]`;
    const halfBox = side => {
      const min = b.center.map(c => c - big), size = [2 * big, 2 * big, 2 * big];
      min[a] = side === 'pos' ? r.s : r.s - big;
      size[a] = big;
      return `translate(${pt(min)}) cube(${pt(size)})`;
    };
    // Rotations that turn +Z onto ±axis.
    const ROT = { z: { 1: [0, 0, 0], '-1': [180, 0, 0] }, x: { 1: [0, 90, 0], '-1': [0, -90, 0] }, y: { 1: [-90, 0, 0], '-1': [90, 0, 0] } };
    const dirInto = { pos: 1, neg: -1 };
    const placements = (dir, mod) => r.connectors.map(c => `  translate(${pt([c.x, c.y, c.z])}) rotate(${pt(ROT[r.axis][dir])}) ${mod}();`).join('\n');
    const part = side => {
      const kind = r.kinds[side];
      if (!kind || !r.connectors.length) return `module part_${side}() half_${side}();`;
      if (kind === 'stud') return `module part_${side}() union() {\n  half_${side}();\n${placements(-dirInto[side], 'stud')}\n}`;
      return `module part_${side}() difference() {\n  half_${side}();\n${placements(dirInto[side], 'socket')}\n}`;
    };
    const poly = prof => `[[0, -0.01], ${prof.map(([rad, h], i) => `[${f(rad)}, ${f(i === 0 ? h - 0.01 : h)}]`).join(', ')}]`;
    const ex = [0, 0, 0]; ex[a] = 1;
    const names = SIDE_NAMES[r.axis];
    return `// SplitForge — parametric split of ${st.name || 'model.stl'}
// Put this file next to the original STL. Units: mm.
// part = "${names.pos}" / "${names.neg}" / "both"${r.pins ? ' / "pins"' : ''}

model = "${(st.name || 'model.stl').replace(/"/g, '')}";
part = "both";
explode = 10;
$fn = 48;

// Cut: ${r.axis.toUpperCase()} = ${f(r.s)} mm. Connector: ${st.opts.type}, ⌀${st.opts.diameter} × ${st.opts.depth} mm, clearance ${st.opts.clearance} mm.
module stud() rotate_extrude() polygon(${poly(r.profiles.stud)});
module socket() rotate_extrude() polygon(${poly(r.profiles.socket)});

module half_pos() intersection() { import(model, convexity = 10); ${halfBox('pos')}; }
module half_neg() intersection() { import(model, convexity = 10); ${halfBox('neg')}; }

${part('pos')}

${part('neg')}
${r.pins ? `
module pins() for (i = [0 : ${r.connectors.length - 1}]) translate([i * ${f(r.profiles.r * 2 + 3)}, 0, 0])
  cylinder(r = ${f(r.profiles.r)}, h = ${f(st.opts.depth * 2)});
` : ''}
if (part == "${names.pos}") part_pos();
else if (part == "${names.neg}") part_neg();${r.pins ? '\nelse if (part == "pins") pins();' : ''}
else { translate(${pt(ex)} * explode) part_pos(); part_neg(); }
`;
  }

  function text(st, kind) {
    const s = kind === 'scad' ? scad(st) : kind === 'json' ? json(st) : csv(st);
    const ext = kind === 'scad' ? '_split.scad' : kind === 'json' ? '_connectors.json' : '_connectors.csv';
    download(new Blob([s], { type: kind === 'json' ? 'application/json' : 'text/plain' }), baseName(st) + ext);
    return s;
  }

  return { SIDE_NAMES, stl, pins, all, text, zip, crc32 };
})();

if (typeof module !== 'undefined') module.exports = Exporters;
