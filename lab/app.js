import { MODES, toCartesian, intersect, unfold, paperOutline, samplePaper } from './geometry.js';
import { createPaperProjection } from './projections.js';

const $ = id => document.getElementById(id);
const d3 = window.d3;
const RAD = Math.PI / 180;
const clamp = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
const phase = (p, lo, hi) => clamp((p - lo) / (hi - lo));
const ease = t => t * t * (3 - 2 * t);
const mix = (a, b, t) => a + (b - a) * t;
const steps = [.2, .37, .69, 1];
const notes = {
  cylinder: {
    badge: 'TANGENT CYLINDER', name: 'CENTRAL\nCYLINDRICAL',
    contact: 'The paper touches the globe along the <strong>equator.</strong> Look for the green contact line.',
    first: 'Start with a cylinder. Place the paper around the globe so it just touches the equator.',
    result: 'A rectangular map. The equator keeps its scale, but the grid stretches dramatically north and south. This is central cylindrical, the literal shadow projection.',
    touch: 'Along the equator, the globe and cylinder share a line. Scale is true there. Move away from it and the shadows stretch.',
    distortion: 'Near the poles, rays travel almost parallel to the cylinder. Their shadows shoot toward infinity. Our finite paper stops at about 63° north and south.',
    formula: 'Cylinder: u = λ, v = tan φ, where λ is longitude relative to the paper and φ is latitude (radians). The sheet spans −π ≤ u ≤ π and −2 ≤ v ≤ 2. Mercator uses a different latitude rule: v = ln tan(π/4 + φ/2).',
  },
  transverse: {
    badge: 'TRANSVERSE CYLINDER', name: 'TRANSVERSE CENTRAL\nCYLINDRICAL',
    contact: 'The paper touches along a <strong>great circle through both poles.</strong> Stretching grows sideways from that circle.',
    first: 'Turn the paper sleeve on its side. Its contact circle now passes through both poles.',
    result: 'The same shadow experiment, turned sideways. The contact meridian keeps its scale; regions far to either side stretch. This is transverse central cylindrical.',
    touch: 'The sideways cylinder touches a great circle through the poles. That complete circle is the line of true scale, including the meridian on the far side.',
    distortion: 'Rays near the cylinder’s open ends travel almost along its axis. Their shadows extend beyond our finite paper. Rotating the globe changes which regions are stretched.',
    formula: 'Transverse cylinder: for a unit-sphere point (x,y,z), q = √(y² + z²), u = x/q and v = atan2(y,z). The cylinder axis is x; the sheet spans −2 ≤ u ≤ 2 and −π ≤ v ≤ π. This literal perspective construction is different from Transverse Mercator.',
  },
  cone: {
    badge: 'TANGENT CONE', name: 'PERSPECTIVE\nCONIC',
    contact: 'The cone touches at <strong>one circle of latitude.</strong> Change the contact latitude to reshape your paper hat.',
    first: 'Place a paper cone over the globe. The green ring marks the latitude where the paper just touches.',
    result: 'A fan-shaped map. Meridians radiate from the cone’s tip and parallels form circular arcs. Scale is true along the contact parallel.',
    touch: 'The contact latitude is the standard parallel. A wider or narrower cone moves that circle. Along it, the sphere and paper have the same local scale.',
    distortion: 'The cone favors a band around its contact latitude. Rays toward the opposite hemisphere can miss the cone or fall beyond its edge. Our paper has a slant length of 3.2 Earth radii.',
    formula: 'Cone: at standard parallel α, a ray meets the cone at distance t = 1 / (cos φ cos α + sin φ sin α). The slant length is l = t cos φ / sin α, with developed angle θ = λ sin α. The flat sheet is a sector of radius 3.2. The exact cone opens into that sector without stretching.',
  },
  azimuthal: {
    badge: 'POLAR TANGENT PLANE', name: 'POLAR\nGNOMONIC',
    contact: 'The sheet touches at just <strong>the North Pole.</strong> Light spreads outward across a flat plane.',
    first: 'Rest a flat sheet against the North Pole. It needs no unrolling, just a turn to face you.',
    result: 'A polar gnomonic map. Longitude lines radiate from the pole. Shadows grow rapidly toward the horizon; the equator can never fit on finite paper.',
    touch: 'A plane touches the globe at one point. Here it is the North Pole, where scale is true in every direction. Other plane orientations can center other places.',
    distortion: 'The equator’s rays are parallel to this paper and never reach it. Only part of the northern hemisphere fits. This sheet ends at about 17° N; the southern hemisphere projects away from it.',
    formula: 'North-polar gnomonic: t = 1/y; u = x/y and v = −z/y for a unit-sphere point (x,y,z), with y > 0. The finite sheet has radius 3.2, so only latitudes above arctan(1/3.2) ≈ 17.35° N appear. Great circles project to straight lines.',
  },
};

