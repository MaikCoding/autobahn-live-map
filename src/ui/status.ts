import type { ServiceData } from '../data/loader';
import type { LayerDefinition } from '../layers/definitions';
import { h } from './dom';

const numbers = new Intl.NumberFormat('de-DE');
const clock = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });

/** Failed roads listed by name before the note switches to "…". */
const MAX_LISTED_ROADS = 6;

export type LayerStatus =
  | { phase: 'loading'; done: number; total: number; count: number }
  | { phase: 'done'; data: ServiceData; onRetry: () => void };

export interface StatusView {
  setConnecting(): void;
  setFatal(message: string, onRetry: () => void): void;
  setLayer(definition: LayerDefinition, status: LayerStatus): void;
}

export function createStatus(root: HTMLElement): StatusView {
  const rows = new Map<string, HTMLElement>();
  return {
    setConnecting() {
      rows.clear();
      root.replaceChildren(h('p', { class: 'status-note' }, 'Verbinde mit der Autobahn-API …'));
    },
    setFatal(message, onRetry) {
      rows.clear();
      root.replaceChildren(
        h(
          'p',
          { class: 'status-note is-error' },
          `Die Autobahnliste konnte nicht geladen werden (${message}). Ohne sie kann die Karte keine Daten abfragen. `,
          retryButton(onRetry),
        ),
      );
    },
    setLayer(definition, status) {
      const row = renderRow(definition, status);
      const existing = rows.get(definition.service);
      if (existing) existing.replaceWith(row);
      else {
        if (rows.size === 0) root.replaceChildren();
        root.append(row);
      }
      rows.set(definition.service, row);
    },
  };
}

function retryButton(onRetry: () => void): HTMLButtonElement {
  const button = h('button', { class: 'link-button', type: 'button' }, 'Erneut laden');
  button.addEventListener('click', onRetry);
  return button;
}

function renderRow(definition: LayerDefinition, status: LayerStatus): HTMLElement {
  const count = status.phase === 'loading' ? status.count : status.data.items.length;
  const row = h(
    'div',
    { class: 'status-row' },
    h('span', { class: 'swatch', 'aria-hidden': 'true' }),
    h('span', { class: 'status-label' }, definition.label),
    h('span', { class: 'status-count' }, numbers.format(count)),
  );
  row.style.setProperty('--c', definition.color);

  if (status.phase === 'loading') {
    const bar = h('span');
    bar.style.width = `${(status.done / Math.max(status.total, 1)) * 100}%`;
    row.append(
      h(
        'div',
        {
          class: 'progress',
          role: 'progressbar',
          'aria-label': `${definition.label} werden geladen`,
          'aria-valuemin': '0',
          'aria-valuemax': String(status.total),
          'aria-valuenow': String(status.done),
        },
        bar,
      ),
      h('p', { class: 'status-note' }, `Lade ${status.done} von ${status.total} Autobahnen …`),
    );
  } else {
    row.append(...summarize(definition, status.data, status.onRetry));
  }
  return row;
}

function summarize(definition: LayerDefinition, data: ServiceData, onRetry: () => void): HTMLElement[] {
  const failed = data.outcomes.filter((outcome) => outcome.state === 'error');
  const withEntries = data.outcomes.filter((outcome) => outcome.state === 'ok').length;
  const notes = [
    h(
      'p',
      { class: 'status-note' },
      `${withEntries} von ${data.outcomes.length} Autobahnen mit Einträgen · Stand ${clock.format(data.loadedAt)}`,
    ),
  ];

  if (data.items.length === 0 && failed.length === 0) {
    notes.push(h('p', { class: 'status-note' }, `Die API meldet derzeit keine ${definition.label}.`));
  }

  const skipped = [
    data.skippedNoCoordinate > 0 ? `${numbers.format(data.skippedNoCoordinate)} ohne gültige Koordinate` : '',
    data.skippedInvalid > 0 ? `${numbers.format(data.skippedInvalid)} unlesbar` : '',
  ].filter(Boolean);
  if (skipped.length > 0) {
    notes.push(h('p', { class: 'status-note' }, `Ausgelassen: ${skipped.join(', ')}.`));
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
    notes.push(note);
  }
  return notes;
}
