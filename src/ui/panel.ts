import type { MapItem } from '../data/normalize';
import type { LayerDefinition } from '../layers/definitions';
import { h } from './dom';

/** Titles start with the road, e.g. "A1 | Saarbrücken - Eppelborn". */
const ROAD_PREFIX = /^(A\d+[a-z]?)\s*\|\s*/;

const numbers = new Intl.NumberFormat('de-DE');

export interface Panel {
  show(item: MapItem, definition: LayerDefinition): void;
  hide(): void;
}

export function createPanel(
  root: HTMLElement,
  body: HTMLElement,
  closeButton: HTMLElement,
  onClose: () => void,
): Panel {
  closeButton.addEventListener('click', onClose);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !root.hidden) onClose();
  });

  return {
    show(item, definition) {
      root.style.setProperty('--c', definition.color);
      body.replaceChildren(...renderItem(item, definition));
      body.scrollTop = 0;
      root.hidden = false;
      document.body.classList.add('has-panel');
    },
    hide() {
      root.hidden = true;
      document.body.classList.remove('has-panel');
    },
  };
}

function renderItem(item: MapItem, definition: LayerDefinition): HTMLElement[] {
  const { road, name, subtitle } = describe(item, definition);
  const variants = [item.displayType, item.trafficType ?? '']
    .map((value) => definition.variants[value])
    .filter((label): label is string => label !== undefined);

  const header = h(
    'header',
    { class: 'panel-head' },
    h(
      'div',
      { class: 'chips' },
      h('span', { class: 'chip chip-service' }, definition.singular),
      h('span', { class: 'chip chip-road' }, road),
      ...[...new Set(variants)].map((label) => h('span', { class: 'chip' }, label)),
      item.future ? h('span', { class: 'chip chip-future' }, 'Geplant') : null,
      item.blocked ? h('span', { class: 'chip chip-blocked' }, 'Gesperrt') : null,
    ),
    h('h2', { class: 'panel-title', id: 'panel-title' }, name),
    subtitle ? h('p', { class: 'panel-subtitle' }, subtitle) : null,
  );

  const paragraphs = toParagraphs(item.description);
  const text =
    paragraphs.length > 0
      ? h('div', { class: 'panel-text' }, ...paragraphs.map((lines) => h('p', null, ...withBreaks(lines))))
      : h('p', { class: 'panel-empty' }, 'Die API liefert zu diesem Eintrag keine Beschreibung.');

  const footer = h(
    'footer',
    { class: 'panel-foot' },
    `Kennung: ${item.identifier}`,
    h('br'),
    'Quelle: Die Autobahn GmbH des Bundes',
  );

  return [header, renderMetrics(item), text, renderAmenities(item), footer].filter(
    (element): element is HTMLElement => element !== null,
  );
}

/** Jam figures, which the API also buries in the description text. */
function renderMetrics(item: MapItem): HTMLElement | null {
  const metrics = [
    item.delayMinutes !== undefined ? metric(`${numbers.format(item.delayMinutes)} Min.`, 'Zeitverlust') : null,
    item.averageSpeedKmh !== undefined ? metric(`${numbers.format(item.averageSpeedKmh)} km/h`, 'Ø Tempo') : null,
  ].filter((element): element is HTMLElement => element !== null);
  return metrics.length > 0 ? h('div', { class: 'metrics' }, ...metrics) : null;
}

function metric(value: string, label: string): HTMLElement {
  return h('div', { class: 'metric' }, h('span', { class: 'metric-value' }, value), h('span', { class: 'metric-label' }, label));
}

function renderAmenities(item: MapItem): HTMLElement | null {
  if (item.amenities.length === 0) return null;
  return h(
    'section',
    { class: 'panel-section' },
    h('h3', null, 'Ausstattung'),
    h('ul', { class: 'amenities' }, ...item.amenities.map((amenity) => h('li', null, amenity))),
  );
}

function describe(item: MapItem, definition: LayerDefinition): { road: string; name: string; subtitle: string } {
  const match = ROAD_PREFIX.exec(item.title);
  const road = match?.[1] ?? item.road;
  const rest = (match ? item.title.slice(match[0].length) : item.title).replaceAll(' | ', ' · ').trim();
  const subtitle = item.subtitle.replaceAll('->', '→');
  // Some titles carry nothing after the road ("A1 | 0").
  const usableRest = rest !== '' && rest !== '0' ? rest : '';
  if (definition.nameInSubtitle && subtitle) return { road, name: subtitle, subtitle: usableRest };
  if (!usableRest) return { road, name: subtitle || definition.singular, subtitle: '' };
  return { road, name: usableRest, subtitle };
}

/** The API sends one string per line and marks paragraph breaks with empty strings. */
function toParagraphs(lines: readonly string[]): string[][] {
  const paragraphs: string[][] = [[]];
  for (const line of lines) {
    const text = line.trim().replaceAll(' -> ', ' → ');
    const current = paragraphs[paragraphs.length - 1];
    if (!current) continue;
    if (text !== '') current.push(text);
    else if (current.length > 0) paragraphs.push([]);
  }
  return paragraphs.filter((paragraph) => paragraph.length > 0);
}

function withBreaks(lines: readonly string[]): (string | HTMLBRElement)[] {
  return lines.flatMap((line, index) => (index === 0 ? [line] : [h('br'), line]));
}
