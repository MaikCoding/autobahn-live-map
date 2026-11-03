import type { ServiceName } from '../api/types';

export interface LayerDefinition {
  service: ServiceName;
  /** Plural, for the layer list and the status. */
  label: string;
  /** Singular, for the detail panel. */
  singular: string;
  color: string;
  /** Pictogram in a 24×24 box, white by default; `currentColor` is the layer colour. */
  glyph: string;
  /** Draw the API's line geometry once zoomed in. */
  lines: boolean;
  /** Shown and loaded right away; the others load when switched on. */
  enabledByDefault: boolean;
  /** The entry's name is in `subtitle`; the title only repeats road and destination. */
  nameInSubtitle: boolean;
  /** Chip labels for display_type or abnormalTrafficType values worth calling out. */
  variants: Readonly<Record<string, string>>;
}

const TRIANGLE =
  '<path d="M12 2.5 22.5 20.5h-21z"/>' +
  '<rect x="10.9" y="8.6" width="2.2" height="6.4" rx="1.1" fill="currentColor"/>' +
  '<circle cx="12" cy="17.4" r="1.3" fill="currentColor"/>';

const NO_ENTRY = '<circle cx="12" cy="12" r="10"/><rect x="5.5" y="10.2" width="13" height="3.6" rx="1" fill="currentColor"/>';

const CONE =
  '<path d="M10.1 2.5h3.8L19.4 18H4.6z"/>' +
  '<path fill="currentColor" d="M8.15 8h7.7l.92 2.6H7.23z"/>' +
  '<path fill="currentColor" d="M6.37 13h11.26l.92 2.6H5.45z"/>' +
  '<rect x="3" y="18" width="18" height="3" rx="1"/>';

const BOLT = '<path d="M14 1.5 4.5 13.5h6L9.5 22.5l10-12.5h-6z"/>';

const PARKING = '<path fill-rule="evenodd" d="M6 2.5h7a6 6 0 0 1 0 12H9.8v7H6zm3.8 3.4v5.2H13a2.6 2.6 0 0 0 0-5.2z"/>';

/** Order of the layer list. Map layers stack the other way round, so warnings end up on top. */
export const LAYERS: readonly LayerDefinition[] = [
  {
    service: 'warning',
    label: 'Verkehrsmeldungen',
    singular: 'Verkehrsmeldung',
    color: '#d6336c',
    glyph: TRIANGLE,
    lines: true,
    enabledByDefault: true,
    nameInSubtitle: false,
    variants: {
      CLOSURE: 'Sperrung',
      QUEUING_TRAFFIC: 'Stau',
      SLOW_TRAFFIC: 'Stockender Verkehr',
      HEAVY_TRAFFIC: 'Dichter Verkehr',
      UNSPECIFIED_ABNORMAL_TRAFFIC: 'Verkehrsstörung',
    },
  },
  {
    service: 'closure',
    label: 'Sperrungen',
    singular: 'Sperrung',
    color: '#7048e8',
    glyph: NO_ENTRY,
    lines: true,
    enabledByDefault: true,
    nameInSubtitle: false,
    variants: {
      CLOSURE_ENTRY_EXIT: 'Auf-/Abfahrt',
      CLOSURE_LOAD_VZ_3_5: 'Max. 3,5 t',
      CLOSURE_LOAD_VZ_16: 'Max. 16 t',
    },
  },
  {
    service: 'roadworks',
    label: 'Baustellen',
    singular: 'Baustelle',
    color: '#e8590c',
    glyph: CONE,
    lines: true,
    enabledByDefault: true,
    nameInSubtitle: false,
    variants: { SHORT_TERM_ROADWORKS: 'Kurzzeitbaustelle' },
  },
  {
    service: 'electric_charging_station',
    label: 'Ladesäulen',
    singular: 'Ladesäule',
    color: '#2b8a3e',
    glyph: BOLT,
    lines: false,
    enabledByDefault: false,
    nameInSubtitle: false,
    variants: {},
  },
  {
    service: 'parking_lorry',
    label: 'Lkw-Parkplätze',
    singular: 'Lkw-Parkplatz',
    color: '#1971c2',
    glyph: PARKING,
    lines: false,
    enabledByDefault: false,
    nameInSubtitle: true,
    variants: {},
  },
];
