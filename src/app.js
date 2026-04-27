// App — main controller

const App = (() => {
  let mesh = null;
  let splitData = null;
  let connectors = [];
  let connectorGeo = null;
  let axis = 'y';
  let pattern = 'corners';
  let modelName = null;
  let overhangTris = null;
  let rebuildTimer = null;

  function init() {
    Renderer.init();
    setupDropzone();
    onCtrl(); // initial build with demo box
  }

  function setupDropzone() {
    const dz = document.getElementById('dropzone');
    dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
    dz.addEventListener('drop', e => {
      e.preventDefault();
      dz.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file && file.name.toLowerCase().endsWith('.stl')) processFile(file);
    });
  }

  function loadSTLFile(input) {
    const file = input.files[0];
    if (file) processFile(file);
  }

  function processFile(file) {
    showProgress('Parsing STL...', 10);
    modelName = file.name;
    const reader = new FileReader();
    reader.onload = e => {
      showProgress('Building mesh...', 40);
      setTimeout(() => {
        try {
          mesh = STLParser.parse(e.target.result);
          Renderer.clearDemo();
          showProgress('Computing split...', 70);
          setTimeout(() => {
            updateModelInfo();
            rebuild();
            hideProgress();
          }, 50);
        } catch(err) {
          hideProgress();
          alert('Failed to parse STL: ' + err.message);
          console.error(err);
        }
      }, 20);
    };
    reader.readAsArrayBuffer(file);
  }

  function updateModelInfo() {
    if (!mesh) return;
    const b = mesh.bounds;
    document.getElementById('model-info').style.display = 'block';
    document.getElementById('mi-name').textContent = modelName || 'Model';
    document.getElementById('mi-stats').innerHTML =
      `Triangles: ${mesh.triangleCount.toLocaleString()}<br>` +
      `Size: ${b.sizeX.toFixed(1)} × ${b.sizeY.toFixed(1)} × ${b.sizeZ.toFixed(1)} mm<br>` +
      `Bounds: (${b.minX.toFixed(1)}, ${b.minY.toFixed(1)}, ${b.minZ.toFixed(1)}) → (${b.maxX.toFixed(1)}, ${b.maxY.toFixed(1)}, ${b.maxZ.toFixed(1)})`;
    document.getElementById('sb-tris').textContent = mesh.triangleCount.toLocaleString();
    document.getElementById('sb-bounds').textContent =
      `${b.sizeX.toFixed(0)}×${b.sizeY.toFixed(0)}×${b.sizeZ.toFixed(0)}mm`;
  }

  function rebuild() {
    if (!mesh) {
      updateConnectorsOnly();
      return;
    }

    const splitT = parseFloat(document.getElementById('sp').value) / 100;
    const cs = parseFloat(document.getElementById('cs').value);
    const cd = parseFloat(document.getElementById('cd').value);
    const ci = parseFloat(document.getElementById('ci').value);
    const ct = parseFloat(document.getElementById('ct').value);

    // Compute connectors first so geometry can use them for capping
    connectors = Geometry.computeConnectors(mesh, axis, splitT, pattern, ci, cs/2);

    // Compute split (Integrated Welding enabled)
    splitData = Geometry.splitMesh(mesh, axis, splitT, connectors);

    // Build connector geometry (using same registry welder)
    // Handled inside Geometry.splitMesh now for better integration

    // Update Renderer
    Renderer.uploadMesh({
      topTris: splitData.topTris,
      bottomTris: splitData.bottomTris,
      connectors: [] // Already integrated into splitData tris
    });

    // Update UI
    Connectors.updateConnectorList(connectors);
    Connectors.updateSplitQuality(mesh, connectors, axis, splitT);

    // Update status bar
    const sv = splitData.splitVal;
    document.getElementById('sb-split').textContent = `${axis.toUpperCase()}=${sv.toFixed(2)}mm`;
    document.getElementById('split-abs-pos').textContent =
      `Split at: ${sv.toFixed(3)} mm on ${axis.toUpperCase()} axis`;
  }

  function updateConnectorsOnly() {
    const ci = parseFloat(document.getElementById('ci').value);
    const cs = parseFloat(document.getElementById('cs').value);
    const splitT = parseFloat(document.getElementById('sp').value)/100;
    const fakeMesh = { bounds: {
      minX:-30,maxX:30,minY:-40,maxY:40,minZ:-20,maxZ:20,
      sizeX:60,sizeY:80,sizeZ:40,cx:0,cy:0,cz:0
    }};
    connectors = Geometry.computeConnectors(fakeMesh, axis, splitT, pattern, ci, cs/2);
    Connectors.updateConnectorList(connectors);
    Renderer.render();
  }

  function onCtrl() {
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(() => {
      syncLabels();
      rebuild();
    }, 60);
    syncLabels();
  }

  function syncLabels() {
    const v = id => document.getElementById(id).value;
    document.getElementById('sp-v').textContent = v('sp') + '%';
    document.getElementById('cs-v').textContent = v('cs') + 'mm';
    document.getElementById('cd-v').textContent = v('cd') + 'mm';
    document.getElementById('ci-v').textContent = v('ci') + 'mm';
    document.getElementById('ct-v').textContent = v('ct') + 'mm';
    document.getElementById('op-v').textContent = v('op') + '%';
    document.getElementById('gn-v').textContent = v('gn') + '×' + v('gn');
  }

  function setAxis(a) {
    axis = a;
    ['x','y','z'].forEach(k => document.getElementById('ax-'+k).classList.toggle('on', k===a));
    onCtrl();
  }

  function setPattern(p) {
    pattern = p;
    ['corners','mid','grid'].forEach(k => document.getElementById('pt-'+k).classList.toggle('on', k===p));
    document.getElementById('grid-row').style.display = p==='grid' ? 'flex' : 'none';
    onCtrl();
  }

  function setDisplayMode(mode) {
    ['solid','wire','xray'].forEach(k => document.getElementById('dv-'+k).classList.toggle('on', k===mode));
    Renderer.setDisplayMode(mode);
  }

  function switchTab(name) {
    document.querySelectorAll('.tab').forEach((t,i) => {
      const names = ['connectors','export','analysis'];
      t.classList.toggle('active', names[i]===name);
    });
    document.querySelectorAll('.tab-content').forEach(t => {
      t.classList.toggle('active', t.id==='tab-'+name);
    });
  }

  function runOverhangAnalysis() {
    if (!mesh) { alert('Load an STL file first.'); return; }
    showProgress('Detecting overhangs...', 30);
    setTimeout(() => {
      overhangTris = Geometry.detectOverhangs(mesh, 45);
      const area = Geometry.surfaceArea(overhangTris);
      Renderer.uploadMesh({
        topTris: splitData?.topTris || [],
        bottomTris: splitData?.bottomTris || [],
        connectors: [],
        overhangs: overhangTris
      });
      Renderer.setShowOverhangs(true);
      document.getElementById('overhang-result').innerHTML =
        `<div style="padding:8px 0;font-size:11px;color:var(--text2);line-height:1.7">
          Found <span style="color:#f5654d;font-weight:600">${overhangTris.length.toLocaleString()}</span> overhang triangles<br>
          Surface area: <span style="color:var(--accent)">${area.toFixed(1)} mm²</span><br>
          Highlighted in <span style="color:#f5654d">red</span> in viewport.<br><br>
          <span style="color:var(--text3)">Consider placing split plane above<br>the overhang region.</span>
        </div>`;
      hideProgress();
    }, 50);
  }

  function resetView() { Renderer.resetView(); }

  function showProgress(text, pct) {
    const el = document.getElementById('progress');
    el.style.display = 'flex';
    document.getElementById('pg-text').textContent = text;
    document.getElementById('pg-bar').style.width = pct + '%';
  }

  function hideProgress() {
    setTimeout(() => { document.getElementById('progress').style.display = 'none'; }, 200);
  }

  return {
    init, loadSTLFile, onCtrl, setAxis, setPattern, setDisplayMode, switchTab, resetView, runOverhangAnalysis,
    get mesh() { return mesh; }, get splitData() { return splitData; }, get connectors() { return connectors; },
    get axis() { return axis; }, get modelName() { return modelName; }
  };
})();

window.App = App;
window.onCtrl = () => App.onCtrl();
window.loadSTLFile = (input) => App.loadSTLFile(input);
window.setAxis = (a) => App.setAxis(a);
window.setPattern = (p) => App.setPattern(p);
window.setDisplayMode = (m) => App.setDisplayMode(m);
window.switchTab = (t) => App.switchTab(t);
window.resetView = () => App.resetView();
window.runOverhangAnalysis = () => App.runOverhangAnalysis();

document.addEventListener('DOMContentLoaded', () => App.init());
