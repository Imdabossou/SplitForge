// Renderer — WebGL-based 3D viewport
const Renderer = (() => {

  let gl, canvas, W, H;
  let prog, progWire;
  let vboTop, vboBot, vboConn, vboOverhang;
  let topCount=0, botCount=0, connCount=0, overhangCount=0;

  let rotX=0.4, rotY=-0.5, zoom=1, panX=0, panY=0;
  let dragging=false, dragBtn=0, lastX=0, lastY=0;
  let displayMode = 'solid';
  let opacity = 0.75;
  let showOverhangs = false;
  let demoBox = null; // fallback when no STL loaded

  const vs = `
    attribute vec3 aPos;
    attribute vec3 aNorm;
    uniform mat4 uMVP;
    uniform mat3 uNormalMat;
    varying vec3 vNorm;
    varying vec3 vPos;
    void main(){
      vNorm = normalize(uNormalMat * aNorm);
      vPos = aPos;
      gl_Position = uMVP * vec4(aPos,1.0);
    }
  `;

  const fs = `
    precision mediump float;
    varying vec3 vNorm;
    varying vec3 vPos;
    uniform vec3 uColor;
    uniform float uAlpha;
    uniform vec3 uLight;
    void main(){
      vec3 n = normalize(vNorm);
      float diff = max(dot(n, normalize(uLight)), 0.0);
      float amb = 0.35;
      float back = max(dot(-n, normalize(uLight)), 0.0) * 0.15;
      float lit = amb + diff * 0.65 + back;
      gl_FragColor = vec4(uColor * lit, uAlpha);
    }
  `;

  const vsFlat = `
    attribute vec3 aPos;
    uniform mat4 uMVP;
    void main(){ gl_Position = uMVP * vec4(aPos,1.0); }
  `;
  const fsFlat = `
    precision mediump float;
    uniform vec4 uColor;
    void main(){ gl_FragColor = uColor; }
  `;

  function compileShader(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s));
    return s;
  }

  function makeProgram(vsSrc, fsSrc) {
    const p = gl.createProgram();
    gl.attachShader(p, compileShader(gl.VERTEX_SHADER, vsSrc));
    gl.attachShader(p, compileShader(gl.FRAGMENT_SHADER, fsSrc));
    gl.linkProgram(p);
    return p;
  }

  function init() {
    canvas = document.getElementById('cv');
    gl = canvas.getContext('webgl', { antialias: true, alpha: true });
    if (!gl) { console.error('WebGL not available'); return; }

    prog = makeProgram(vs, fs);
    progWire = makeProgram(vsFlat, fsFlat);

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    resize();
    window.addEventListener('resize', resize);

    canvas.addEventListener('mousedown', e => { dragging=true; dragBtn=e.button; lastX=e.clientX; lastY=e.clientY; e.preventDefault(); });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('mouseup', () => dragging=false);
    canvas.addEventListener('mouseleave', () => dragging=false);
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('wheel', e => { zoom *= e.deltaY>0 ? 0.99 : 1.01; zoom=Math.max(0.01,Math.min(1000,zoom)); render(); e.preventDefault(); }, {passive:false});


    // Set up demo box
    demoBox = buildDemoBox();
    render();
  }

  function resize() {
    const rect = canvas.parentElement.getBoundingClientRect();
    W = canvas.width = rect.width;
    H = canvas.height = rect.height - 24; // status bar
    if (gl) gl.viewport(0,0,W,H);
    render();
  }

  function onMouseMove(e) {
    if (!dragging) return;
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    if (dragBtn === 0) { rotY += dx * 0.008; rotX += dy * 0.008; }
    else if (dragBtn === 2) { panX += dx * 0.002 / zoom; panY -= dy * 0.002 / zoom; }
    else if (dragBtn === 1) { zoom *= 1 - dy*0.003; zoom=Math.max(0.01,Math.min(1000,zoom)); }
    render();
  }

  function buildDemoBox() {
    // Simple box mesh as placeholder
    const w=30,h=40,d=20;
    const verts=[], norms=[];
    function face(pts, n) {
      for (let i=0;i<2;i++){
        const idx = i?[0,2,3]:[0,1,2];
        for(const j of idx){ verts.push(...pts[j]); norms.push(...n); }
      }
    }
    face([[-w,-h,-d],[w,-h,-d],[w,h,-d],[-w,h,-d]],[0,0,-1]);
    face([[-w,-h,d],[w,-h,d],[w,h,d],[-w,h,d]],[0,0,1]);
    face([[-w,-h,-d],[-w,-h,d],[-w,h,d],[-w,h,-d]],[-1,0,0]);
    face([[w,-h,-d],[w,-h,d],[w,h,d],[w,h,-d]],[1,0,0]);
    face([[-w,-h,-d],[w,-h,-d],[w,-h,d],[-w,-h,d]],[0,-1,0]);
    face([[-w,h,-d],[w,h,-d],[w,h,d],[-w,h,d]],[0,1,0]);
    return { verts: new Float32Array(verts), norms: new Float32Array(norms),
      triCount: verts.length/9, bounds:{minX:-w,maxX:w,minY:-h,maxY:h,minZ:-d,maxZ:d,sizeX:2*w,sizeY:2*h,sizeZ:2*d,cx:0,cy:0,cz:0} };
  }

  function uploadMesh(data) {
    // data: {topTris, bottomTris, connectors, overhangs}
    topCount = data.topTris ? data.topTris.length * 3 : 0;
    botCount = data.bottomTris ? data.bottomTris.length * 3 : 0;

    if (data.topTris) {
      const arr = trisToFloat32(data.topTris);
      vboTop = uploadBuffer(vboTop, arr);
    }
    if (data.bottomTris) {
      const arr = trisToFloat32(data.bottomTris);
      vboBot = uploadBuffer(vboBot, arr);
    }
    if (data.connectors) {
      const arr = trisToFloat32(data.connectors);
      vboConn = uploadBuffer(vboConn, arr);
      connCount = data.connectors.length * 3;
    }
    if (data.overhangs) {
      const arr = trisToFloat32(data.overhangs);
      vboOverhang = uploadBuffer(vboOverhang, arr);
      overhangCount = data.overhangs.length * 3;
    }
    demoBox = null;
    render();
  }

  function trisToFloat32(tris) {
    const buf = new Float32Array(tris.length * 18); // 3 verts * (3 pos + 3 norm) = 18
    let i = 0;
    for (const t of tris) {
      const ax=t.v1.x-t.v0.x, ay=t.v1.y-t.v0.y, az=t.v1.z-t.v0.z;
      const bx=t.v2.x-t.v0.x, by=t.v2.y-t.v0.y, bz=t.v2.z-t.v0.z;
      let nx=ay*bz-az*by, ny=az*bx-ax*bz, nz=ax*by-ay*bx;
      const nl=Math.sqrt(nx*nx+ny*ny+nz*nz)||1; nx/=nl;ny/=nl;nz/=nl;
      for (const v of [t.v0,t.v1,t.v2]) {
        buf[i++]=v.x; buf[i++]=v.y; buf[i++]=v.z;
        buf[i++]=nx; buf[i++]=ny; buf[i++]=nz;
      }
    }
    return buf;
  }

  function uploadBuffer(existing, data) {
    if (!existing) existing = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, existing);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return existing;
  }

  function matMul(a, b) {
    const r = new Float32Array(16);
    for (let col = 0; col < 4; col++) {
      for (let row = 0; row < 4; row++) {
        let sum = 0;
        for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[col * 4 + k];
        r[col * 4 + row] = sum;
      }
    }
    return r;
  }

  function makeMVP(cx, cy, cz, scale) {
    const rx = rotX, ry = rotY;
    const cRx = Math.cos(rx), sRx = Math.sin(rx);
    const cRy = Math.cos(ry), sRy = Math.sin(ry);

    const RY = new Float32Array([
      cRy, 0, sRy, 0,
      0, 1, 0, 0,
      -sRy, 0, cRy, 0,
      0, 0, 0, 1
    ]);
    const RX = new Float32Array([
      1, 0, 0, 0,
      0, cRx, -sRx, 0,
      0, sRx, cRx, 0,
      0, 0, 0, 1
    ]);

    const aspect = W / H;
    const fov = Math.PI / 4;
    const near = 0.1, far = 100000;
    const f = (1 / Math.tan(fov / 2)) * zoom;
    const PROJ = new Float32Array([
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (far + near) / (near - far), -1,
      0, 0, (2 * far * near) / (near - far), 0
    ]);

    const s = scale;
    const tx = panX, ty = panY;
    const DIST = 250 * scale + 2;
    const TRANS = new Float32Array([
      s, 0, 0, 0,
      0, s, 0, 0,
      0, 0, s, 0,
      -cx * s + tx * s * 100, -cy * s + ty * s * 100, -DIST, 1
    ]);

    return matMul(PROJ, matMul(TRANS, matMul(RX, RY)));
  }

  function drawVBO(vbo, count, color, alpha, light) {
    if (!vbo || count === 0) return;
    gl.useProgram(prog);
    const bounds = window.App?.mesh?.bounds || (demoBox?.bounds);
    if (!bounds) return;

    const maxD = Math.max(bounds.sizeX || 60, bounds.sizeY || 80, bounds.sizeZ || 40);
    const scale = 1.8 / maxD;
    const mvp = makeMVP(bounds.cx || 0, bounds.cy || 0, bounds.cz || 0, scale);

    const uMVP = gl.getUniformLocation(prog, 'uMVP');
    gl.uniformMatrix4fv(uMVP, false, mvp);

    const rx = rotX, ry = rotY;
    const cRx = Math.cos(rx), sRx = Math.sin(rx);
    const cRy = Math.cos(ry), sRy = Math.sin(ry);
    const nm = new Float32Array([
      cRy, sRx * sRy, -cRx * sRy,
      0, cRx, sRx,
      sRy, -sRx * cRy, cRx * cRy
    ]);
    gl.uniformMatrix3fv(gl.getUniformLocation(prog, 'uNormalMat'), false, nm);
    gl.uniform3fv(gl.getUniformLocation(prog, 'uColor'), color);
    gl.uniform1f(gl.getUniformLocation(prog, 'uAlpha'), alpha);
    gl.uniform3fv(gl.getUniformLocation(prog, 'uLight'), light || [0.6, 1, 0.5]);

    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    const aPos = gl.getAttribLocation(prog, 'aPos');
    const aNorm = gl.getAttribLocation(prog, 'aNorm');
    gl.enableVertexAttribArray(aPos);
    gl.enableVertexAttribArray(aNorm);
    gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 24, 0);
    gl.vertexAttribPointer(aNorm, 3, gl.FLOAT, false, 24, 12);
    gl.drawArrays(gl.TRIANGLES, 0, count);
  }

  function drawDemoBox(splitT, axis) {
    if (!demoBox) return;
    const { verts, norms, bounds } = demoBox;
    const maxD = Math.max(bounds.sizeX, bounds.sizeY, bounds.sizeZ);
    const scale = 1.8 / maxD;
    const mvp = makeMVP(0, 0, 0, scale);

    const merged = new Float32Array(verts.length * 2);
    for (let i = 0, j = 0; i < verts.length / 3; i++) {
      merged[j++] = verts[i * 3]; merged[j++] = verts[i * 3 + 1]; merged[j++] = verts[i * 3 + 2];
      merged[j++] = norms[i * 3]; merged[j++] = norms[i * 3 + 1]; merged[j++] = norms[i * 3 + 2];
    }

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, merged, gl.STATIC_DRAW);

    gl.useProgram(prog);
    gl.uniformMatrix4fv(gl.getUniformLocation(prog, 'uMVP'), false, mvp);
    
    const rx = rotX, ry = rotY;
    const cRx = Math.cos(rx), sRx = Math.sin(rx);
    const cRy = Math.cos(ry), sRy = Math.sin(ry);
    const nm = new Float32Array([
      cRy, sRx * sRy, -cRx * sRy,
      0, cRx, sRx,
      sRy, -sRx * cRy, cRx * cRy
    ]);
    gl.uniformMatrix3fv(gl.getUniformLocation(prog, 'uNormalMat'), false, nm);
    
    gl.uniform3fv(gl.getUniformLocation(prog, 'uColor'), [0.3, 0.5, 0.9]);
    gl.uniform1f(gl.getUniformLocation(prog, 'uAlpha'), 0.5);
    gl.uniform3fv(gl.getUniformLocation(prog, 'uLight'), [0.6, 1, 0.5]);
    const aPos = gl.getAttribLocation(prog, 'aPos'), aNorm = gl.getAttribLocation(prog, 'aNorm');
    gl.enableVertexAttribArray(aPos); gl.enableVertexAttribArray(aNorm);
    gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 24, 0);
    gl.vertexAttribPointer(aNorm, 3, gl.FLOAT, false, 24, 12);
    gl.drawArrays(gl.TRIANGLES, 0, verts.length / 3);

    drawSplitPlane(bounds, splitT || 0.5, axis || 'z', mvp);
    gl.deleteBuffer(buf);
  }

  function drawSplitPlane(bounds, splitT, axis, mvp) {
    let v0,v1,v2,v3;
    const e = 0.5;
    if(axis==='z'){
      const z=bounds.minZ+bounds.sizeZ*splitT;
      v0=[bounds.minX-e,bounds.minY-e,z]; v1=[bounds.maxX+e,bounds.minY-e,z];
      v2=[bounds.maxX+e,bounds.maxY+e,z]; v3=[bounds.minX-e,bounds.maxY+e,z];
    } else if(axis==='y'){
      const y=bounds.minY+bounds.sizeY*splitT;
      v0=[bounds.minX-e,y,bounds.minZ-e]; v1=[bounds.maxX+e,y,bounds.minZ-e];
      v2=[bounds.maxX+e,y,bounds.maxZ+e]; v3=[bounds.minX-e,y,bounds.maxZ+e];
    } else {
      const x=bounds.minX+bounds.sizeX*splitT;
      v0=[x,bounds.minY-e,bounds.minZ-e]; v1=[x,bounds.maxY+e,bounds.minZ-e];
      v2=[x,bounds.maxY+e,bounds.maxZ+e]; v3=[x,bounds.minY-e,bounds.maxZ+e];
    }
    const pts = new Float32Array([...v0,...v1,...v2,...v0,...v2,...v3]);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, pts, gl.STATIC_DRAW);
    gl.useProgram(progWire);
    gl.uniformMatrix4fv(gl.getUniformLocation(progWire,'uMVP'), false, mvp);
    gl.uniform4fv(gl.getUniformLocation(progWire,'uColor'), [1,0.78,0.25,0.3]);
    const aPos=gl.getAttribLocation(progWire,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,3,gl.FLOAT,false,12,0);
    gl.drawArrays(gl.TRIANGLES,0,6);
    // Outline
    const lineVerts=new Float32Array([...v0,...v1,...v1,...v2,...v2,...v3,...v3,...v0]);
    gl.bufferData(gl.ARRAY_BUFFER, lineVerts, gl.STATIC_DRAW);
    gl.uniform4fv(gl.getUniformLocation(progWire,'uColor'), [1,0.78,0.25,0.9]);
    gl.lineWidth(2);
    gl.drawArrays(gl.LINES,0,8);
    gl.deleteBuffer(buf);
  }

  function render() {
    if(!gl) return;
    gl.clearColor(0.05,0.055,0.08,1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const app = window.App;
    const splitT = app ? parseFloat(document.getElementById('sp').value)/100 : 0.5;
    const axis = app ? (app.axis||'z') : 'z';
    const op = opacity;

    if (demoBox) {
      drawDemoBox(splitT, axis);
      renderAxisIndicator(axis);
      return;
    }

    const bounds = app?.mesh?.bounds;
    if (!bounds) return;
    const maxD = Math.max(bounds.sizeX, bounds.sizeY, bounds.sizeZ);
    const scale = 1.8 / maxD;
    const mvp = makeMVP(bounds.cx, bounds.cy, bounds.cz, scale);

    if (displayMode === 'xray') {
      gl.depthMask(false);
      drawVBO(vboBot, botCount, [0.55,0.45,0.9], op*0.4);
      drawVBO(vboTop, topCount, [0.3,0.6,0.95], op*0.4);
      gl.depthMask(true);
    } else if (displayMode === 'wire') {
      gl.disable(gl.DEPTH_TEST);
      drawVBO(vboBot, botCount, [0.55,0.45,0.9], 0.6);
      drawVBO(vboTop, topCount, [0.3,0.6,0.95], 0.6);
      gl.enable(gl.DEPTH_TEST);
    } else {
      drawVBO(vboBot, botCount, [0.55,0.45,0.9], op);
      drawVBO(vboTop, topCount, [0.3,0.6,0.95], op);
    }

    if (showOverhangs && overhangCount > 0) {
      drawVBO(vboOverhang, overhangCount, [1,0.3,0.2], 0.9);
    }

    drawVBO(vboConn, connCount, [0.2,0.95,0.6], 1.0);

    // Split plane overlay
    gl.useProgram(progWire);
    gl.uniformMatrix4fv(gl.getUniformLocation(progWire,'uMVP'), false, mvp);
    drawSplitPlane(bounds, splitT, axis, mvp);

    renderAxisIndicator(axis);
  }

  function renderAxisIndicator() {
    const c = document.getElementById('axis-indicator');
    if (!c) return;
    c.width = 80; c.height = 80;
    const ctx2 = c.getContext('2d');
    ctx2.clearRect(0,0,80,80);
    const cx2=40, cy2=40, r=25;
    const axes = [
      {v:[1,0,0], col:'#f55', label:'X'},
      {v:[0,1,0], col:'#5f5', label:'Y'},
      {v:[0,0,-1], col:'#55f', label:'Z'}
    ];
    const cRx=Math.cos(rotX),sRx=Math.sin(rotX);
    const cRy=Math.cos(rotY),sRy=Math.sin(rotY);
    const projected = axes.map(a => {
      let x=a.v[0],y=a.v[1],z=a.v[2];
      const ry = x*cRy+z*sRy; z=-x*sRy+z*cRy; x=ry;
      const rz = y*cRx-z*sRx; z=y*sRx+z*cRx; y=rz;
      return {px:cx2+x*r, py:cy2-y*r, col:a.col, label:a.label, z};
    }).sort((a,b)=>a.z-b.z);
    for(const a of projected){
      ctx2.beginPath(); ctx2.moveTo(cx2,cy2); ctx2.lineTo(a.px,a.py);
      ctx2.strokeStyle=a.col; ctx2.lineWidth=2; ctx2.stroke();
      ctx2.fillStyle=a.col; ctx2.font='bold 10px monospace'; ctx2.textAlign='center'; ctx2.textBaseline='middle';
      ctx2.fillText(a.label, a.px+(a.px-cx2)*0.25, a.py+(a.py-cy2)*0.25);
    }
    ctx2.beginPath(); ctx2.arc(cx2,cy2,3,0,Math.PI*2);
    ctx2.fillStyle='#888'; ctx2.fill();
  }

  function setDisplayMode(mode) { displayMode=mode; render(); }
  function setOpacity(v) { opacity=v/100; render(); }
  function setShowOverhangs(v) { showOverhangs=v; render(); }
  function resetView() { rotX=0.4; rotY=-0.5; zoom=1; panX=0; panY=0; render(); }
  function clearDemo() { demoBox=null; }

  return { init, uploadMesh, render, setDisplayMode, setOpacity, setShowOverhangs, resetView, clearDemo, drawSplitPlane };
})();
