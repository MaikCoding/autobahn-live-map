import { isArray, isRecord, isString, stringsOf, toFiniteNumber } from '../api/guards';
import type {
  ApiChargingStation,
  ApiClosure,
  ApiImpact,
  ApiParkingLorry,
  ApiRoadwork,
  ApiWarning,
  ServiceName,
  Untrusted,
} from '../api/types';

/** Generous box around Germany: anything outside is a broken coordinate, not a distant roadwork. */
const PLAUSIBLE = { minLon: 5.5, maxLon: 15.5, minLat: 47, maxLat: 55.5 };

export type Position = [lon: number, lat: number];

export interface Timestamp {
  date: Date;
  /** Charging stations only send a date. */
  hasTime: boolean;
}

/** One API entry, checked and reduced to what the map and the detail panel use. */
export interface MapItem {
  /** Unique across services and roads. */
  key: string;
  service: ServiceName;
  /** The road whose endpoint delivered the entry. */
  road: string;
  identifier: string;
  position: Position;
  title: string;
  subtitle: string;
  displayType: string;
  description: string[];
  future: boolean;
  blocked: boolean;
  start?: Timestamp;
  /** Course of a roadwork, jam or closure, if the API sent a usable one. */
  line?: Position[];
  impact?: ApiImpact;
  delayMinutes?: number;
  averageSpeedKmh?: number;
  trafficType?: string;
  amenities: string[];
}

export type SkipReason = 'invalid' | 'no-coordinate';

export type NormalizeResult = { item: MapItem } | { skipped: SkipReason };

type AnyApiItem = ApiRoadwork & ApiWarning & ApiClosure & ApiChargingStation & ApiParkingLorry;

export function normalizeItem(raw: unknown, service: ServiceName, road: string): NormalizeResult {
  if (!isRecord(raw)) return { skipped: 'invalid' };
  // Safe: every field stays `unknown` and is checked below.
  const entry = raw as Untrusted<AnyApiItem>;

  if (!isString(entry.identifier) || entry.identifier === '') return { skipped: 'invalid' };
  const position = parsePosition(entry.coordinate);
  if (!position) return { skipped: 'no-coordinate' };

  return {
    item: {
      key: `${service}:${entry.identifier}`,
      service,
      road,
      identifier: entry.identifier,
      position,
      title: isString(entry.title) ? entry.title.trim() : '',
      subtitle: isString(entry.subtitle) ? entry.subtitle.trim() : '',
      displayType: isString(entry.display_type) ? entry.display_type : '',
      description: stringsOf(entry.description),
      future: entry.future === true,
      blocked: entry.isBlocked === 'true' || entry.isBlocked === true,
      start: parseTimestamp(entry.startTimestamp),
      line: parseLine(entry.geometry),
      impact: parseImpact(entry.impact),
      delayMinutes: toFiniteNumber(entry.delayTimeValue),
      averageSpeedKmh: toFiniteNumber(entry.averageSpeed),
      trafficType: isString(entry.abnormalTrafficType) ? entry.abnormalTrafficType : undefined,
      amenities: parseAmenities(entry.lorryParkingFeatureIcons),
    },
  };
}

function isPlausible(lon: number, lat: number): boolean {
  return lon >= PLAUSIBLE.minLon && lon <= PLAUSIBLE.maxLon && lat >= PLAUSIBLE.minLat && lat <= PLAUSIBLE.maxLat;
}

/** Reads `coordinate` only; `point` has no fixed axis order. */
export function parsePosition(value: unknown): Position | undefined {
  if (!isRecord(value)) return undefined;
  const lat = toFiniteNumber(value.lat);
  const lon = toFiniteNumber(value.long);
  if (lat === undefined || lon === undefined || !isPlausible(lon, lat)) return undefined;
  return [lon, lat];
}

function parseLine(value: unknown): Position[] | undefined {
  if (!isRecord(value) || value.type !== 'LineString' || !isArray(value.coordinates)) return undefined;
  const positions: Position[] = [];
  for (const pair of value.coordinates) {
    if (!isArray(pair)) continue;
    const lon = toFiniteNumber(pair[0]);
    const lat = toFiniteNumber(pair[1]);
    if (lon !== undefined && lat !== undefined && isPlausible(lon, lat)) positions.push([lon, lat]);
  }
  return positions.length >= 2 ? positions : undefined;
}

const GERMAN_DATE = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/;
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

export function parseTimestamp(value: unknown): Timestamp | undefined {
  if (!isString(value)) return undefined;
  const text = value.trim();
  const german = GERMAN_DATE.exec(text);
  if (german) {
    const [day, month, year] = german.slice(1).map(Number) as [number, number, number];
    const date = new Date(year, month - 1, day);
    // Rejects rollovers such as 31.02.
    return date.getDate() === day && date.getMonth() === month - 1 ? { date, hasTime: false } : undefined;
  }
  if (!ISO_DATE_TIME.test(text)) return undefined;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? undefined : { date, hasTime: true };
}

function parseImpact(value: unknown): ApiImpact | undefined {
  if (!isRecord(value)) return undefined;
  return {
    lower: isString(value.lower) ? value.lower : undefined,
    upper: isString(value.upper) ? value.upper : undefined,
    symbols: stringsOf(value.symbols),
  };
}

function parseAmenities(value: unknown): string[] {
  if (!isArray(value)) return [];
  return value.flatMap((icon) => (isRecord(icon) && isString(icon.description) ? [icon.description] : []));
}
