// Adventurer Olympics — hex map geometry (pointy-top axial hexes).
//
// Tile model: 7 hexes = centre + 6 outer. The 6 outer positions are the six
// axial neighbor offsets of the centre (DIRS). A tile slot is a side of a
// tile — the gap between two consecutive outer hexes.
//
// Tiles fit the MIRROR way (RULES.md §12: the fit has two mirror-image
// versions; the port pins one and the setup instructions show the picture).
// The pinned convention NEVER overlaps: a tile placed across a side of an
// existing tile covers 7 FRESH hexes and touches the map on exactly the side's
// two hexes (Zeke confirmed 2026-09-29 that physical tiles nestle side-to-side
// with no shared hexes — two tiles cover 2×7 = 14 distinct hexes). The centre
// offset is the integer-lattice position 2a+b (a, b = the side's two adjacent
// outer offsets), which is rotation-consistent: slotting across side s of a
// rotated tile lands on the same key as a fresh tile across that side. Verified
// exhaustive: 200 random 10-tile fills ⇒ zero collisions, zero interior holes
// (output/adventurer-olympics/ao-geom-math.mts).
//
// All coordinates are integer axial (q, r). Tile centres, outer hexes, icon
// positions and standee positions all live on the same unit grid.

import type { HexName, IconKind } from './data.js';
import type { Hex, IconHex, PlacedTile } from './types.js';

// Axial neighbor offsets (pointy-top), in the order the outer hexes are laid
// out around a centre. DIRS[i] is outer position i.
export const DIRS: Array<[number, number]> = [
  [1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1],
];

// Local hex name → outer index at rotation 0. C = centre (no offset).
// The mapping is chosen so N is the "top" hex and the names run in the same
// rotational direction as DIRS, so the side between outer positions i and i+1
// is named for the hexes that occupy those positions — this is what the
// printed side labels ("side NE–SE") must match.
//   position 0 = NE (sits at the (1,0) axial step)
//   position 1 = N  (the (1,-1) step)  · side NE–SE lies between positions 0
//                                       and 5 — handled in sideLabelOf.
// See the note in sideLabelOf for the side-name convention.
const LOCAL_TO_OUTER: Record<Exclude<HexName, 'C'>, number> = {
  N: 1,    // NE-ish (top)
  NE: 0,   // E
  SE: 5,   // SE
  S: 4,    // SW-ish (bottom)
  SW: 3,   // W
  NW: 2,   // NW
};

export function hexKey(q: number, r: number): string {
  return `${q},${r}`;
}

export function keyToHex(key: string): Hex {
  const parts = key.split(',').map(Number);
  const q = parts[0] as number;
  const r = parts[1] as number;
  return { q, r, key };
}

export function neighbors(key: string): string[] {
  const { q, r } = keyToHex(key);
  return DIRS.map(([dq, dr]) => hexKey(q + dq, r + dr));
}

export function hexDistance(a: string, b: string): number {
  const A = keyToHex(a), B = keyToHex(b);
  return (Math.abs(A.q - B.q) + Math.abs(A.r - B.r) + Math.abs((A.q + A.r) - (B.q + B.r))) / 2;
}

/** The 6 outer hex keys of a tile centred at `center`. */
export function tileOuterHexes(centerKey: string): string[] {
  const { q, r } = keyToHex(centerKey);
  return DIRS.map(([dq, dr]) => hexKey(q + dq, r + dr));
}

/** All 7 hex keys of a tile (centre + outer). Used for collision checks and
 *  for the map's hex inventory. */
export function tileHexes(centerKey: string): string[] {
  return [centerKey, ...tileOuterHexes(centerKey)];
}

/** For each local hex name of a tile, its absolute hex key at the given
 *  centre + rotation. The centre is the tile's centre key; outer hexes are
 *  the unit-grid axial offsets (rotation index added). */
