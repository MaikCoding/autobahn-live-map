// Builds the state boundaries for the statistics and the national outline
// for the autobahn overview layer from BKG VG2500 (© BKG, dl-de/by-2-0).
//
//   npm run build:geodata
//
// Output is committed, so the app never depends on the BKG service at runtime.
import { mkdir, writeFile } from 'node:fs/promises';

const WFS =
  'https://sgx.geodatenzentrum.de/wfs_vg2500?service=WFS&version=2.0.0&request=GetFeature' +
  '&typeNames=vg2500:vg2500_lan&outputFormat=application/json&srsName=EPSG:4326';
const OUT_DIR = new URL('../src/data/', import.meta.url);

/** VG2500 geofactor: 9 is land; 8 covers coastal waters and Lake Constance. */
const GF_LAND = 9;
/** Degrees (≈ 300–450 m); only the outline is simplified, so state borders stay seamless. */
const OUTLINE_TOLERANCE = 0.004;

const retrieved = new Date().toISOString().slice(0, 10);
const attribution = `© BKG (${retrieved.slice(0, 4)}) dl-de/by-2-0, Datenquellen: https://sgx.geodatenzentrum.de/web_public/gdz/datenquellen/datenquellen_vg_nuts.pdf`;

const response = await fetch(WFS);
if (!response.ok) throw new Error(`BKG WFS: HTTP ${response.status}`);
const source = await response.json();

const states = new Map();
for (const { properties, geometry } of source.features) {
  if (properties.gf !== GF_LAND) continue;
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  const state = states.get(properties.ags) ?? { ags: properties.ags, name: properties.gen, polygons: [] };
  state.polygons.push(...polygons);
  states.set(properties.ags, state);
}
if (states.size !== 16) throw new Error(`Expected 16 states, got ${states.size}`);

const keyOf = ([lon, lat]) => `${lon},${lat}`;

/** Union by edge cancellation: VG2500 states share exact vertices, so inner borders appear twice. */
function outerRings(polygons) {
  const edges = new Map();
  for (const ring of polygons.flat()) {
    for (let i = 0; i < ring.length - 1; i++) {
      const [a, b] = [ring[i], ring[i + 1]];
      const [ka, kb] = [keyOf(a), keyOf(b)];
      if (ka === kb) continue;
      const id = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      const edge = edges.get(id);
      if (edge) edge.count++;
      else edges.set(id, { a, b, count: 1 });
    }
  }
  const boundary = [...edges].filter(([, edge]) => edge.count === 1);
  const neighbours = new Map();
  for (const [id, { a, b }] of boundary) {
    for (const [from, to] of [
      [a, b],
      [b, a],
    ]) {
      const list = neighbours.get(keyOf(from)) ?? [];
      list.push({ id, to });
      neighbours.set(keyOf(from), list);
    }
  }
  const used = new Set();
  const rings = [];
  for (const [startId, { a: start }] of boundary) {
    if (used.has(startId)) continue;
    const ring = [start];
    let point = start;
    for (;;) {
      const step = (neighbours.get(keyOf(point)) ?? []).find(({ id }) => !used.has(id));
      if (!step) break;
      used.add(step.id);
      point = step.to;
      ring.push(point);
      if (keyOf(point) === keyOf(start)) break;
    }
    if (ring.length >= 4 && keyOf(ring[0]) === keyOf(ring.at(-1))) rings.push(ring);
  }
  return rings;
}

/** Douglas–Peucker on a closed ring; keeps the closing point. */
function simplify(ring, tolerance) {
  const keep = new Uint8Array(ring.length);
  keep[0] = keep[ring.length - 1] = 1;
  const stack = [[0, ring.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop();
    const [ax, ay] = ring[first];
    const [bx, by] = ring[last];
    const length = Math.hypot(bx - ax, by - ay);
    let farthest = -1;
    let maxDistance = tolerance;
    for (let i = first + 1; i < last; i++) {
      const [px, py] = ring[i];
      const distance =
        length === 0 ? Math.hypot(px - ax, py - ay) : Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / length;
      if (distance > maxDistance) {
        maxDistance = distance;
        farthest = i;
      }
    }
    if (farthest !== -1) {
      keep[farthest] = 1;
      stack.push([first, farthest], [farthest, last]);
    }
  }
  return ring.filter((_, i) => keep[i] === 1);
}

const allPolygons = [...states.values()].flatMap((state) => state.polygons);
const outline = outerRings(allPolygons)
  .map((ring) => simplify(ring, OUTLINE_TOLERANCE))
  .filter((ring) => ring.length >= 4)
  .map((ring) => [ring]);

const statesCollection = {
  type: 'FeatureCollection',
  attribution,
  source: 'BKG Verwaltungsgebiete 1:2 500 000 (VG2500), Layer vg2500_lan, nur Landflächen',
  retrieved,
  features: [...states.values()]
    .sort((a, b) => a.ags.localeCompare(b.ags))
    .map(({ ags, name, polygons }) => ({
      type: 'Feature',
      properties: { ags, name },
      geometry: { type: 'MultiPolygon', coordinates: polygons },
    })),
};
const outlineGeometry = { attribution, retrieved, type: 'MultiPolygon', coordinates: outline };

await mkdir(OUT_DIR, { recursive: true });
await writeFile(new URL('bundeslaender.geojson', OUT_DIR), JSON.stringify(statesCollection));
await writeFile(new URL('germany-outline.json', OUT_DIR), JSON.stringify(outlineGeometry));

const vertices = (rings) => rings.flat(2).length;
console.log(`states: ${states.size}, vertices: ${vertices(allPolygons)}`);
console.log(`outline: ${outline.length} rings, ${vertices(outline)} vertices`);
