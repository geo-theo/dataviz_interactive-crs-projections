# Vendored map dependencies

These pinned, unmodified browser bundles are served locally so the deployed page
does not depend on a third-party CDN at runtime.

| Local file | Version | Upstream source | License |
| --- | --- | --- | --- |
| `d3.min.js` | D3 7.9.0 | [d3/d3](https://github.com/d3/d3/tree/v7.9.0) | `LICENSE-d3` (ISC) |
| `d3-geo-projection.min.js` | 4.0.0 | [d3/d3-geo-projection](https://github.com/d3/d3-geo-projection/tree/v4.0.0) | `LICENSE-d3-geo-projection` |
| `topojson-client.min.js` | 3.1.0 | [topojson/topojson-client](https://github.com/topojson/topojson-client/tree/v3.1.0) | `LICENSE-topojson-client` (ISC) |

Downloaded from the corresponding version-pinned `dist/` files on
`https://cdn.jsdelivr.net/npm/`.

## World boundaries

`../data/countries-110m.json` is the unmodified file from
[world-atlas 2.0.2](https://github.com/topojson/world-atlas/tree/v2.0.2), downloaded
from <https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json>.
The package license is preserved at `../data/LICENSE-world-atlas`.

The TopoJSON contains 177 named country/territory geometries plus merged land.
It redistributes Natural Earth 4.1.0 Admin 0 country boundaries at 1:110 million
scale in longitude/latitude decimal degrees. Natural Earth data is
[public domain](https://www.naturalearthdata.com/about/terms-of-use/).
The dataset simplifies coastlines and omits some small countries and islands;
names and boundaries reflect the source dataset.
