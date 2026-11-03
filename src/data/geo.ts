import { isArray, isRecord, isString, toFiniteNumber } from '../api/guards';
import type { Position } from './normalize';

const EARTH_RADIUS_KM = 6371.0088;
/** Points just outside the generalised VG2500 borders still count for the nearest state. */
const NEAREST_STATE_MAX_KM = 5;

export function distanceKm([lon1, lat1]: Position, [lon2, lat2]: Position): number {
  const rad = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

export function lineLengthKm(line: readonly Position[]): number {
  let total = 0;
  let previous: Position | undefined;
  for (const position of line) {
    if (previous) total += distanceKm(previous, position);
    previous = position;
  }
  return total;
}

/** Sample spacing along lines for `coveredKm`. */
const SAMPLE_KM = 0.1;
/** Samples closer than this count as the same stretch: merges both carriageways and overlapping entries. */
const SAME_STRETCH_KM = 0.075;
const KM_PER_DEGREE_LAT = 111.32;

function* sampleLine(line: readonly Position[], stepKm: number): Generator<Position> {
  let previous: Position | undefined;
  let carry = 0;
  for (const position of line) {
    if (!previous) {
      yield position;
    } else {
      const length = distanceKm(previous, position);
      let at = stepKm - carry;
      for (; at <= length; at += stepKm) {
        const t = at / length;
        yield [previous[0] + (position[0] - previous[0]) * t, previous[1] + (position[1] - previous[1]) * t];
      }
      carry = length - (at - stepKm);
    }
    previous = position;
  }
}

/**
 * Length of road covered by the lines, counting each stretch once. Summing line
 * lengths would count both directions and overlapping construction phases
 * separately; the A7 alone would add up to roughly its full length.
 */
export function coveredKm(lines: readonly (readonly Position[])[]): number {
  const cellLat = SAME_STRETCH_KM / KM_PER_DEGREE_LAT;
  // Longitude degrees are about 0.6 as long in Germany; wider cells keep them roughly square.
  const cellLon = cellLat / 0.6;
  const grid = new Map<string, Position[]>();
  let kept = 0;
  for (const line of lines) {
    for (const point of sampleLine(line, SAMPLE_KM)) {
      const cx = Math.floor(point[0] / cellLon);
      const cy = Math.floor(point[1] / cellLat);
      let seen = false;
      for (let dx = -1; dx <= 1 && !seen; dx++) {
        for (let dy = -1; dy <= 1 && !seen; dy++) {
          seen = (grid.get(`${cx + dx},${cy + dy}`) ?? []).some((other) => distanceKm(point, other) < SAME_STRETCH_KM);
        }
      }
      if (seen) continue;
      kept++;
      const key = `${cx},${cy}`;
      grid.set(key, [...(grid.get(key) ?? []), point]);
    }
  }
  return kept * SAMPLE_KM;
}

export interface FederalState {
  /** Amtlicher Gemeindeschlüssel of the state, "01" … "16". */
  ags: string;
  name: string;
  /** MultiPolygon rings; holes (Berlin inside Brandenburg) are ordinary rings. */
  polygons: Position[][][];
  bbox: [minLon: number, minLat: number, maxLon: number, maxLat: number];
}

function parseRing(value: unknown): Position[] {
  if (!isArray(value)) return [];
  return value.flatMap((pair) => {
    if (!isArray(pair)) return [];
    const lon = toFiniteNumber(pair[0]);
    const lat = toFiniteNumber(pair[1]);
    return lon === undefined || lat === undefined ? [] : [[lon, lat] as Position];
  });
}

/** Parses the generated bundeslaender.geojson; malformed features are dropped, not guessed. */
export function parseStates(data: unknown): FederalState[] {
  if (!isRecord(data) || !isArray(data.features)) throw new Error('Unerwartetes Format der Länderdaten');
  const states: FederalState[] = [];
  for (const feature of data.features) {
    if (!isRecord(feature) || !isRecord(feature.properties) || !isRecord(feature.geometry)) continue;
    const { ags, name } = feature.properties;
    const { type, coordinates } = feature.geometry;
    if (!isString(ags) || !isString(name) || type !== 'MultiPolygon' || !isArray(coordinates)) continue;
    const polygons = coordinates.map((polygon) => (isArray(polygon) ? polygon.map(parseRing) : []));
    const all = polygons.flat(2);
    if (all.length === 0) continue;
    const lons = all.map(([lon]) => lon);
    const lats = all.map(([, lat]) => lat);
    states.push({
      ags,
      name,
      polygons,
      bbox: [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)],
    });
  }
  return states;
}

/** Even-odd ray casting over every ring, so holes need no special casing. */
function contains(polygons: readonly Position[][][], [x, y]: Position): boolean {
  let inside = false;
  for (const polygon of polygons) {
    for (const ring of polygon) {
      let previous = ring[ring.length - 1];
      for (const point of ring) {
        if (previous && point[1] > y !== previous[1] > y) {
          const crossing = ((previous[0] - point[0]) * (y - point[1])) / (previous[1] - point[1]) + point[0];
          if (x < crossing) inside = !inside;
        }
        previous = point;
      }
    }
  }
  return inside;
}

function inBox([minLon, minLat, maxLon, maxLat]: FederalState['bbox'], [lon, lat]: Position, margin = 0): boolean {
  return lon >= minLon - margin && lon <= maxLon + margin && lat >= minLat - margin && lat <= maxLat + margin;
}

/** Point-in-polygon first; if a point falls just outside the generalised border, the nearest state within 5 km. */
export function findState(states: readonly FederalState[], position: Position): FederalState | undefined {
  const candidates = states.filter((state) => inBox(state.bbox, position));
  const containing = candidates.find((state) => contains(state.polygons, position));
  if (containing) return containing;

  let nearest: FederalState | undefined;
  let nearestKm = NEAREST_STATE_MAX_KM;
  for (const state of states.filter((candidate) => inBox(candidate.bbox, position, 0.1))) {
    for (const vertex of state.polygons.flat(2)) {
      const km = distanceKm(position, vertex);
      if (km < nearestKm) {
        nearestKm = km;
        nearest = state;
      }
    }
  }
  return nearest;
}
