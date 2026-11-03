import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import { LngLatBounds, type PaddingOptions } from 'maplibre-gl';
import { ApiError, fetchRoads } from './api/client';
import type { ServiceName } from './api/types';
import statesUrl from './data/bundeslaender.geojson?url';
import { findState, parseStates, type FederalState } from './data/geo';
import { loadService } from './data/loader';
import type { MapItem, Position } from './data/normalize';
import { computeOverview, summarizeRoad, type LayerSnapshot } from './data/stats';
import { LAYERS } from './layers/definitions';
import { createMap, showGermany, viewPadding } from './map/createMap';
import { addDatasetLayer, bindInteractions, type DatasetLayer } from './map/dataLayers';
import { addOverlays, NAMED_MIN_ZOOM, OVERVIEW_LAYER, roadsOfFeature, type Overlays } from './map/overlays';
import { readUrlState, writeUrlState } from './urlState';
import { createPanel } from './ui/panel';
import { createRoadFilter } from './ui/roadFilter';
import { renderOverview, renderRoad, type StatsActions } from './ui/statsView';
import { createStatus, type LayerState } from './ui/status';

/** Markers appear while a layer loads; the heavy line geometry follows once it is complete. */
const PARTIAL_UPDATE_MS = 400;
/** Fitting to a single roadwork should not zoom down to street level. */
const FIT_MAX_ZOOM = 11;
/** Zoom for an item picked from a list, close enough to leave its cluster. */
const ITEM_ZOOM = 12;
const PANEL_COLOR = '#1d5ea8';

interface LayerEntry {
  layer: DatasetLayer;
  enabled: boolean;
  state: LayerState;
  /** Everything loaded so far, before the road filter. */
  items: readonly MapItem[];
}

type PanelView = { kind: 'item'; key: string } | { kind: 'road'; road: string } | { kind: 'stats' };

function byId(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`#${id} fehlt in index.html`);
  return element;
}

function errorMessage(error: unknown): string {
  return error instanceof ApiError || error instanceof Error ? error.message : String(error);
}

const urlState = readUrlState(LAYERS.map((definition) => definition.service));
const status = createStatus(byId('status'), (service, enabled) => setEnabled(service, enabled));
const map = createMap(byId('map'), (message) =>
  status.setNotice(`Kartenhintergrund nicht erreichbar (${message}). Die Daten erscheinen auf neutralem Grund.`),
);
const panelElement = byId('panel');
const panel = createPanel(panelElement, byId('panel-body'), byId('panel-close'), () => closePanel());
const roadFilterView = createRoadFilter(byId('filter'), (roads) => setRoadFilter(roads));
roadFilterView.setRoads(urlState.roads);

const hud = byId('hud');
const hudToggle = byId('hud-toggle');
hudToggle.addEventListener('click', () => {
  hudToggle.setAttribute('aria-expanded', String(hud.classList.toggle('is-expanded')));
});
const statsButton = byId('stats-button');
statsButton.addEventListener('click', () => (panelView?.kind === 'stats' ? closePanel() : openStats()));

/** In layer-list order. */
const entries: LayerEntry[] = [];
let overlays: Overlays | null = null;
let roads: string[] | null = null;
let roadFilter: ReadonlySet<string> = new Set();
/** The filter changed; fit the map to its matches as soon as some are loaded. */
let fitPending = false;

let panelView: PanelView | null = null;
/** Where "Zurück" leads from the current panel view. */
let backTo: PanelView | null = null;
let selectedKey: string | null = null;
let selectedRoad: string | null = null;

let states: FederalState[] | null = null;
let statesError: string | null = null;
let statesRequest: Promise<void> | null = null;
const stateCache = new Map<string, FederalState | undefined>();

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

/** Map padding that also keeps content clear of the open panel. */
function panelAwarePadding(): PaddingOptions {
  const padding = viewPadding();
  if (panelElement.hidden) return padding;
  const mapBox = map.getContainer().getBoundingClientRect();
  const panelBox = panelElement.getBoundingClientRect();
  const isBottomSheet = panelBox.left <= mapBox.left + 1;
  return isBottomSheet
    ? { ...padding, bottom: padding.bottom + panelBox.height }
    : { ...padding, right: padding.right + (mapBox.right - panelBox.left) };
}

