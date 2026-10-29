const RADIANS = Math.PI / 180;
const TAU = 2 * Math.PI;

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function vector([longitude, latitude]) {
  const lambda = longitude * RADIANS;
  const phi = latitude * RADIANS;
  return [Math.cos(phi) * Math.cos(lambda), Math.cos(phi) * Math.sin(lambda), Math.sin(phi)];
}

function angle(a, b) {
  return Math.atan2(Math.hypot(...cross(a, b)), dot(a, b));
}

// Store each country's actual great-circle boundary segments. Cartesian vectors
// make this work for long edges and polygons crossing the antimeridian, too.
function boundarySegments(object) {
  const segments = [];
  function ring(coordinates) {
    if (coordinates.length < 2) return;
    const vertices = coordinates.map(vector);
    for (let index = 0; index < vertices.length; index += 1) {
      const a = vertices[index];
      const b = vertices[(index + 1) % vertices.length];
      const normal = cross(a, b);
      const normalLength = Math.hypot(...normal);
      segments.push({a, b, normal, normalLength, length: angle(a, b)});
    }
  }
  function visit(geometry) {
    if (!geometry) return;
    switch (geometry.type) {
      case 'Feature': visit(geometry.geometry); break;
      case 'FeatureCollection': geometry.features.forEach(visit); break;
      case 'GeometryCollection': geometry.geometries.forEach(visit); break;
      case 'Polygon': geometry.coordinates.forEach(ring); break;
      case 'MultiPolygon': geometry.coordinates.forEach(polygon => polygon.forEach(ring)); break;
      default: break;
    }
  }
  visit(object);
  return segments;
}

function distanceToSegment(point, segment) {
  const {a, b, normal, normalLength, length} = segment;
  let distance = Math.min(angle(point, a), angle(point, b));
  if (normalLength < 1e-12) return distance;

  // The perpendicular foot on the supporting great circle is only relevant
  // when it lies on this finite minor arc, rather than its continuation.
  const normalComponent = dot(point, normal) / (normalLength * normalLength);
  const foot = point.map((value, index) => value - normalComponent * normal[index]);
  const footLength = Math.hypot(...foot);
  if (footLength < 1e-12) return distance;
  for (const sign of [1, -1]) {
    const candidate = foot.map(value => sign * value / footLength);
    if (angle(a, candidate) + angle(candidate, b) <= length + 1e-9) {
      distance = Math.min(distance, angle(point, candidate));
    }
  }
  return distance;
}

/**
 * Two equal-radius spherical caps, placed clear of the selected country.
 * A is near the equator; B is at a substantially higher absolute latitude.
 * Their geographic positions stay fixed while the map projection changes.
 */
export function createIndicators(d3, country, radiusDegrees = 5) {
  if (!Number.isFinite(radiusDegrees) || radiusDegrees <= 0 || radiusDegrees > 10) {
    throw new RangeError('Indicator radius must be greater than 0 and at most 10 degrees.');
  }
  const clearanceDegrees = 3;
  const exclusionRadius = (radiusDegrees + clearanceDegrees) * RADIANS;
  const segments = boundarySegments(country);
  const circle = d3.geoCircle().radius(radiusDegrees).precision(2);
  const exclusionCircle = d3.geoCircle().radius(radiusDegrees + clearanceDegrees).precision(12);
  const selected = [];

  function clearOfCountry(center) {
    if (!country) return true;
    if (d3.geoContains(country, center)) return false;
    const point = vector(center);
    if (segments.some(segment => distanceToSegment(point, segment) <= exclusionRadius)) return false;
    // Interior tests also protect against unusual polygons, holes, and an
    // entire small island enclosed by a candidate circle.
    return exclusionCircle.center(center)().coordinates[0].every(coordinate => !d3.geoContains(country, coordinate));
  }

  const bands = [
    {latitudes: [8, -8, 15, -15, 0], longitudes: [-125, -90, -45, 40, 90, 135, 0, -145, 65, -65, 110, -110]},
    {latitudes: [52, -52, 46, -46, 58, -58], longitudes: [-35, -135, 135, 55, 100, -90, 0, -65, 75, 115, -115, 150, -150]},
  ];

  for (const [index, band] of bands.entries()) {
    let chosen;
    for (const latitude of band.latitudes) {
      for (const longitude of band.longitudes) {
        const center = [longitude, latitude];
        // Keep complete caps away from the map's antimeridian seam. The
        // longitudinal reach of a cap grows with latitude.
        const reach = Math.asin(Math.sin(radiusDegrees * RADIANS) / Math.cos(latitude * RADIANS)) / RADIANS;
        if (Math.abs(longitude) + reach >= 175) continue;
        if (selected.some(feature => d3.geoDistance(feature.properties.center, center) < Math.max(55 * RADIANS, 2 * radiusDegrees * RADIANS))) continue;
        if (clearOfCountry(center)) {
          chosen = center;
          break;
        }
      }
      if (chosen) break;
    }
    if (!chosen) throw new Error('Could not place two reference circles clear of the selected country.');
    selected.push({
      type: 'Feature',
      properties: {label: index === 0 ? 'A' : 'B', center: chosen, radiusDegrees},
      geometry: circle.center(chosen)(),
    });
  }
  return selected;
}

// Exact spherical cap area, in steradians, useful when explaining the circles.
export function indicatorArea(radiusDegrees = 5) {
  return TAU * (1 - Math.cos(radiusDegrees * RADIANS));
}

// Rebuild the spherical cap instead of translating its projected SVG path.
export function moveIndicator(d3, feature, center) {
  if (!Array.isArray(center) || center.length !== 2 || !center.every(Number.isFinite)
      || Math.abs(center[0]) > 180 || Math.abs(center[1]) > 90) {
    throw new RangeError('Circle center must be a longitude/latitude coordinate.');
  }
  return {
    ...feature,
    properties: { ...feature.properties, center: [...center], userPosition: true },
    geometry: d3.geoCircle().center(center).radius(feature.properties.radiusDegrees).precision(2)(),
  };
}
