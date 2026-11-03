import type { ServiceName } from '../api/types';
import type { ServiceData } from '../data/loader';
import type { LayerDefinition } from '../layers/definitions';
import { h } from './dom';

const numbers = new Intl.NumberFormat('de-DE');
const clock = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });

/** Failed roads listed by name before the note switches to "…". */
const MAX_LISTED_ROADS = 6;

export type LayerState =
  | { phase: 'idle' }
  | { phase: 'loading'; done: number; total: number; count: number }
  | { phase: 'done'; data: ServiceData; onRetry: () => void };

export interface LayerView {
  state: LayerState;
  enabled: boolean;
  /** Entries left after the road filter; null without a filter. */
  filteredCount: number | null;
}

export interface StatusView {
  setConnecting(): void;
  setFatal(message: string, onRetry: () => void): void;
  setLayer(definition: LayerDefinition, view: LayerView): void;
  /** A problem outside the layers, e.g. a missing basemap. Stays until replaced. */
  setNotice(message: string): void;
}

interface Row {
  element: HTMLElement;
  checkbox: HTMLInputElement;
  count: HTMLElement;
  details: HTMLElement;
}

/**
 * Layer list with switches; rows are updated in place so keyboard focus
 * survives progress updates. On phones the list collapses to `summary`.
 */
export function createStatus(
  root: HTMLElement,
  onToggle: (service: ServiceName, enabled: boolean) => void,
): StatusView {
  const rows = new Map<ServiceName, Row>();
  const views = new Map<ServiceName, LayerView>();
  const summary = h('div', { class: 'status-summary' });
  const list = h('div', { class: 'status-list' });
  const meta = h('p', { class: 'status-meta' });
  const notice = h('p', { class: 'status-note is-error' });

  const show = (...content: HTMLElement[]): void => root.replaceChildren(...content, notice);

  return {
    setConnecting() {
      rows.clear();
      views.clear();
      show(h('p', { class: 'status-note' }, 'Verbinde mit der Autobahn-API …'));
    },
    setFatal(message, onRetry) {
      rows.clear();
      views.clear();
      show(
        h(
          'p',
          { class: 'status-note is-error' },
          `Die Autobahnliste konnte nicht geladen werden (${message}). Ohne sie kann die Karte keine Daten abfragen. `,
          retryButton(onRetry),
        ),
      );
    },
    setLayer(definition, view) {
      if (rows.size === 0) {
        list.replaceChildren();
        meta.textContent = '';
        show(summary, list, meta);
      }
      let row = rows.get(definition.service);
      if (!row) {
        row = createRow(definition, onToggle);
        rows.set(definition.service, row);
        list.append(row.element);
      }
      views.set(definition.service, view);
      updateRow(row, definition, view);
      updateSummary(summary, [...views.values()]);
      if (view.state.phase === 'done') {
        const { outcomes, loadedAt } = view.state.data;
        meta.textContent = `${outcomes.length} Autobahnen · Stand ${clock.format(loadedAt)} Uhr · Daten: Die Autobahn GmbH des Bundes`;
      }
    },
    setNotice(message) {
      notice.textContent = message;
    },
  };
}

function createRow(definition: LayerDefinition, onToggle: (service: ServiceName, enabled: boolean) => void): Row {
  const checkbox = h('input', { type: 'checkbox', class: 'layer-checkbox' });
  checkbox.addEventListener('change', () => onToggle(definition.service, checkbox.checked));
  const count = h('span', { class: 'status-count' });
  const details = h('div', { class: 'status-details' });
  const element = h(
    'div',
    { class: 'status-row' },
    h(
      'label',
      { class: 'layer-toggle' },
      checkbox,
      h('span', { class: 'swatch', 'aria-hidden': 'true' }),
      h('span', { class: 'status-label' }, definition.label),
    ),
    count,
    details,
  );
  element.style.setProperty('--c', definition.color);
  return { element, checkbox, count, details };
}

function countText(total: number, filteredCount: number | null): string {
  return filteredCount === null ? numbers.format(total) : `${numbers.format(filteredCount)} von ${numbers.format(total)}`;
}

