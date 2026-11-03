import type { FeatureCollection, LineString, Point } from 'geojson';
import type {
  FilterSpecification,
  GeoJSONSource,
  Map as MapLibreMap,
  MapGeoJSONFeature,
  MapMouseEvent,
  PointLike,
} from 'maplibre-gl';
import type { MapItem } from '../data/normalize';
import type { LayerDefinition } from '../layers/definitions';
import { addMarkerImage } from './markers';

interface ItemProperties {
  key: string;
  future: boolean;
}

export interface DatasetLayer {
  readonly definition: LayerDefinition;
  /** Map layers that react to clicks. */
  readonly interactiveLayerIds: readonly string[];
  /** `partial` skips the line geometry, which is large and only worth sending once. */
  setItems(items: readonly MapItem[], options?: { partial?: boolean }): void;
  getItem(key: string): MapItem | undefined;
  setSelected(key: string | null): void;
  setVisible(visible: boolean): void;
}

/** Below this zoom the clusters carry the overview and lines would only be noise. */
const LINE_MIN_ZOOM = 9;
/** Finger-sized hit area; lines are only a few pixels wide. */
const HIT_TOLERANCE = 8;

function emptyCollection(): FeatureCollection {
  return { type: 'FeatureCollection', features: [] };
}

function selectedFilter(key: string | null): FilterSpecification {
  return ['==', ['get', 'key'], key ?? ''];
}

function toPoints(items: readonly MapItem[]): FeatureCollection<Point, ItemProperties> {
  return {
    type: 'FeatureCollection',
    features: items.map((item) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: item.position },
      properties: { key: item.key, future: item.future },
    })),
  };
}

function toLines(items: readonly MapItem[]): FeatureCollection<LineString, ItemProperties> {
  return {
    type: 'FeatureCollection',
    features: items.flatMap((item) =>
      item.line
        ? [
            {
              type: 'Feature' as const,
              geometry: { type: 'LineString' as const, coordinates: item.line },
              properties: { key: item.key, future: item.future },
            },
          ]
        : [],
    ),
  };
}

export async function addDatasetLayer(map: MapLibreMap, definition: LayerDefinition): Promise<DatasetLayer> {
  const id = definition.service;
  const pointSource = `${id}-points`;
  const lineSource = `${id}-lines`;
  const icon = `marker-${id}`;
  await addMarkerImage(map, icon, definition.color, definition.glyph);

  // Lines sit below the basemap labels so place names stay readable.
  const firstLabelLayer = map.getStyle().layers.find((layer) => layer.type === 'symbol')?.id;

  if (definition.lines) {
    map.addSource(lineSource, { type: 'geojson', data: emptyCollection() });
    map.addLayer(
      {
        id: `${id}-lines-selected`,
        type: 'line',
        source: lineSource,
        minzoom: LINE_MIN_ZOOM,
        filter: selectedFilter(null),
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': definition.color,
          'line-width': ['interpolate', ['linear'], ['zoom'], 9, 8, 14, 16],
          'line-opacity': 0.3,
        },
      },
      firstLabelLayer,
    );
    map.addLayer(
      {
        id: `${id}-lines`,
        type: 'line',
        source: lineSource,
        minzoom: LINE_MIN_ZOOM,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': definition.color,
          'line-width': ['interpolate', ['linear'], ['zoom'], 9, 2.5, 14, 6],
          'line-opacity': ['case', ['get', 'future'], 0.4, 0.85],
        },
      },
      firstLabelLayer,
    );
  }

  map.addSource(pointSource, {
    type: 'geojson',
    data: emptyCollection(),
    cluster: true,
    clusterRadius: 48,
    clusterMaxZoom: 11,
  });
  map.addLayer({
    id: `${id}-clusters`,
    type: 'circle',
    source: pointSource,
    filter: ['has', 'point_count'],
    paint: {
      'circle-color': definition.color,
      'circle-opacity': 0.92,
      'circle-radius': ['step', ['get', 'point_count'], 14, 25, 18, 100, 23, 500, 28],
      'circle-stroke-color': '#fff',
      'circle-stroke-width': 2,
    },
  });
  map.addLayer({
    id: `${id}-cluster-count`,
    type: 'symbol',
    source: pointSource,
    filter: ['has', 'point_count'],
    layout: {
      'text-field': ['get', 'point_count_abbreviated'],
      'text-font': ['Noto Sans Bold'],
      'text-size': 12,
      'text-allow-overlap': true,
    },
    paint: { 'text-color': '#fff' },
  });
  map.addLayer({
    id: `${id}-selected`,
    type: 'circle',
    source: pointSource,
    filter: selectedFilter(null),
    paint: {
      'circle-radius': 21,
      'circle-color': definition.color,
      'circle-opacity': 0.2,
      'circle-stroke-color': definition.color,
      'circle-stroke-width': 2,
    },
  });
  map.addLayer({
    id: `${id}-points`,
    type: 'symbol',
    source: pointSource,
    filter: ['!', ['has', 'point_count']],
    layout: { 'icon-image': icon, 'icon-allow-overlap': true, 'icon-ignore-placement': true },
    paint: { 'icon-opacity': ['case', ['get', 'future'], 0.55, 1] },
  });

  const ownLayerIds = [
    ...(definition.lines ? [`${id}-lines-selected`, `${id}-lines`] : []),
    `${id}-clusters`,
    `${id}-cluster-count`,
    `${id}-selected`,
    `${id}-points`,
  ];
  let byKey = new Map<string, MapItem>();
  return {
    definition,
    interactiveLayerIds: [`${id}-points`, `${id}-clusters`, ...(definition.lines ? [`${id}-lines`] : [])],
    setItems(items, { partial = false } = {}) {
      byKey = new Map(items.map((item) => [item.key, item]));
      void map.getSource<GeoJSONSource>(pointSource)?.setData(toPoints(items));
      if (definition.lines && !partial) void map.getSource<GeoJSONSource>(lineSource)?.setData(toLines(items));
    },
    getItem: (key) => byKey.get(key),
    setSelected(key) {
      map.setFilter(`${id}-selected`, selectedFilter(key));
      if (definition.lines) map.setFilter(`${id}-lines-selected`, selectedFilter(key));
    },
    setVisible(visible) {
      for (const layerId of ownLayerIds) map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
    },
  };
}

