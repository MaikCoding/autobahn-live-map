/**
 * Wire format of https://verkehr.autobahn.de/o/autobahn as observed in a full
 * crawl on 2026-11-03 (docs/api-notes.md). The community OpenAPI spec is out of
 * date in several places, so these types follow the live responses instead.
 */

/** The API also has `webcam`, but it has been empty on every road since 2022. */
export type ServiceName = 'roadworks' | 'warning' | 'closure' | 'electric_charging_station' | 'parking_lorry';

/** GET / */
export interface ApiRoadList {
  /** "A1", "A64a", … */
  roads: string[];
}

/** Numbers or numeric strings, even within one service. Note `long`, not `lon`. */
export interface ApiCoordinate {
  lat: number | string;
  long: number | string;
}

/** Positions are [lon, lat]. */
export interface ApiLineString {
  type: 'LineString';
  coordinates: [number, number][];
}

export interface ApiImpact {
  lower?: string;
  upper?: string;
  /** Lane pictogram, e.g. ["BORDER_LEFT", "CLOSED", "ARROW_UP", "BORDER_RIGHT"]. */
  symbols: string[];
}

export interface ApiFeatureIcon {
  icon: string;
  description: string;
  style: string;
}

/** Fields shared by every service. */
export interface ApiRoadItem {
  /** Plain text on current records, Base64 on old ones. */
  identifier: string;
  icon: string;
  /** "true" or "false" as a string. */
  isBlocked: string;
  future: boolean;
  display_type: string;
  title: string;
  subtitle: string;
  coordinate: ApiCoordinate;
  description: string[];
  routeRecommendation: unknown[];
  footer: string[];
  lorryParkingFeatureIcons: ApiFeatureIcon[];
  /** ISO 8601, except "DD.MM.YYYY" on charging stations. */
  startTimestamp?: string;
  startLcPosition?: string;
  /** "lat,lon" or "lon,lat" depending on record age, so never read for positions. */
  point?: string;
  extent?: string;
}

/** display_type: ROADWORKS | SHORT_TERM_ROADWORKS */
export interface ApiRoadwork extends ApiRoadItem {
  impact?: ApiImpact;
  geometry?: ApiLineString;
}

/** display_type: WARNING, occasionally CLOSURE */
export interface ApiWarning extends ApiRoadItem {
  /** Minutes, as a string. */
  delayTimeValue?: string;
  /** km/h, as a string. */
  averageSpeed?: string;
  /** QUEUING_TRAFFIC | SLOW_TRAFFIC | HEAVY_TRAFFIC | UNSPECIFIED_ABNORMAL_TRAFFIC */
  abnormalTrafficType?: string;
  /** "inrix" | "eva" */
  source?: string;
  geometry?: ApiLineString;
}

/** display_type: CLOSURE | CLOSURE_ENTRY_EXIT | CLOSURE_LOAD_VZ_3_5 | CLOSURE_LOAD_VZ_16 */
export interface ApiClosure extends ApiRoadItem {
  impact?: ApiImpact;
  geometry?: ApiLineString;
  source?: string;
}

/** display_type: STRONG_ELECTRIC_CHARGING_STATION | ELECTRIC_CHARGING_STATION */
export type ApiChargingStation = ApiRoadItem;

/** display_type: PARKING; amenities in lorryParkingFeatureIcons. */
export type ApiParkingLorry = ApiRoadItem;

export interface ApiServiceItems {
  roadworks: ApiRoadwork;
  warning: ApiWarning;
  closure: ApiClosure;
  electric_charging_station: ApiChargingStation;
  parking_lorry: ApiParkingLorry;
}

/** GET /{roadId}/services/{service}: the top-level key is the service name. */
export type ApiServiceResponse<S extends ServiceName> = { [K in S]: ApiServiceItems[K][] };

/** A parsed JSON object whose field names follow T but whose values are not checked yet. */
export type Untrusted<T> = { [K in keyof T]?: unknown };
