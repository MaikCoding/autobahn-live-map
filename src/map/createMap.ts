import {
  AttributionControl,
  Map as MapLibreMap,
  NavigationControl,
  setWorkerUrl,
  type LngLatBoundsLike,
  type PaddingOptions,
} from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';

// MapLibre locates its worker relative to its own module URL, which no longer
// exists once Vite pre-bundles or chunks the library. Point it at the real file.
setWorkerUrl(workerUrl);

/** OpenFreeMap needs no API key; its OSM attribution comes from the style's TileJSON. */
const BASEMAP_STYLE = 'https://tiles.openfreemap.org/styles/positron';

const GERMANY_BOUNDS: LngLatBoundsLike = [
  [5.87, 47.27],
  [15.04, 55.06],
];

/** GeoNutzV §3: visible source note plus a note that the data was modified ("aufbereitet"). */
const DATA_ATTRIBUTION =
  'Verkehrsdaten © <a href="https://www.autobahn.de/" target="_blank" rel="noopener">Die Autobahn GmbH des Bundes</a>, aufbereitet';

/** Keeps fitted content clear of the status card: beside it on wide screens, below it on phones. */
export function viewPadding(): PaddingOptions {
  const wide = window.innerWidth >= 900;
  return { top: wide ? 32 : 170, right: 32, bottom: 40, left: wide ? 370 : 16 };
}

export function showGermany(map: MapLibreMap): void {
  map.fitBounds(GERMANY_BOUNDS, { padding: viewPadding(), duration: 800 });
}

export function createMap(container: HTMLElement): MapLibreMap {
  const map = new MapLibreMap({
    container,
    style: BASEMAP_STYLE,
    bounds: GERMANY_BOUNDS,
    fitBoundsOptions: { padding: viewPadding() },
    attributionControl: false,
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
  });
  map.touchZoomRotate.disableRotation();
  map.addControl(new NavigationControl({ showCompass: false }), 'bottom-right');
  map.addControl(new AttributionControl({ compact: true, customAttribution: DATA_ATTRIBUTION }), 'bottom-right');
  return map;
}
