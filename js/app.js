import { createProjectionCatalog, createMorph, oneHot, blendWeights, MERCATOR_LIMIT } from './projections.js';
import { createIndicators, moveIndicator } from './indicators.js';
import { prepareCountries } from './countries.js';
import { invertMapPoint } from './drag.js';

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
  let saveTimer;
  let morph;
  let projection;
  let path;
  let activeDrag = null;
  let indicators = [];
  const savedCenters = params.get('circles')?.split(';').map(pair => pair.split(',').map(Number));
  const validSavedCenters = savedCenters?.length === 2 && savedCenters.every(center =>
    center.length === 2 && center.every(Number.isFinite)
    && Math.abs(center[0]) <= 180 && Math.abs(center[1]) <= 90);
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
    clearTimeout(saveTimer);
    const url = new URL(location.href);
    url.searchParams.set('projection', catalog[projectionIndex].id);
    url.searchParams.set('country', country.id);
    if (showCircles) url.searchParams.set('tissot', '1');
    else url.searchParams.delete('tissot');
    if (indicators.some(i => i.feature.properties.userPosition)) {
      url.searchParams.set('circles', indicators.map(i =>
        i.feature.properties.center.map(value => Number(value.toFixed(5))).join(',')).join(';'));
    } else url.searchParams.delete('circles');
    history.replaceState(null, '', url);
  }

  function updateDescription(announce = false) {
    const entry = catalog[projectionIndex];
    $('projection-description').textContent = entry.description;
    $('projection').title = entry.description;
    $('map-title').textContent = `${entry.name} world map, highlighting ${country.properties.name}`;
    const text = `${country.properties.name} highlighted in orange. ${entry.description}${showCircles ? ' Two draggable red circles have equal area on the globe and show the projection’s distortion.' : ''}`;
    $('map-description').textContent = text;
    if (announce) $('announcement').textContent = `${entry.name}. ${text}`;
  }

  function positionText([lon, lat]) {
    return `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? 'E' : 'W'}`;
  }

  function updateIndicators() {
    const previous = indicators;
    indicators = createIndicators(d3, country).map((feature, index) => {
      if (previous[index]?.feature.properties.userPosition) feature = previous[index].feature;
      else if (!previous.length && validSavedCenters) feature = moveIndicator(d3, feature, savedCenters[index]);
      const group = document.createElementNS(svgNS, 'g');
      group.setAttribute('class', 'indicator-control');
      group.setAttribute('role', 'button');
      group.setAttribute('tabindex', '0');
      group.setAttribute('aria-describedby', 'tissot-description');
      const shape = document.createElementNS(svgNS, 'path');
      shape.setAttribute('class', 'indicator');
      const title = document.createElementNS(svgNS, 'title');
      group.append(title, shape);
      const indicator = { feature, group, shape, title };
      describeIndicator(indicator);
      group.addEventListener('pointerdown', event => startDrag(event, indicator));
      group.addEventListener('pointermove', drag);
      group.addEventListener('pointerup', endDrag);
      group.addEventListener('pointercancel', endDrag);
      group.addEventListener('lostpointercapture', endDrag);
      group.addEventListener('keydown', event => moveWithKeyboard(event, indicator));
      return indicator;
    });
    $('indicators').replaceChildren(...indicators.map(i => i.group));
  }

  function describeIndicator(indicator) {
    const { label, center, radiusDegrees } = indicator.feature.properties;
    const description = `Tissot circle ${label}: ${positionText(center)}, ${radiusDegrees}° radius. Drag or use arrow keys to move.`;
    indicator.title.textContent = description;
    indicator.group.setAttribute('aria-label', description);
  }

  function latitudeLimit() {
    const mercatorWeight = weights[catalog.findIndex(entry => entry.id === 'mercator')];
    return 90 - (90 - MERCATOR_LIMIT) * mercatorWeight;
  }

  function wrapLongitude(longitude) {
    return ((longitude + 180) % 360 + 360) % 360 - 180;
  }

  function placeIndicator(indicator, center) {
    indicator.feature = moveIndicator(d3, indicator.feature, center);
    describeIndicator(indicator);
  }

  function startDrag(event, indicator) {
    if (event.button !== 0 || activeDrag || !projection) return;
    const point = d3.pointer(event, $('world-map'));
    const grab = invertMapPoint(projection, point, indicator.feature.properties.center, latitudeLimit());
    if (!grab) return;
    const center = indicator.feature.properties.center;
    activeDrag = {
      indicator, pointerId: event.pointerId, client: [event.clientX, event.clientY], grab,
      offset: [wrapLongitude(center[0] - grab[0]), center[1] - grab[1]],
    };
    indicator.group.focus({ preventScroll: true });
    indicator.group.classList.add('dragging');
    indicator.group.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function moveDraggedIndicator() {
    if (!activeDrag) return;
    const { client, indicator, offset } = activeDrag;
    const point = d3.pointer({ clientX: client[0], clientY: client[1] }, $('world-map'));
    // Ignore the whitespace beyond the projected globe; keep the last valid location.
    if (!$('ocean').isPointInFill({ x: point[0], y: point[1] })) return;
    const grab = invertMapPoint(projection, point, activeDrag.grab, latitudeLimit());
    if (!grab) return;
    activeDrag.grab = grab;
    placeIndicator(indicator, [wrapLongitude(grab[0] + offset[0]),
      Math.max(-latitudeLimit(), Math.min(latitudeLimit(), grab[1] + offset[1]))]);
  }

  function drag(event) {
    if (!activeDrag || event.pointerId !== activeDrag.pointerId) return;
    activeDrag.client = [event.clientX, event.clientY];
    moveDraggedIndicator();
    renderIndicators();
    event.preventDefault();
  }

  function endDrag(event) {
    if (!activeDrag || (event && event.pointerId !== activeDrag.pointerId)) return;
    if (event?.type === 'pointerup') drag(event);
    const { indicator, pointerId } = activeDrag;
    activeDrag = null;
    indicator.group.classList.remove('dragging');
    if (indicator.group.hasPointerCapture(pointerId)) indicator.group.releasePointerCapture(pointerId);
    saveState();
    $('announcement').textContent = `Circle ${indicator.feature.properties.label} moved to ${positionText(indicator.feature.properties.center)}. Its area on the globe is unchanged.`;
  }

  function moveWithKeyboard(event, indicator) {
    const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[event.key];
    if (!direction) return;
    event.preventDefault();
    const step = event.shiftKey ? 5 : 1;
    const [lon, lat] = indicator.feature.properties.center;
    placeIndicator(indicator, [wrapLongitude(lon + direction[0] * step),
      Math.max(-latitudeLimit(), Math.min(latitudeLimit(), lat + direction[1] * step))]);
    renderIndicators();
    // Holding an arrow key should not flood the browser's history API.
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveState, 150);
  }

  function renderIndicators() {
    if (!showCircles || !path) return;
    for (const indicator of indicators) indicator.shape.setAttribute('d', path(indicator.feature) || '');
  }

  function render() {
    if (!morph) return;
    projection = morph(weights);
    path = d3.geoPath(projection).digits(2);
    for (const [element, geometry] of layers) element.setAttribute('d', path(geometry) || '');
    moveDraggedIndicator();
    renderIndicators();
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
      render();
      updateDescription(true);
      return;
    }
    animation = { from: weights, to: target, start: now };
    frame = requestAnimationFrame(tick);
  }

  function updateToggle() {
    $('tissot-toggle').setAttribute('aria-pressed', String(showCircles));
    $('indicators').toggleAttribute('hidden', !showCircles);
  }

  $('projection').addEventListener('change', changeProjection);
  $('country').addEventListener('change', () => {
    endDrag();
    country = countries.find(c => c.id === $('country').value);
    layers[4][1] = country;
    updateIndicators();
    updateDescription(true);
    saveState();
    render();
  });
  $('tissot-toggle').addEventListener('click', () => {
    endDrag();
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
    console.error('Map projections:', error);
    $('loading').hidden = true;
    $('error').hidden = false;
  });
}
// Wait for the preceding deferred, vendored libraries as well as the DOM.
if (document.readyState === 'complete') start();
else window.addEventListener('DOMContentLoaded', start, { once: true });
