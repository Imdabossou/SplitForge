// STL Parser — handles both ASCII and binary formats

const STLParser = (() => {

  function isBinary(buffer) {
    if (buffer.byteLength < 84) return false;
    const header = new Uint8Array(buffer, 0, 80);
    const s = String.fromCharCode(...header.slice(0, 5));
    if (s.toLowerCase() !== 'solid') return true;
    const view = new DataView(buffer);
    const triCount = view.getUint32(80, true);
    const expectedSize = 84 + triCount * 50;
    return Math.abs(buffer.byteLength - expectedSize) < 4;
  }

  function parseBinary(buffer) {
    const view = new DataView(buffer);
    const triCount = view.getUint32(80, true);
    const vertices = new Float32Array(triCount * 9);
    const normals = new Float32Array(triCount * 9);
    let offset = 84;
    let minX=Infinity,minY=Infinity,minZ=Infinity;
    let maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity;

    for (let i = 0; i < triCount; i++) {
      const nx = view.getFloat32(offset, true), ny = view.getFloat32(offset+4, true), nz = view.getFloat32(offset+8, true);
      offset += 12;
      for (let v = 0; v < 3; v++) {
        const x = view.getFloat32(offset, true), y = view.getFloat32(offset+4, true), z = view.getFloat32(offset+8, true);
        offset += 12;
        const idx = i*9 + v*3;
        vertices[idx]=x; vertices[idx+1]=y; vertices[idx+2]=z;
        normals[idx]=nx; normals[idx+1]=ny; normals[idx+2]=nz;
        if(x<minX)minX=x; if(x>maxX)maxX=x;
        if(y<minY)minY=y; if(y>maxY)maxY=y;
        if(z<minZ)minZ=z; if(z>maxZ)maxZ=z;
      }
      offset += 2;
    }
    return { vertices, normals, triangleCount: triCount,
      bounds: {minX,minY,minZ,maxX,maxY,maxZ, sizeX:maxX-minX, sizeY:maxY-minY, sizeZ:maxZ-minZ, cx:(minX+maxX)/2, cy:(minY+maxY)/2, cz:(minZ+maxZ)/2 }};
  }

  function parseASCII(text) {
    const lines = text.split('\n');
    const verts = [], norms = [];
    let curNorm = [0,0,0], minX=Infinity,minY=Infinity,minZ=Infinity, maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity, triCount = 0;
    for (const line of lines) {
      const l = line.trim();
      if (l.startsWith('facet normal')) {
        const p = l.split(/\s+/); curNorm = [parseFloat(p[2]), parseFloat(p[3]), parseFloat(p[4])];
      } else if (l.startsWith('vertex')) {
        const p = l.split(/\s+/);
        const x=parseFloat(p[1]),y=parseFloat(p[2]),z=parseFloat(p[3]);
        verts.push(x,y,z); norms.push(...curNorm);
        if(x<minX)minX=x; if(x>maxX)maxX=x; if(y<minY)minY=y; if(y>maxY)maxY=y; if(z<minZ)minZ=z; if(z>maxZ)maxZ=z;
      } else if (l.startsWith('endfacet')) { triCount++; }
    }
    return { vertices: new Float32Array(verts), normals: new Float32Array(norms), triangleCount: triCount,
      bounds: {minX,minY,minZ,maxX,maxY,maxZ, sizeX:maxX-minX, sizeY:maxY-minY, sizeZ:maxZ-minZ, cx:(minX+maxX)/2, cy:(minY+maxY)/2, cz:(minZ+maxZ)/2 }};
  }

  function parse(buffer) {
    return isBinary(buffer) ? parseBinary(buffer) : parseASCII(new TextDecoder().decode(buffer));
  }

  // Robust Binary STL encoder with coordinate snapping
  function encodeBinary(triangles, label='SplitForge') {
    const buf = new ArrayBuffer(84 + triangles.length * 50);
    const view = new DataView(buf);
    const header = new Uint8Array(80);
    new TextEncoder().encode(label.slice(0,79)).forEach((b,i)=>header[i]=b);
    header.forEach((b,i) => view.setUint8(i, b));
    view.setUint32(80, triangles.length, true);
    let offset = 84;
    for (const t of triangles) {
      // Normals
      const ax=t.v1.x-t.v0.x, ay=t.v1.y-t.v0.y, az=t.v1.z-t.v0.z;
      const bx=t.v2.x-t.v0.x, by=t.v2.y-t.v0.y, bz=t.v2.z-t.v0.z;
      let nx=ay*bz-az*by, ny=az*bx-ax*bz, nz=ax*by-ay*bx;
      const nl=Math.sqrt(nx*nx+ny*ny+nz*nz)||1;
      view.setFloat32(offset, nx/nl, true); offset+=4;
      view.setFloat32(offset, ny/nl, true); offset+=4;
      view.setFloat32(offset, nz/nl, true); offset+=4;
      // Vertices
      for (const v of [t.v0,t.v1,t.v2]) {
        view.setFloat32(offset, v.x, true); offset+=4;
        view.setFloat32(offset, v.y, true); offset+=4;
        view.setFloat32(offset, v.z, true); offset+=4;
      }
      view.setUint16(offset, 0, true); offset+=2;
    }
    return buf;
  }

  return { parse, encodeBinary };
})();
