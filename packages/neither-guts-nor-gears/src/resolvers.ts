// Printed-name resolvers (CLAUDE.md "Don't make the model guess"): every
// constrained-set field (faction, hero, unit, building, research, battle card,
// treaty, coordinate) accepts the NAME printed on the component, tolerant of
// case/spacing/punctuation, and resolves it to the internal id. A rejection
// names the accepted forms so the model's next try can succeed.

import { GameError } from '@zekel/game-kit';
import {
  BATTLE_CARDS, FACTIONS, HEROES, ROBOT_BUILDINGS, ROBOT_RESEARCH, ROBOT_UNITS,
  TREATIES, WIZARD_BUILDINGS, WIZARD_RESEARCH, WIZARD_UNITS,
  type Species, type TreatyType,
} from './data/catalogs.js';
import type { MapTile } from './data/maps.js';
import { tileCoord } from './data/maps.js';
import type { Coord } from './types.js';

/** Normalize a printed name for tolerant matching: lowercase, strip all
 *  non-alphanumerics (so "The Brass Circle", "brass circle", "Brass-Circle",
 *  and "thebrasscircle" all match). */
export function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function matchByName<T extends { id: string; name: string }>(
  table: readonly T[], input: string, what: string,
): T {
  const n = normalizeName(input);
  const exact = table.filter((r) => normalizeName(r.name) === n || normalizeName(r.id) === n);
  if (exact.length === 1) return exact[0]!;
  const partial = table.filter((r) => normalizeName(r.name).includes(n) || n.includes(normalizeName(r.id)));
  if (exact.length === 0 && partial.length === 1) return partial[0]!;
  if (partial.length > 1) {
    throw new GameError('AMBIGUOUS_MOVE', `"${input}" matches several ${what}s: ${partial.map((r) => r.name).join(', ')}. Name it exactly as printed.`);
  }
  throw new GameError('ILLEGAL_MOVE', `Unknown ${what} "${input}". Accepted (by printed name): ${table.map((r) => r.name).join(', ')}.`);
}

export function resolveFaction(input: string) { return matchByName(FACTIONS, input, 'faction'); }
export function resolveHero(input: string) { return matchByName(HEROES, input, 'hero'); }
export function resolveTreaty(input: string): { id: TreatyType; name: string } {
  const t = matchByName(TREATIES, input, 'treaty type');
  return { id: t.id, name: t.name };
}

export function resolvePurchasable(input: string, species: Species) {
  const units = species === 'wizard' ? WIZARD_UNITS : ROBOT_UNITS;
  const buildings = species === 'wizard' ? WIZARD_BUILDINGS : ROBOT_BUILDINGS;
  const all = [...units, ...buildings];
  const n = normalizeName(input);
  const hit = all.find((r) => normalizeName(r.name) === n || normalizeName(r.id) === n);
  if (hit) return hit;
  // Try partial match before failing, against the species list only.
  const partial = all.filter((r) => normalizeName(r.name).includes(n));
  if (partial.length === 1) return partial[0]!;
  if (partial.length > 1) {
    throw new GameError('AMBIGUOUS_MOVE', `"${input}" matches several purchasables: ${partial.map((r) => r.name).join(', ')}. Name it exactly as printed.`);
  }
  throw new GameError('ILLEGAL_MOVE', `Unknown purchase "${input}" for the ${species} side. Accepted: ${all.map((r) => r.name).join(', ')}.`);
}

export function resolveResearch(input: string, species: Species) {
  const table = species === 'wizard' ? WIZARD_RESEARCH : ROBOT_RESEARCH;
  return matchByName(table, input, 'research');
}

/** Battle cards resolve by their printed TYPE label ("Extra", "Retreat",
 *  "Counter", ...) — a hand holds instances; a report/commit names the type. */
