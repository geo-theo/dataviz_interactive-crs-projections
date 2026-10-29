import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { createPaperProjection } from '../lab/projections.js';
import { toCartesian, intersect } from '../lab/geometry.js';

const context = vm.createContext({});
for (const name of ['d3.min.js', 'topojson-client.min.js']) {
  vm.runInContext(fs.readFileSync(new URL(`../vendor/${name}`, import.meta.url), 'utf8'), context);
}
const { d3, topojson } = context;
const topology = JSON.parse(fs.readFileSync(new URL('../data/countries-110m.json', import.meta.url), 'utf8'));
const land = topojson.feature(topology, topology.objects.land);
const near = (a, b, tolerance = 1e-8) => assert.ok(Math.abs(a - b) < tolerance, `${a} ≈ ${b}`);

test('D3 paper projection points match physical ray intersections after globe rotation', () => {
  for (const mode of ['cylinder', 'transverse', 'cone', 'azimuthal']) {
    for (const longitude of [-95, 0, 50]) {
      const projection = createPaperProjection(d3, mode, longitude);
      for (let lon = -170; lon <= 170; lon += 17) {
        for (let lat = -79; lat <= 81; lat += 10) {
          const hit = intersect(toCartesian(lon + longitude, lat), mode);
          if (!hit) continue;
          const actual = projection([lon, lat]);
          near(actual[0], hit.flat[0]);
          near(-actual[1], hit.flat[1]);
        }
      }
    }
  }
});

test('streamed coastlines and graticules stay inside every finite sheet', () => {
  for (const mode of ['cylinder', 'transverse', 'cone', 'azimuthal']) {
    for (const alpha of mode === 'cone' ? [20, 35, 65] : [35]) {
      for (const longitude of [-85, 0, 120]) {
        const projection = createPaperProjection(d3, mode, longitude, alpha);
        let count = 0;
        const sink = {
          point(u, screenY) {
            const v = -screenY; count++;
            assert.ok(Number.isFinite(u) && Number.isFinite(v), `${mode}: finite point`);
            if (mode === 'cylinder') assert.ok(Math.abs(v) <= 2 + 1e-8, `${mode}: latitude edge ${v}`);
            if (mode === 'transverse') assert.ok(Math.abs(u) <= 2 + 1e-8, `${mode}: axial edge ${u}`);
            if (mode === 'cone') {
              assert.ok(Math.hypot(u, 1 - v) <= 3.2 + 1e-8, `${mode}: finite slant length`);
              assert.ok(Math.abs(Math.atan2(u, 1 - v)) <= Math.PI * Math.sin(alpha * Math.PI / 180) + 1e-8, `${mode}: sector seam`);
            }
            if (mode === 'azimuthal') assert.ok(Math.hypot(u, v) <= 3.2 + 1e-8, `${mode}: disk edge`);
          },
          lineStart() {}, lineEnd() {}, polygonStart() {}, polygonEnd() {}, sphere() {},
        };
        d3.geoStream(land, projection.stream(sink));
        d3.geoStream(d3.geoGraticule().step([15, 15])(), projection.stream(sink));
        assert.ok(count > 1000, `${mode}: substantial geometry survives clipping`);
      }
    }
  }
});

test('geometry entirely outside a paper sheet produces no streamed points', () => {
  for (const [mode, point] of [['cylinder', [0, 85]], ['transverse', [85, 0]], ['cone', [0, -80]], ['azimuthal', [0, -30]]]) {
    const projection = createPaperProjection(d3, mode);
    let count = 0;
    d3.geoStream({type: 'Point', coordinates: point}, projection.stream({point() { count++; }}));
    assert.equal(count, 0, `${mode}: outside point omitted`);
  }
});
