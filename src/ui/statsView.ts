import type { ServiceName } from '../api/types';
import type { MapItem } from '../data/normalize';
import type { Overview, RoadSummary } from '../data/stats';
import type { LayerDefinition } from '../layers/definitions';
import { h } from './dom';
import { describeItem } from './panel';

export interface StatsActions {
  selectItem(item: MapItem): void;
  selectRoad(road: string): void;
  focusState(ags: string): void;
  filterRoad(road: string | null): void;
}

const numbers = new Intl.NumberFormat('de-DE');
const wholeKm = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
const NEUTRAL = '#1d5ea8';

/** The state ranking opens on closures, the question that started this view. */
let stateMetric: ServiceName = 'closure';

function definitionOf(definitions: readonly LayerDefinition[], service: ServiceName): LayerDefinition | undefined {
  return definitions.find((definition) => definition.service === service);
}

function colored<T extends HTMLElement>(element: T, color: string): T {
  element.style.setProperty('--c', color);
  return element;
}

function kpi(value: string, label: string, color: string): HTMLElement {
  return colored(h('div', { class: 'kpi' }, h('span', { class: 'kpi-value' }, value), h('span', { class: 'kpi-label' }, label)), color);
}

interface BarRow {
  label: string;
  value: number;
  display: string;
  onClick: () => void;
}

function bars(rows: readonly BarRow[], color: string): HTMLElement {
  const max = Math.max(1, ...rows.map((row) => row.value));
  return colored(
    h(
      'ol',
      { class: 'bars' },
      ...rows.map((row) => {
        const fill = h('span', { class: 'bar-fill' });
        fill.style.width = `${(row.value / max) * 100}%`;
        const button = h(
          'button',
          { class: 'bar-row', type: 'button' },
          h('span', { class: 'bar-label' }, row.label),
          h('span', { class: 'bar-track' }, fill),
          h('span', { class: 'bar-value' }, row.display),
        );
        button.addEventListener('click', row.onClick);
        return h('li', null, button);
      }),
    ),
    color,
  );
}

function section(title: string, ...content: (HTMLElement | null)[]): HTMLElement {
  return h('section', { class: 'stats-section' }, h('h3', null, title), ...content);
}

function header(chip: string, title: string, subtitle: string): HTMLElement {
  return h(
    'header',
    { class: 'panel-head' },
    h('div', { class: 'chips' }, h('span', { class: 'chip chip-service' }, chip)),
    h('h2', { class: 'panel-title', id: 'panel-title' }, title),
    h('p', { class: 'panel-subtitle' }, subtitle),
  );
}

function stateSection(
  overview: Overview,
  definitions: readonly LayerDefinition[],
  actions: StatsActions,
  statesError: string | null,
): HTMLElement {
  const container = h('div');
  const render = (): void => {
    if (statesError) {
      container.replaceChildren(h('p', { class: 'status-note is-error' }, `Ländergrenzen nicht verfügbar (${statesError}).`));
      return;
    }
    if (!overview.states) {
      container.replaceChildren(h('p', { class: 'status-note' }, 'Einträge werden den Ländern zugeordnet …'));
      return;
    }
    const services = definitions.filter((definition) => overview.loaded.has(definition.service));
    if (!services.some((definition) => definition.service === stateMetric) && services[0]) stateMetric = services[0].service;
    const metric = definitionOf(definitions, stateMetric);
    const tabs = h(
      'div',
      { class: 'tabs', role: 'group', 'aria-label': 'Kennzahl' },
      ...services.map((definition) => {
        const tab = colored(
          h('button', { class: 'tab', type: 'button', 'aria-pressed': String(definition.service === stateMetric) }, definition.label),
          definition.color,
        );
        tab.addEventListener('click', () => {
          stateMetric = definition.service;
          render();
        });
        return tab;
      }),
    );
    const rows = overview.states
      .map(({ state, counts }) => ({ state, value: counts[stateMetric] ?? 0 }))
      .sort((a, b) => b.value - a.value || a.state.name.localeCompare(b.state.name, 'de'));
    const unassigned = overview.unassigned[stateMetric] ?? 0;
    container.replaceChildren(
      tabs,
      bars(
        rows.map(({ state, value }) => ({
          label: state.name,
          value,
          display: numbers.format(value),
          onClick: () => actions.focusState(state.ags),
        })),
        metric?.color ?? NEUTRAL,
      ),
      unassigned > 0 ? h('p', { class: 'status-note' }, `${numbers.format(unassigned)} Einträge keinem Land zuordenbar.`) : '',
    );
  };
  render();
  return container;
}

