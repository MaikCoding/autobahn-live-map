import { ApiError, fetchServiceItems } from '../api/client';
import type { ServiceName } from '../api/types';
import { normalizeItem, type MapItem } from './normalize';

/** Browsers open about six connections per host anyway; the API showed no rate limit at this level. */
const DEFAULT_CONCURRENCY = 6;

export type RoadOutcome =
  | { road: string; state: 'ok'; count: number }
  | { road: string; state: 'empty' }
  | { road: string; state: 'error'; message: string };

export interface LoadProgress {
  done: number;
  total: number;
  failed: number;
  items: readonly MapItem[];
}

export interface ServiceData {
  service: ServiceName;
  items: MapItem[];
  outcomes: RoadOutcome[];
  /** Entries that were not objects or had no identifier. */
  skippedInvalid: number;
  /** Entries without a usable coordinate, skipped instead of placed at 0,0. */
  skippedNoCoordinate: number;
  loadedAt: Date;
}

export interface LoadOptions {
  concurrency?: number;
  signal?: AbortSignal;
  onProgress?: (progress: LoadProgress) => void;
}

export function compareRoads(a: string, b: string): number {
  return a.localeCompare(b, 'de', { numeric: true });
}

/** Loads one service for every road. A failing road is recorded, never fatal. */
export async function loadService(
  service: ServiceName,
  roads: readonly string[],
  { concurrency = DEFAULT_CONCURRENCY, signal, onProgress }: LoadOptions = {},
): Promise<ServiceData> {
  const items: MapItem[] = [];
  const seen = new Set<string>();
  const outcomes: RoadOutcome[] = [];
  let skippedInvalid = 0;
  let skippedNoCoordinate = 0;
  let failed = 0;

  await forEachLimit(roads, concurrency, async (road) => {
    try {
      const entries = await fetchServiceItems(road, service, signal);
      let count = 0;
      for (const entry of entries) {
        const result = normalizeItem(entry, service, road);
        if ('skipped' in result) {
          if (result.skipped === 'invalid') skippedInvalid++;
          else skippedNoCoordinate++;
          continue;
        }
        if (seen.has(result.item.key)) continue;
        seen.add(result.item.key);
        items.push(result.item);
        count++;
      }
      outcomes.push(entries.length === 0 ? { road, state: 'empty' } : { road, state: 'ok', count });
    } catch (error) {
      if (signal?.aborted) throw error;
      failed++;
      outcomes.push({ road, state: 'error', message: error instanceof ApiError ? error.message : String(error) });
    }
    onProgress?.({ done: outcomes.length, total: roads.length, failed, items });
  });

  outcomes.sort((a, b) => compareRoads(a.road, b.road));
  return { service, items, outcomes, skippedInvalid, skippedNoCoordinate, loadedAt: new Date() };
}

async function forEachLimit<T extends {}>(
  values: readonly T[],
  limit: number,
  task: (value: T) => Promise<void>,
): Promise<void> {
  const queue = [...values];
  const worker = async (): Promise<void> => {
    for (let value = queue.shift(); value !== undefined; value = queue.shift()) await task(value);
  };
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, worker));
}
