// Adventurer Olympics: reading the engine's view (zekel src/games/adventurer-olympics/views.ts).
// Shared by the plan (index.ts) and the game-drawn screen (AoScreen.tsx). Every number comes
// from the view or the reference data in it; nothing here works out a rule. Hex keys are the
// engine's axial "q,r"; the map primitive draws flat-topped axial hexes, so each key is
// redrawn at (q + r, -q): a change of drawing axes, not a rule.

import type { CardData, MapNode } from '@zekel/primitives';
import type { GlueInput, LegalMove } from '@zekel/glue-kit';
import { asArr, asNum, asStr, isObj } from '@zekel/glue-kit';
import { iconUrl } from './icons.js';

export const GAME = 'adventurer-olympics';

// ---- the look (docs/design/adventurer-olympics/README.md, "The look") -------

export const PLAYER_COLOUR: Record<string, string> = { red: '#e8483d', blue: '#3d8bfd', yellow: '#ffc83d', purple: '#9b5de5' };
export const LAND = ['#c8e6a0', '#bfe39a', '#d2eaa8', '#c3e0a4', '#cfe6b0', '#d8e8a0', '#c6e3ac', '#bddf9c', '#d0e4a4', '#c9e8b0'];
export const PALETTE: Record<string, string> = {
  ...PLAYER_COLOUR,
  ...Object.fromEntries(LAND.map((c, i) => [`land${i + 1}`, c])),
  companion: '#5aa9e6', little: '#8fd14f', big: '#ff7a59', dungeon: '#9d8fc2', rune: '#6b5f93',
  tile: '#f3e6c8', quest: '#ffd95e', parchment: '#fbf3e0',
};

/** The four adventurers (the standees); any can take any colour. */
export const ADVENTURERS = ['Fighter', 'Ranger', 'Wizard', 'Rogue'] as const;
export const COLOURS = ['Red', 'Blue', 'Yellow', 'Purple'] as const;

/** Each companion looks like what it gives (README, "What each card shows"). */
export const COMPANION_ART: Record<number, [string, string]> = {
  1: ['cat', 'Cat'], 2: ['imp', 'Imp'], 3: ['pseudodragon', 'Pseudodragon'], 4: ['squire', 'Squire'],
  5: ['unicorn', 'Unicorn'], 6: ['horse', 'Horse'], 7: ['goat', 'Goat'], 8: ['pegasus', 'Pegasus'],
  9: ['fairy', 'Fairy'], 10: ['broom', 'Magic Broom'], 11: ['owl', 'Owl'], 12: ['parrot', 'Parrot'],
  13: ['orc', 'Orc'], 14: ['wolf', 'Wolf'], 15: ['golem', 'Stone Golem'], 16: ['bard', 'Bard'],
};
/** One creature per monster number. */
export const MONSTER_ART: Record<number, [string, string]> = {
  2: ['slime', 'Slime'], 3: ['goblin', 'Goblin'], 4: ['skeleton', 'Skeleton'],
  5: ['ogre', 'Ogre'], 6: ['spider', 'Giant Spider'], 7: ['dragon', 'Dragon'],
};
/** The engine's icon kinds, as the canvas draws and names them. */
export const ICON: Record<string, { art: string; name: string }> = {
  city: { art: 'city', name: 'City' },
  dungeon: { art: 'dungeon', name: 'Dungeon' },
  little_monster: { art: 'little', name: 'Little Monster' },
  big_monster: { art: 'big', name: 'Big Monster' },
  hearts: { art: 'hearts', name: 'Heart rune' },
  spades: { art: 'spades', name: 'Spade rune' },
  diamonds: { art: 'diamonds', name: 'Diamond rune' },
  clubs: { art: 'clubs', name: 'Club rune' },
  star: { art: 'star', name: 'Star rune' },
};
export const DUNGEON_CARD: Record<string, string> = {
  little_monster: 'Little Monster', big_monster: 'Big Monster', double_little_monsters: '2 Little Monsters',
  companion: 'Companion', any_artifact: 'Any rune', map: 'Map',
};
export const DECKS = [
  { key: 'companion', label: 'Companions', art: 'cha' },
  { key: 'dungeon', label: 'Dungeon', art: 'dungeon' },
  { key: 'little', label: 'Little Monsters', art: 'little' },
  { key: 'big', label: 'Big Monsters', art: 'big' },
] as const;

