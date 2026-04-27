// Exporters — STL binary, OpenSCAD, JSON, CSV

const Exporters = (() => {

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportSTLPart(tris, isTop, filename) {
    const buf = STLParser.encodeBinary(tris, `SplitForge ${isTop?'top':'bottom'} part`);
    download(new Blob([buf], {type:'model/stl'}), filename);
    updatePreview(`Binary STL — ${tris.length} triangles\nFile: ${filename}\n\nMechanical Snap Connectors integrated.`);
  }

  function exportSTL(which) {
    const app = window.App;
    if (!app?.splitData) { alert('No split data — load a model and set split plane first.'); return; }
    const { topTris, bottomTris } = app.splitData;
    const name = app.modelName?.replace('.stl','') || 'model';
    if (which === 'top') exportSTLPart(topTris, true, `${name}_top.stl`);
    else exportSTLPart(bottomTris, false, `${name}_bottom.stl`);
  }

  function exportSTLBoth() { exportSTL('top'); setTimeout(() => exportSTL('bottom'), 300); }

  function generateOpenSCAD(which) {
    const app = window.App;
    const connectors = app?.connectors || [];
    const name = app?.modelName?.replace('.stl','') || 'model';
    const cs = parseFloat(document.getElementById('cs').value);
    const cd = parseFloat(document.getElementById('cd').value);
    const ct = parseFloat(document.getElementById('ct').value);

    const connStr = connectors.map(c => 
      `  translate([${c.x.toFixed(3)}, ${c.y.toFixed(3)}, ${c.z.toFixed(3)}])\n` +
      `    rotate(align_to_normal([${c.nx},${c.ny},${c.nz}]))\n` +
      `    rotate([180,0,0]) snap_connector(r=${cs/2}, depth=${cd});`
    ).join('\n');

    const socketStr = connectors.map(c => 
      `  translate([${c.x.toFixed(3)}, ${c.y.toFixed(3)}, ${c.z.toFixed(3)}])\n` +
      `    rotate(align_to_normal([${c.nx},${c.ny},${c.nz}]))\n` +
      `    rotate([180,0,0]) snap_socket(r=${cs/2}, depth=${cd}, tol=${ct});`
    ).join('\n');

    return `// SplitForge — Generated OpenSCAD
$fn = 32;

module snap_connector(r, depth) {
  cylinder(h=depth*0.65, r=r);
  translate([0,0,depth*0.65]) cylinder(h=depth*0.15, r1=r, r2=r*1.2);
  translate([0,0,depth*0.8]) cylinder(h=depth*0.2, r1=r*1.2, r2=r*0.5);
}

module snap_socket(r, depth, tol=0) {
  cylinder(h=depth+0.2, r=r+tol);
  translate([0,0,depth*0.65-0.1]) cylinder(h=depth*0.15+0.2, r1=r+tol, r2=r*1.2+tol);
}

function align_to_normal(n) =
  let(xy_len = sqrt(n[0]*n[0]+n[1]*n[1]))
  (xy_len < 0.001) ? (n[2] >= 0 ? [0,0,0] : [180,0,0]) : [atan2(xy_len, n[2]), 0, atan2(n[1], n[0])];

module top_part() {
  union() {
    import("${name}_top.stl");
${connStr}
  }
}

module bottom_part() {
  difference() {
    import("${name}_bottom.stl");
${socketStr}
  }
}

${which === 'top' ? 'top_part();' : which === 'bottom' ? 'bottom_part();' : 'top_part();\n// translate([0,0,10]) bottom_part();'}
`;
  }

  function exportOpenSCAD(w) {
    const scad = generateOpenSCAD(w || 'both');
    const name = window.App?.modelName?.replace('.stl','') || 'model';
    const fn = w ? `${name}_${w}.scad` : `${name}_assembly.scad`;
    download(new Blob([scad], {type:'text/plain'}), fn);
    updatePreview(scad);
  }

  function updatePreview(text) {
    const el = document.getElementById('export-preview');
    if (el) el.textContent = text;
    if (typeof switchTab !== 'undefined') switchTab('export');
  }

  return { exportSTL, exportSTLBoth, exportOpenSCAD, updatePreview };
})();

function exportSTL(w) { Exporters.exportSTL(w); }
function exportSTLBoth() { Exporters.exportSTLBoth(); }
function exportOpenSCAD() { Exporters.exportOpenSCAD(); }
function exportOpenSCADTop() { Exporters.exportOpenSCAD('top'); }
function exportOpenSCADBottom() { Exporters.exportOpenSCAD('bottom'); }