async function init() {
  if (!d3 || !window.topojson) throw new Error('The bundled map libraries could not load.');
  const response = await fetch(new URL('../data/countries-110m.json', import.meta.url));
  if (!response.ok) throw new Error(`Map data returned ${response.status}`);
  const topology = await response.json();
  const land = window.topojson.feature(topology, topology.objects.land);
  const graticule = d3.geoGraticule().step([15, 15])();
  const params = new URLSearchParams(location.search);
  const state = {
    mode: MODES.some(m => m.id === params.get('surface')) ? params.get('surface') : 'cylinder',
    longitude: clamp(Number(params.get('longitude')) || 0, -180, 180),
    alpha: clamp(Number(params.get('parallel')) || 35, 20, 65),
    progress: params.get('flat') === '1' ? 1 : 0,
    yaw: -24, pitch: 17, rays: true, circles: false,
  };
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const groups = Object.fromEntries(['paper-back', 'globe-back', 'rays-back', 'globe-front', 'paper-front', 'shadows', 'rays-front', 'scene-labels'].map(id => [id, d3.select($(id))]));
  let mesh, outline, flatLand, flatGrid, flatCircles, contact, projection;
  let animation = null, raf = 0, stage = -1, drag = null;
  let lastTime = 0;

  function projectLines(feature) {
    const lines = [];
    let line;
    d3.geoStream(feature, projection.stream({
      point(x, y) { if (line && Number.isFinite(x) && Number.isFinite(y)) line.push([x, -y]); },
      lineStart() { line = []; },
      lineEnd() { if (line?.length > 1) lines.push(line); line = null; },
      polygonStart() {}, polygonEnd() {}, sphere() {},
    }));
    return lines;
  }

  function rebuild() {
    projection = createPaperProjection(d3, state.mode, state.longitude, state.alpha);
    mesh = samplePaper(state.mode, state.alpha, 60, 14);
    // Sample straight edges as well; a rectangle's corner-only outline cannot
    // describe its curved rim while it is still wrapped around the globe.
    const boundary = paperOutline(state.mode, state.alpha, 160);
    outline = boundary.flatMap((point, i) => {
      if (!i) return [point];
      const previous = boundary[i - 1];
      const n = Math.max(1, Math.ceil(Math.hypot(point[0] - previous[0], point[1] - previous[1]) / .07));
      return Array.from({ length: n }, (_, j) => [mix(previous[0], point[0], (j + 1) / n), mix(previous[1], point[1], (j + 1) / n)]);
    });
    flatLand = projectLines(land);
    flatGrid = projectLines(graticule);
    const centers = state.mode === 'azimuthal' ? [[-30, 73], [60, 32]]
      : state.mode === 'cone' ? [[-25, state.alpha], [45, Math.max(0, state.alpha - 28)]]
      : state.mode === 'transverse' ? [[0, 15], [48, 25]] : [[-25, 0], [40, 48]];
    flatCircles = centers.map(center => {
      // Geographic centers move with the globe so both comparisons remain on
      // the finite paper when longitude changes.
      const geographic = [center[0] - state.longitude, center[1]];
      const feature = d3.geoCircle().center(geographic).radius(6).precision(2)();
      return { feature, lines: projectLines(feature) };
    });
    contact = Array.from({ length: 241 }, (_, i) => {
      const angle = i / 240 * Math.PI * 2;
      if (state.mode === 'cylinder') return [Math.sin(angle), 0, Math.cos(angle)];
      if (state.mode === 'transverse') return [0, Math.sin(angle), Math.cos(angle)];
      if (state.mode === 'cone') return [Math.cos(state.alpha * RAD) * Math.sin(angle), Math.sin(state.alpha * RAD), Math.cos(state.alpha * RAD) * Math.cos(angle)];
      return [Math.sin(angle) * .035, 1.001, Math.cos(angle) * .035];
    });
    updateControls();
    render();
  }

  function syncUrl() {
    const url = new URL(location.href);
    url.searchParams.set('surface', state.mode);
    if (state.longitude) url.searchParams.set('longitude', state.longitude); else url.searchParams.delete('longitude');
    if (state.mode === 'cone') url.searchParams.set('parallel', state.alpha); else url.searchParams.delete('parallel');
    if (state.progress === 1) url.searchParams.set('flat', '1'); else url.searchParams.delete('flat');
    history.replaceState(null, '', url);
  }

  function updateControls() {
    const note = notes[state.mode];
    document.querySelectorAll('[data-mode]').forEach(button => {
      const active = button.dataset.mode === state.mode;
      button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
    });
    $('cone-settings').hidden = state.mode !== 'cone';
    $('meridian').value = state.longitude;
    $('meridian-value').textContent = state.longitude === 0 ? '0°' : `${Math.abs(state.longitude)}° ${state.longitude > 0 ? 'E' : 'W'}`;
    $('parallel').value = state.alpha;
    $('parallel-value').textContent = `${state.alpha}° N`;
    $('contact-copy').innerHTML = note.contact;
    $('scene-badge').replaceChildren(document.createTextNode(note.badge), Object.assign(document.createElement('span'), { textContent: 'Earth radius = 1 · paper shown translucent' }));
    $('projection-name').style.whiteSpace = 'pre-line';
    $('projection-name').textContent = note.name;
    $('note-contact').textContent = note.touch;
    $('note-distortion').textContent = note.distortion;
    $('formula-copy').textContent = note.formula;
    $('scene-title').textContent = `${MODES.find(m => m.id === state.mode).name}: light from globe to paper`;
    syncUrl();
  }

  function updateStage() {
    const p = state.progress;
    const current = p < .21 ? 0 : p < .4 ? 1 : p < .72 ? 2 : 3;
    const changed = stage !== current;
    stage = current;
    const text = [notes[state.mode].first,
      'The bulb is at the globe’s center. Follow each gold ray through a point on the sphere to the paper. The farther its shadow lands, the more the map stretches.',
      'The latitude and longitude wires cast a grid. Trace that grid and the continent shadows onto the paper. Some rays fall beyond the sheet’s edges.',
      notes[state.mode].result][stage];
    $('observation-label').textContent = ['WHAT TO DO', 'FOLLOW THE LIGHT', 'MAKE YOUR MARK', state.progress > .99 ? 'YOUR FINISHED MAP' : 'OPEN THE PAPER'][stage];
    $('observation-copy').textContent = text;
    document.querySelectorAll('[data-step]').forEach((button, i) => {
      button.classList.toggle('active', i === stage);
      button.classList.toggle('done', i < stage);
      if (i === stage) button.setAttribute('aria-current', 'step'); else button.removeAttribute('aria-current');
    });
    $('progress').value = Math.round(p * 1000);
    const amount = ease(phase(p, .72, 1));
    $('progress-text').textContent = `${Math.round(amount * 100)}% ${state.mode === 'azimuthal' ? 'turned' : 'unfolded'}`;
    $('progress').setAttribute('aria-valuetext', `${Math.round(p * 100)} percent. ${['Place the paper', 'Switch on the light', 'Trace the shadows', 'Unfold your map'][stage]}.`);
    if (!animation) $('play-text').textContent = p > .999 ? 'Replay experiment' : 'Run the experiment';
    const target = steps.findIndex(t => t > p + .015);
    $('next').replaceChildren(document.createTextNode(target < 0 ? 'Start again' : ['Place paper', 'Light the globe', 'Trace shadows', state.mode === 'azimuthal' ? 'Turn the map' : 'Unfold map'][target]), Object.assign(document.createElement('span'), { textContent: '→' }));
    if (changed) $('announcement').textContent = text;
    $('scene-description').textContent = `${MODES.find(m => m.id === state.mode).projection}. ${text}`;
  }

  function render() {
    const p = state.progress;
    const placed = ease(phase(p, 0, .2));
    const light = ease(phase(p, .21, .37));
    const traced = phase(p, .4, .69);
    const opened = ease(phase(p, .72, 1));
    const viewBlend = ease(phase(opened, 0, .9));
    const yaw = state.yaw * RAD * (1 - viewBlend), pitch = state.pitch * RAD * (1 - viewBlend);
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const [minU, maxU] = d3.extent(outline, pt => pt[0]);
    const [minV, maxV] = d3.extent(outline, pt => pt[1]);
    const flatScale = Math.min(690 / (maxU - minU), 450 / (maxV - minV));
    const initialScale = state.mode === 'cone' ? Math.min(113, 215 * Math.sin(state.alpha * RAD)) : state.mode === 'azimuthal' ? 91 : 109;
    const scale = mix(initialScale, flatScale, viewBlend);
    const center = [520 - (minU + maxU) / 2 * flatScale * viewBlend,
      mix(state.mode === 'cone' ? 304 : 288, 288 + (minV + maxV) / 2 * flatScale, viewBlend)];
    function camera(point) {
      const [x, y, z] = point;
      const horizontal = cy * x + sy * z;
      const depth = -sy * x + cy * z;
      return [center[0] + horizontal * scale, center[1] - (cp * y + sp * depth) * scale, -sp * y + cp * depth];
    }
    function paperPoint(flat) {
      const point = unfold(flat, state.mode, opened, state.alpha);
      // The loose paper approaches the globe before illumination begins.
      if (state.mode === 'azimuthal') point[1] += (1 - placed) * 1.2;
      else { point[0] *= 1 + (1 - placed) * .32; point[2] *= 1 + (1 - placed) * .32; }
      return camera(point);
    }
    const linePath = (points, convert = paperPoint, close = false) => {
      const result = points.map(convert);
      return result.length ? `M${result.map(pt => `${pt[0].toFixed(2)},${pt[1].toFixed(2)}`).join('L')}${close ? 'Z' : ''}` : '';
    };
    const paths = (lines, convert = paperPoint, close = false) => lines.map(line => linePath(line, convert, close)).join('');
    const facets = mesh.map(quad => {
      const corners = quad.map(paperPoint);
      return { d: linePath(quad, paperPoint, true), z: d3.mean(corners, v => v[2]) };
    }).sort((a, b) => a.z - b.z);
    const globeOpacity = 1 - ease(phase(opened, .05, .65));
    const opacity = mix(.42, .94, opened);
    const back = facets.filter(f => f.z < -.02), front = facets.filter(f => f.z >= -.02);
    for (const [key, data] of [['paper-back', back], ['paper-front', front]]) {
      groups[key].selectAll('path.paper-face').data(data).join('path').attr('class', 'paper-face')
        .attr('d', f => f.d).attr('fill', f => f.z < 0 ? '#e1deca' : '#eee5ca')
        .attr('fill-opacity', opacity).attr('stroke', f => f.z < 0 ? '#e1deca' : '#eee5ca').attr('stroke-opacity', opacity).attr('stroke-width', .55);
    }
    const globeProjection = d3.geoOrthographic().rotate([state.longitude + yaw / RAD, pitch / RAD])
      .scale(scale).translate(center).precision(.35);
    const globePath = d3.geoPath(globeProjection);
    const globe = groups['globe-front'].attr('opacity', globeOpacity);
    globe.selectAll('circle.globe-disc').data([0]).join('circle').attr('class', 'globe-disc').attr('cx', center[0]).attr('cy', center[1]).attr('r', scale).attr('fill', 'url(#globe-fill)').attr('fill-opacity', .65).attr('stroke', '#9eae94').attr('stroke-width', .8);
    globe.selectAll('path.globe-land').data([land]).join('path').attr('class', 'globe-land').attr('d', globePath).attr('fill', '#708c6b').attr('fill-opacity', .23).attr('stroke', '#66815f').attr('stroke-width', .8);
    globe.selectAll('path.globe-grid').data([graticule]).join('path').attr('class', 'globe-grid grid-line').attr('d', globePath).attr('stroke', '#657f60').attr('stroke-opacity', .8);
    // The far hemisphere remains visible as a wire skeleton, as in the class model.
    const backProjection = d3.geoOrthographic().rotate([state.longitude + yaw / RAD + 180, -pitch / RAD]).reflectX(true).scale(scale).translate(center);
    groups['globe-back'].attr('opacity', globeOpacity * .35).selectAll('path').data([graticule]).join('path').attr('d', d3.geoPath(backProjection)).attr('fill', 'none').attr('stroke', '#78916c').attr('stroke-width', .6).attr('stroke-dasharray', '2 3');
    globe.selectAll('path.contact').data([contact]).join('path').attr('class', 'contact contact-line').attr('d', line => linePath(line, camera));
    globe.selectAll('path.globe-circles').data(state.circles ? flatCircles : []).join('path').attr('class', 'globe-circles shadow-circle').attr('d', f => globePath(f.feature));

    const shadow = groups.shadows;
    shadow.selectAll('path.paper-edge').data([outline]).join('path').attr('class', 'paper-edge').attr('d', line => linePath(line)).attr('fill', 'none').attr('stroke', '#b3a27c').attr('stroke-width', 1).attr('stroke-opacity', .8);
    // The light casts the whole shadow first; the tracing pass darkens it.
    shadow.selectAll('path.cast-grid').data([0]).join('path').attr('class', 'cast-grid paper-grid').attr('d', paths(flatGrid)).attr('opacity', light * .18 * (1 - traced));
    shadow.selectAll('path.cast-coast').data([0]).join('path').attr('class', 'cast-coast paper-coast').attr('d', paths(flatLand)).attr('opacity', light * .28 * (1 - traced));
    // A vertical wipe traces the entire clipped D3 geometry continuously.
    const traceThreshold = mix(-3.3, 3.3, traced);
    const traceLine = lines => lines.flatMap(line => {
      const segments = []; let current = [];
      for (const pt of line) {
        if (pt[0] <= traceThreshold) current.push(pt);
        else { if (current.length > 1) segments.push(current); current = []; }
      }
      if (current.length > 1) segments.push(current);
      return segments;
    });
    shadow.selectAll('path.paper-grid').data([0]).join('path').attr('class', 'paper-grid').attr('d', paths(traceLine(flatGrid))).attr('opacity', traced > 0 ? mix(.7, .8, opened) : 0);
    shadow.selectAll('path.paper-land').data([0]).join('path').attr('class', 'paper-land paper-coast').attr('d', paths(traceLine(flatLand))).attr('opacity', traced > 0 ? 1 : 0);
    // Fill the finished map only: its cut and clipped rings are then planar.
    shadow.selectAll('path.flat-land-fill').data(opened > .98 && traced > .99 ? [0] : []).join('path').attr('class', 'flat-land-fill').attr('d', paths(flatLand, paperPoint, true)).attr('fill', '#65855c').attr('fill-opacity', .2).attr('stroke', 'none').attr('fill-rule', 'evenodd').lower();
    shadow.selectAll('path.paper-circles').data(state.circles && traced > .05 ? flatCircles : []).join('path').attr('class', 'paper-circles shadow-circle').attr('d', f => paths(f.lines, paperPoint, true));

    const rayOpacity = state.rays ? light * (1 - phase(opened, 0, .22)) : 0;
    const samples = state.mode === 'azimuthal' ? [[-45, 65], [20, 40], [100, 25], [170, 55]]
      : state.mode === 'cone' ? [[-65, 15], [0, state.alpha], [55, 65], [100, 5]]
      : state.mode === 'transverse' ? [[0, 50], [40, 15], [-50, -30], [20, -50]]
      : [[-65, 38], [-20, 0], [35, 48], [60, -35]];
    const rays = samples.map(([lon, lat]) => {
      const sphere = toCartesian(lon, lat);
      const hit = intersect(sphere, state.mode, state.alpha);
      return hit ? { sphere, hit } : null;
    }).filter(Boolean);
    const rayGroup = groups['rays-front'].attr('opacity', rayOpacity);
    rayGroup.selectAll('path.ray').data(rays).join('path').attr('class', 'ray').attr('d', ray => linePath([[0, 0, 0], ray.hit.point], camera));
    rayGroup.selectAll('circle.ray-sphere').data(rays).join('circle').attr('class', 'ray-sphere').attr('cx', r => camera(r.sphere)[0]).attr('cy', r => camera(r.sphere)[1]).attr('r', 2.6).attr('fill', '#b5802e').attr('stroke', '#f7e3a5').attr('stroke-width', 1);
    rayGroup.selectAll('circle.ray-hit').data(rays).join('circle').attr('class', 'ray-hit').attr('cx', r => camera(r.hit.point)[0]).attr('cy', r => camera(r.hit.point)[1]).attr('r', 3.5).attr('fill', '#f9f2d4').attr('stroke', '#b5802e').attr('stroke-width', 1.2);
    const bulb = camera([0, 0, 0]);
    rayGroup.selectAll('circle.bulb-glow').data([0]).join('circle').attr('class', 'bulb-glow').attr('cx', bulb[0]).attr('cy', bulb[1]).attr('r', 62).attr('fill', 'url(#bulb-glow)').lower();
    rayGroup.selectAll('circle.bulb').data([0]).join('circle').attr('class', 'bulb').attr('cx', bulb[0]).attr('cy', bulb[1]).attr('r', 6).attr('fill', '#fff4c2').attr('stroke', '#ce9a43').attr('stroke-width', 1.2);

    const labels = groups['scene-labels'];
    const initialLabels = opened < .1;
    const annotation = initialLabels ? [
      { label: 'THE WIRE GLOBE', point: camera([-.68, -.68, .05]), anchor: [208, 442] },
      { label: p < .21 ? 'PLACE YOUR PAPER' : 'THE PROJECTION SURFACE', point: paperPoint(state.mode === 'azimuthal' ? [1.8, -.5] : state.mode === 'cone' ? [1.7, -.6] : state.mode === 'transverse' ? [1.8, .9] : [1.4, 1.4]), anchor: [773, 148] },
    ] : [];
    if (initialLabels && light > .8) annotation.push({ label: 'LIGHT AT THE CENTER', point: bulb, anchor: [325, 390] });
    labels.selectAll('path.leader').data(annotation).join('path').attr('class', 'leader svg-leader').attr('d', d => `M${d.anchor[0]},${d.anchor[1] + 8}L${d.anchor[0]},${d.anchor[1] + 24}L${d.point[0]},${d.point[1]}`);
    labels.selectAll('text.annotation').data(annotation).join('text').attr('class', 'annotation svg-micro').attr('x', d => d.anchor[0]).attr('y', d => d.anchor[1]).attr('text-anchor', 'middle').text(d => d.label);
    labels.selectAll('text.flat-caption').data(opened > .85 ? [0] : []).join('text').attr('class', 'flat-caption svg-micro').attr('x', 520).attr('y', 563).attr('text-anchor', 'middle').text(`${MODES.find(m => m.id === state.mode).projection.toUpperCase()} / YOUR UNFOLDED PAPER`);
    $('floor-shadow').setAttribute('opacity', String(.08 * (1 - opened)));
    updateStage();
  }

  function stop() {
    cancelAnimationFrame(raf); animation = null;
    $('play-text').textContent = state.progress >= .999 ? 'Replay experiment' : 'Run the experiment';
    $('play-icon').textContent = '▶';
  }

  function animateTo(target, duration = 2000) {
    stop();
    if (reducedMotion.matches) { state.progress = target; render(); syncUrl(); stop(); return; }
    animation = { from: state.progress, target, duration, start: null };
    $('play-text').textContent = 'Pause experiment'; $('play-icon').textContent = 'Ⅱ';
    function tick(time) {
      if (!animation) return;
      animation.start ??= time;
      const t = clamp((time - animation.start) / animation.duration);
      state.progress = mix(animation.from, animation.target, t);
      // Limit expensive geographic redraws while maintaining smooth interaction.
      if (time - lastTime > 25 || t === 1) { render(); lastTime = time; }
      if (t < 1) raf = requestAnimationFrame(tick);
      else { stop(); syncUrl(); }
    }
    raf = requestAnimationFrame(tick);
  }

  $('play').addEventListener('click', () => {
    if (animation) stop();
    else {
      if (state.progress > .999) { state.progress = 0; render(); }
      animateTo(1, 14000 * (1 - state.progress));
    }
  });
  $('next').addEventListener('click', () => {
    const target = steps.find(t => t > state.progress + .015);
    animateTo(target ?? 0, target === undefined ? 800 : 2500);
  });
  $('progress').addEventListener('input', event => { stop(); state.progress = Number(event.target.value) / 1000; render(); });
  $('progress').addEventListener('change', syncUrl);
  document.querySelectorAll('[data-step]').forEach(button => button.addEventListener('click', () => animateTo(steps[Number(button.dataset.step)], 2200)));
  document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => {
    stop(); state.mode = button.dataset.mode; state.progress = 0; state.yaw = -24; state.pitch = 17;
    rebuild(); $('announcement').textContent = `${MODES.find(m => m.id === state.mode).name} selected. ${notes[state.mode].first}`;
  }));
  $('meridian').addEventListener('input', event => { state.longitude = Number(event.target.value); rebuild(); });
  $('parallel').addEventListener('input', event => { state.alpha = Number(event.target.value); rebuild(); });
  $('show-rays').addEventListener('change', event => { state.rays = event.target.checked; render(); });
  $('show-circles').addEventListener('change', event => { state.circles = event.target.checked; render(); });
  $('reset').addEventListener('click', () => {
    stop(); Object.assign(state, { progress: 0, longitude: 0, alpha: 35, yaw: -24, pitch: 17, rays: true, circles: false });
    $('show-rays').checked = true; $('show-circles').checked = false; rebuild();
  });
  function resetView() { state.yaw = -24; state.pitch = 17; render(); }
  $('view-reset').addEventListener('click', resetView);
  const scene = $('scene');
  scene.addEventListener('pointerdown', event => {
    if (event.button !== 0 || state.progress > .9) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, yaw: state.yaw, pitch: state.pitch };
    scene.setPointerCapture(event.pointerId); scene.classList.add('dragging');
  });
  scene.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return;
    state.yaw = drag.yaw + (event.clientX - drag.x) * .35;
    state.pitch = clamp(drag.pitch - (event.clientY - drag.y) * .25, -65, 65);
    render();
  });
  function endDrag() { drag = null; scene.classList.remove('dragging'); }
  scene.addEventListener('pointerup', endDrag); scene.addEventListener('pointercancel', endDrag); scene.addEventListener('lostpointercapture', endDrag);
  scene.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Home') resetView();
    else {
      state.yaw += event.key === 'ArrowLeft' ? -5 : event.key === 'ArrowRight' ? 5 : 0;
      state.pitch = clamp(state.pitch + (event.key === 'ArrowUp' ? 5 : event.key === 'ArrowDown' ? -5 : 0), -65, 65); render();
    }
  });
  reducedMotion.addEventListener('change', () => { if (reducedMotion.matches && animation) { const target = animation.target; stop(); state.progress = target; render(); syncUrl(); } });
  const narrowViewport = matchMedia('(max-width: 760px)');
  function fitScene() { scene.setAttribute('viewBox', narrowViewport.matches ? '130 0 780 590' : '0 0 1040 590'); }
  narrowViewport.addEventListener('change', fitScene);
  fitScene();
  rebuild();
  $('loading').hidden = true;
  $('play').disabled = false; $('next').disabled = false;
  stop();
}

init().catch(error => {
  console.error(error);
  $('loading').hidden = true;
  $('error').hidden = false;
});