export function renderOverview(
  overview: Overview,
  definitions: readonly LayerDefinition[],
  actions: StatsActions,
  statesError: string | null,
): HTMLElement[] {
  const color = (service: ServiceName): string => definitionOf(definitions, service)?.color ?? NEUTRAL;
  const { loaded } = overview;

  const kpis = [
    loaded.has('roadworks') ? kpi(`${wholeKm.format(overview.roadworks.km)} km`, 'Autobahn mit aktiver Baustelle', color('roadworks')) : null,
    loaded.has('warning')
      ? kpi(`${numbers.format(overview.warnings.delayMinutes)} Min.`, `Zeitverlust in ${numbers.format(overview.warnings.jams)} Staus`, color('warning'))
      : null,
    loaded.has('closure') ? kpi(numbers.format(overview.closures.ramps), 'gesperrte Auf- und Abfahrten', color('closure')) : null,
    loaded.has('parking_lorry')
      ? kpi(numbers.format(overview.parking.lorrySpaces), `Lkw-Stellplätze an ${numbers.format(overview.parking.count)} Plätzen`, color('parking_lorry'))
      : null,
    loaded.has('electric_charging_station')
      ? kpi(numbers.format(overview.charging.fast), 'Schnellladestandorte', color('electric_charging_station'))
      : null,
    loaded.has('roadworks') ? kpi(numbers.format(overview.roadworks.planned), 'Baustellen angekündigt', color('roadworks')) : null,
  ].filter((element): element is HTMLElement => element !== null);

  const missing = definitions.filter((definition) => !loaded.has(definition.service)).map((definition) => definition.label);

  const records = overview.records.map((record) => {
    const definition = definitionOf(definitions, record.item.service);
    const { road, name } = definition ? describeItem(record.item, definition) : { road: record.item.road, name: record.item.title };
    const button = colored(
      h(
        'button',
        { class: 'record', type: 'button' },
        h('span', { class: 'record-label' }, record.label),
        h('span', { class: 'record-value' }, record.value),
        h('span', { class: 'record-name' }, `${road} · ${name}`),
      ),
      definition?.color ?? NEUTRAL,
    );
    button.addEventListener('click', () => actions.selectItem(record.item));
    return h('li', null, button);
  });

  return [
    header('Statistik', 'Lagebild Autobahn', 'Live aus den geladenen Ebenen, für ganz Deutschland'),
    kpis.length > 0 ? h('div', { class: 'kpis' }, ...kpis) : h('p', { class: 'panel-empty' }, 'Noch keine Daten geladen.'),
    missing.length > 0 ? h('p', { class: 'stats-hint' }, `Nicht eingeschaltet: ${missing.join(', ')}. Einschalten für mehr Zahlen.`) : null,
    section('Bundesländer', stateSection(overview, definitions, actions, statesError)),
    loaded.has('roadworks') && overview.topRoads.length > 0
      ? section(
          'Meiste Baustellen-Kilometer',
          bars(
            overview.topRoads.map((row) => ({
              label: `${row.road} · ${numbers.format(row.roadworks)} Baustellen`,
              value: row.roadworksKm,
              display: `${wholeKm.format(row.roadworksKm)} km`,
              onClick: () => actions.selectRoad(row.road),
            })),
            color('roadworks'),
          ),
        )
      : null,
    records.length > 0 ? section('Rekorde', h('ol', { class: 'records' }, ...records)) : null,
    h(
      'p',
      { class: 'stats-method' },
      'Methode: Bundesland per Koordinate und Ländergrenzen des BKG (VG2500, © BKG 2026, dl-de/by-2-0), an Grenzen ungenau. ' +
        'Baustellen-Kilometer aus der Liniengeometrie der Meldungen; Fahrtrichtungen und überlappende Bauphasen zählen einmal. ' +
        'Lkw-Stellplätze aus den Beschreibungstexten.',
    ),
  ].filter((element): element is HTMLElement => element !== null);
}

export function renderRoad(
  summary: RoadSummary,
  definitions: readonly LayerDefinition[],
  actions: StatsActions,
  isFiltered: boolean,
): HTMLElement[] {
  const total = Object.values(summary.counts).reduce((sum, count) => sum + count, 0);
  const subtitle =
    summary.states === null ? 'Länder werden zugeordnet …' : summary.states.length > 0 ? summary.states.join(' · ') : 'Autobahn';

  const tiles = definitions
    .filter((definition) => summary.loaded.has(definition.service))
    .map((definition) => {
      const count = summary.counts[definition.service] ?? 0;
      const extra =
        definition.service === 'roadworks' && count > 0
          ? ` · ${wholeKm.format(summary.roadworksKm)} km aktiv`
          : definition.service === 'warning' && summary.delayMinutes > 0
            ? ` · ${numbers.format(summary.delayMinutes)} Min.`
            : '';
      return kpi(numbers.format(count), `${definition.label}${extra}`, definition.color);
    });

  const filterButton = h(
    'button',
    { class: 'action-button', type: 'button' },
    isFiltered ? 'Filter aufheben' : `Nur ${summary.road} auf der Karte zeigen`,
  );
  filterButton.addEventListener('click', () => actions.filterRoad(isFiltered ? null : summary.road));

  const warning = definitionOf(definitions, 'warning');
  const jams = summary.jams.slice(0, 5).map((item) => {
    const { name } = warning ? describeItem(item, warning) : { name: item.title };
    const button = colored(
      h(
        'button',
        { class: 'record', type: 'button' },
        h('span', { class: 'record-label' }, item.subtitle.replaceAll('->', '→')),
        h('span', { class: 'record-value' }, `${numbers.format(item.delayMinutes ?? 0)} Min.`),
        h('span', { class: 'record-name' }, name),
      ),
      warning?.color ?? NEUTRAL,
    );
    button.addEventListener('click', () => actions.selectItem(item));
    return h('li', null, button);
  });

  return [
    header('Autobahn', summary.road, subtitle),
    total > 0
      ? h('div', { class: 'kpis' }, ...tiles)
      : h('p', { class: 'panel-empty' }, `Für die ${summary.road} liefern die geladenen Ebenen keine Einträge.`),
    total > 0 ? filterButton : null,
    jams.length > 0 ? section('Staus gerade', h('ol', { class: 'records' }, ...jams)) : null,
    h('p', { class: 'stats-method' }, 'Markiert ist der Verlauf aus OpenStreetMap; sichtbar ab Zoomstufe 6.'),
  ].filter((element): element is HTMLElement => element !== null);
}
