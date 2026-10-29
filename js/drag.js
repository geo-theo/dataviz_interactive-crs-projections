const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const finitePoint = point => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite);

/** Invert a fitted projection, including a blend that has no analytic inverse.
 * The previous geographic center is the fast, continuous seed during a drag.
 * A damped Newton solve stays inside the geographic domain; outside points
 * return null rather than snapping to the nearest map edge.
 */
export function invertMapPoint(projection, point, hint = [0, 0], latitudeLimit = 90) {
  if (typeof projection !== 'function' || !finitePoint(point)
      || !Number.isFinite(latitudeLimit) || latitudeLimit <= 0 || latitudeLimit > 90) return null;
  const limit = Math.min(latitudeLimit, 89.999999);
  const error = projected => (projected[0] - point[0]) ** 2 + (projected[1] - point[1]) ** 2;
  const bound = position => [clamp(position[0], -180, 180), clamp(position[1], -limit, limit)];

  function solve(seed) {
    let position = bound(seed);
    for (let iteration = 0; iteration < 32; iteration += 1) {
      const projected = projection(position);
      if (!finitePoint(projected)) return null;
      const residual = error(projected);
      if (residual < 1e-8) return position;

      const west = bound([position[0] - 0.0001, position[1]]);
      const east = bound([position[0] + 0.0001, position[1]]);
      const south = bound([position[0], position[1] - 0.0001]);
      const north = bound([position[0], position[1] + 0.0001]);
      const [w, e, s, n] = [west, east, south, north].map(projection);
      if (![w, e, s, n].every(finitePoint)) return null;
      const a = (e[0] - w[0]) / (east[0] - west[0]);
      const b = (n[0] - s[0]) / (north[1] - south[1]);
      const c = (e[1] - w[1]) / (east[0] - west[0]);
      const d = (n[1] - s[1]) / (north[1] - south[1]);
      const determinant = a * d - b * c;
      if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) return null;
      const dx = point[0] - projected[0], dy = point[1] - projected[1];
      let longitudeStep = (d * dx - b * dy) / determinant;
      let latitudeStep = (a * dy - c * dx) / determinant;
      const scale = Math.max(1, Math.abs(longitudeStep) / 35, Math.abs(latitudeStep) / 35);
      longitudeStep /= scale;
      latitudeStep /= scale;
      let next;
      for (let fraction = 1; fraction >= 1 / 128; fraction /= 2) {
        const candidate = bound([position[0] + fraction * longitudeStep, position[1] + fraction * latitudeStep]);
        const result = projection(candidate);
        if (finitePoint(result) && error(result) < residual) {
          next = candidate;
          break;
        }
      }
      if (!next) return null;
      position = next;
    }
    return error(projection(position)) < 1e-8 ? position : null;
  }

  const result = solve(finitePoint(hint) ? hint : [0, 0]);
  if (result) return result;
  // Large cursor jumps and a seed near a pole can defeat a local solve. Try
  // nearby projected grid locations without adding a heavy inverse library.
  const seeds = [];
  for (const longitude of [-150, -90, -30, 30, 90, 150]) {
    for (const latitude of [-75, -40, 0, 40, 75]) {
      const position = bound([longitude, latitude]);
      const projected = projection(position);
      if (finitePoint(projected)) seeds.push({position, error: error(projected)});
    }
  }
  seeds.sort((a, b) => a.error - b.error);
  for (const seed of seeds.slice(0, 6)) {
    const candidate = solve(seed.position);
    if (candidate) return candidate;
  }
  return null;
}