function fitToPositions(positions: readonly Position[], minZoom = 0): void {
  const [first] = positions;
  if (!first) return;
  const bounds = positions.reduce((box, position) => box.extend(position), new LngLatBounds(first, first));
  const camera = map.cameraForBounds(bounds, { padding: panelAwarePadding(), maxZoom: FIT_MAX_ZOOM });
  if (camera) map.easeTo({ ...camera, zoom: Math.max(camera.zoom ?? minZoom, minZoom), duration: 800 });
}

function fitToMatches(): void {
  const positions = entries.filter((entry) => entry.enabled).flatMap((entry) => entry.items.filter(matches).map((item) => item.position));
  if (positions.length === 0) return;
  // Keep refitting while layers still load, so the view grows with the matches.
  fitPending = entries.some((entry) => entry.enabled && entry.state.phase === 'loading');
  fitToPositions(positions);
}

/** Pans a selected item out from under the panel: the side panel on desktop, the bottom sheet on phones. */
function reveal(item: MapItem, zoom?: number): void {
  const point = map.project(item.position);
  const mapBox = map.getContainer().getBoundingClientRect();
  const panelBox = panelElement.getBoundingClientRect();
  const isBottomSheet = panelBox.left <= mapBox.left + 1;
  const offset: [number, number] = isBottomSheet ? [0, -panelBox.height / 2] : [-(mapBox.right - panelBox.left) / 2, 0];
  const hidden = isBottomSheet ? point.y > panelBox.top - mapBox.top - 24 : point.x > panelBox.left - mapBox.left - 24;
  if (zoom !== undefined || hidden) map.easeTo({ center: item.position, offset, zoom: zoom ?? map.getZoom(), duration: 500 });
}

function updateHighlight(): void {
  overlays?.setHighlightedRoads(selectedRoad ? [selectedRoad] : [...roadFilter]);
}

// Panel views -----------------------------------------------------------------

function snapshots(): LayerSnapshot[] {
  return entries
    .filter((entry) => entry.enabled && entry.state.phase === 'done')
    .map((entry) => ({ service: entry.layer.definition.service, items: entry.items }));
}

function stateOf(): ((item: MapItem) => FederalState | undefined) | null {
  const loaded = states;
  if (!loaded) return null;
  return (item) => {
    if (!stateCache.has(item.key)) stateCache.set(item.key, findState(loaded, item.position));
    return stateCache.get(item.key);
  };
}

/** State boundaries load on first use: only the statistics need them. */
function ensureStates(): void {
  statesRequest ??= fetch(statesUrl)
    .then(async (response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data: unknown = await response.json();
      states = parseStates(data);
    })
    .catch((error: unknown) => {
      statesError = errorMessage(error);
    })
    .finally(() => refreshPanel());
}

const statsActions: StatsActions = {
  selectItem(item) {
    if (!matches(item)) applyRoadFilter([]);
    openItem(item.key, panelView, ITEM_ZOOM);
  },
  selectRoad(road) {
    openRoad(road, { fit: true, from: panelView });
  },
  focusState(ags) {
    const state = states?.find((candidate) => candidate.ags === ags);
    if (!state) return;
    overlays?.setFocusedState(state);
    const [minLon, minLat, maxLon, maxLat] = state.bbox;
    fitToPositions([
      [minLon, minLat],
      [maxLon, maxLat],
    ]);
  },
  filterRoad(road) {
    applyRoadFilter(road ? [road] : []);
  },
};

function renderPanel(keepScroll = false): void {
  if (panelView?.kind === 'stats') {
    panel.showView(renderOverview(computeOverview(snapshots(), stateOf()), LAYERS, statsActions, statesError), PANEL_COLOR, {
      keepScroll,
    });
  } else if (panelView?.kind === 'road') {
    const { road } = panelView;
    const isFiltered = roadFilter.size === 1 && roadFilter.has(road);
    panel.showView(renderRoad(summarizeRoad(road, snapshots(), stateOf()), LAYERS, statsActions, isFiltered), PANEL_COLOR, {
      onBack: backTo ? goBack : undefined,
      keepScroll,
    });
  }
  statsButton.setAttribute('aria-pressed', String(panelView?.kind === 'stats'));
}