// ---- reading the view -------------------------------------------------------

export interface Player {
  id: string; name: string; standee: string; colour: string; hex: string; stepsLeft: number; initiative: number;
  companions: string[]; little: string[]; big: string[]; artifacts: string[]; questPoints: number;
  claimedQuests: string[]; exploredTiles: number[]; dungeonsCompleted: number; tokensSpent: number;
  stats: { charisma: number; strength: number; movement: number } | null;
  /** Coins of this colour not yet on the map, when the engine gives it. */
  tokensLeft: number | null;
}

/** A seat's name; an AI seat the engine names only by its seat id is called by its colour. */
export function nameOrColour(p: Record<string, unknown>): string {
  const id = asStr(p['player_id']), name = asStr(p['name']), colour = asStr(p['colour']);
  return name && name !== id ? name : colour || id;
}

export function players(view: Record<string, unknown>): Player[] {
  return asArr(view['players']).filter(isObj).map((p) => {
    const st = isObj(p['stats']) ? p['stats'] : null;
    return {
      // An AI seat has no name of its own; the table calls it by its colour.
      id: asStr(p['player_id']), name: nameOrColour(p), standee: asStr(p['standee']), colour: asStr(p['colour']),
      hex: asStr(p['hex']), stepsLeft: asNum(p['stepsLeft']), initiative: asNum(p['initiative']),
      companions: asArr(p['companions']).map((x) => asStr(x)), little: asArr(p['littleMonsters']).map((x) => asStr(x)),
      big: asArr(p['bigMonsters']).map((x) => asStr(x)), artifacts: asArr(p['artifacts']).map((x) => asStr(x)),
      questPoints: asNum(p['questPoints']), claimedQuests: asArr(p['claimedQuests']).map((x) => asStr(x)),
      exploredTiles: asArr(p['exploredTiles']).map((x) => asNum(x)), dungeonsCompleted: asNum(p['dungeonsCompleted']),
      tokensSpent: asNum(p['tokensSpent']),
      stats: st ? { charisma: asNum(st['charisma']), strength: asNum(st['strength']), movement: asNum(st['movement']) } : null,
      tokensLeft: typeof p['tokensLeft'] === 'number' ? p['tokensLeft'] : null,
    };
  });
}

export const colourKey = (colour: string) => (colour.toLowerCase() in PLAYER_COLOUR ? colour.toLowerCase() : 'parchment');
export const tint = (colour: string) => PLAYER_COLOUR[colour.toLowerCase()] ?? '#2b2233';

/** The figure a seat stands as: its chosen adventurer, or for a seat whose
 *  standee is unnamed (an AI's "Standee 2"), the first adventurer nobody
 *  took, in seat order. Only the picture; the engine keeps the name. */
export function adventurerOf(all: Player[], id: string): string {
  const named = new Set(all.map((p) => ADVENTURERS.find((a) => a.toLowerCase() === p.standee.toLowerCase())).filter(Boolean));
  const free = ADVENTURERS.filter((a) => !named.has(a));
  let k = 0;
  for (const p of all) {
    const own = ADVENTURERS.find((a) => a.toLowerCase() === p.standee.toLowerCase());
    const pick = own ?? free[k++ % Math.max(1, free.length)] ?? 'Fighter';
    if (p.id === id) return pick;
  }
  return 'Fighter';
}

