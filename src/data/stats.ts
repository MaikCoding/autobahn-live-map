import type { ServiceName } from '../api/types';
import { coveredKm, lineLengthKm, type FederalState } from './geo';
import { compareRoads } from './loader';
import type { MapItem } from './normalize';

/** One loaded layer; layers that are off or not loaded yet are simply absent. */
export interface LayerSnapshot {
  service: ServiceName;
  items: readonly MapItem[];
}

export interface StateRow {
  state: FederalState;
  counts: Partial<Record<ServiceName, number>>;
}

export interface RoadRow {
  road: string;
  roadworks: number;
  roadworksKm: number;
}

export interface RecordEntry {
  label: string;
  value: string;
  item: MapItem;
}

export interface Overview {
  loaded: ReadonlySet<ServiceName>;
  roadworks: { current: number; planned: number; shortTerm: number; km: number };
  warnings: { count: number; jams: number; delayMinutes: number };
  closures: { count: number; ramps: number; weightLimits: number };
  charging: { count: number; fast: number };
  parking: { count: number; lorrySpaces: number; withSpaceInfo: number };
  /** null while the state boundaries are still loading. */
  states: StateRow[] | null;
  /** Entries that matched no state, per service. */
  unassigned: Partial<Record<ServiceName, number>>;
  topRoads: RoadRow[];
  records: RecordEntry[];
}

export interface RoadSummary {
  road: string;
  loaded: ReadonlySet<ServiceName>;
  counts: Partial<Record<ServiceName, number>>;
  roadworksKm: number;
  delayMinutes: number;
  /** Warnings with a delay, largest first. */
  jams: MapItem[];
  /** States the road's entries lie in, most entries first; null while boundaries load. */
  states: string[] | null;
}

const JAM_TYPES = new Set(['QUEUING_TRAFFIC', 'SLOW_TRAFFIC', 'HEAVY_TRAFFIC']);
/** Parking descriptions carry the capacity as text: "LKW Stellplätze: 82". */
const LORRY_SPACES = /LKW[\s-]*Stellpl(?:ä|ae)tze:\s*(\d+)/i;
const TOP_ROADS = 10;

const km = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat('de-DE');

export function lorrySpaces(item: MapItem): number | undefined {
  for (const line of item.description) {
    const match = LORRY_SPACES.exec(line);
    if (match?.[1]) return Number(match[1]);
  }
  return undefined;
}

/** Lines of active (not planned) roadworks. */
function activeLines(items: readonly MapItem[]): MapItem['position'][][] {
  return items.flatMap((item) => (!item.future && item.line ? [item.line] : []));
}

function itemsOf(snapshots: readonly LayerSnapshot[], service: ServiceName): readonly MapItem[] {
  return snapshots.find((snapshot) => snapshot.service === service)?.items ?? [];
}

function maxBy<T>(values: readonly T[], score: (value: T) => number | undefined): { value: T; score: number } | undefined {
  let best: { value: T; score: number } | undefined;
  for (const value of values) {
    const current = score(value);
    if (current !== undefined && (!best || current > best.score)) best = { value, score: current };
  }
  return best;
}

