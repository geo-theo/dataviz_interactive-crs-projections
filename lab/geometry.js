// The classroom model uses straight rays from a unit sphere's centre.
// Coordinates: x east/right, y north/up, z toward the viewer at lon=0,lat=0.
// These are perspective projections, not Mercator/Lambert formulas.
const PI = Math.PI;
const RAD = PI / 180;
const EPS = 1e-10;

export const PAPER_LIMITS = Object.freeze({ axial: 2, radial: 3.2 });

export const MODES = Object.freeze([
  { id: 'cylinder', name: 'Equatorial cylinder', family: 'Cylindrical', projection: 'Central cylindrical', contact: 'Equator', description: 'Wrap the paper around the equator. Straight rays spread the parallels farther apart toward the poles.' },
  { id: 'transverse', name: 'Transverse cylinder', family: 'Cylindrical', projection: 'Transverse central cylindrical', contact: 'A meridian', description: 'Turn the cylinder on its side. The paper touches a great circle through both poles; stretching grows away from that circle.' },
  { id: 'cone', name: 'Tangent cone', family: 'Conic', projection: 'Perspective conic', contact: 'One standard parallel', description: 'Rest a cone on a circle of latitude. Cut one side and open the paper into a fan.' },
  { id: 'azimuthal', name: 'Polar plane', family: 'Azimuthal', projection: 'Polar gnomonic', contact: 'North Pole', description: 'Touch a flat sheet to the North Pole. Rays spread outward; the equator would project infinitely far away.' },
]);

function modeId(mode) {
  return typeof mode === 'string' ? mode : mode?.id;
}

function coneAngle(standardParallel) {
  if (!(standardParallel > 0 && standardParallel < 90)) {
    throw new RangeError('A northern tangent cone needs a standard parallel between 0° and 90°.');
  }
  return standardParallel * RAD;
}

export function toCartesian(lon, lat) {
  const lambda = lon * RAD, phi = lat * RAD;
  return [Math.cos(phi) * Math.sin(lambda), Math.sin(phi), Math.cos(phi) * Math.cos(lambda)];
}

/**
 * Intersect a ray through a sphere point with the finite teaching paper.
 * Returns null for rays outside the sheet or facing away from its surface.
 * flat units are sphere radii, with positive v pointing upward.
 * Cylinder: u∈[-π,π], |v|≤2. Transverse: |u|≤2, v∈[-π,π].
 * Cone: sector at flat apex [0,1], slant radius 0..3.2,
 *       sector angle θ∈[-π sin(α),π sin(α)].
 *       The contact circle has slant radius cot(α).
 * Polar plane: radius≤3.2. Its horizon is intentionally omitted.
 */
export function intersect(point, mode, standardParallel = 35) {
  if (!point || point.length !== 3 || !point.every(Number.isFinite)) return null;
  const norm = Math.hypot(...point);
  if (norm < EPS) return null;
  const [x, y, z] = point.map(value => value / norm);
  const id = modeId(mode);
  let distance, flat;
  if (id === 'cylinder') {
    const q = Math.hypot(x, z);
    if (q < EPS) return null;
    distance = 1 / q;
    flat = [Math.atan2(x, z), y / q];
    if (Math.abs(flat[1]) > PAPER_LIMITS.axial + EPS) return null;
  } else if (id === 'transverse') {
    const q = Math.hypot(y, z);
    if (q < EPS) return null;
    distance = 1 / q;
    flat = [x / q, Math.atan2(y, z)];
    if (Math.abs(flat[0]) > PAPER_LIMITS.axial + EPS) return null;
  } else if (id === 'cone') {
    const alpha = coneAngle(standardParallel);
    const q = Math.hypot(x, z);
    const denominator = q * Math.cos(alpha) + y * Math.sin(alpha);
    if (denominator <= EPS) return null;
    distance = 1 / denominator;
    const slant = distance * q / Math.sin(alpha);
    if (slant > PAPER_LIMITS.radial + EPS) return null;
    const theta = Math.atan2(x, z) * Math.sin(alpha);
    flat = [slant * Math.sin(theta), 1 - slant * Math.cos(theta)];
  } else if (id === 'azimuthal') {
    if (y <= EPS) return null;
    distance = 1 / y;
    flat = [x / y, -z / y];
    if (Math.hypot(...flat) > PAPER_LIMITS.radial + EPS) return null;
  } else {
    throw new RangeError(`Unknown paper mode: ${id}`);
  }
  return { point: [x * distance, y * distance, z * distance], flat, distance };
}

/** Exact inverse development: put a flat paper point back on its surface. */
export function surfacePoint(u, v, mode, standardParallel = 35) {
  return unfold([u, v], mode, 0, standardParallel);
}

