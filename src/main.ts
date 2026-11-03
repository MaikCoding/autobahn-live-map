import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import { ApiError, fetchRoads } from './api/client';
import { loadService } from './data/loader';
import type { MapItem } from './data/normalize';
import { LAYERS } from './layers/definitions';
import { createMap } from './map/createMap';
import { addDatasetLayer, bindInteractions, type DatasetLayer } from './map/dataLayers';
import { createPanel } from './ui/panel';
import { createStatus } from './ui/status';

/** Markers appear while a layer loads; the heavy line geometry follows once it is complete. */
const PARTIAL_UPDATE_MS = 400;

function byId(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`#${id} fehlt in index.html`);
  return element;
}

function errorMessage(error: unknown): string {
  return error instanceof ApiError || error instanceof Error ? error.message : String(error);
}

const map = createMap(byId('map'));
const status = createStatus(byId('status'));
const panel = createPanel(byId('panel'), byId('panel-body'), byId('panel-close'), () => select(null));
const layers: DatasetLayer[] = [];

function select(key: string | null): void {
  let match: { item: MapItem; layer: DatasetLayer } | undefined;
  for (const layer of layers) {
    const item = key ? layer.getItem(key) : undefined;
    if (item) match = { item, layer };
  }
  for (const layer of layers) layer.setSelected(match ? key : null);
  if (match) panel.show(match.item, match.layer.definition);
  else panel.hide();
}

async function loadLayer(layer: DatasetLayer, roads: readonly string[]): Promise<void> {
  const { definition } = layer;
  let lastUpdate = 0;
  status.setLayer(definition, { phase: 'loading', done: 0, total: roads.length, count: 0 });

  const data = await loadService(definition.service, roads, {
    onProgress: ({ done, total, items }) => {
      status.setLayer(definition, { phase: 'loading', done, total, count: items.length });
      const now = performance.now();
      if (now - lastUpdate > PARTIAL_UPDATE_MS) {
        lastUpdate = now;
        layer.setItems(items, { partial: true });
      }
    },
  });

  layer.setItems(data.items);
  status.setLayer(definition, { phase: 'done', data, onRetry: () => void loadLayer(layer, roads) });
}

async function start(): Promise<void> {
  status.setConnecting();
  let roads: string[];
  try {
    roads = await fetchRoads();
    if (roads.length === 0) throw new Error('die API liefert eine leere Liste');
  } catch (error) {
    status.setFatal(errorMessage(error), () => void start());
    return;
  }
  await Promise.all(layers.map((layer) => loadLayer(layer, roads)));
}

map.on('load', () => {
  void (async () => {
    for (const definition of LAYERS) layers.push(await addDatasetLayer(map, definition));
    bindInteractions(map, layers, select);
    await start();
  })().catch((error: unknown) => status.setFatal(errorMessage(error), () => location.reload()));
});
