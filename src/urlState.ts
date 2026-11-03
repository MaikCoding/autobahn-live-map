import type { ServiceName } from './api/types';

/** What a shared link restores: `?road=A3,A5&layers=warning,closure`. */
export interface UrlState {
  roads: string[];
  /** null: the default layers. */
  layers: ServiceName[] | null;
}

function splitList(value: string | null): string[] {
  return (value ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

export function readUrlState(services: readonly ServiceName[]): UrlState {
  const params = new URLSearchParams(location.search);
  const isService = (value: string): value is ServiceName => (services as readonly string[]).includes(value);
  return {
    roads: splitList(params.get('road')),
    layers: params.has('layers') ? splitList(params.get('layers')).filter(isService) : null,
  };
}

export function writeUrlState({ roads, layers }: UrlState): void {
  const params = new URLSearchParams(location.search);
  if (roads.length > 0) params.set('road', roads.join(','));
  else params.delete('road');
  if (layers) params.set('layers', layers.join(','));
  else params.delete('layers');
  // Commas stay readable in a shared link.
  const query = params.toString().replaceAll('%2C', ',');
  history.replaceState(null, '', `${location.pathname}${query ? `?${query}` : ''}${location.hash}`);
}
