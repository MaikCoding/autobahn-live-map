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
  /** Chip labels for display_type values worth calling out. */
  variants: Readonly<Record<string, string>>;
}

const CONE =
  '<path d="M10.1 2.5h3.8L19.4 18H4.6z"/>' +
  '<path fill="currentColor" d="M8.15 8h7.7l.92 2.6H7.23z"/>' +
  '<path fill="currentColor" d="M6.37 13h11.26l.92 2.6H5.45z"/>' +
  '<rect x="3" y="18" width="18" height="3" rx="1"/>';

export const LAYERS: readonly LayerDefinition[] = [
  {
    service: 'roadworks',
    label: 'Baustellen',
    singular: 'Baustelle',
    color: '#e8590c',
    glyph: CONE,
    lines: true,
    variants: { SHORT_TERM_ROADWORKS: 'Kurzzeitbaustelle' },
  },
];
