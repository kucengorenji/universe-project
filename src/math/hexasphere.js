import * as THREE from 'three';

/**
 * Generates a Goldberg Polyhedron (Dual of Subdivided Icosphere)
 * All tiles are regular hexagons, except for exactly 12 pentagons.
 */
export function generateHexasphere(subdivision = 3, radius = 10) {
  // 1. Base Icosahedron
  const phi = (1 + Math.sqrt(5)) / 2;
  const initialVertices = [
    new THREE.Vector3(-1, phi, 0).normalize(),
    new THREE.Vector3(1, phi, 0).normalize(),
    new THREE.Vector3(-1, -phi, 0).normalize(),
    new THREE.Vector3(1, -phi, 0).normalize(),
    new THREE.Vector3(0, -1, phi).normalize(),
    new THREE.Vector3(0, 1, phi).normalize(),
    new THREE.Vector3(0, -1, -phi).normalize(),
    new THREE.Vector3(0, 1, -phi).normalize(),
    new THREE.Vector3(phi, 0, -1).normalize(),
    new THREE.Vector3(phi, 0, 1).normalize(),
    new THREE.Vector3(-phi, 0, -1).normalize(),
    new THREE.Vector3(-phi, 0, 1).normalize()
  ];

  let faces = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]
  ];

  let vertices = [...initialVertices];

  // 2. Subdivide
  const midpointCache = new Map();
  function getMidpoint(idxA, idxB) {
    const key = idxA < idxB ? `${idxA}_${idxB}` : `${idxB}_${idxA}`;
    if (midpointCache.has(key)) {
      return midpointCache.get(key);
    }
    const vA = vertices[idxA];
    const vB = vertices[idxB];
    const mid = new THREE.Vector3().addVectors(vA, vB).normalize();
    const newIdx = vertices.length;
    vertices.push(mid);
    midpointCache.set(key, newIdx);
    return newIdx;
  }

  for (let s = 0; s < subdivision; s++) {
    const nextFaces = [];
    for (let f = 0; f < faces.length; f++) {
      const [v0, v1, v2] = faces[f];
      const m01 = getMidpoint(v0, v1);
      const m12 = getMidpoint(v1, v2);
      const m20 = getMidpoint(v2, v0);

      nextFaces.push([v0, m01, m20]);
      nextFaces.push([v1, m12, m01]);
      nextFaces.push([v2, m20, m12]);
      nextFaces.push([m01, m12, m20]);
    }
    faces = nextFaces;
  }

  // 3. Compute face centroids on unit sphere (these become tile corners)
  const faceCentroids = faces.map(([a, b, c]) => {
    return new THREE.Vector3()
      .add(vertices[a])
      .add(vertices[b])
      .add(vertices[c])
      .normalize();
  });

  // Map each vertex to the faces containing it and adjacent vertices (neighbors)
  const vertexFaces = Array.from({ length: vertices.length }, () => []);
  const vertexNeighbors = Array.from({ length: vertices.length }, () => new Set());

  faces.forEach((face, fIdx) => {
    const [a, b, c] = face;
    vertexFaces[a].push(fIdx);
    vertexFaces[b].push(fIdx);
    vertexFaces[c].push(fIdx);

    vertexNeighbors[a].add(b).add(c);
    vertexNeighbors[b].add(a).add(c);
    vertexNeighbors[c].add(a).add(b);
  });

  // 4. Construct dual tiles
  const tiles = [];
  const globalCorners = faceCentroids; // Corners shared across tiles

  for (let i = 0; i < vertices.length; i++) {
    const center = vertices[i].clone(); // unit vector
    const faceIndices = vertexFaces[i];
    const isPentagon = faceIndices.length === 5;

    // Sort corners circularly around the vertex normal
    const normal = center.clone().normalize();
    // Choose reference tangent
    let tangent = new THREE.Vector3(0, 1, 0);
    if (Math.abs(normal.y) > 0.9) {
      tangent = new THREE.Vector3(1, 0, 0);
    }
    const u = new THREE.Vector3().crossVectors(normal, tangent).normalize();
    const v = new THREE.Vector3().crossVectors(normal, u).normalize();

    const cornerItems = faceIndices.map((fIdx) => {
      const pos = faceCentroids[fIdx];
      const projected = new THREE.Vector3().copy(pos).sub(normal.clone().multiplyScalar(pos.dot(normal)));
      const angle = Math.atan2(projected.dot(v), projected.dot(u));
      return { fIdx, pos, angle };
    });

    cornerItems.sort((a, b) => a.angle - b.angle);

    const cornerIndices = cornerItems.map((item) => item.fIdx);
    const cornerPositions = cornerItems.map((item) => item.pos.clone());

    // Neighbors as array
    const neighbors = Array.from(vertexNeighbors[i]);

    tiles.push({
      id: i,
      center, // normalized Vector3
      worldCenter: center.clone().multiplyScalar(radius),
      isPentagon,
      cornerIndices,
      corners: cornerPositions, // array of normalized Vector3
      neighbors,
      // Metadata to be populated by MapGenerator
      biome: 'ocean',
      elevation: 0,
      moisture: 0,
      owner: null, // 'player' | 'system' | null
      isCapital: false,
      capitalOf: null,
      hasRiver: false,
      riverNeighborId: null
    });
  }

  // Pre-calculate edge lookup for border rendering
  // An edge between tile A and tile B is identified by the pair of shared corner indices
  const tileMap = new Map();
  tiles.forEach((t) => tileMap.set(t.id, t));

  return {
    radius,
    tiles,
    tileMap,
    globalCorners,
    subdivision
  };
}
