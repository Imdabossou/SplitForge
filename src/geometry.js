// Geometry — mesh splitting, connector generation, overhang detection

const Geometry = (() => {

  const SOCKET_SEGMENTS = 32;
  let vertexRegistry = new Map();

  function weldV(x, y, z) {
    const precision = 100000;
    const key = `${Math.round(x*precision)},${Math.round(y*precision)},${Math.round(z*precision)}`;
    if (vertexRegistry.has(key)) return vertexRegistry.get(key);
    const v = { x, y, z };
    vertexRegistry.set(key, v);
    return v;
  }

  function weldCoord(u, v, axis, splitVal, uAxis, vAxis) {
    const pt = {}; pt[uAxis] = u; pt[vAxis] = v; pt[axis] = splitVal;
    return weldV(pt.x||0, pt.y||0, pt.z||0);
  }

  function getRingVertices(cx, cy, r, axis, splitVal, uAxis, vAxis, segments, dist = 0) {
    const pts = [];
    for (let i = 0; i < segments; i++) {
      const a = i / segments * Math.PI * 2;
      const u = cx + Math.cos(a) * r;
      const v = cy + Math.sin(a) * r;
      pts.push(weldCoord(u, v, axis, splitVal + dist, uAxis, vAxis));
    }
    return pts;
  }

  function splitMesh(mesh, axis, t, connectors = []) {
    vertexRegistry.clear();
    const { vertices, bounds } = mesh;
    const triCount = mesh.triangleCount;
    const topTris = [], bottomTris = [];
    const segments = []; 

    const splitVal = axis === 'x' ? bounds.minX + bounds.sizeX * t : 
                     axis === 'y' ? bounds.minY + bounds.sizeY * t : 
                     bounds.minZ + bounds.sizeZ * t;

    const axIdx = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
    const uAxis = axis === 'y' ? 'x' : axis === 'x' ? 'z' : 'x';
    const vAxis = axis === 'y' ? 'z' : axis === 'x' ? 'y' : 'y';

    for (let i = 0; i < triCount; i++) {
      const base = i * 9;
      const vs = [
        weldV(vertices[base],   vertices[base+1], vertices[base+2]),
        weldV(vertices[base+3], vertices[base+4], vertices[base+5]),
        weldV(vertices[base+6], vertices[base+7], vertices[base+8])
      ];
      const vals = vs.map(v => [v.x,v.y,v.z][axIdx]);
      const aboveCount = vals.filter(v => v >= splitVal).length;
      const belowCount = vals.filter(v => v < splitVal).length;

      if (aboveCount === 3) { topTris.push({ v0: vs[0], v1: vs[1], v2: vs[2] }); }
      else if (belowCount === 3) { bottomTris.push({ v0: vs[0], v1: vs[1], v2: vs[2] }); }
      else {
        const clipped = clipTriangle(vs, axIdx, splitVal);
        topTris.push(...clipped.top);
        bottomTris.push(...clipped.bottom);
        if (clipped.segment) {
          segments.push({
            p0: { u: clipped.segment[0][uAxis], v: clipped.segment[0][vAxis] },
            p1: { u: clipped.segment[1][uAxis], v: clipped.segment[1][vAxis] },
            raw: clipped.segment
          });
        }
      }
    }

    const cs = parseFloat(document.getElementById('cs')?.value || 5);
    const ct = parseFloat(document.getElementById('ct')?.value || 0.2);
    const cd = parseFloat(document.getElementById('cd')?.value || 3);
    
    topTris.push(...triangulateScanline(segments, connectors, cs/2, axis, splitVal, true, uAxis, vAxis));
    bottomTris.push(...triangulateScanline(segments, connectors, cs/2 + ct, axis, splitVal, false, uAxis, vAxis));

    const connGeo = Connectors.buildDisplayGeometry(connectors, cs/2, cd, ct, (x,y,z)=>weldV(x,y,z));
    topTris.push(...connGeo.studs);
    bottomTris.push(...connGeo.sockets);

    return { topTris, bottomTris, splitVal };
  }

  function clipTriangle(vs, axIdx, splitVal) {
    const get = v => [v.x, v.y, v.z][axIdx];
    const above = vs.map(v => get(v) >= splitVal);
    const lerp = (a, b) => {
      const t = (splitVal - get(a)) / (get(b) - get(a));
      return weldV(a.x+(b.x-a.x)*t, a.y+(b.y-a.y)*t, a.z+(b.z-a.z)*t);
    };
    const aboveVerts = vs.filter((_,i) => above[i]), belowVerts = vs.filter((_,i) => !above[i]);
    if (aboveVerts.length === 1) {
      const a = aboveVerts[0], b = belowVerts[0], c = belowVerts[1];
      const ab = lerp(a, b), ac = lerp(a, c);
      return { top: [{v0:a,v1:ab,v2:ac}], bottom: [{v0:b,v1:c,v2:ac},{v0:b,v1:ac,v2:ab}], segment: [ab, ac] };
    } else {
      const a = aboveVerts[0], b = aboveVerts[1], c = belowVerts[0];
      const ac = lerp(a, c), bc = lerp(b, c);
      return { top: [{v0:a,v1:b,v2:bc},{v0:a,v1:bc,v2:ac}], bottom: [{v0:c,v1:ac,v2:bc}], segment: [ac, bc] };
    }
  }

  function triangulateScanline(shellSegments, connectors, holeR, axis, splitVal, isTop, uAxis, vAxis) {
    const tris = [];
    const allSegments = [...shellSegments];
    for (const c of connectors) {
      const hu = c[uAxis], hv = c[vAxis];
      for (let i = 0; i < SOCKET_SEGMENTS; i++) {
        const a1 = i / SOCKET_SEGMENTS * Math.PI * 2, a2 = (i+1) / SOCKET_SEGMENTS * Math.PI * 2;
        allSegments.push({
          p0: { u: hu + Math.cos(a1)*holeR, v: hv + Math.sin(a1)*holeR },
          p1: { u: hu + Math.cos(a2)*holeR, v: hv + Math.sin(a2)*holeR }
        });
      }
    }
    if (allSegments.length === 0) return [];
    const vCoords = Array.from(new Set(allSegments.flatMap(s => [s.p0.v, s.p1.v]))).sort((a,b)=>a-b);
    for (let i = 0; i < vCoords.length - 1; i++) {
      const v0 = vCoords[i], v1 = vCoords[i+1];
      if (v1 - v0 < 1e-7) continue;
      const vMid = (v0 + v1) / 2;
      const spans = [];
      for (const s of allSegments) {
        const sMinV = Math.min(s.p0.v, s.p1.v), sMaxV = Math.max(s.p0.v, s.p1.v);
        if (vMid > sMinV && vMid < sMaxV) {
          const t0 = (v0 - s.p0.v) / (s.p1.v - s.p0.v), t1 = (v1 - s.p0.v) / (s.p1.v - s.p0.v);
          spans.push({ u0: s.p0.u + t0*(s.p1.u-s.p0.u), u1: s.p0.u + t1*(s.p1.u-s.p0.u), mid: s.p0.u + ((vMid-s.p0.v)/(s.p1.v-s.p0.v))*(s.p1.u-s.p0.u) });
        }
      }
      spans.sort((a,b)=>a.mid-b.mid);
      for (let j = 0; j < spans.length - 1; j += 2) {
        const sL = spans[j], sR = spans[j+1];
        const A = weldCoord(sL.u0, v0, axis, splitVal, uAxis, vAxis);
        const B = weldCoord(sR.u0, v0, axis, splitVal, uAxis, vAxis);
        const C = weldCoord(sR.u1, v1, axis, splitVal, uAxis, vAxis);
        const D = weldCoord(sL.u1, v1, axis, splitVal, uAxis, vAxis);
        if (isTop) {
          if (A!==B && B!==C && C!==A) tris.push({v0:A, v1:C, v2:B});
          if (A!==C && C!==D && D!==A) tris.push({v0:A, v1:D, v2:C});
        } else {
          if (A!==B && B!==C && C!==A) tris.push({v0:A, v1:B, v2:C});
          if (A!==C && C!==D && D!==A) tris.push({v0:A, v1:C, v2:D});
        }
      }
    }
    return tris;
  }

  function makeSnapConnector(cx, cy, cz, axis, splitVal, uAxis, vAxis, radius, depth, segments=SOCKET_SEGMENTS) {
    const tris = [];
    const dir = -1;
    const shaftLen = depth * 0.65, beadR = radius * 1.25;
    const r0 = getRingVertices(cx, cy, radius, axis, splitVal, uAxis, vAxis, segments, 0);
    const rShaft = getRingVertices(cx, cy, radius, axis, splitVal, uAxis, vAxis, segments, dir * shaftLen);
    const rBead = getRingVertices(cx, cy, beadR, axis, splitVal, uAxis, vAxis, segments, dir * (shaftLen + depth * 0.15));
    const rTip = getRingVertices(cx, cy, radius * 0.5, axis, splitVal, uAxis, vAxis, segments, dir * depth);
    const tipPt = weldCoord(cx, cy, axis, splitVal + dir * depth, uAxis, vAxis);
    const addWall = (rA, rB) => {
      for(let i=0; i<segments; i++){
        const j=(i+1)%segments;
        tris.push({v0:rA[i],v1:rB[i],v2:rB[j]}); tris.push({v0:rA[i],v1:rB[j],v2:rA[j]});
      }
    };
    addWall(r0, rShaft); addWall(rShaft, rBead); addWall(rBead, rTip);
    for(let i=0; i<segments; i++){
      const j=(i+1)%segments;
      tris.push({v0:tipPt, v1:rTip[j], v2:rTip[i]});
    }
    return tris;
  }

  function makeSnapSocket(cx, cy, cz, axis, splitVal, uAxis, vAxis, radius, depth, tolerance=0.2, segments=SOCKET_SEGMENTS) {
    const r = radius + tolerance, d = depth + 0.2, beadR = r * 1.25 + 0.1;
    const tris = [];
    const dir = -1;
    const r0 = getRingVertices(cx, cy, r, axis, splitVal, uAxis, vAxis, segments, 0);
    const rShaft = getRingVertices(cx, cy, r, axis, splitVal, uAxis, vAxis, segments, dir * (d * 0.65));
    const rGroove = getRingVertices(cx, cy, beadR, axis, splitVal, uAxis, vAxis, segments, dir * (d * 0.8));
    const rBottom = getRingVertices(cx, cy, r, axis, splitVal, uAxis, vAxis, segments, dir * d);
    const bottomPt = weldCoord(cx, cy, axis, splitVal + dir * d, uAxis, vAxis);
    const addWall = (rA, rB) => {
      for(let i=0; i<segments; i++){
        const j=(i+1)%segments;
        tris.push({v0:rA[j],v1:rB[i],v2:rA[i]}); tris.push({v0:rA[j],v1:rB[j],v2:rB[i]});
      }
    };
    addWall(r0, rShaft); addWall(rShaft, rGroove); addWall(rGroove, rBottom);
    for(let i=0; i<segments; i++){
      const j=(i+1)%segments;
      tris.push({v0:bottomPt, v1:rBottom[i], v2:rBottom[j]});
    }
    return tris;
  }

  function computeConnectors(mesh, axis, splitT, pattern, inset, radius) {
    const { bounds } = mesh;
    let splitVal, faceW, faceH, faceOrigin, uAxis, vAxis;
    if (axis === 'x') {
      splitVal = bounds.minX + bounds.sizeX * splitT; faceW = bounds.sizeZ; faceH = bounds.sizeY;
      faceOrigin = { x: splitVal, y: (bounds.minY+bounds.maxY)/2, z: (bounds.minZ+bounds.maxZ)/2 }; uAxis = {x:0,y:0,z:1}; vAxis = {x:0,y:1,z:0};
    } else if (axis === 'y') {
      splitVal = bounds.minY + bounds.sizeY * splitT; faceW = bounds.sizeX; faceH = bounds.sizeZ;
      faceOrigin = { x: (bounds.minX+bounds.maxX)/2, y: splitVal, z: (bounds.minZ+bounds.maxZ)/2 }; uAxis = {x:1,y:0,z:0}; vAxis = {x:0,y:0,z:1};
    } else {
      splitVal = bounds.minZ + bounds.sizeZ * splitT; faceW = bounds.sizeX; faceH = bounds.sizeY;
      faceOrigin = { x: (bounds.minX+bounds.maxX)/2, y: (bounds.minY+bounds.maxY)/2, z: splitVal }; uAxis = {x:1,y:0,z:0}; vAxis = {x:0,y:1,z:0};
    }
    let uvPts = [];
    const safeInset = Math.min(Math.max(inset, radius), faceW/2 - radius, faceH/2 - radius);
    const uO = -faceW/2, vO = -faceH/2;
    if (pattern === 'corners') {
      uvPts = [[uO+safeInset, vO+safeInset], [uO+faceW-safeInset, vO+safeInset], [uO+faceW-safeInset, vO+faceH-safeInset], [uO+safeInset, vO+faceH-safeInset]];
    } else if (pattern === 'mid') {
      uvPts = [[uO+safeInset, vO+safeInset], [uO+faceW-safeInset, vO+safeInset], [uO+faceW-safeInset, vO+faceH-safeInset], [uO+safeInset, vO+faceH-safeInset], [0, vO+safeInset], [uO+faceW-safeInset, 0], [0, vO+faceH-safeInset], [uO+safeInset, 0]];
    } else if (pattern === 'grid') {
      const gn = parseInt(document.getElementById('gn')?.value || 2);
      for (let i = 0; i < gn; i++) for (let j = 0; j < gn; j++) {
        const u = gn > 1 ? uO+safeInset + (faceW-2*safeInset)*i/(gn-1) : 0;
        const v = gn > 1 ? vO+safeInset + (faceH-2*safeInset)*j/(gn-1) : 0;
        uvPts.push([u, v]);
      }
    }
    const uAxKey = axis==='y'?'x':axis==='x'?'z':'x';
    const vAxKey = axis==='y'?'z':axis==='x'?'y':'y';
    return uvPts.map((uv, i) => {
      const c = { id: i+1, splitVal, axis };
      c[uAxKey] = uv[0]; c[vAxKey] = uv[1];
      c.x = faceOrigin.x + uAxis.x*uv[0] + vAxis.x*uv[1];
      c.y = faceOrigin.y + uAxis.y*uv[0] + vAxis.y*uv[1];
      c.z = faceOrigin.z + uAxis.z*uv[0] + vAxis.z*uv[1];
      return c;
    });
  }

  function detectOverhangs(mesh, thresholdDeg = 45) {
    const { vertices, normals, triangleCount } = mesh;
    const overhangTris = [], thresh = Math.cos((180 - thresholdDeg) * Math.PI / 180);
    for (let i = 0; i < triangleCount; i++) {
      const ni = i * 9; if (-normals[ni+1] > thresh) {
        const base = i * 9;
        overhangTris.push({
          v0:{x:vertices[base],y:vertices[base+1],z:vertices[base+2]}, v1:{x:vertices[base+3],y:vertices[base+4],z:vertices[base+5]}, v2:{x:vertices[base+6],y:vertices[base+7],z:vertices[base+8]},
          angle: Math.acos(Math.min(1,-normals[ni+1]))*180/Math.PI
        });
      }
    }
    return overhangTris;
  }

  function surfaceArea(tris) {
    return tris.reduce((sum, t) => {
      const ax=t.v1.x-t.v0.x, ay=t.v1.y-t.v0.y, az=t.v1.z-t.v0.z, bx=t.v2.x-t.v0.x, by=t.v2.y-t.v0.y, bz=t.v2.z-t.v0.z;
      const cx=ay*bz-az*by, cy=az*bx-ax*bz, cz=ax*by-ay*bx;
      return sum + Math.sqrt(cx*cx+cy*cy+cz*cz)*0.5;
    }, 0);
  }

  return { splitMesh, computeConnectors, makeSnapConnector, makeSnapSocket, detectOverhangs, surfaceArea, clipTriangle };
})();
