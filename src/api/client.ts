import { isArray, isRecord, isString } from './guards';
import type { ServiceName } from './types';

export const API_BASE = 'https://verkehr.autobahn.de/o/autobahn';

/** Roadwork lists reach ~700 KB without compression; leave room for slow mobile links. */
const TIMEOUT_MS = 30_000;

export type ApiErrorKind = 'network' | 'timeout' | 'http' | 'parse' | 'shape';

export class ApiError extends Error {
  readonly kind: ApiErrorKind;

  constructor(message: string, kind: ApiErrorKind) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
  }
}

async function getJson(path: string, signal?: AbortSignal): Promise<unknown> {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  try {
    const response = await fetch(API_BASE + path, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    if (!response.ok) throw new ApiError(`HTTP ${response.status}`, 'http');
    const text = await response.text();
    try {
      const data: unknown = JSON.parse(text);
      return data;
    } catch {
      throw new ApiError('Antwort ist kein gültiges JSON', 'parse');
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    // A caller-side abort is not an API failure; let it through untouched.
    if (signal?.aborted) throw error;
    if (timeout.aborted) throw new ApiError('Zeitüberschreitung', 'timeout');
    throw new ApiError('Keine Verbindung zur API', 'network');
  }
}

export async function fetchRoads(signal?: AbortSignal): Promise<string[]> {
  const data = await getJson('/', signal);
  if (!isRecord(data) || !isArray(data.roads)) throw new ApiError('Unerwartetes Format der Autobahnliste', 'shape');
  const roads = data.roads
    .filter(isString)
    .map((road) => road.trim())
    .filter((road) => road !== '');
  return [...new Set(roads)];
}

/**
 * The API answers unknown roads and even unknown services with 200 and an
 * empty list, so an empty result never proves that a service exists.
 */
export async function fetchServiceItems(road: string, service: ServiceName, signal?: AbortSignal): Promise<unknown[]> {
  const data = await getJson(`/${encodeURIComponent(road)}/services/${service}`, signal);
  const items = isRecord(data) ? data[service] : undefined;
  if (!isArray(items)) throw new ApiError(`Antwort enthält kein Feld „${service}“`, 'shape');
  return items;
}