export function resolveBattleCard(input: string): { id: (typeof BATTLE_CARDS)[number]['id']; label: string } {
  const n = normalizeName(input);
  const exact = BATTLE_CARDS.filter((c) => normalizeName(c.label) === n || normalizeName(c.id) === n);
  if (exact.length === 1) return exact[0]!;
  // The four Bonus variants differ by their SIGN, so their short forms are
  // read with the sign kept ("-1 DEF" is the opposing-units card, "+1 DEF"
  // your own). A bare "1 DEF" could be either and is refused, never guessed.
  const signed = input.toLowerCase().replace(/[−–]/g, '-').replace(/[^a-z0-9+-]+/g, '');
  const defMatch = (wants: Partial<Record<(typeof BATTLE_CARDS)[number]['id'], RegExp>>, text: string): (typeof BATTLE_CARDS)[number] | null => {
    for (const [id, re] of Object.entries(wants) as Array<[(typeof BATTLE_CARDS)[number]['id'], RegExp]>) {
      if (re.test(text)) return BATTLE_CARDS.find((c) => c.id === id)!;
    }
    return null;
  };
  const byPattern = defMatch({
    'bonus-def-plus': /^(bonus)?\+1def|^plus1def|(your|own).*def|def.*(your|own)/,
    'bonus-dmg-plus': /^(bonus)?\+1dmg|^plus1dmg|(your|own).*dmg|dmg.*(your|own)/,
    'bonus-def-minus': /^(bonus)?-1def|^minus1def|opposing.*def|def.*opposing/,
    'bonus-dmg-minus': /^(bonus)?-1dmg|^minus1dmg|opposing.*dmg|dmg.*opposing/,
  }, signed);
  if (byPattern) return byPattern;
  if (/^(bonus)?1(def|dmg)$/.test(signed)) {
    const stat = signed.endsWith('def') ? 'DEF' : 'DMG';
    throw new GameError('AMBIGUOUS_MOVE', `"${input}" could be either Bonus: "+1 ${stat}" (to all your units) or "-1 ${stat}" (to all opposing units). Name it with its sign, as printed.`);
  }
  const loose = BATTLE_CARDS.filter((c) => {
    const lbl = normalizeName(c.label);
    return lbl.includes(n) || n.includes(normalizeName(c.id));
  });
  if (loose.length === 1) return loose[0]!;
  if (loose.length > 1) {
    throw new GameError('AMBIGUOUS_MOVE', `"${input}" matches several battle cards: ${loose.map((c) => c.label).join(', ')}. Name it as printed.`);
  }
  throw new GameError('ILLEGAL_MOVE', `Unknown battle card "${input}". Accepted (by printed name): ${BATTLE_CARDS.map((c) => c.label).join(', ')}.`);
}

/** Coordinate resolver: accepts "c,r", "c r", "(c, r)" — AND the printed
 *  tile label ("E4", "e4", "E 4") per the 2026-09-21 naming design. The pair
 *  remains the engine's identity; resolvers translate labels at the boundary. */
export function resolveCoord(tiles: MapTile[], input: string | { c: number; r: number }): Coord {
  if (typeof input === 'object' && input !== null) {
    const key = `${input.c},${input.r}`;
    if (!tiles.some((t) => `${t.c},${t.r}` === key)) {
      throw new GameError('ILLEGAL_MOVE', `Coordinate (${input.c},${input.r}) is not a tile on this map.`);
    }
    return key;
  }
  const trimmed = input.trim();
  // Label form first: "E4" / "e4" / "E 4".
  const labelMatch = trimmed.match(/^([A-Za-z])\s*(\d+)$/);
  if (labelMatch) {
    let parsed: { c: number; r: number };
    try {
      parsed = tileCoord(trimmed);
    } catch (e) {
      throw new GameError('ILLEGAL_MOVE', `"${input}" is not a tile label on this map. Labels read letter-then-number (E4 / G3 / C2).`);
    }
    const key = `${parsed!.c},${parsed!.r}`;
    if (!tiles.some((t) => `${t.c},${t.r}` === key)) {
      throw new GameError('ILLEGAL_MOVE', `Tile label ${trimmed.toUpperCase().replace(/\s+/, '')} is not on this map (the pair exists but the layout omits it).`);
    }
    return key;
  }
  const m = trimmed.match(/^\(?\s*(-?\d+)\s*[,\s]\s*(-?\d+)\s*\)?$/);
  if (!m) {
    throw new GameError('ILLEGAL_MOVE', `"${input}" is not a coordinate. Use the printed tile label (e.g. "E4") or the legacy "c,r" form.`);
  }
  const key = `${parseInt(m[1]!, 10)},${parseInt(m[2]!, 10)}`;
  if (!tiles.some((t) => `${t.c},${t.r}` === key)) {
    throw new GameError('ILLEGAL_MOVE', `Coordinate ${key} is not a tile on this map. Only listed coordinates are playable (§13.2).`);
  }
  return key;
}

/** Starting-location resolver: accepts "@n", "start n", or the coordinate. */
export function resolveStartLocation(tiles: MapTile[], input: string): Coord {
  const m = input.trim().match(/^@?(\d+)$/);
  if (m) {
    const n = parseInt(m[1]!, 10);
    const tile = tiles.find((t) => t.start === n);
    if (!tile) {
      const available = tiles.filter((t) => t.start !== undefined).map((t) => `@${t.start}`).join(', ');
      throw new GameError('ILLEGAL_MOVE', `Starting location @${n} does not exist on this map. Numbered starts: ${available}.`);
    }
    return `${tile.c},${tile.r}`;
  }
  return resolveCoord(tiles, input);
}

/** Species-restricted hero lists, used by the Leader draft and milestone claims. */
export function heroesEligibleFor(species: Species): typeof HEROES {
  return HEROES.filter((h) => h.species === null || h.species === species);
}

/** All unit/building catalogs for id lookup by internal id. */
export function unitById(id: string) {
  return [...WIZARD_UNITS, ...ROBOT_UNITS].find((u) => u.id === id);
}
export function buildingById(id: string) {
  return [...WIZARD_BUILDINGS, ...ROBOT_BUILDINGS].find((b) => b.id === id);
}
export function researchById(id: string) {
  return [...WIZARD_RESEARCH, ...ROBOT_RESEARCH].find((r) => r.id === id);
}
