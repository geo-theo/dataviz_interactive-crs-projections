# Map projections

A full-page, animated map projection explorer built with vanilla HTML, CSS,
JavaScript, D3, and TopoJSON. The page contains only two native dropdowns, a
Tissot Circles toggle, and the map. Designed for GitHub Pages with no runtime CDN,
API key, package installation, or framework required.

## Explore

- Choose one of **16 projections** and **177 countries/territories**.
- Watch the world and selected country morph over 1.45 seconds. Changing the
  projection again continues from the current shape without jumping.
- Toggle **Tissot Circles** to compare two 5° spherical-radius circles with the
  same geographic area. They stay at fixed geographic locations as projections
  change and are placed clear of the selected country with a 3° margin.
- Share a view using its URL, which stores projection, country, and circle state.
- Use the keyboard or a screen reader. The layout responds to screen size and
  respects the operating system's reduced-motion preference.

Projections: Natural Earth I, Equal Earth, Mercator, Robinson, Mollweide,
Winkel Tripel, Equirectangular, Gall–Peters, Hammer, Sinusoidal, Aitoff,
Eckert IV, Eckert VI, Natural Earth II, Kavrayskiy VII, and Bonne.

## Run locally

Install Node.js 20 or newer, then run:

```sh
npm run dev
```

Open <http://127.0.0.1:4173>. A web server is necessary because the page uses
JavaScript modules and fetches the bundled map data. No `npm install` is needed.

```sh
npm test        # geometry, interpolation, fitting, and indicator checks
npm run build   # copy public assets into dist/
```

To serve the deployment artifact, run `node scripts/serve.mjs --dist` after
building. The development server binds to localhost only.

## GitHub Pages

The repository includes [a Pages workflow](.github/workflows/pages.yml).
In the repository's **Settings → Pages → Build and deployment**, choose
**GitHub Actions** as the source. Every push to `main` runs the geometry tests,
creates `dist/`, and deploys it. You can also run **Deploy Projection Atlas**
manually from the Actions tab.

The project URL for this repository is
<https://geo-theo.github.io/dataviz_interactive-crs-projections/> once deployment
succeeds. All asset paths are relative, so project subdirectory hosting works.

For a branch-based Pages setup, `main` / `/ (root)` also works: `index.html`
and the public assets are at the repository root, and `.nojekyll` is included.

## How the map works

`js/projections.js` fits each projection to a shared viewport and interpolates
its projected geographic coordinates. D3 resamples and projects the actual
geometries on every animation frame; SVG path strings are never interpolated.
All views use the same central meridian and antimeridian seam. Transitions
retain a weighted combination of endpoint projections, allowing interruption
without jumps. The intermediate shapes are illustrative blends, rather than
named coordinate reference systems.

`js/indicators.js` creates spherical circle polygons. It checks spherical
containment and the minimum distance to the selected country's geodesic
boundary segments before placing them. The default locations are in the
eastern Pacific (8°N, 125°W) and North Atlantic (52°N, 35°W). Country-aware
fallbacks handle occupied locations. The positions remain fixed while changing
projections, so each circle is a stable distortion reference.

These finite 5° circles illustrate Tissot's idea; a strict Tissot indicatrix
uses an infinitesimal circle. Equal-area projections preserve their projected
area ratio; conformal projections preserve local angles. Each world is fitted
independently to the viewport, so absolute pixel areas across different
projection views are not a common physical scale.

The Mercator view clips geographic geometry at ±85.0511° to avoid its polar
singularities. Its latitude cutoff also transitions during morphing. D3's
spherical projection formulas are used throughout: this is a world-map teaching
tool, rather than an ellipsoidal datum conversion or EPSG transformation tool.

## Data and attribution

The map uses world-atlas 2.0.2 / Natural Earth 4.1.0 boundaries at 1:110 million
scale. These simplified boundaries omit some small countries and islands;
country names and territorial divisions follow the source dataset. The
dropdown contains the 177 country/territory features present in that file.

Pinned libraries, source links, and upstream licenses are documented in
[vendor/README.md](vendor/README.md). All data and dependencies are served from
this repository, with no third-party requests needed after deployment.

Inspired by Nicolas Lambert's
[Comparaisons des projections](https://observablehq.com/d/629082cda48cb5c5).