function progressBar(done: number, total: number, label: string): HTMLElement {
  const bar = h('span');
  bar.style.width = `${(done / Math.max(total, 1)) * 100}%`;
  return h(
    'div',
    {
      class: 'progress',
      role: 'progressbar',
      'aria-label': label,
      'aria-valuemin': '0',
      'aria-valuemax': String(total),
      'aria-valuenow': String(done),
    },
    bar,
  );
}

function updateRow(row: Row, definition: LayerDefinition, { state, enabled, filteredCount }: LayerView): void {
  row.checkbox.checked = enabled;
  row.element.classList.toggle('is-off', !enabled);

  if (state.phase === 'idle') {
    row.count.textContent = '';
    row.count.title = '';
    row.details.replaceChildren();
    return;
  }

  if (state.phase === 'loading') {
    row.count.textContent = countText(state.count, filteredCount);
    row.count.title = '';
    row.details.replaceChildren(progressBar(state.done, state.total, `${definition.label} werden geladen`));
    return;
  }

  const { data } = state;
  const withEntries = data.outcomes.filter((outcome) => outcome.state === 'ok').length;
  row.count.textContent = countText(data.items.length, filteredCount);
  row.count.title = `${withEntries} von ${data.outcomes.length} Autobahnen mit Einträgen`;
  row.details.replaceChildren(...notes(definition, data, state.onRetry));
}

/** One line for the collapsed phone layout: progress while loading, totals and failures after. */
function updateSummary(summary: HTMLElement, views: readonly LayerView[]): void {
  const enabled = views.filter((view) => view.enabled && view.state.phase !== 'idle');
  let done = 0;
  let total = 0;
  let shown = 0;
  let failed = 0;
  for (const { state, filteredCount } of enabled) {
    if (state.phase === 'loading') {
      done += state.done;
      total += state.total;
      shown += filteredCount ?? state.count;
    } else if (state.phase === 'done') {
      shown += filteredCount ?? state.data.items.length;
      failed += state.data.outcomes.filter((outcome) => outcome.state === 'error').length;
    }
  }

  if (total > 0) {
    summary.replaceChildren(progressBar(done, total, 'Daten werden geladen'), h('span', null, `Lade Daten … ${numbers.format(shown)} Einträge`));
    return;
  }
  const layers = enabled.length === 1 ? '1 Ebene' : `${enabled.length} Ebenen`;
  summary.replaceChildren(
    h('span', null, `${layers} · ${numbers.format(shown)} Einträge`),
    failed > 0 ? h('span', { class: 'is-error' }, ` · ${failed}× nicht erreichbar`) : '',
  );
}

function retryButton(onRetry: () => void): HTMLButtonElement {
  const button = h('button', { class: 'link-button', type: 'button' }, 'Erneut laden');
  button.addEventListener('click', onRetry);
  return button;
}

/** Only exceptions get a line: an empty layer, skipped entries, unreachable roads. */
function notes(definition: LayerDefinition, data: ServiceData, onRetry: () => void): HTMLElement[] {
  const failed = data.outcomes.filter((outcome) => outcome.state === 'error');
  const result: HTMLElement[] = [];

  if (data.items.length === 0 && failed.length === 0) {
    result.push(h('p', { class: 'status-note' }, `Die API meldet derzeit keine ${definition.label}.`));
  }

  const skipped = [
    data.skippedNoCoordinate > 0 ? `${numbers.format(data.skippedNoCoordinate)} ohne gültige Koordinate` : '',
    data.skippedInvalid > 0 ? `${numbers.format(data.skippedInvalid)} unlesbar` : '',
  ].filter(Boolean);
  if (skipped.length > 0) {
    result.push(h('p', { class: 'status-note' }, `Ausgelassen: ${skipped.join(', ')}.`));
  }

  if (failed.length > 0) {
    const roads = failed.map((outcome) => outcome.road);
    const listed = roads.slice(0, MAX_LISTED_ROADS).join(', ') + (roads.length > MAX_LISTED_ROADS ? ' …' : '');
    const text =
      failed.length === data.outcomes.length
        ? 'Keine Autobahn erreichbar. '
        : `${failed.length} ${failed.length === 1 ? 'Autobahn' : 'Autobahnen'} nicht erreichbar: ${listed}. `;
    const note = h('p', { class: 'status-note is-error' }, text, retryButton(onRetry));
    note.title = failed.map((outcome) => `${outcome.road}: ${outcome.message}`).join('\n');
    result.push(note);
  }
  return result;
}