export function localHexAbsolute(
  centerKey: string,
  rotation: number,
  localHex: HexName,
): string {
  if (localHex === 'C') return centerKey;
  const outerIdx = (LOCAL_TO_OUTER[localHex] + rotation) % 6;
  const { q, r } = keyToHex(centerKey);
  const d = DIRS[outerIdx] as [number, number];
  return hexKey(q + d[0], r + d[1]);
}

/** The absolute centre of the tile that slots across side `side` (0..5) of the
 *  tile centred at `centerKey` — the pinned mirror convention of RULES.md
 *  §5.3/§12 (Zeke confirmed 2026-09-29: physical tiles never overlap).
 *
 *  The new tile's centre is pushed out to `2a + b` (a = the side's first outer
 *  offset, b = the second) — an INTEGER-lattice position. Its two nearest
 *  outer hexes nestle against the side's two hexes at distance 1 (touch), and
 *  the two tiles share NO hex: two tiles cover 2×7 = 14 distinct hexes. The
 *  convention is rotation-consistent (slotting a new tile across side s of a
 *  rotated tile lands on the same key as slotting a fresh tile across the same
 *  side), so the map lattices cleanly — 200 random 10-tile fills produce zero
 *  collisions and zero interior holes (output/adventurer-olympics/ao-geom-math.mts).
 *
 *  The pre-fix code placed the centre at the SUM `a + b` of two adjacent unit
 *  offsets — exactly on hexes of the source tile, so two tiles shared hexes
 *  and merged icons (12 distinct hexes, movement resolved only the first icon
 *  at the shared address). */
export function tileCenter(centerKey: string, side: number): string {
  const { q, r } = keyToHex(centerKey);
  const a = DIRS[side % 6] as [number, number];
  const b = DIRS[((side + 1) % 6)] as [number, number];
  return hexKey(q + 2 * a[0] + b[0], r + 2 * a[1] + b[1]);
}

/** The two outer hex keys (the side's "nestle" hexes) of side `side` on the
 *  tile centred at `centerKey`. A tile placed across this side touches the map
 *  exactly at these two hexes (each of the new tile's two nearest outer hexes
 *  is adjacent to one of them; the tiles share no hex). */
export function slotHexes(centerKey: string, side: number): [string, string] {
  const { q, r } = keyToHex(centerKey);
  const a = DIRS[side % 6] as [number, number];
  const b = DIRS[((side + 1) % 6)] as [number, number];
  return [hexKey(q + a[0], r + a[1]), hexKey(q + b[0], r + b[1])];
}

/** The printed side label ("side N–NE") of side `side` of a tile standing at
 *  `centerKey` with rotation `rotation`.
 *
 *  The name pins which two OUTER hexes of the tile the side sits between, using
 *  the tile's PRINTED local hex names (the orientation-independent identity the
 *  rulebook uses: "side NE–SE" lies between the NE and SE hexes). Rotating the
 *  tile changes which absolute direction those hexes point, but the side is
 *  always named for the same two printed hexes — so a player holding the tile
 *  reads the same label the menu printed.
 *
 *  This is the ONE authoritative local-name↔side mapping (R4): the previous
 *  label arrays used a clockwise order inconsistent with LOCAL_TO_OUTER, so a
 *  menu said "NE–SE" for the side that actually touched the N and NW hexes. */
export function sideLabelOf(centerKey: string, rotation: number, side: number): string {
  // Side i lies between outer positions i and i+1. The printed name of the
  // outer position o is the local name whose LOCAL_TO_OUTER index maps the
  // tile's ROTATED position back to position o.
  const localNames: Array<Exclude<HexName, 'C'>> = ['N', 'NE', 'SE', 'S', 'SW', 'NW'];
  const nameAt = (outerPos: number): string => {
    const pos = ((outerPos % 6) + 6) % 6;
    const found = localNames.find((ln) => (LOCAL_TO_OUTER[ln] + rotation) % 6 === pos);
    return found ?? '?';
  };
  const i = ((side % 6) + 6) % 6;
  const a = nameAt(i), b = nameAt(i + 1);
  // Print the pair the way the rulebook writes it (§5.3: N–NE, NE–SE, SE–S,
  // S–SW, SW–NW, NW–N), whichever order the two hexes came out in.
  const printed = PRINTED_SIDES.find((ps) => (ps[0] === a && ps[1] === b) || (ps[0] === b && ps[1] === a));
  return printed ? `side ${printed[0]}–${printed[1]}` : `side ${a}–${b}`;
}

