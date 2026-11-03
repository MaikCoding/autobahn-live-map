import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import type { ExpressionSpecification, FilterSpecification, GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import outline from '../data/germany-outline.json';
import type { FederalState } from '../data/geo';

/** The vector source of the OpenFreeMap style; missing when the fallback style is in use. */
const BASEMAP_SOURCE = 'openmaptiles';
/** OpenMapTiles carries motorway numbers (`route_n_ref`) only from this zoom on. */
export const NAMED_MIN_ZOOM = 6;
const AUTOBAHN_BLUE = '#1d5ea8';

export const OVERVIEW_LAYER = 'autobahn-overview';
export const NETWORK_LAYER = 'autobahn-network';
const HIGHLIGHT_LAYERS = ['autobahn-highlight-casing', 'autobahn-highlight'] as const;
const STATE_SOURCE = 'state-focus';

const GERMANY: MultiPolygon = { type: 'MultiPolygon', coordinates: outline.coordinates };

/** The world with Germany cut out, to veil the neighbouring countries. */
const OUTSIDE_GERMANY: Polygon = {
  type: 'Polygon',
  coordinates: [
    [
      [-180, -85],
      [180, -85],
      [180, 85],
      [-180, 85],
      [-180, -85],
    ],
    ...outline.coordinates.flatMap((polygon) => polygon.slice(0, 1)),
  ],
};

/**
 * A German autobahn section: a route slot with network "BAB", or a plain `ref`
 * like "A 7" inside Germany. Many sections list only the European route
 * (E 45) in their slots; French autoroutes are written "A 4" too, hence `within`.
 */
const IS_AUTOBAHN: ExpressionSpecification = [
  'any',
  ['==', ['get', 'route_1_network'], 'BAB'],
  ['==', ['get', 'route_2_network'], 'BAB'],
  ['==', ['get', 'route_3_network'], 'BAB'],
  ['all', ['==', ['slice', ['coalesce', ['get', 'ref'], ''], 0, 2], 'A '], ['within', GERMANY]],
];

function fieldIn(field: string, refs: readonly string[]): ExpressionSpecification {
  return ['in', ['coalesce', ['get', field], ''], ['literal', [...refs]]];
}

function highlightFilter(refs: readonly string[]): FilterSpecification {
  return [
    'all',
    IS_AUTOBAHN,
    ['any', fieldIn('ref', refs), fieldIn('route_1_ref', refs), fieldIn('route_2_ref', refs), fieldIn('route_3_ref', refs)],
  ];
}

/** "A3" → "A 3", "A64a" → "A 64a": the form OSM uses. */
function toOsmRef(road: string): string {
  return road.replace(/^A(?=\d)/, 'A ');
}

/** API road ids ("A3") of the autobahns a clicked tile feature belongs to. */
export function roadsOfFeature(properties: Record<string, unknown>): string[] {
  const refs: string[] = [];
  for (const slot of [1, 2, 3]) {
    const ref = properties[`route_${slot}_ref`];
    if (properties[`route_${slot}_network`] === 'BAB' && typeof ref === 'string') refs.push(ref);
  }
  const { ref } = properties;
  if (refs.length === 0 && typeof ref === 'string' && ref.startsWith('A ')) refs.push(ref);
  return refs.map((value) => value.replace(/\s+/g, ''));
}

export interface Overlays {
  /** Map layers a click on an autobahn can hit; the overview layer has no road numbers. */
  readonly roadLayerIds: readonly string[];
  setHighlightedRoads(roads: readonly string[]): void;
  setFocusedState(state: FederalState | null): void;
}

/**
 * The autobahn network from the basemap tiles, a highlight for selected
 * roads, and the outline of a focused state. Returns null without a basemap.
 */
export function addOverlays(map: MapLibreMap): Overlays | null {
  if (!map.getSource(BASEMAP_SOURCE)) return null;
  const beforeId = map.getStyle().layers.find((layer) => layer.type === 'symbol')?.id;
  const lineLayout = { 'line-cap': 'round', 'line-join': 'round' } as const;

  // Below zoom 6 the tiles merge all motorways of a tile into a few multi-lines without
  // numbers, reaching across borders; `within` would drop them all. The veil below mutes
  // the foreign ones instead.
  map.addLayer(
    {
      id: OVERVIEW_LAYER,
      type: 'line',
      source: BASEMAP_SOURCE,
      'source-layer': 'transportation',
      maxzoom: NAMED_MIN_ZOOM,
      filter: ['==', ['get', 'class'], 'motorway'],
      layout: lineLayout,
      paint: { 'line-color': AUTOBAHN_BLUE, 'line-width': 1.4, 'line-opacity': 0.5 },
    },
    beforeId,
  );
  map.addLayer(
    {
      id: NETWORK_LAYER,
      type: 'line',
      source: BASEMAP_SOURCE,
      'source-layer': 'transportation_name',
      minzoom: NAMED_MIN_ZOOM,
      filter: IS_AUTOBAHN,
      layout: lineLayout,
      paint: {
        'line-color': AUTOBAHN_BLUE,
        'line-width': ['interpolate', ['linear'], ['zoom'], 6, 1.5, 10, 2.5, 14, 4],
        'line-opacity': 0.55,
      },
    },
    beforeId,
  );
  const [casing, highlight] = HIGHLIGHT_LAYERS;
  map.addLayer(
    {
      id: casing,
      type: 'line',
      source: BASEMAP_SOURCE,
      'source-layer': 'transportation_name',
      minzoom: NAMED_MIN_ZOOM,
      filter: highlightFilter([]),
      layout: lineLayout,
      paint: { 'line-color': '#fff', 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 7, 14, 15] },
    },
    beforeId,
  );
  map.addLayer(
    {
      id: highlight,
      type: 'line',
      source: BASEMAP_SOURCE,
      'source-layer': 'transportation_name',
      minzoom: NAMED_MIN_ZOOM,
      filter: highlightFilter([]),
      layout: lineLayout,
      paint: { 'line-color': AUTOBAHN_BLUE, 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 4, 14, 9] },
    },
    beforeId,
  );

  const empty: FeatureCollection = { type: 'FeatureCollection', features: [] };
  map.addSource(STATE_SOURCE, { type: 'geojson', data: empty });
  map.addLayer(
    {
      id: 'state-focus-fill',
      type: 'fill',
      source: STATE_SOURCE,
      paint: { 'fill-color': AUTOBAHN_BLUE, 'fill-opacity': 0.06 },
    },
    beforeId,
  );
  map.addLayer(
    {
      id: 'state-focus-line',
      type: 'line',
      source: STATE_SOURCE,
      layout: lineLayout,
      paint: { 'line-color': AUTOBAHN_BLUE, 'line-width': 2, 'line-dasharray': [2, 1.5] },
    },
    beforeId,
  );

  map.addSource('outside-germany', { type: 'geojson', data: OUTSIDE_GERMANY });
  map.addLayer(
    {
      id: 'outside-germany',
      type: 'fill',
      source: 'outside-germany',
      paint: {
        'fill-color': '#f4f5f7',
        'fill-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0.6, 10, 0.35],
      },
    },
    beforeId,
  );

  return {
    roadLayerIds: [NETWORK_LAYER, OVERVIEW_LAYER],
    setHighlightedRoads(roads) {
      const filter = highlightFilter(roads.map(toOsmRef));
      for (const id of HIGHLIGHT_LAYERS) map.setFilter(id, filter);
    },
    setFocusedState(state) {
      const data: FeatureCollection = state
        ? {
            type: 'FeatureCollection',
            features: [{ type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: state.polygons } }],
          }
        : empty;
      void map.getSource<GeoJSONSource>(STATE_SOURCE)?.setData(data);
    },
  };
}
