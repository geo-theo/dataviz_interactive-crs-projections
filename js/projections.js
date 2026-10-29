// All projections share one central meridian and antimeridian cut. Keeping the
// same spherical topology allows point-by-point morphing without path glitches.
export const MERCATOR_LIMIT = 85.0511287798066;

export function createProjectionCatalog(d3) {
  const rad = Math.PI / 180;
  const mercator = (lambda, phi) => d3.geoMercatorRaw(lambda,
    Math.max(-MERCATOR_LIMIT * rad, Math.min(MERCATOR_LIMIT * rad, phi)));
  return [
    { id: 'natural-earth', name: 'Natural Earth I', kind: 'Compromise', raw: d3.geoNaturalEarth1Raw, description: 'A balanced view of the world, with softly curved meridians.' },
    { id: 'equal-earth', name: 'Equal Earth', kind: 'Equal-area', raw: d3.geoEqualEarthRaw, description: 'True relative areas, with a familiar, gently rounded world.' },
    { id: 'mercator', name: 'Mercator', kind: 'Conformal', raw: mercator, description: 'Preserves local angles; areas grow toward the poles. Display limited to ±85.05°.' },
    { id: 'robinson', name: 'Robinson', kind: 'Compromise', raw: d3.geoRobinsonRaw, description: 'A rounded compromise between the shapes and sizes of continents.' },
    { id: 'mollweide', name: 'Mollweide', kind: 'Equal-area', raw: d3.geoMollweideRaw, description: 'An elliptical world that preserves the relative area of every country.' },
    { id: 'winkel-tripel', name: 'Winkel Tripel', kind: 'Compromise', raw: d3.geoWinkel3Raw, description: 'Balances area, direction, and distance distortion in one rounded view.' },
    { id: 'equirectangular', name: 'Equirectangular', kind: 'Equidistant cylindrical', raw: d3.geoEquirectangularRaw, description: 'A rectangular grid. Meridians and the equator have a constant distance scale.' },
    { id: 'gall-peters', name: 'Gall–Peters', kind: 'Equal-area', raw: d3.geoCylindricalEqualAreaRaw(45 * rad), description: 'Preserves area, stretching the tropics and flattening the polar regions.' },
    { id: 'hammer', name: 'Hammer', kind: 'Equal-area', raw: d3.geoHammerRaw(2), description: 'An equal-area ellipse with curved parallels and a broad central region.' },
    { id: 'sinusoidal', name: 'Sinusoidal', kind: 'Equal-area', raw: d3.geoSinusoidalRaw, description: 'Preserves area while bending meridians toward a single point at each pole.' },
    { id: 'aitoff', name: 'Aitoff', kind: 'Compromise', raw: d3.geoAitoffRaw, description: 'The world in an ellipse, with curved meridians and parallels.' },
    { id: 'eckert-iv', name: 'Eckert IV', kind: 'Equal-area', raw: d3.geoEckert4Raw, description: 'An equal-area world with rounded sides and flat polar lines.' },
    { id: 'eckert-vi', name: 'Eckert VI', kind: 'Equal-area', raw: d3.geoEckert6Raw, description: 'An equal-area outline shaped by sinusoidal curves and flat poles.' },
    { id: 'natural-earth-ii', name: 'Natural Earth II', kind: 'Compromise', raw: d3.geoNaturalEarth2Raw, description: 'A rounded world with pointed poles and balanced continental shapes.' },
    { id: 'kavrayskiy-vii', name: 'Kavrayskiy VII', kind: 'Compromise', raw: d3.geoKavrayskiy7Raw, description: 'A broad, curved world with a straight equator and flat polar lines.' },
    { id: 'bonne', name: 'Bonne', kind: 'Equal-area', raw: d3.geoBonneRaw(45 * rad), description: 'An equal-area, heart-shaped view with concentric curved parallels.' },
  ];
}

export function oneHot(index, length) {
  return Array.from({ length }, (_, i) => i === index ? 1 : 0);
}

export function blendWeights(from, to, t) {
  return from.map((value, i) => value * (1 - t) + to[i] * t);
}

function latitudeClip(d3, limitDegrees) {
  const limit = limitDegrees * Math.PI / 180;
  return stream => d3.geoClipAntimeridian(
    d3.geoClipRectangle(-Math.PI, -limit, Math.PI, limit)(stream));
}

export function createMorph(d3, catalog, width, height) {
  // Reserve space for the small captions, then fit every endpoint to the same
  // world viewport. The intermediate shapes interpolate those fitted endpoints.
  const compact = width <= 620;
  const top = compact ? 58 : 74;
  const bottom = compact ? 170 : 179;
  const side = compact ? 14 : Math.max(42, width * 0.055);
  const extent = [[side, top], [width - side, Math.max(top + 80, height - bottom)]];
  const fitted = catalog.map(entry => {
    const p = d3.geoProjection(entry.raw).precision(0.3).fitExtent(extent, { type: 'Sphere' });
    const origin = entry.raw(0, 0);
    const translate = p.translate();
    return { raw: entry.raw, scale: p.scale(), translate: [
      translate[0] - origin[0] * p.scale(), translate[1] + origin[1] * p.scale(),
    ] };
  });
  // Include translations inside the raw interpolator (Bonne is asymmetric).
  // A fixed geographic center avoids d3's default raw(0,0) recentering.
  const mutate = d3.geoProjectionMutator(weights => {
    const active = fitted.map((p, i) => ({ ...p, weight: weights[i] })).filter(p => p.weight > 0);
    return (lambda, phi) => {
      let x = 0, y = 0;
      for (const p of active) {
        const point = p.raw(lambda, phi);
        x += p.weight * (point[0] * p.scale + p.translate[0]);
        y += p.weight * (point[1] * p.scale - p.translate[1]);
      }
      return [x, y];
    };
  });
  return weights => {
    // geoProjection subtracts raw(0,0). Compensate with that exact point to
    // retain the fitted endpoint translations, including asymmetric worlds.
    const p = mutate(weights).scale(1).precision(0.6);
    const origin = fitted.reduce((a, entry, i) => {
      const r = entry.raw(0, 0);
      a[0] += weights[i] * (r[0] * entry.scale + entry.translate[0]);
      a[1] += weights[i] * (r[1] * entry.scale - entry.translate[1]);
      return a;
    }, [0, 0]);
    const mercatorWeight = weights[catalog.findIndex(entry => entry.id === 'mercator')] || 0;
    // The Mercator endpoint omits the singular polar caps, as a standard world
    // Mercator does. Move the latitude cutoff with the animation as well.
    p.preclip(mercatorWeight > 0
      ? latitudeClip(d3, 90 - (90 - MERCATOR_LIMIT) * mercatorWeight)
      : d3.geoClipAntimeridian);
    return p.translate([origin[0], -origin[1]]).clipExtent([[0, 0], [width, height]]);
  };
}