export interface RefCard { id: string; number: number; bonus: Record<string, number> }
export function refCards(view: Record<string, unknown>, key: string): RefCard[] {
  const rd = isObj(view['referenceData']) ? view['referenceData'] : {};
  return asArr(rd[key]).filter(isObj).map((c) => ({
    id: asStr(c['id']), number: asNum(c['number']),
    bonus: isObj(c['bonus']) ? Object.fromEntries(Object.entries(c['bonus']).map(([k, v]) => [k, asNum(v)])) : {},
  }));
}
export function questNames(view: Record<string, unknown>): Record<string, { name: string; endGame: boolean }> {
  const rd = isObj(view['referenceData']) ? view['referenceData'] : {};
  return Object.fromEntries(asArr(rd['quests']).filter(isObj).map((q) => [asStr(q['kind']), { name: asStr(q['name']), endGame: q['endGame'] === true }]));
}

export const STAT_WORD: Record<string, string> = { strength: 'Strength', charisma: 'Charisma', movement: 'Movement' };
export function bonusText(bonus: Record<string, number>): string {
  return Object.entries(bonus).filter(([, v]) => v).map(([k, v]) => `+${v} ${STAT_WORD[k] ?? k}`).join(', ');
}

export function cardFor(view: Record<string, unknown>, cardId: string): CardData {
  const comp = refCards(view, 'companions').find((c) => c.id === cardId);
  if (comp) {
    const n = Number(cardId.replace(/\D+/g, ''));
    const [art, name] = COMPANION_ART[n] ?? ['cat', cardId];
    return { id: `ao:card:${cardId}`, label: name, subtitle: bonusText(comp.bonus), cost: comp.number, artUrl: iconUrl(art, { wobble: false }), colorKey: 'companion' };
  }
  for (const [key, deck, word] of [['littleMonsters', 'little', 'Little Monster'], ['bigMonsters', 'big', 'Big Monster']] as const) {
    const m = refCards(view, key).find((c) => c.id === cardId);
    if (m) {
      const [art, name] = MONSTER_ART[m.number] ?? ['goblin', cardId];
      return { id: `ao:card:${cardId}`, label: name, subtitle: word, cost: m.number, artUrl: iconUrl(art, { wobble: false }), colorKey: deck };
    }
  }
  return { id: `ao:card:${cardId}`, label: cardId };
}

export function runeCard(a: string, holder?: string): CardData {
  const icon = ICON[a];
  return { id: `ao:rune:${a}`, label: icon?.name ?? a, subtitle: holder, artUrl: iconUrl(icon?.art ?? a, { wobble: false }), colorKey: 'rune' };
}

/** Engine key "q,r" to the map primitive's flat-topped axial coordinate. */
export function hexOf(key: string): { q: number; r: number } | null {
  const m = /^(-?\d+),(-?\d+)$/.exec(key);
  if (!m) return null;
  const q = Number(m[1]), r = Number(m[2]);
  return { q: q + r, r: -q };
}

export function pendingOf(view: Record<string, unknown>): { kind: string; seat: string; payload: Record<string, unknown> } | null {
  const p = view['pending'];
  if (!isObj(p)) return null;
  return { kind: asStr(p['kind']), seat: asStr(p['seat']), payload: isObj(p['payload']) ? p['payload'] : {} };
}

// ---- moves -----------------------------------------------------------------

export const typeOf = (m: LegalMove) => asStr(m.move['type']);
export const find = (input: GlueInput, pred: (m: LegalMove) => boolean) => input.legalMoves.find(pred) ?? null;

/** The hex a step or walk-away move goes to. */
export function targetOf(m: LegalMove): string | null {
  if (typeOf(m) === 'step') return asStr(m.move['to']) || null;
  if (typeOf(m) === 'move_away') {
    const path = asArr(m.move['path']);
    return path.length === 1 ? asStr(path[0]) || null : null;
  }
  return null;
}

