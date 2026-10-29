import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import {createProjectionCatalog, createMorph, oneHot, blendWeights, MERCATOR_LIMIT} from '../js/projections.js';
import {createIndicators, indicatorArea} from '../js/indicators.js';
import {prepareCountries} from '../js/countries.js';

const context = vm.createContext({});
for (const filename of ['d3.min.js', 'd3-geo-projection.min.js', 'topojson-client.min.js']) {
  vm.runInContext(fs.readFileSync(new URL(`../vendor/${filename}`, import.meta.url), 'utf8'), context);
}
const {d3, topojson} = context;
const topology = JSON.parse(fs.readFileSync(new URL('../data/countries-110m.json', import.meta.url), 'utf8'));
const world = topojson.feature(topology, topology.objects.countries);
const catalog = createProjectionCatalog(d3);
const sphere = {type: 'Sphere'};
const samplePoints = [[0, 0], [-125, 8], [-35, 52], [145, -48], [-170, 75]];
const width = 1280;
const height = 800;

test('every country has a distinct dropdown key that survives URL state', () => {
  const countries = prepareCountries(world.features);
  assert.equal(new Set(countries.map(country => country.id)).size, 177);
  for (const country of countries) {
    assert.equal(typeof country.id, 'string');
    const query = new URLSearchParams({country: country.id});
    const restored = countries.find(feature => feature.id === new URLSearchParams(query.toString()).get('country'));
    assert.equal(restored, country, `${country.properties.name} restores from its option value`);
  }
  for (const name of ['Kosovo', 'N. Cyprus', 'Somaliland']) {
    assert.ok(countries.find(country => country.properties.name === name).id.startsWith('name:'));
  }
});

function assertFinitePath(path, geometry, label) {
  const rendered = path(geometry);
  assert.equal(typeof rendered, 'string', `${label}: has rendered geometry`);
  assert.ok(rendered.length > 0, `${label}: path is not empty`);
  assert.doesNotMatch(rendered, /NaN|Infinity/, `${label}: all path coordinates are finite`);
}

function assertViewport(bounds, w, h, label) {
  const [[x0, y0], [x1, y1]] = bounds;
  assert.ok([x0, y0, x1, y1].every(Number.isFinite), `${label}: finite bounds`);
  assert.ok(x0 >= -0.01 && y0 >= -0.01 && x1 <= w + 0.01 && y1 <= h + 0.01,
    `${label}: bounds ${JSON.stringify(bounds)} fit ${w} × ${h}`);
}