/** Statistics and road summaries follow the data; item details stay as they are. */
function refreshPanel(): void {
  if (panelView?.kind === 'stats' || panelView?.kind === 'road') renderPanel(true);
}

function clearItemSelection(): void {
  selectedKey = null;
  for (const { layer } of entries) layer.setSelected(null);
}

function openStats(): void {
  clearItemSelection();
  selectedRoad = null;
  backTo = null;
  panelView = { kind: 'stats' };
  ensureStates();
  updateHighlight();
  renderPanel();
}

function openRoad(road: string, { fit, from = null }: { fit: boolean; from?: PanelView | null }): void {
  clearItemSelection();
  overlays?.setFocusedState(null);
  selectedRoad = road;
  backTo = from;
  panelView = { kind: 'road', road };
  ensureStates();
  updateHighlight();
  renderPanel();
  if (fit) {
    const positions = snapshots().flatMap(({ items }) => items.filter((item) => item.road === road).map((item) => item.position));
    // The highlight needs road numbers, which the tiles only carry from zoom 6.
    fitToPositions(positions, NAMED_MIN_ZOOM);
  }
}

function openItem(key: string, from: PanelView | null = null, zoom?: number): void {
  let match: { item: MapItem; layer: DatasetLayer } | undefined;
  for (const { layer, enabled } of entries) {
    const item = enabled ? layer.getItem(key) : undefined;
    if (item) match = { item, layer };
  }
  if (!match) {
    closePanel();
    return;
  }
  selectedKey = key;
  selectedRoad = null;
  backTo = from;
  panelView = { kind: 'item', key };
  for (const { layer } of entries) layer.setSelected(key);
  updateHighlight();
  panel.show(match.item, match.layer.definition, from ? goBack : undefined);
  statsButton.setAttribute('aria-pressed', 'false');
  reveal(match.item, zoom);
}

function goBack(): void {
  const target = backTo;
  backTo = null;
  if (target?.kind === 'stats') openStats();
  else if (target?.kind === 'road') openRoad(target.road, { fit: false });
  else if (target?.kind === 'item') openItem(target.key);
}

function closePanel(): void {
  clearItemSelection();
  selectedRoad = null;
  backTo = null;
  panelView = null;
  overlays?.setFocusedState(null);
  updateHighlight();
  panel.hide();
  statsButton.setAttribute('aria-pressed', 'false');
}

// Filter, layers, loading -------------------------------------------------------

/** Sets the filter from code (autobahn view, statistics) and mirrors it in the search field. */
function applyRoadFilter(roadIds: readonly string[]): void {
  roadFilterView.setRoads(roadIds);
  setRoadFilter(roadIds);
}

function setRoadFilter(roadIds: readonly string[]): void {
  const next = new Set(roadIds);
  if (next.size === roadFilter.size && [...next].every((road) => roadFilter.has(road))) return;
  roadFilter = next;
  for (const entry of entries) {
    pushItems(entry);
    render(entry);
  }
  if (panelView?.kind === 'item') openItem(panelView.key, backTo);
  syncUrl();
  updateHighlight();
  refreshPanel();
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
  if (!enabled && selectedKey && entry.layer.getItem(selectedKey)) closePanel();
  render(entry);
  syncUrl();
  refreshPanel();
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
  refreshPanel();
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
    // Below the data layers, so markers and lines stay on top of the network.
    overlays = addOverlays(map);
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
      {
        onSelect: (key) => (key ? openItem(key) : closePanel()),
        fallbackLayerIds: overlays?.roadLayerIds ?? [],
        onFallback: (feature, event) => {
          // Overview lines carry no road numbers; zoom in to where they do.
          if (feature.layer.id === OVERVIEW_LAYER) {
            map.easeTo({ center: event.lngLat, zoom: NAMED_MIN_ZOOM + 1, duration: 600 });
            return;
          }
          const [road] = roadsOfFeature(feature.properties ?? {});
          if (road) openRoad(road, { fit: false });
        },
      },
    );
    updateHighlight();
    await start();
  })().catch((error: unknown) => status.setFatal(errorMessage(error), () => location.reload()));
});
