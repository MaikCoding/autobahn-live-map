import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import { LngLatBounds } from 'maplibre-gl';
import { ApiError, fetchRoads } from './api/client';
import type { ServiceName } from './api/types';
import { loadService } from './data/loader';
import type { MapItem } from './data/normalize';
import { LAYERS } from './layers/definitions';
import { createMap, showGermany, viewPadding } from './map/createMap';
import { addDatasetLayer, bindInteractions, type DatasetLayer } from './map/dataLayers';
import { readUrlState, writeUrlState } from './urlState';
import { createPanel } from './ui/panel';
import { createRoadFilter } from './ui/roadFilter';
import { createStatus, type LayerState } from './ui/status';

/** Markers appear while a layer loads; the heavy line geometry follows once it is complete. */
const PARTIAL_UPDATE_MS = 400;
/** Fitting to a single roadwork should not zoom down to street level. */
const FIT_MAX_ZOOM = 11;

interface LayerEntry {
  layer: DatasetLayer;
  enabled: boolean;
  state: LayerState;
  /** Everything loaded so far, before the road filter. */
  items: readonly MapItem[];
}

function byId(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`#${id} fehlt in index.html`);
  return element;
}

function errorMessage(error: unknown): string {
  return error instanceof ApiError || error instanceof Error ? error.message : String(error);
}

const urlState = readUrlState(LAYERS.map((definition) => definition.service));
const map = createMap(byId('map'));
const status = createStatus(byId('status'), (service, enabled) => setEnabled(service, enabled));
const panel = createPanel(byId('panel'), byId('panel-body'), byId('panel-close'), () => select(null));
const roadFilterView = createRoadFilter(byId('filter'), (roads) => setRoadFilter(roads));
roadFilterView.setRoads(urlState.roads);

/** In layer-list order. */
const entries: LayerEntry[] = [];
let roads: string[] | null = null;
let selectedKey: string | null = null;
let roadFilter: ReadonlySet<string> = new Set();
/** The filter changed; fit the map to its matches as soon as some are loaded. */
let fitPending = false;

function matches(item: MapItem): boolean {
  return roadFilter.size === 0 || roadFilter.has(item.road);
}

function render(entry: LayerEntry): void {
  const filteredCount = roadFilter.size > 0 ? entry.items.filter(matches).length : null;
  status.setLayer(entry.layer.definition, { state: entry.state, enabled: entry.enabled, filteredCount });
}

function pushItems(entry: LayerEntry, partial = false): void {
  entry.layer.setItems(roadFilter.size > 0 ? entry.items.filter(matches) : entry.items, { partial });
}

function syncUrl(): void {
  const enabled = entries.filter((entry) => entry.enabled).map((entry) => entry.layer.definition.service);
  const defaults = LAYERS.filter((definition) => definition.enabledByDefault).map((definition) => definition.service);
  const isDefault = enabled.length === defaults.length && enabled.every((service) => defaults.includes(service));
  writeUrlState({ roads: [...roadFilter], layers: isDefault ? null : enabled });
}

function fitToMatches(): void {
  const positions = entries.filter((entry) => entry.enabled).flatMap((entry) => entry.items.filter(matches).map((item) => item.position));
  const [first] = positions;
  if (!first) return;
  // Keep refitting while layers still load, so the view grows with the matches.
  fitPending = entries.some((entry) => entry.enabled && entry.state.phase === 'loading');
  const bounds = positions.reduce((box, position) => box.extend(position), new LngLatBounds(first, first));
  map.fitBounds(bounds, { padding: viewPadding(), maxZoom: FIT_MAX_ZOOM, duration: 800 });
}

function select(key: string | null): void {
  let match: { item: MapItem; layer: DatasetLayer } | undefined;
  for (const { layer, enabled } of entries) {
    const item = key && enabled ? layer.getItem(key) : undefined;
    if (item) match = { item, layer };
  }
  selectedKey = match ? key : null;
  for (const { layer } of entries) layer.setSelected(selectedKey);
  if (match) panel.show(match.item, match.layer.definition);
  else panel.hide();
}

function setRoadFilter(roadIds: readonly string[]): void {
  const next = new Set(roadIds);
  if (next.size === roadFilter.size && [...next].every((road) => roadFilter.has(road))) return;
  roadFilter = next;
  for (const entry of entries) {
    pushItems(entry);
    render(entry);
  }
  if (selectedKey) select(selectedKey);
  syncUrl();
  if (roadFilter.size > 0) {
    fitPending = true;
    fitToMatches();
  } else {
    fitPending = false;
    showGermany(map);
  }
}

function setEnabled(service: ServiceName, enabled: boolean): void {
  const entry = entries.find(({ layer }) => layer.definition.service === service);
  if (!entry) return;
  entry.enabled = enabled;
  entry.layer.setVisible(enabled);
  if (!enabled && selectedKey && entry.layer.getItem(selectedKey)) select(null);
  render(entry);
  syncUrl();
  if (enabled && entry.state.phase === 'idle' && roads) void loadLayer(entry, roads);
}

async function loadLayer(entry: LayerEntry, roadList: readonly string[]): Promise<void> {
  let lastUpdate = 0;
  entry.state = { phase: 'loading', done: 0, total: roadList.length, count: 0 };
  render(entry);

  const data = await loadService(entry.layer.definition.service, roadList, {
    onProgress: ({ done, total, items }) => {
      entry.items = items;
      entry.state = { phase: 'loading', done, total, count: items.length };
      render(entry);
      const now = performance.now();
      if (now - lastUpdate > PARTIAL_UPDATE_MS) {
        lastUpdate = now;
        pushItems(entry, true);
      }
    },
  });

  entry.items = data.items;
  entry.state = { phase: 'done', data, onRetry: () => void loadLayer(entry, roadList) };
  pushItems(entry);
  render(entry);
  if (fitPending) fitToMatches();
}

async function start(): Promise<void> {
  status.setConnecting();
  try {
    roads = await fetchRoads();
    if (roads.length === 0) throw new Error('die API liefert eine leere Liste');
  } catch (error) {
    roads = null;
    status.setFatal(errorMessage(error), () => void start());
    return;
  }
  const roadList = roads;
  for (const entry of entries) render(entry);
  // Resolves a road filter from a shared link now that the road names are known.
  roadFilterView.setKnownRoads(roadList);
  await Promise.all(entries.filter((entry) => entry.enabled).map((entry) => loadLayer(entry, roadList)));
}

// Once the user moves the map, stop fitting it to filter matches.
map.on('movestart', (event) => {
  if (event.originalEvent) fitPending = false;
});

map.on('load', () => {
  void (async () => {
    // Added bottom-up: the last layer in the list is drawn first, so warnings end up on top.
    const layers = new Map<ServiceName, DatasetLayer>();
    for (const definition of [...LAYERS].reverse()) {
      layers.set(definition.service, await addDatasetLayer(map, definition));
    }
    for (const definition of LAYERS) {
      const layer = layers.get(definition.service);
      if (!layer) continue;
      const enabled = urlState.layers ? urlState.layers.includes(definition.service) : definition.enabledByDefault;
      layer.setVisible(enabled);
      entries.push({ layer, enabled, state: { phase: 'idle' }, items: [] });
    }
    bindInteractions(
      map,
      entries.map((entry) => entry.layer),
      select,
    );
    await start();
  })().catch((error: unknown) => status.setFatal(errorMessage(error), () => location.reload()));
});