function near(actual, expected, tolerance, label) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} ≈ ${expected}`);
}

test('all 16 projections render finite paths for all 177 countries', () => {
  assert.equal(catalog.length, 16);
  assert.equal(world.features.length, 177);
  assert.equal(new Set(catalog.map(entry => entry.id)).size, catalog.length);
  const morph = createMorph(d3, catalog, width, height);
  let referenceCenter;
  for (const [index, entry] of catalog.entries()) {
    const projection = morph(oneHot(index, catalog.length));
    const path = d3.geoPath(projection);
    assertFinitePath(path, sphere, entry.name);
    for (const country of world.features) {
      assertFinitePath(path, country, `${entry.name}: ${country.properties.name}`);
    }
    // Disable viewport clipping so an incorrect normalized translation cannot
    // be hidden by the final screen clip (especially Bonne's shifted origin).
    projection.clipExtent(null);
    const bounds = path.bounds(sphere);
    assertViewport(bounds, width, height, entry.name);
    const center = [(bounds[0][0] + bounds[1][0]) / 2, (bounds[0][1] + bounds[1][1]) / 2];
    referenceCenter ||= center;
    near(center[0], referenceCenter[0], 1e-7, `${entry.name}: world stays horizontally centered`);
    near(center[1], referenceCenter[1], 1e-7, `${entry.name}: world stays vertically centered`);
  }
});

test('every pair has a finite midpoint and interpolates geographic points', () => {
  const morph = createMorph(d3, catalog, width, height);
  const endpointPoints = catalog.map((_, index) => {
    const projection = morph(oneHot(index, catalog.length));
    return samplePoints.map(point => projection(point));
  });
  for (let first = 0; first < catalog.length; first += 1) {
    for (let second = first + 1; second < catalog.length; second += 1) {
      const weights = blendWeights(oneHot(first, catalog.length), oneHot(second, catalog.length), 0.5);
      const projection = morph(weights);
      const path = d3.geoPath(projection);
      const label = `${catalog[first].name} → ${catalog[second].name}`;
      assertFinitePath(path, world, label);
      assertFinitePath(path, sphere, label);
      projection.clipExtent(null);
      assertViewport(path.bounds(sphere), width, height, label);
      samplePoints.forEach((point, index) => {
        const actual = projection(point);
        const expected = endpointPoints[first][index].map((value, axis) => (value + endpointPoints[second][index][axis]) / 2);
        near(actual[0], expected[0], 1e-7, `${label}: longitude interpolation`);
        near(actual[1], expected[1], 1e-7, `${label}: latitude interpolation`);
      });
    }
  }
});

test('a redirected transition starts at its current geometry', () => {
  const morph = createMorph(d3, catalog, width, height);
  const interrupted = blendWeights(oneHot(0, catalog.length), oneHot(5, catalog.length), 0.37);
  const before = samplePoints.map(point => morph(interrupted)(point));
  const redirected = blendWeights(interrupted, oneHot(15, catalog.length), 0);
  samplePoints.forEach((point, index) => {
    const after = morph(redirected)(point);
    near(after[0], before[index][0], 1e-9, 'Redirected x stays continuous');
    near(after[1], before[index][1], 1e-9, 'Redirected y stays continuous');
  });
  near(redirected.reduce((sum, value) => sum + value, 0), 1, 1e-12, 'Weights sum to one');
});

test('endpoint worlds also fit narrow mobile and short landscape viewports', () => {
  for (const [w, h] of [[390, 720], [844, 390]]) {
    const morph = createMorph(d3, catalog, w, h);
    catalog.forEach((entry, index) => {
      const projection = morph(oneHot(index, catalog.length)).clipExtent(null);
      assertViewport(d3.geoPath(projection).bounds(sphere), w, h, `${entry.name} mobile`);
    });
  }
});

test('Mercator clips polar caps and remains conformal at 52 degrees', () => {
  const index = catalog.findIndex(entry => entry.id === 'mercator');
  const projection = createMorph(d3, catalog, width, height)(oneHot(index, catalog.length));
  for (const latitude of [0, 52, MERCATOR_LIMIT - 0.01, -MERCATOR_LIMIT + 0.01]) {
    let count = 0;
    d3.geoStream({type: 'Point', coordinates: [0, latitude]}, projection.stream({point() { count += 1; }}));
    assert.equal(count, 1, `Mercator retains latitude ${latitude}`);
  }
  for (const latitude of [86, -86, 90, -90]) {
    let count = 0;
    d3.geoStream({type: 'Point', coordinates: [0, latitude]}, projection.stream({point() { count += 1; }}));
    assert.equal(count, 0, `Mercator excludes latitude ${latitude}`);
  }
  const epsilon = 0.0001;
  const latitude = 52;
  const west = projection([-epsilon, latitude]);
  const east = projection([epsilon, latitude]);
  const south = projection([0, latitude - epsilon]);
  const north = projection([0, latitude + epsilon]);
  const eastScale = Math.hypot(east[0] - west[0], east[1] - west[1]) / Math.cos(latitude * Math.PI / 180);
  const northScale = Math.hypot(north[0] - south[0], north[1] - south[1]);
  assert.ok([eastScale, northScale].every(Number.isFinite));
  near(eastScale / northScale, 1, 1e-7, 'Mercator east and north local scales match');
});

test('Tissot circles have equal spherical area and clear all countries', () => {
  for (const country of world.features) {
    const indicators = createIndicators(d3, country);
    assert.equal(indicators.length, 2);
    const area = indicators.map(feature => d3.geoArea(feature));
    near(area[0] / area[1], 1, 1e-12, `${country.properties.name}: equal spherical area`);
    // Finite polygon sampling slightly underestimates a mathematically exact cap.
    assert.ok(Math.abs(area[0] / indicatorArea() - 1) < 0.001);
    for (const feature of indicators) {
      assert.equal(d3.geoContains(country, feature.properties.center), false, `${country.properties.name}: center outside country`);
      for (const point of feature.geometry.coordinates[0]) {
        assert.equal(d3.geoContains(country, point), false, `${country.properties.name}: circle boundary outside country`);
      }
    }
    assert.ok(d3.geoDistance(indicators[0].properties.center, indicators[1].properties.center) > 10 * Math.PI / 180);
  }
});

test('Tissot placement relocates around synthetic overlapping and multipart countries', () => {
  const first = d3.geoCircle().center([-125, 8]).radius(12)();
  const second = d3.geoCircle().center([-35, 52]).radius(12)();
  const country = {type: 'MultiPolygon', coordinates: [first.coordinates, second.coordinates]};
  const indicators = createIndicators(d3, country);
  assert.notDeepEqual(indicators[0].properties.center, [-125, 8]);
  assert.notDeepEqual(indicators[1].properties.center, [-35, 52]);
  for (const indicator of indicators) {
    assert.equal(d3.geoContains(country, indicator.properties.center), false);
    assert.ok(indicator.geometry.coordinates[0].every(point => !d3.geoContains(country, point)));
  }
  // Long boundary arcs and an antimeridian-crossing country must remain finite.
  const seamCountry = d3.geoCircle().center([178, 50]).radius(25).precision(90)();
  assert.equal(createIndicators(d3, seamCountry).length, 2);
});

test('equal-area endpoints preserve the relative projected areas of the circles', () => {
  const indicators = createIndicators(d3, null);
  const morph = createMorph(d3, catalog, width, height);
  catalog.forEach((entry, index) => {
    if (entry.kind !== 'Equal-area') return;
    const path = d3.geoPath(morph(oneHot(index, catalog.length)));
    near(path.area(indicators[0]) / path.area(indicators[1]), 1, 0.005, `${entry.name}: equal projected areas`);
  });
});