export interface InteractionHandlers {
  onSelect(key: string | null): void;
  /** Lower-priority layers, such as the autobahn network; they only count where no marker is. */
  fallbackLayerIds?: readonly string[];
  onFallback?(feature: MapGeoJSONFeature, event: MapMouseEvent): void;
}

/** One click handler for all layers: clusters zoom in, items are selected, empty map deselects. */
export function bindInteractions(
  map: MapLibreMap,
  layers: readonly DatasetLayer[],
  { onSelect, fallbackLayerIds = [], onFallback }: InteractionHandlers,
): void {
  const hitAt = (point: { x: number; y: number }, layerIds: readonly string[]) => {
    const box: [PointLike, PointLike] = [
      [point.x - HIT_TOLERANCE, point.y - HIT_TOLERANCE],
      [point.x + HIT_TOLERANCE, point.y + HIT_TOLERANCE],
    ];
    const present = layerIds.filter((id) => map.getLayer(id));
    // Topmost first, so markers win over the lines underneath.
    return present.length > 0 ? map.queryRenderedFeatures(box, { layers: present })[0] : undefined;
  };
  const itemLayerIds = () => layers.flatMap((layer) => layer.interactiveLayerIds);

  map.on('click', (event) => {
    const feature = hitAt(event.point, itemLayerIds());
    if (!feature) {
      const fallback = hitAt(event.point, fallbackLayerIds);
      if (fallback && onFallback) onFallback(fallback, event);
      else onSelect(null);
      return;
    }
    const properties: Record<string, unknown> = feature.properties ?? {};
    if (typeof properties.cluster_id === 'number' && feature.geometry.type === 'Point') {
      const center = feature.geometry.coordinates as [number, number];
      map
        .getSource<GeoJSONSource>(feature.source)
        ?.getClusterExpansionZoom(properties.cluster_id)
        .then((zoom) => map.easeTo({ center, zoom }))
        .catch(() => map.easeTo({ center, zoom: map.getZoom() + 2 }));
      return;
    }
    if (typeof properties.key === 'string') onSelect(properties.key);
  });

  map.on('mousemove', (event) => {
    const hit = hitAt(event.point, itemLayerIds()) ?? hitAt(event.point, fallbackLayerIds);
    map.getCanvas().style.cursor = hit ? 'pointer' : '';
  });
}
