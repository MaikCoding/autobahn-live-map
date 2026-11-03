import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import { ApiError, fetchRoads } from './api/client';
import type { ServiceName } from './api/types';
import { loadService } from './data/loader';
import type { MapItem } from './data/normalize';
import { LAYERS } from './layers/definitions';
import { createMap } from './map/createMap';
import { addDatasetLayer, bindInteractions, type DatasetLayer } from './map/dataLayers';
import { createPanel } from './ui/panel';
import { createStatus, type LayerState } from './ui/status';

/** Markers appear while a layer loads; the heavy line geometry follows once it is complete. */
const PARTIAL_UPDATE_MS = 400;

interface LayerEntry {
  layer: DatasetLayer;
  enabled: boolean;
  state: LayerState;
}

function byId(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`#${id} fehlt in index.html`);
  return element;
}

function errorMessage(error: unknown): string {
  return error instanceof ApiError || error instanceof Error ? error.message : String(error);
}

const map = createMap(byId('map'));
const status = createStatus(byId('status'), (service, enabled) => setEnabled(service, enabled));
const panel = createPanel(byId('panel'), byId('panel-body'), byId('panel-close'), () => select(null));
/** In layer-list order. */
const entries: LayerEntry[] = [];
let roads: string[] | null = null;
let selectedKey: string | null = null;

function render(entry: LayerEntry): void {
  status.setLayer(entry.layer.definition, entry.state, entry.enabled);
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

function setEnabled(service: ServiceName, enabled: boolean): void {
  const entry = entries.find(({ layer }) => layer.definition.service === service);
  if (!entry) return;
  entry.enabled = enabled;
  entry.layer.setVisible(enabled);
  if (!enabled && selectedKey && entry.layer.getItem(selectedKey)) select(null);
  render(entry);
  if (enabled && entry.state.phase === 'idle' && roads) void loadLayer(entry, roads);
}

async function loadLayer(entry: LayerEntry, roadList: readonly string[]): Promise<void> {
  const { layer } = entry;
  let lastUpdate = 0;
  entry.state = { phase: 'loading', done: 0, total: roadList.length, count: 0 };
  render(entry);

  const data = await loadService(layer.definition.service, roadList, {
    onProgress: ({ done, total, items }) => {
      entry.state = { phase: 'loading', done, total, count: items.length };
      render(entry);
      const now = performance.now();
      if (now - lastUpdate > PARTIAL_UPDATE_MS) {
        lastUpdate = now;
        layer.setItems(items, { partial: true });
      }
    },
  });

  layer.setItems(data.items);
  entry.state = { phase: 'done', data, onRetry: () => void loadLayer(entry, roadList) };
  render(entry);
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
  await Promise.all(entries.filter((entry) => entry.enabled).map((entry) => loadLayer(entry, roadList)));
}

map.on('load', () => {
  void (async () => {
    // Added bottom-up: the last layer in the list is drawn first, so warnings end up on top.
    const layers = new Map<ServiceName, DatasetLayer>();
    for (const definition of [...LAYERS].reverse()) {
      const layer = await addDatasetLayer(map, definition);
      layer.setVisible(definition.enabledByDefault);
      layers.set(definition.service, layer);
    }
    for (const definition of LAYERS) {
      const layer = layers.get(definition.service);
      if (layer) entries.push({ layer, enabled: definition.enabledByDefault, state: { phase: 'idle' } });
    }
    bindInteractions(
      map,
      entries.map((entry) => entry.layer),
      select,
    );
    await start();
  })().catch((error: unknown) => status.setFatal(errorMessage(error), () => location.reload()));
});
