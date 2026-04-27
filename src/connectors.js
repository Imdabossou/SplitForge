// Connectors — builds displayable + exportable connector geometry

const Connectors = (() => {

  function buildDisplayGeometry(connectors, radius, depth, tolerance, weld) {
    const studs = [];
    const sockets = [];
    const axis = (typeof App !== 'undefined' && App.axis) ? App.axis : 'y';
    const uAxis = axis === 'y' ? 'x' : axis === 'x' ? 'z' : 'x';
    const vAxis = axis === 'y' ? 'z' : axis === 'x' ? 'y' : 'y';
    const splitT = parseFloat(document.getElementById('sp').value)/100;
    const bounds = App.mesh.bounds;
    const splitVal = axis === 'x' ? bounds.minX + bounds.sizeX * splitT : 
                     axis === 'y' ? bounds.minY + bounds.sizeY * splitT : 
                     bounds.minZ + bounds.sizeZ * splitT;

    for (const c of connectors) {
      // Top part: Studs are welded into face holes
      studs.push(...Geometry.makeSnapConnector(c[uAxis], c[vAxis], 0, axis, splitVal, uAxis, vAxis, radius, depth, 32));
      // Bottom part: Sockets are welded into face holes
      sockets.push(...Geometry.makeSnapSocket(c[uAxis], c[vAxis], 0, axis, splitVal, uAxis, vAxis, radius, depth, tolerance, 32));
    }
    return { studs, sockets };
  }

  function updateConnectorList(connectors) {
    const list = document.getElementById('conn-list');
    const badge = document.getElementById('sb-conns');
    badge.textContent = connectors.length;
    if (!connectors.length) {
      list.innerHTML = '<div class="empty-msg">No connectors — adjust split plane or load a model</div>';
      return;
    }
    list.innerHTML = connectors.map(c => `
      <div class="conn-item">
        <div class="conn-num">#${c.id}</div>
        <div class="conn-pos">x: ${c.x.toFixed(2)} y: ${c.y.toFixed(2)} z: ${c.z.toFixed(2)}</div>
        <div class="conn-dot"></div>
      </div>
    `).join('');
  }

  function updateSplitQuality(mesh, connectors, axis, splitT) {
    const el = document.getElementById('split-quality');
    if (!mesh) return;
    const bounds = mesh.bounds;
    let splitAbs = axis==='x' ? bounds.minX + bounds.sizeX*splitT : axis==='y' ? bounds.minY + bounds.sizeY*splitT : bounds.minZ + bounds.sizeZ*splitT;
    el.innerHTML = `<div style="padding:10px;font-size:11px;color:var(--text2)">Split at ${splitAbs.toFixed(2)}mm on ${axis.toUpperCase()} axis.<br>Connectors: ${connectors.length}</div>`;
  }

  return { buildDisplayGeometry, updateConnectorList, updateSplitQuality };
})();
