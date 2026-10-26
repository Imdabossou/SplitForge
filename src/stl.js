// STL — parse (binary + ASCII) to a flat triangle soup, and encode binary STL

const STL = (() => {

  // Binary files may legally start with "solid", so the size check comes first.
  function isBinary(buffer) {
    if (buffer.byteLength < 84) return false;
    const count = new DataView(buffer).getUint32(80, true);
    if (84 + count * 50 === buffer.byteLength) return true;
    const head = new TextDecoder().decode(new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 1024)));
    if (/^\s*solid\b/i.test(head) && /\b(facet|endsolid)\b/i.test(head)) return false;
    return 84 + count * 50 <= buffer.byteLength;
  }

  function parseBinary(buffer) {
    const view = new DataView(buffer);
    const count = view.getUint32(80, true);
    const out = new Float32Array(count * 9);
    let n = 0;
    for (let i = 0, off = 84; i < count; i++, off += 50) {
      let ok = true;
      for (let k = 0; k < 9; k++) {
        const f = view.getFloat32(off + 12 + k * 4, true);
        if (!Number.isFinite(f)) ok = false;
        out[n + k] = f;
      }
      if (ok) n += 9;
    }
    return out.subarray(0, n);
  }

  function parseASCII(text) {
    const re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/g;
    const nums = [];
    let m;
    while ((m = re.exec(text))) nums.push(+m[1], +m[2], +m[3]);
    const out = new Float32Array(nums.length - nums.length % 9);
    let n = 0;
    for (let i = 0; i < out.length; i += 9) {
      let ok = true;
      for (let k = 0; k < 9; k++) if (!Number.isFinite(nums[i + k])) ok = false;
      if (!ok) continue;
      for (let k = 0; k < 9; k++) out[n + k] = nums[i + k];
      n += 9;
    }
    return out.subarray(0, n);
  }

  // Returns a Float32Array of triangle vertex positions (9 floats per triangle).
  function parse(buffer) {
    let positions;
    if (isBinary(buffer)) positions = parseBinary(buffer);
    else if (/^\s*solid\b/i.test(new TextDecoder().decode(new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 256)))))
      positions = parseASCII(new TextDecoder().decode(buffer));
    else throw new Error('Not a valid STL file');
    if (!positions.length) throw new Error('STL contains no triangles');
    return positions;
  }

  function encodeBinary(positions, label = 'SplitForge') {
    const count = positions.length / 9;
    const buf = new ArrayBuffer(84 + count * 50);
    const view = new DataView(buf);
    const head = new TextEncoder().encode(label.slice(0, 79));
    new Uint8Array(buf, 0, 80).set(head);
    view.setUint32(80, count, true);
    let off = 84;
    for (let i = 0; i < positions.length; i += 9) {
      const ax = positions[i + 3] - positions[i], ay = positions[i + 4] - positions[i + 1], az = positions[i + 5] - positions[i + 2];
      const bx = positions[i + 6] - positions[i], by = positions[i + 7] - positions[i + 1], bz = positions[i + 8] - positions[i + 2];
      const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      const l = Math.hypot(nx, ny, nz) || 1;
      view.setFloat32(off, nx / l, true);
      view.setFloat32(off + 4, ny / l, true);
      view.setFloat32(off + 8, nz / l, true);
      for (let k = 0; k < 9; k++) view.setFloat32(off + 12 + k * 4, positions[i + k], true);
      view.setUint16(off + 48, 0, true);
      off += 50;
    }
    return buf;
  }

  return { parse, encodeBinary };
})();
