// Adventurer Olympics drawings as images the primitives can show (an
// `artUrl`). The paths come from the canvas's icon component through
// icons.gen.ts; this only wraps them in an SVG. `tint` is a player's colour,
// used where the canvas takes one (a coin, the base under an adventurer).
// `wobble` adds the canvas's hand-drawn turbulence; the canvas turns it off
// below 26 px, and so should a caller drawing small.

import { ICONS, TINT, type IconShape } from './icons.gen.js';

const INK = '#2b2233';

export function hasIcon(name: string): boolean {
  return name in ICONS;
}

function pathOf(p: IconShape, tint: string, filter: string): string {
  const fill = p.f === TINT ? tint : p.f;
  const stroke = p.s === TINT ? tint : p.s;
  const attrs = [
    `d="${p.d}"`, `fill="${fill}"`, `stroke="${stroke}"`, `stroke-width="${p.w}"`,
    'stroke-linecap="round"', 'stroke-linejoin="round"',
    p.o !== undefined ? `opacity="${p.o}"` : '',
    p.t ? `transform="${p.t}"` : '',
    filter,
  ].filter(Boolean);
  return `<path ${attrs.join(' ')}/>`;
}

/** The drawing as SVG markup in a 100x100 box. Unknown names draw nothing. */
export function iconSvg(name: string, opts: { tint?: string; wobble?: boolean } = {}): string {
  const shapes = ICONS[name] ?? [];
  const tint = opts.tint ?? INK;
  const wobble = opts.wobble ?? true;
  const defs = wobble
    ? '<defs><filter id="w" filterUnits="userSpaceOnUse" x="-20" y="-20" width="140" height="140"><feTurbulence type="fractalNoise" baseFrequency="0.045" numOctaves="2" seed="7"/><feDisplacementMap in="SourceGraphic" scale="2.5"/></filter></defs>'
    : '';
  const filter = wobble ? 'filter="url(#w)"' : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-6 -6 112 112">${defs}${shapes.map((p) => pathOf(p, tint, filter)).join('')}</svg>`;
}

const cache = new Map<string, string>();

/** The drawing as a data URL, for a primitive's `artUrl`. */
export function iconUrl(name: string, opts: { tint?: string; wobble?: boolean } = {}): string | undefined {
  if (!hasIcon(name)) return undefined;
  const key = `${name}|${opts.tint ?? ''}|${opts.wobble ?? true}`;
  let url = cache.get(key);
  if (!url) {
    url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(iconSvg(name, opts))}`;
    cache.set(key, url);
  }
  return url;
}