const PRINTED_SIDES: Array<[string, string]> = [
  ['N', 'NE'], ['NE', 'SE'], ['SE', 'S'], ['S', 'SW'], ['SW', 'NW'], ['NW', 'N'],
];

/** Is `key` an integer (unit-grid) hex key? Under the pinned integer-lattice
 *  fit every key is integral — this is a validation guard for callers passing
 *  user-supplied hex keys (e.g. a mistyped "1.5,0"). */
export function isUnitHexKey(key: string): boolean {
  const parts = key.split(',');
  if (parts.length !== 2) return false;
  return parts.every((p) => /^-?\d+$/.test(p));
}

/** True when `centerKey` is a legal place for a new tile: not occupied by a
 *  placed tile's centre, and a real map slot (some placed tile has a side
 *  whose slot centre is this key, and both hexes of that side are on the map). */
export function isMapSlot(placedCenters: string[], centerKey: string, hexes: Record<string, true> | Map<string, unknown> | Set<string>): boolean {
  if (placedCenters.includes(centerKey)) return false;
  const has = (k: string): boolean =>
    hexes instanceof Set ? hexes.has(k)
      : hexes instanceof Map ? hexes.has(k)
        : (hexes as Record<string, true>)[k] === true;
  for (const c of placedCenters) {
    for (let s = 0; s < 6; s++) {
      if (tileCenter(c, s) === centerKey) {
        const [a, b] = slotHexes(c, s);
        return has(a) && has(b);
      }
    }
  }
  return false;
}

/** Build the absolute icon-hex list for a placed tile. */
export function iconHexesForTile(
  tile: { tileId: number; center: { q: number; r: number; key: string }; rotation: number },
  tileDef: { icons: Partial<Record<HexName, IconKind | import('./data.js').ArtifactId>> },
): IconHex[] {
  const out: IconHex[] = [];
  const centerKey = tile.center.key;
  for (const [localHex, kind] of Object.entries(tileDef.icons) as Array<[HexName, IconKind | import('./data.js').ArtifactId]>) {
    if (localHex === 'C') continue; // no tile has an icon on its centre hex
    out.push({
      key: localHexAbsolute(centerKey, tile.rotation, localHex),
      tileId: tile.tileId,
      localHex,
      kind,
      completed: false,
      completedBy: null,
    });
  }
  return out;
}

export type { PlacedTile };

// ---------------------------------------------------------------------------
// Table words for hexes, slots and rotations. The axial keys ("-1,0") are the
// server's coordinates; nobody at a physical table can find them. Every hex
// belongs to exactly one tile (tiles never overlap), so a hex is named by the
// tile it is on and the hex name PRINTED on that tile ("the NE hex of Tile 3")
// — readable off the physical tile however it was turned. The starting tile
// is always placed unturned (rotation 0), so a rotation is named by which way
// the new tile's printed N hex points, in terms of the starting tile's hexes.
// ---------------------------------------------------------------------------
const LOCAL_NAMES: Array<Exclude<HexName, 'C'>> = ['N', 'NE', 'SE', 'S', 'SW', 'NW'];

type PlacedRef = { tileId: number; center: { key: string }; rotation: number };

