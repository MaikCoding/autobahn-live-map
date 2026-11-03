/** Runtime checks for parsed JSON, which stays `unknown` until proven otherwise. */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Like Array.isArray, but narrows to unknown[] instead of any[]. */
export function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

export function isString(value: unknown): value is string {
  return typeof value === 'string';
}

/** Accepts numbers and numeric strings; the API mixes both for the same field. */
export function toFiniteNumber(value: unknown): number | undefined {
  const number =
    typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN;
  return Number.isFinite(number) ? number : undefined;
}

export function stringsOf(value: unknown): string[] {
  return isArray(value) ? value.filter(isString) : [];
}