export interface PlacementSlot {
  slot: string; label: string; hexes: string[];
  rotations: Array<{ rotation: number; label: string; icons: Array<{ hex: string; kind: string }>; move: Record<string, unknown> }>;
}
export function placementOf(view: Record<string, unknown>): { tileId: number; context: string; slots: PlacementSlot[] } | null {
  const po = view['placementOptions'];
  if (!isObj(po)) return null;
  return {
    tileId: asNum(po['tileId']), context: asStr(po['context']),
    slots: asArr(po['slots']).filter(isObj).map((s) => ({
      slot: asStr(s['slot']), label: asStr(s['label']), hexes: asArr(s['hexes']).map((h) => asStr(h)),
      rotations: asArr(s['rotations']).filter(isObj).map((r) => ({
        rotation: asNum(r['rotation']), label: asStr(r['label']),
        icons: asArr(r['icons']).filter(isObj).map((i) => ({ hex: asStr(i['hex']), kind: asStr(i['kind']) })),
        move: isObj(r['move']) ? r['move'] : {},
      })),
    })),
  };
}

/** The slot and turn being put together, if any (GlueInput.ui). */
export function composing(input: GlueInput): { slot: string; rotation: number } | null {
  const ui = input.ui ?? {};
  const slot = asStr(ui['slot']);
  return slot ? { slot, rotation: ((asNum(ui['rotation']) % 6) + 6) % 6 } : null;
}

/** The listed move for a slot and turn, when the engine lists it. */
export function placeMove(input: GlueInput, slot: string, rotation: number): LegalMove | null {
  return find(input, (m) => typeOf(m) === 'explore' && asStr(m.move['slot']) === slot && asNum(m.move['rotation'], -1) === rotation);
}

// ---- the map ---------------------------------------------------------------

/** A tuft of grass, the canvas's (Main.dc.html) path drawn in its own box. */
const TUFT = `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 9"><path d="M2 8l2-5 2 5 2-6 2 6" fill="none" stroke="#6fa845" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>')}`;

