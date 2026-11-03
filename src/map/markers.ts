import type { Map as MapLibreMap } from 'maplibre-gl';

/** Marker diameter in CSS pixels. */
const SIZE = 30;
const PIXEL_RATIO = 2;

/** Round marker with a white pictogram, rendered from SVG so it stays crisp on any screen. */
export async function addMarkerImage(map: MapLibreMap, id: string, color: string, glyph: string): Promise<void> {
  if (map.hasImage(id)) return;
  const pixels = SIZE * PIXEL_RATIO;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${pixels}" height="${pixels}" viewBox="0 0 30 30" color="${color}">` +
    '<circle cx="15" cy="16" r="13" fill="#000" fill-opacity="0.2"/>' +
    `<circle cx="15" cy="15" r="13" fill="${color}" stroke="#fff" stroke-width="2"/>` +
    `<g transform="translate(7 7) scale(0.6667)" fill="#fff">${glyph}</g>` +
    '</svg>';
  const image = new Image(pixels, pixels);
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await image.decode();
  if (!map.hasImage(id)) map.addImage(id, image, { pixelRatio: PIXEL_RATIO });
}