export function computeOverview(
  snapshots: readonly LayerSnapshot[],
  stateOf: ((item: MapItem) => FederalState | undefined) | null,
): Overview {
  const roadworks = itemsOf(snapshots, 'roadworks');
  const warnings = itemsOf(snapshots, 'warning');
  const closures = itemsOf(snapshots, 'closure');
  const charging = itemsOf(snapshots, 'electric_charging_station');
  const parking = itemsOf(snapshots, 'parking_lorry');

  let states: StateRow[] | null = null;
  const unassigned: Partial<Record<ServiceName, number>> = {};
  if (stateOf) {
    const rows = new Map<string, StateRow>();
    for (const { service, items } of snapshots) {
      for (const item of items) {
        const state = stateOf(item);
        if (!state) {
          unassigned[service] = (unassigned[service] ?? 0) + 1;
          continue;
        }
        const row = rows.get(state.ags) ?? { state, counts: {} };
        row.counts[service] = (row.counts[service] ?? 0) + 1;
        rows.set(state.ags, row);
      }
    }
    states = [...rows.values()];
  }

  const byRoad = new Map<string, MapItem[]>();
  for (const item of roadworks) byRoad.set(item.road, [...(byRoad.get(item.road) ?? []), item]);
  const roads = [...byRoad].map(([road, items]) => ({ road, roadworks: items.length, roadworksKm: coveredKm(activeLines(items)) }));

  const records: RecordEntry[] = [];
  const longestRoadwork = maxBy(roadworks, (item) => (!item.future && item.line ? lineLengthKm(item.line) : undefined));
  if (longestRoadwork) records.push({ label: 'Längste Baustelle', value: `${km.format(longestRoadwork.score)} km`, item: longestRoadwork.value });
  const biggestDelay = maxBy(warnings, (item) => item.delayMinutes);
  if (biggestDelay) records.push({ label: 'Größter Zeitverlust', value: `${whole.format(biggestDelay.score)} Min.`, item: biggestDelay.value });
  const slowest = maxBy(warnings, (item) => (item.averageSpeedKmh === undefined ? undefined : -item.averageSpeedKmh));
  if (slowest) records.push({ label: 'Zähester Verkehr', value: `Ø ${whole.format(-slowest.score)} km/h`, item: slowest.value });
  const longestClosure = maxBy(closures, (item) => (item.displayType === 'CLOSURE' && item.line ? lineLengthKm(item.line) : undefined));
  if (longestClosure) records.push({ label: 'Längste Sperrung', value: `${km.format(longestClosure.score)} km`, item: longestClosure.value });
  const biggestParking = maxBy(parking, lorrySpaces);
  if (biggestParking) records.push({ label: 'Größter Lkw-Parkplatz', value: `${whole.format(biggestParking.score)} Lkw-Plätze`, item: biggestParking.value });

  const spaces = parking.map(lorrySpaces).filter((value): value is number => value !== undefined);

  return {
    loaded: new Set(snapshots.map((snapshot) => snapshot.service)),
    roadworks: {
      current: roadworks.filter((item) => !item.future).length,
      planned: roadworks.filter((item) => item.future).length,
      shortTerm: roadworks.filter((item) => item.displayType === 'SHORT_TERM_ROADWORKS').length,
      km: roads.reduce((sum, row) => sum + row.roadworksKm, 0),
    },
    warnings: {
      count: warnings.length,
      jams: warnings.filter((item) => item.trafficType !== undefined && JAM_TYPES.has(item.trafficType)).length,
      delayMinutes: warnings.reduce((sum, item) => sum + (item.delayMinutes ?? 0), 0),
    },
    closures: {
      count: closures.length,
      ramps: closures.filter((item) => item.displayType === 'CLOSURE_ENTRY_EXIT').length,
      weightLimits: closures.filter((item) => item.displayType.startsWith('CLOSURE_LOAD')).length,
    },
    charging: {
      count: charging.length,
      fast: charging.filter((item) => item.displayType === 'STRONG_ELECTRIC_CHARGING_STATION').length,
    },
    parking: {
      count: parking.length,
      lorrySpaces: spaces.reduce((sum, value) => sum + value, 0),
      withSpaceInfo: spaces.length,
    },
    states,
    unassigned,
    topRoads: roads
      .sort((a, b) => b.roadworksKm - a.roadworksKm || compareRoads(a.road, b.road))
      .slice(0, TOP_ROADS),
    records,
  };
}

export function summarizeRoad(
  road: string,
  snapshots: readonly LayerSnapshot[],
  stateOf: ((item: MapItem) => FederalState | undefined) | null,
): RoadSummary {
  const counts: Partial<Record<ServiceName, number>> = {};
  const stateCounts = new Map<string, number>();
  const roadworks: MapItem[] = [];
  let delayMinutes = 0;
  const jams: MapItem[] = [];

  for (const { service, items } of snapshots) {
    for (const item of items) {
      if (item.road !== road) continue;
      counts[service] = (counts[service] ?? 0) + 1;
      if (service === 'roadworks') roadworks.push(item);
      if (item.delayMinutes !== undefined) {
        delayMinutes += item.delayMinutes;
        jams.push(item);
      }
      const state = stateOf?.(item);
      if (state) stateCounts.set(state.name, (stateCounts.get(state.name) ?? 0) + 1);
    }
  }

  return {
    road,
    loaded: new Set(snapshots.map((snapshot) => snapshot.service)),
    counts,
    roadworksKm: coveredKm(activeLines(roadworks)),
    delayMinutes,
    jams: jams.sort((a, b) => (b.delayMinutes ?? 0) - (a.delayMinutes ?? 0)),
    states: stateOf ? [...stateCounts].sort((a, b) => b[1] - a[1]).map(([name]) => name) : null,
  };
}