export function mapNodes(view: Record<string, unknown>, input: GlueInput, all: Player[]): MapNode[] {
  const map = isObj(view['map']) ? view['map'] : {};
  const tiles = asArr(map['tiles']).filter(isObj);
  const icons = asArr(map['icons']).filter(isObj);
  const tileOfHex = new Map<string, number>();
  for (const t of tiles) {
    const hexes = asArr(t['hexes']).map((h) => asStr(h));
    for (const h of hexes.length ? hexes : [asStr(t['center'])]) tileOfHex.set(h, asNum(t['tileId']));
  }
  const iconAt = new Map(icons.map((i) => [asStr(i['key']), i] as const));
  const colourOf = new Map(all.map((p) => [p.id, p.colour] as const));
  const nameOf = new Map(all.map((p) => [p.id, p.name] as const));
  const explored = new Map(tiles.filter((t) => t['exploredBy']).map((t) => [asStr(t['center']), asStr(t['exploredBy'])] as const));
  const newest = tiles.length > 0 ? asStr(tiles[tiles.length - 1]!['center']) : '';
  const prevTiles = isObj(input.previous) && isObj(input.previous['map']) ? asArr(input.previous['map']['tiles']).length : tiles.length;

  const nodes: MapNode[] = [];
  for (const key of asArr(map['hexes']).map((h) => asStr(h))) {
    const hex = hexOf(key);
    if (!hex) continue;
    const icon = iconAt.get(key);
    const tileId = tileOfHex.get(key) ?? 0;
    const pieces: NonNullable<MapNode['pieces']> = [];
    const done = icon && icon['completed'] === true;
    const by = done ? asStr(icon['completedBy']) : explored.get(key) ?? '';
    if (by) pieces.push({ label: `coin:${key}`, kind: 'token', size: 0.45, artUrl: iconUrl('coin', { tint: tint(colourOf.get(by) ?? ''), wobble: false }) });
    for (const p of all.filter((pl) => pl.hex === key)) {
      pieces.push({ label: `standee:${p.id}`, artUrl: iconUrl(adventurerOf(all, p.id).toLowerCase(), { tint: tint(p.colour), wobble: false }) });
    }
    // The canvas's grass: a tuft on about one plain hex in four, always the same ones.
    if (!icon && !by && ((hex.q * 7 + hex.r * 3) % 4 + 4) % 4 === 0) pieces.push({ label: `tuft:${key}`, kind: 'token', size: 0.3, artUrl: TUFT });
    const kind = icon ? asStr(icon['kind']) : '';
    const name = ICON[kind]?.name ?? '';
    const where = icon ? asStr(icon['hexLabel']) : '';
    nodes.push({
      id: `ao:hex:${key}`,
      label: name ? `${name}${done ? `, done by ${nameOf.get(by) ?? by}` : ''}` : 'Empty hex',
      describedAs: [name || 'Empty hex', where, done ? `done by ${nameOf.get(by) ?? by}` : ''].filter(Boolean).join(', '),
      x: 0, y: 0, hex,
      colorKey: tileId ? `land${tileId}` : 'land1',
      artUrl: icon ? iconUrl(ICON[kind]?.art ?? kind, { wobble: false }) : undefined,
      dim: !!done,
      pieces,
      // A tile placed by the event on screen flies in from the stack.
      arriveFrom: tiles.length > prevTiles && tileOfHex.get(key) === tileOfHex.get(newest) ? 'ao:deck:tile' : undefined,
    });
  }

  // While a revealed tile waits: every slot it may go in, as ghost hexes; the
  // slot being turned shows the tile's icons where this turn puts them.
  const place = pendingOf(view)?.kind === 'explore_place' && pendingOf(view)?.seat === input.playerId ? placementOf(view) : null;
  if (place) {
    const pick = composing(input);
    const taken = new Set(nodes.map((n) => n.id));
    for (const s of place.slots) {
      const chosen = pick?.slot === s.slot;
      const turn = chosen ? s.rotations.find((r) => r.rotation === pick!.rotation) : undefined;
      for (const key of s.hexes) {
        const hex = hexOf(key);
        const id = `ao:slot:${s.slot}:${key}`;
        if (!hex || taken.has(id)) continue;
        const icon = turn?.icons.find((i) => i.hex === key);
        nodes.push({
          id, label: `Place Tile ${place.tileId} against ${s.label}`, x: 0, y: 0, hex,
          ghost: true, selected: chosen, colorKey: `land${place.tileId}`,
          artUrl: icon ? iconUrl(ICON[icon.kind]?.art ?? icon.kind, { wobble: false }) : undefined,
        });
      }
    }
  }
  return nodes;
}

/** Lit parts for the current legal moves: each hex a step or a walk-away
 *  goes to, and, while a tile waits, every hex of every slot. */
export function litFor(input: GlueInput): string[] {
  const lit: string[] = [];
  for (const m of input.legalMoves) {
    const to = targetOf(m);
    if (to) lit.push(`ao:hex:${to}`);
  }
  const view = isObj(input.view) ? input.view : null;
  const place = view && pendingOf(view)?.kind === 'explore_place' ? placementOf(view) : null;
  if (place) for (const s of place.slots) for (const h of s.hexes) lit.push(`ao:slot:${s.slot}:${h}`);
  return [...new Set(lit)];
}

/** Every listed move a tap on a hex could mean (a step or a walk-away to it). */
export function movesForHex(id: string, input: GlueInput): LegalMove[] {
  const hex = /^ao:hex:(-?\d+,-?\d+)$/.exec(id);
  return hex ? input.legalMoves.filter((m) => targetOf(m) === hex[1]) : [];
}

/** The slot a tap on a slot's ghost hex picks, when that slot is offered. */
export function slotForTap(id: string, view: Record<string, unknown>): string | null {
  const m = /^ao:slot:(.+):(-?\d+,-?\d+)$/.exec(id);
  if (!m) return null;
  return placementOf(view)?.slots.some((s) => s.slot === m[1]) ? m[1]! : null;
}

