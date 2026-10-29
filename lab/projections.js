// D3 streaming counterpart to geometry.js. Spherical cap clipping preserves
// geodesic coastline intersections; final planar clipping keeps all adaptive
// resampling strictly inside the finite sheet.
const RAD = Math.PI / 180;
const PI = Math.PI;
const EPS = 1e-10;

function rotateStream(rotation, sink) {
  return {
    point(lambda, phi) {
      const point = rotation([lambda / RAD, phi / RAD]);
      sink.point(point[0] * RAD, point[1] * RAD);
    },
    lineStart() { sink.lineStart(); }, lineEnd() { sink.lineEnd(); },
    polygonStart() { sink.polygonStart(); }, polygonEnd() { sink.polygonEnd(); },
    sphere() { sink.sphere(); },
  };
}

function latitudeClip(d3, minimum, maximum) {
  const north = d3.geoRotation([0, -90]);
  const south = d3.geoRotation([0, 90]);
  return sink => {
    let stream = d3.geoClipAntimeridian(sink);
    if (maximum < PI / 2 - EPS) {
      stream = rotateStream(south, d3.geoClipCircle(PI / 2 + maximum)(rotateStream(south.invert, stream)));
    }
    if (minimum > -PI / 2 + EPS) {
      stream = rotateStream(north, d3.geoClipCircle(PI / 2 - minimum)(rotateStream(north.invert, stream)));
    }
    return stream;
  };
}

function circleClip(centerX, centerY, radius) {
  const radiusSquared = radius * radius;
  const inside = point => (point[0] - centerX) ** 2 + (point[1] - centerY) ** 2 <= radiusSquared + EPS;
  // An inscribed polygon is used for closed rings. Its maximum radial error
  // is under 0.000031 Earth radii (less than .003 pixels in this lab).
  const vertices = Array.from({ length: 720 }, (_, i) => {
    const angle = i * 2 * PI / 720;
    return [centerX + radius * Math.cos(angle), centerY + radius * Math.sin(angle)];
  });
  function clipRing(points) {
    let output = points;
    for (let i = 0; i < vertices.length && output.length; i++) {
      const a = vertices[i], b = vertices[(i + 1) % vertices.length];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const side = point => dx * (point[1] - a[1]) - dy * (point[0] - a[0]);
      const input = output; output = [];
      let previous = input.at(-1), previousSide = side(previous);
      for (const current of input) {
        const currentSide = side(current);
        if ((currentSide >= -EPS) !== (previousSide >= -EPS)) {
          const t = previousSide / (previousSide - currentSide);
          output.push([previous[0] + t * (current[0] - previous[0]), previous[1] + t * (current[1] - previous[1])]);
        }
        if (currentSide >= -EPS) output.push(current);
        previous = current; previousSide = currentSide;
      }
    }
    return output;
  }
  function segment(a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const px = a[0] - centerX, py = a[1] - centerY;
    const aa = dx * dx + dy * dy;
    if (aa < EPS) return inside(a) ? [a, b] : null;
    const bb = 2 * (px * dx + py * dy);
    const cc = px * px + py * py - radiusSquared;
    const discriminant = bb * bb - 4 * aa * cc;
    if (discriminant < 0) return inside(a) ? [a, b] : null;
    const root = Math.sqrt(Math.max(0, discriminant));
    const lo = Math.max(0, (-bb - root) / (2 * aa));
    const hi = Math.min(1, (-bb + root) / (2 * aa));
    return lo <= hi ? [lo, hi].map(t => [a[0] + t * dx, a[1] + t * dy]) : null;
  }
  return sink => {
    let line = null, polygon = false, rings = [];
    return {
      point(x, y) {
        if (line) line.push([x, y]);
        else if (inside([x, y])) sink.point(x, y);
      },
      lineStart() { line = []; },
      lineEnd() {
        if (polygon) rings.push(line);
        else {
          let open = false, last = null;
          for (let i = 1; i < line.length; i++) {
            const clipped = segment(line[i - 1], line[i]);
            if (!clipped) { if (open) sink.lineEnd(); open = false; last = null; continue; }
            if (!open || Math.hypot(last[0] - clipped[0][0], last[1] - clipped[0][1]) > 1e-7) {
              if (open) sink.lineEnd();
              sink.lineStart(); sink.point(...clipped[0]); open = true;
            }
            sink.point(...clipped[1]); last = clipped[1];
          }
          if (open) sink.lineEnd();
        }
        line = null;
      },
      polygonStart() { polygon = true; rings = []; },
      polygonEnd() {
        const clipped = rings.map(clipRing).filter(ring => ring.length >= 3);
        if (clipped.length) {
          sink.polygonStart();
          for (const ring of clipped) { sink.lineStart(); for (const point of ring) sink.point(...point); sink.lineEnd(); }
          sink.polygonEnd();
        }
        polygon = false; rings = [];
      },
      sphere() { sink.sphere(); },
    };
  };
}

export function createPaperProjection(d3, mode, longitude = 0, standardParallel = 35) {
  let raw, rotation = [longitude, 0, 0], minimum, maximum;
  if (mode === 'cylinder' || mode === 'transverse') {
    minimum = -Math.atan(2); maximum = Math.atan(2);
    if (mode === 'transverse') {
      rotation = [longitude, 0, 90];
      raw = (lambda, phi) => [Math.tan(phi), -lambda];
    } else raw = (lambda, phi) => [lambda, Math.tan(phi)];
  } else if (mode === 'cone') {
    const alpha = standardParallel * RAD, s = Math.sin(alpha), c = Math.cos(alpha);
    minimum = Math.atan((1 / (3.2 * s) - c) / s);
    maximum = PI / 2;
    raw = (lambda, phi) => {
      const length = Math.cos(phi) / (s * Math.cos(phi - alpha));
      return [length * Math.sin(lambda * s), 1 - length * Math.cos(lambda * s)];
    };
  } else if (mode === 'azimuthal') {
    rotation = [longitude, -90, 0];
    raw = d3.geoGnomonicRaw;
  } else throw new RangeError(`Unknown paper mode: ${mode}`);
  const origin = raw(0, 0);
  const projection = d3.geoProjection(raw).scale(1).translate([origin[0], -origin[1]])
    .rotate(rotation).precision(.003);
  if (mode === 'azimuthal') projection.clipAngle(Math.atan(3.2) / RAD);
  else projection.preclip(latitudeClip(d3, minimum, maximum));
  if (mode === 'cylinder') projection.clipExtent([[-PI, -2], [PI, 2]]);
  if (mode === 'transverse') projection.clipExtent([[-2, -PI], [2, PI]]);
  if (mode === 'cone') projection.postclip(circleClip(0, -1, 3.2));
  return projection;
}
