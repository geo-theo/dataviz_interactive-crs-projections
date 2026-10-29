import { createProjectionCatalog, createMorph, oneHot, blendWeights } from './projections.js';
import { createIndicators } from './indicators.js';
import { prepareCountries } from './countries.js';

const $ = id => document.getElementById(id);
const svgNS = 'http://www.w3.org/2000/svg';

async function init() {
  const d3 = window.d3;
  const topojson = window.topojson;
  if (!d3 || !topojson) throw new Error('The local map libraries could not load.');
  const catalog = createProjectionCatalog(d3);
  const response = await fetch(new URL('../data/countries-110m.json', import.meta.url));
  if (!response.ok) throw new Error(`Map data: HTTP ${response.status}`);
  const world = await response.json();
  const countries = prepareCountries(topojson.feature(world, world.objects.countries).features);
  const land = topojson.feature(world, world.objects.land);
  const borders = topojson.mesh(world, world.objects.countries, (a, b) => a !== b);
  const graticule = d3.geoGraticule().step([15, 15])();
  const sphere = { type: 'Sphere' };
  const params = new URLSearchParams(location.search);
  let projectionIndex = Math.max(0, catalog.findIndex(p => p.id === params.get('projection')));
  let country = countries.find(c => c.id === params.get('country'))
    || countries.find(c => c.properties.name === 'Brazil') || countries[0];
  let showCircles = params.get('tissot') === '1';
  let weights = oneHot(projectionIndex, catalog.length);
  let animation = null;
  let frame = 0;
  let resizeFrame = 0;
  let morph;
  let indicators = [];
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const layers = [
    [$('ocean'), sphere], [$('graticule'), graticule], [$('land'), land],
    [$('borders'), borders], [$('selected-country'), country], [$('outline'), sphere],
  ];

  $('projection').replaceChildren(...catalog.map(p => new Option(p.name, p.id)));
  $('country').replaceChildren(...countries.map(c => new Option(c.properties.name, c.id)));
  $('projection').value = catalog[projectionIndex].id;
  $('country').value = country.id;

  function saveState() {
    const url = new URL(location.href);
    url.searchParams.set('projection', catalog[projectionIndex].id);
    url.searchParams.set('country', country.id);
    if (showCircles) url.searchParams.set('tissot', '1');
    else url.searchParams.delete('tissot');
    history.replaceState(null, '', url);
  }

  function updateDescription(announce = false) {
    const entry = catalog[projectionIndex];
    $('projection-name').textContent = entry.name;
    $('projection-kind').textContent = `${entry.kind} projection`;
    $('projection-description').textContent = entry.description;
    $('country-name').textContent = country.properties.name;
    $('map-title').textContent = `${entry.name} world map, highlighting ${country.properties.name}`;
    const text = `${country.properties.name} highlighted in orange. ${entry.description}${showCircles ? ' Two blue circles have equal area on the globe and show the projection’s distortion.' : ''}`;
    $('map-description').textContent = text;
    if (announce) $('announcement').textContent = `${entry.name}. ${text}`;
  }

  function positionText([lon, lat]) {
    return `${Math.abs(lat)}°${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon)}°${lon >= 0 ? 'E' : 'W'}`;
  }

  function updateIndicators() {
    indicators = createIndicators(d3, country).map(feature => {
      const group = document.createElementNS(svgNS, 'g');
      const shape = document.createElementNS(svgNS, 'path');
      shape.setAttribute('class', 'indicator');
      const hatch = document.createElementNS(svgNS, 'path');
      hatch.setAttribute('class', 'indicator-hatch');
      const center = document.createElementNS(svgNS, 'circle');
      center.setAttribute('class', 'indicator-center');
      center.setAttribute('r', '2');
      const label = document.createElementNS(svgNS, 'text');
      label.setAttribute('class', 'indicator-label');
      label.textContent = feature.properties.label;
      const title = document.createElementNS(svgNS, 'title');
      title.textContent = `Circle ${feature.properties.label}: ${positionText(feature.properties.center)}, 5° spherical radius`;
      group.append(title, shape, hatch, center, label);
      return { feature, group, shape, hatch, center, label };
    });
    $('indicators').replaceChildren(...indicators.map(i => i.group));
    $('circle-positions').textContent = indicators.map(({ feature: f }) => `${f.properties.label} · ${positionText(f.properties.center)}`).join('   /   ');
  }

  function render() {
    if (!morph) return;
    const projection = morph(weights);
    const path = d3.geoPath(projection).digits(2);
    for (const [element, geometry] of layers) element.setAttribute('d', path(geometry) || '');
    if (showCircles) {
      for (const indicator of indicators) {
        const shape = path(indicator.feature);
        indicator.shape.setAttribute('d', shape || '');
        indicator.hatch.setAttribute('d', shape || '');
        const [x, y] = projection(indicator.feature.properties.center);
        indicator.center.setAttribute('cx', x);
        indicator.center.setAttribute('cy', y);
        const bounds = path.bounds(indicator.feature);
        indicator.label.setAttribute('x', x);
        indicator.label.setAttribute('y', bounds[0][1] - 7);
      }
    }
  }

  function resize() {
    const { width, height } = $('map-stage').getBoundingClientRect();
    $('world-map').setAttribute('viewBox', `0 0 ${width} ${height}`);
    morph = createMorph(d3, catalog, width, height);
    render();
  }

  function currentWeights(now) {
    if (!animation) return weights;
    const t = Math.min(1, Math.max(0, (now - animation.start) / 1450));
    return blendWeights(animation.from, animation.to, d3.easeCubicInOut(t));
  }

  function tick(now) {
    weights = currentWeights(now);
    const done = now >= animation.start + 1450;
    if (done) weights = animation.to;
    render();
    if (!done) frame = requestAnimationFrame(tick);
    else {
      animation = null;
      frame = 0;
      $('map-stage').classList.remove('is-transitioning');
      updateDescription(true);
    }
  }

  function changeProjection() {
    const now = performance.now();
    weights = currentWeights(now);
    cancelAnimationFrame(frame);
    projectionIndex = catalog.findIndex(p => p.id === $('projection').value);
    const target = oneHot(projectionIndex, catalog.length);
    updateDescription();
    saveState();
    if (reducedMotion.matches) {
      weights = target;
      animation = null;
      $('map-stage').classList.remove('is-transitioning');
      render();
      updateDescription(true);
      return;
    }
    animation = { from: weights, to: target, start: now };
    $('map-stage').classList.add('is-transitioning');
    frame = requestAnimationFrame(tick);
  }

  function updateToggle() {
    $('tissot-toggle').setAttribute('aria-pressed', String(showCircles));
    $('indicators').toggleAttribute('hidden', !showCircles);
    $('circle-caption').hidden = !showCircles;
  }

  $('projection').addEventListener('change', changeProjection);
  $('country').addEventListener('change', () => {
    country = countries.find(c => c.id === $('country').value);
    layers[4][1] = country;
    updateIndicators();
    updateDescription(true);
    saveState();
    render();
  });
  $('tissot-toggle').addEventListener('click', () => {
    showCircles = !showCircles;
    updateToggle();
    updateDescription(true);
    saveState();
    render();
  });
  reducedMotion.addEventListener('change', () => {
    if (reducedMotion.matches && animation) {
      cancelAnimationFrame(frame);
      weights = animation.to;
      animation = null;
      $('map-stage').classList.remove('is-transitioning');
      render();
      updateDescription(true);
    }
  });
  new ResizeObserver(() => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(resize);
  }).observe($('map-stage'));
  updateIndicators();
  updateDescription();
  updateToggle();
  resize();
  $('loading').hidden = true;
  for (const id of ['projection', 'country', 'tissot-toggle']) $(id).disabled = false;
}

function start() {
  init().catch(error => {
    console.error('Projection Atlas:', error);
    $('loading').hidden = true;
    $('error').hidden = false;
  });
}
// Wait for the preceding deferred, vendored libraries as well as the DOM.
if (document.readyState === 'complete') start();
else window.addEventListener('DOMContentLoaded', start, { once: true });
