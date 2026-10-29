# Map projections

## Light & paper projection lab

Open **[the Projection Lab](https://geo-theo.github.io/dataviz_interactive-crs-projections/lab/)**
for a second interactive visual inspired by a GIS classroom's lighted globe.
Choose an equatorial cylinder, transverse cylinder, tangent cone, or polar plane;
place the paper, turn on the central light, trace the grid and coastline shadows,
and unfold the paper into a map. Run the full animation, advance one step at a
time, or scrub it manually. Drag or use arrow keys to orbit the apparatus; turn
the globe with the longitude slider. A contact-latitude slider adjusts the cone.
Optional equal-size spherical circles reveal distortion.

`lab/geometry.js` computes ray/surface intersections on a unit sphere and exact
isometric development of the cylinder and cone. D3 clips and resamples the
geographic geometry before it is placed on the paper. The finite paper explicitly
omits rays beyond its edges. These are central cylindrical, transverse central
cylindrical, perspective conic, and polar gnomonic projections; the central-light
model does not produce Mercator or Lambert conformal conic. A projection alone
is not a complete CRS or datum transformation.

The lab shares the repository's bundled D3/TopoJSON and Natural Earth data, has
no external runtime dependencies, supports keyboard controls and reduced motion,
and is included in the existing GitHub Pages build. Local preview:
<http://127.0.0.1:4173/lab/>.

A full-page, animated map projection explorer built with vanilla HTML, CSS,
JavaScript, D3, and TopoJSON. The page contains only two native dropdowns, a
Tissot Circles toggle, and the map. Designed for GitHub Pages with no runtime CDN,
API key, package installation, or framework required.

## Explore

- Choose one of **16 projections** and **177 countries/territories**.
- Watch the world and selected country morph over 1.45 seconds. Changing the
  projection again continues from the current shape without jumping.
- Toggle **Tissot Circles** to compare two 5° spherical-radius circles with the
  same geographic area. Drag either circle with the mouse or a touch screen to
  explore distortion in different locations. Their geographic area stays fixed.
- Circle positions persist when changing projections or countries and when
  toggling the overlay. Focus a circle and use arrow keys to move it by 1°
  (Shift + arrow moves it by 5°).
- Share a view using its URL, which stores projection, country, circle visibility,
  and manually chosen circle positions.
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
fallbacks handle occupied initial locations. Manually placed circles may overlap
any country, and their positions remain fixed while changing projections.
Dragging rebuilds each circle as a spherical cap at its new longitude/latitude;
it does not merely translate the projected outline. Pointer capture keeps the
drag active outside the circle, and positions outside the globe are ignored.
`js/drag.js` numerically inverts the current projection, including animated
blends, using the previous location to maintain continuity.

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