/** "the NE hex of Tile 3" / "the centre of Tile 3" for an absolute hex key. */
export function hexLabelOf(placed: PlacedRef[], key: string): string {
  for (const t of placed) {
    if (t.center.key === key) return `the centre of Tile ${t.tileId}`;
    for (const ln of LOCAL_NAMES) {
      if (localHexAbsolute(t.center.key, t.rotation, ln) === key) return `the ${ln} hex of Tile ${t.tileId}`;
    }
  }
  return key;
}

/** How to turn a tile placed with `rotation`, in table words. */
export function rotationLabel(rotation: number): string {
  if (rotation === 0) return 'turned the same way as the starting tile (its N hex points where the starting tile\'s N hex points)';
  const pos = (LOCAL_TO_OUTER.N + rotation) % 6;
  const toward = LOCAL_NAMES.find((ln) => LOCAL_TO_OUTER[ln] === pos)!;
  return `turned so its N hex points where the starting tile's ${toward} hex points`;
}

/** Accept a rotation as 0-5, or as the starting-tile hex name its N hex points
 *  toward ("NW", "points NW", "N hex toward the starting tile's SE"). */
export function resolveRotation(input: unknown): number | null {
  if (typeof input === 'number') return Number.isInteger(input) && input >= 0 && input <= 5 ? input : null;
  if (typeof input !== 'string') return null;
  const text = input.trim().toUpperCase();
  if (/^[0-5]$/.test(text)) return Number(text);
  // The LAST hex name mentioned is the direction ("N hex points ... SE").
  const names = text.match(/\b(NE|NW|SE|SW|N|S)\b/g);
  const toward = names?.[names.length - 1] as Exclude<HexName, 'C'> | undefined;
  if (!toward) return null;
  return ((LOCAL_TO_OUTER[toward] - LOCAL_TO_OUTER.N) % 6 + 6) % 6;
}

/** Accept a hex as an axial key or in table words: "Tile 3 NE", "the NE hex of
 *  Tile 3", "centre of tile 3". Returns the axial key, or null. */
export function resolveHexRef(placed: PlacedRef[], ref: unknown): string | null {
  if (typeof ref !== 'string') return null;
  const text = ref.trim();
  if (isUnitHexKey(text.replace(/\s+/g, ''))) return text.replace(/\s+/g, '');
  const tileNum = text.match(/tile\s*(\d+)/i);
  if (!tileNum) return null;
  const t = placed.find((x) => x.tileId === Number(tileNum[1]));
  if (!t) return null;
  const rest = text.replace(/tile\s*\d+/i, ' ').toUpperCase();
  if (/\bCENT(RE|ER)\b|\bC\b/.test(rest)) return t.center.key;
  const ln = rest.match(/\b(NE|NW|SE|SW|N|S)\b/);
  if (!ln) return null;
  return localHexAbsolute(t.center.key, t.rotation, ln[1] as Exclude<HexName, 'C'>);
}

/** Accept a tile slot as its centre key or as "side NE–SE of Tile 4" (any
 *  dash, "to", or order of the two hex names). Returns the slot centre key. */
export function resolveSlotRef(placed: PlacedRef[], ref: unknown): string | null {
  if (typeof ref !== 'string') return null;
  const text = ref.trim();
  if (isUnitHexKey(text.replace(/\s+/g, ''))) return text.replace(/\s+/g, '');
  const tileNum = text.match(/tile\s*(\d+)/i);
  if (!tileNum) return null;
  const t = placed.find((x) => x.tileId === Number(tileNum[1]));
  if (!t) return null;
  const names = text.replace(/tile\s*\d+/i, ' ').toUpperCase().match(/\b(NE|NW|SE|SW|N|S)\b/g);
  if (!names || names.length !== 2) return null;
  const want = [...names].sort().join('-');
  for (let s = 0; s < 6; s++) {
    const label = sideLabelOf(t.center.key, t.rotation, s).replace('side ', '').split('–').sort().join('-');
    if (label === want) return tileCenter(t.center.key, s);
  }
  return null;
}