/**
 * Develop the paper without stretching it. amount=0 is the original surface;
 * amount=1 is the flat point [u,v,0]. Cylinder radii increase to infinity.
 * A cone's half-angle opens toward 90° while its cut spreads into a sector.
 * The polar plane rotates rigidly. Translation keeps the final paper centred.
 */
export function unfold(flat, mode, amount, standardParallel = 35) {
  const [u, v] = flat;
  const a = Math.max(0, Math.min(1, amount));
  const k = 1 - a;
  const id = modeId(mode);
  if (id === 'cylinder' || id === 'transverse') {
    const angle = id === 'cylinder' ? u : v;
    // Stable limits avoid numerical cancellation near the flat endpoint.
    const curve = k < 1e-7 ? angle : Math.sin(k * angle) / k;
    const depth = k < 1e-7 ? k * (1 - angle * angle / 2)
      : -2 * Math.sin(k * angle / 2) ** 2 / k + k;
    return id === 'cylinder' ? [curve, v, depth] : [u, curve, depth];
  }
  if (id === 'cone') {
    const alpha = coneAngle(standardParallel);
    const slant = Math.hypot(u, 1 - v);
    const theta = Math.atan2(u, 1 - v);
    const beta = alpha + a * (PI / 2 - alpha);
    const sinBeta = Math.sin(beta), cosBeta = Math.cos(beta);
    const longitude = theta / sinBeta;
    const turn = a * PI / 2;
    const axisY = Math.cos(turn), axisZ = Math.sin(turn);
    const radialY = -Math.sin(turn), radialZ = Math.cos(turn);
    const apexY = k / Math.sin(alpha) + a;
    return [
      slant * sinBeta * Math.sin(longitude),
      apexY + slant * (-cosBeta * axisY + sinBeta * Math.cos(longitude) * radialY),
      slant * (-cosBeta * axisZ + sinBeta * Math.cos(longitude) * radialZ),
    ];
  }
  if (id === 'azimuthal') {
    const turn = a * PI / 2;
    return [u, Math.cos(turn) + v * Math.sin(turn), -v * Math.cos(turn)];
  }
  throw new RangeError(`Unknown paper mode: ${id}`);
}

/** Closed polygon of the finite sheet in its developed coordinates. */
export function paperOutline(mode, standardParallel = 35, steps = 128) {
  const id = modeId(mode);
  const n = Math.max(8, Math.floor(steps));
  const { axial: h, radial: r } = PAPER_LIMITS;
  if (id === 'cylinder') return [[-PI, -h], [PI, -h], [PI, h], [-PI, h], [-PI, -h]];
  if (id === 'transverse') return [[-h, -PI], [h, -PI], [h, PI], [-h, PI], [-h, -PI]];
  if (id === 'cone') {
    const extent = PI * Math.sin(coneAngle(standardParallel));
    return [[0, 1], ...Array.from({length: n + 1}, (_, i) => {
      const theta = -extent + 2 * extent * i / n;
      return [r * Math.sin(theta), 1 - r * Math.cos(theta)];
    }), [0, 1]];
  }
  if (id === 'azimuthal') return Array.from({length: n + 1}, (_, i) => {
    const theta = 2 * PI * i / n;
    return [r * Math.cos(theta), r * Math.sin(theta)];
  });
  throw new RangeError(`Unknown paper mode: ${id}`);
}

/**
 * Flat-coordinate quad mesh. Radial modes include the apex/centre (degenerate
 * first-row quads are harmless); every vertex matches surfacePoint/unfold.
 */
export function samplePaper(mode, standardParallel = 35, columns = 64, rows = 20) {
  const id = modeId(mode);
  const { axial: h, radial: r } = PAPER_LIMITS;
  let sample;
  if (id === 'cylinder') sample = (s, t) => [(2 * s - 1) * PI, (2 * t - 1) * h];
  else if (id === 'transverse') sample = (s, t) => [(2 * t - 1) * h, (2 * s - 1) * PI];
  else if (id === 'cone') {
    const extent = PI * Math.sin(coneAngle(standardParallel));
    sample = (s, t) => {
      const theta = (2 * s - 1) * extent;
      return [r * t * Math.sin(theta), 1 - r * t * Math.cos(theta)];
    };
  } else if (id === 'azimuthal') sample = (s, t) => [r * t * Math.cos(2 * PI * s), r * t * Math.sin(2 * PI * s)];
  else throw new RangeError(`Unknown paper mode: ${id}`);
  const quads = [];
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      quads.push([sample(column / columns, row / rows), sample((column + 1) / columns, row / rows),
        sample((column + 1) / columns, (row + 1) / rows), sample(column / columns, (row + 1) / rows)]);
    }
  }
  return quads;
}
