import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import {createProjectionCatalog, createMorph, oneHot, blendWeights, MERCATOR_LIMIT} from '../js/projections.js';
import {invertMapPoint} from '../js/drag.js';

const context = vm.createContext({});
for (const filename of ['d3.min.js', 'd3-geo-projection.min.js']) {
  vm.runInContext(fs.readFileSync(new URL(`../vendor/${filename}`, import.meta.url), 'utf8'), context);
}
const {d3} = context;
const catalog = createProjectionCatalog(d3);
const morph = createMorph(d3, catalog, 1280, 720);
const points = [[0, 0], [-125, 8], [-35, 52], [145, -48], [-179.9, 75], [179.9, -75], [70, 84], [-65, -84]];

function assertRoundTrip(projection, coordinate, hint, latitudeLimit, label, unique = true) {
  const screen = projection(coordinate);
  const actual = invertMapPoint(projection, screen, hint, latitudeLimit);
  assert.ok(actual, `${label}: inverse exists at ${coordinate}`);
  assert.ok(Math.hypot(...projection(actual).map((value, i) => value - screen[i])) < 0.001,
    `${label}: inverse returns the cursor position`);
  if (unique) {
    assert.ok(Math.abs(actual[0] - coordinate[0]) < 0.001 && Math.abs(actual[1] - coordinate[1]) < 0.001,
      `${label}: recovers geographic position ${coordinate}, got ${actual}`);
  }
  return actual;
}

test('all projection endpoints invert cursor positions including high latitudes and the seam', () => {
  catalog.forEach((entry, index) => {
    const projection = morph(oneHot(index, catalog.length));
    const limit = entry.id === 'mercator' ? MERCATOR_LIMIT : 90;
    for (const point of points) assertRoundTrip(projection, point, [-125, 8], limit, entry.name);
  });
});

test('every projection pair also supports dragging during its morph', () => {
  for (let first = 0; first < catalog.length; first += 1) {
    for (let second = first + 1; second < catalog.length; second += 1) {
      const weights = blendWeights(oneHot(first, catalog.length), oneHot(second, catalog.length), 0.5);
      const projection = morph(weights);
      const limit = 90 - (90 - MERCATOR_LIMIT) * weights[catalog.findIndex(entry => entry.id === 'mercator')];
      for (const point of points) {
        // Some intermediate Bonne blends fold at the polar seam. More than
        // one geographic point can legitimately project to that same pixel.
        assertRoundTrip(projection, point, [-125, 8], limit, `${catalog[first].name} / ${catalog[second].name}`, false);
      }
    }
  }
});

test('a continuously dragged center follows long moves without geographic jumps', () => {
  catalog.forEach((entry, index) => {
    const projection = morph(oneHot(index, catalog.length));
    const limit = entry.id === 'mercator' ? MERCATOR_LIMIT : 90;
    let center = [-165, -65];
    for (let step = 0; step <= 40; step += 1) {
      const coordinate = [-165 + 330 * step / 40, -65 + 140 * step / 40];
      center = assertRoundTrip(projection, coordinate, center, limit, entry.name);
    }
  });
});

test('invalid and off-world cursor positions are rejected instead of clamping to map edges', () => {
  catalog.forEach((entry, index) => {
    const projection = morph(oneHot(index, catalog.length));
    const limit = entry.id === 'mercator' ? MERCATOR_LIMIT : 90;
    for (const point of [[-10000, 0], [10000, 0], [640, -10000], [640, 10000], [NaN, 10], [Infinity, 0]]) {
      assert.equal(invertMapPoint(projection, point, [0, 0], limit), null, entry.name);
    }
  });
  assert.equal(invertMapPoint(null, [0, 0]), null);
  assert.equal(invertMapPoint(morph(oneHot(0, catalog.length)), [0, 0], [0, 0], 0), null);
});
