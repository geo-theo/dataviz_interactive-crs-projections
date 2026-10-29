import assert from 'node:assert/strict';
import test from 'node:test';
import {MODES, PAPER_LIMITS, toCartesian, intersect, surfacePoint, unfold, paperOutline, samplePaper} from '../lab/geometry.js';

const near = (a, b, tolerance = 1e-9) => assert.ok(Math.abs(a - b) < tolerance, `${a} ≈ ${b}`);
const vectorNear = (a, b, tolerance) => a.forEach((value, i) => near(value, b[i], tolerance));
const distance = (a, b) => Math.hypot(...a.map((value, i) => value - b[i]));

test('perspective rays hit the actual finite cylinder, cone, or plane', () => {
  for (const {id} of MODES) {
    let hitCount = 0;
    for (let lon = -175; lon <= 175; lon += 10) {
      for (let lat = -85; lat <= 85; lat += 10) {
        const globe = toCartesian(lon, lat);
        const hit = intersect(globe, id);
        if (!hit) continue;
        hitCount++;
        assert.ok(hit.distance >= 1 - 1e-9, 'tangent paper lies on or outside the sphere');
        vectorNear(hit.point, globe.map(value => value * hit.distance));
        vectorNear(surfacePoint(...hit.flat, id), hit.point);
        if (id === 'cylinder') near(Math.hypot(hit.point[0], hit.point[2]), 1);
        if (id === 'transverse') near(Math.hypot(hit.point[1], hit.point[2]), 1);
        if (id === 'azimuthal') near(hit.point[1], 1);
        if (id === 'cone') {
          const alpha = 35 * Math.PI / 180;
          near(Math.hypot(hit.point[0], hit.point[2]), Math.tan(alpha) * (1 / Math.sin(alpha) - hit.point[1]));
        }
      }
    }
    assert.ok(hitCount > 100, `${id} projects a substantial region`);
  }
});

test('contact lines and points remain on the unit globe', () => {
  for (let lon = -180; lon <= 180; lon += 15) {
    const equator = toCartesian(lon, 0);
    vectorNear(intersect(equator, 'cylinder').point, equator);
    const standard = toCartesian(lon, 35);
    vectorNear(intersect(standard, 'cone').point, standard);
  }
  for (let lat = -90; lat <= 90; lat += 15) {
    const meridian = toCartesian(0, lat);
    vectorNear(intersect(meridian, 'transverse').point, meridian);
  }
  vectorNear(intersect(toCartesian(0, 90), 'azimuthal').point, [0, 1, 0]);
});

test('singular, backward, and beyond-paper rays are omitted', () => {
  assert.equal(intersect(toCartesian(0, 90), 'cylinder'), null);
  assert.equal(intersect(toCartesian(90, 0), 'transverse'), null);
  for (const lat of [0, -30, -90, 5]) assert.equal(intersect(toCartesian(0, lat), 'azimuthal'), null);
  assert.equal(intersect(toCartesian(0, -80), 'cone'), null);
  assert.equal(intersect(toCartesian(0, 80), 'cylinder'), null);
  assert.equal(intersect([0, 0, 0], 'cone'), null);
  assert.equal(intersect([NaN, 1, 2], 'cylinder'), null);
  assert.throws(() => intersect([0, 0, 1], 'cone', 0), RangeError);
});

test('a centre light produces central cylindrical spacing, not Mercator spacing', () => {
  const hit = intersect(toCartesian(30, 45), 'cylinder');
  near(hit.flat[0], Math.PI / 6);
  near(hit.flat[1], 1);
  assert.ok(Math.abs(hit.flat[1] - Math.log(Math.tan(3 * Math.PI / 8))) > 0.1);
});

test('changing the standard parallel moves cone contact without changing ray geometry', () => {
  for (const parallel of [20, 35, 55, 70]) {
    const alpha = parallel * Math.PI / 180;
    for (const lon of [-160, -60, 0, 90, 175]) {
      const contact = toCartesian(lon, parallel);
      const hit = intersect(contact, 'cone', parallel);
      vectorNear(hit.point, contact);
      near(Math.hypot(hit.flat[0], 1 - hit.flat[1]), 1 / Math.tan(alpha));
      vectorNear(surfacePoint(...hit.flat, 'cone', parallel), contact);
      vectorNear(unfold(hit.flat, 'cone', 1, parallel), [...hit.flat, 0]);
    }
  }
});

test('polar gnomonic turns a great-circle plane into a straight line', () => {
  const projected = [-1, 0, 1].map(x => intersect([x, 1, 0.4 * x + 0.3], 'azimuthal').flat);
  for (const [u, v] of projected) near(v, -0.4 * u - 0.3);
});

test('unfolding preserves both exact endpoints and local paper distances', () => {
  const samples = {cylinder: [0.6, 0.4], transverse: [0.4, 0.6], cone: [0.6, -0.4], azimuthal: [0.6, 0.4]};
  for (const {id} of MODES) {
    const flat = samples[id];
    vectorNear(unfold(flat, id, 0), surfacePoint(...flat, id));
    vectorNear(unfold(flat, id, 1), [...flat, 0]);
    for (const amount of [0, 0.25, 0.5, 0.75, 0.99999999, 1]) {
      for (const delta of [[1e-5, 0], [0, 1e-5], [1e-5, 1e-5]]) {
        const neighbor = flat.map((value, i) => value + delta[i]);
        const ratio = distance(unfold(flat, id, amount), unfold(neighbor, id, amount)) / Math.hypot(...delta);
        near(ratio, 1, 2e-6);
      }
    }
  }
});

test('paper outlines and mesh share the finite projection domain', () => {
  for (const {id} of MODES) {
    const outline = paperOutline(id);
    vectorNear(outline[0], outline.at(-1));
    const quads = samplePaper(id, 35, 24, 12);
    assert.equal(quads.length, 24 * 12);
    for (const flat of quads.flat()) {
      assert.ok(unfold(flat, id, 0.55).every(Number.isFinite));
      if (id === 'cone') assert.ok(Math.hypot(flat[0], 1 - flat[1]) <= PAPER_LIMITS.radial + 1e-9);
      if (id === 'azimuthal') assert.ok(Math.hypot(...flat) <= PAPER_LIMITS.radial + 1e-9);
    }
  }
});
