import { h } from './dom';

/** Wait for a pause in typing before re-clustering thousands of points. */
const DEBOUNCE_MS = 250;

export interface RoadFilterView {
  /** The API's road list; until it arrives, nothing can be matched. */
  setKnownRoads(roads: readonly string[]): void;
  setRoads(roads: readonly string[]): void;
}

/**
 * "a3, A 5 7" → ["A3", "A5", "A7"]. Tokens are matched case-insensitively
 * against the API's road list, so "a64A" finds "A64a".
 */
export function parseRoadQuery(query: string, known: readonly string[]): { roads: string[]; unknown: string[] } {
  const canonical = new Map(known.map((road) => [road.toLowerCase(), road]));
  const roads: string[] = [];
  const unknown: string[] = [];
  const tokens = query
    .replace(/\bA\s+(?=\d)/gi, 'A')
    .split(/[\s,;]+/)
    .filter(Boolean);
  for (const token of tokens) {
    const road = canonical.get((/^\d/.test(token) ? `A${token}` : token).toLowerCase());
    if (road) {
      if (!roads.includes(road)) roads.push(road);
    } else {
      unknown.push(token);
    }
  }
  return { roads, unknown };
}

export function createRoadFilter(root: HTMLElement, onChange: (roads: string[]) => void): RoadFilterView {
  let known: string[] = [];
  let timer: number | undefined;

  const input = h('input', {
    id: 'road-filter',
    class: 'filter-input',
    type: 'search',
    placeholder: 'Autobahn, z. B. A3',
    autocomplete: 'off',
    spellcheck: 'false',
    enterkeyhint: 'search',
    list: 'road-options',
    'aria-describedby': 'road-filter-hint',
  });
  const options = h('datalist', { id: 'road-options' });
  const hint = h('p', { class: 'filter-hint', id: 'road-filter-hint' });
  const form = h(
    'form',
    { class: 'filter', role: 'search' },
    h('label', { class: 'visually-hidden', for: 'road-filter' }, 'Nach Autobahn filtern'),
    input,
    options,
  );
  root.replaceChildren(form, hint);

  const apply = (): void => {
    window.clearTimeout(timer);
    const { roads, unknown } = parseRoadQuery(input.value, known);
    if (known.length === 0 || unknown.length === 0) hint.textContent = '';
    else if (roads.length === 0) hint.textContent = `„${unknown.join(', ')}“ gibt es in den Daten nicht. Es wird alles angezeigt.`;
    else hint.textContent = `Ignoriert: ${unknown.join(', ')}`;
    onChange(roads);
  };

  input.addEventListener('input', () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(apply, DEBOUNCE_MS);
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    apply();
    input.blur();
  });

  return {
    setKnownRoads(roads) {
      known = [...roads];
      options.replaceChildren(...known.map((road) => h('option', { value: road })));
      if (input.value.trim() !== '') apply();
    },
    setRoads(roads) {
      input.value = roads.join(', ');
    },
  };
}
