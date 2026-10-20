// How a sentence a person reads names a seat and a tile: the seat's printed
// faction name and the tile's printed label, never a player id or a "c,r"
// coord. Shared by the views, the gates' shut reasons and the move
// descriptions a screen prints.

import { FACTIONS } from './data/catalogs.js';
import { tileLabel } from './data/maps.js';
import type { Coord, NGGState } from './types.js';

/** The printed tile label ("D4") for an engine coord ("-1,7"). */
export function tileName(coord: Coord): string {
  const [c, r] = coord.split(',').map((v) => parseInt(v, 10));
  return tileLabel(c!, r!);
}

/** A seat's printed faction name, falling back to its player id before one is chosen. */
export function seatName(state: NGGState, playerId: string): string {
  const p = state.players.find((x) => x.playerId === playerId);
  return FACTIONS.find((f) => f.id === p?.factionId)?.name ?? playerId;
}

/** The name a sentence uses for a seat: the name the player gave at the
 *  table, else the seat's faction, else its player id. */
export function spokenSeatName(state: NGGState, players: ReadonlyArray<{ player_id: string; name?: string }>, playerId: string): string {
  const given = players.find((p) => p.player_id === playerId)?.name?.trim();
  return given || seatName(state, playerId);
}

/** Rewrite engine text for people: player ids become seat names and "c,r"
 *  grid pairs become printed tile labels. The stored log keeps ids and pairs
 *  (the AI and the views read them); only what is shown is rewritten. A
 *  one-letter player id is left alone — it would match ordinary words. */
export function readableText(state: NGGState, players: ReadonlyArray<{ player_id: string; name?: string }>, text: string): string {
  const tiles = new Set(state.tiles.map((t) => `${t.c},${t.r}`));
  let out = text.replace(/(?<![\w.,-])(-?\d+),(-?\d+)(?![\w,])/g, (m, c: string, r: string) => (tiles.has(`${c},${r}`) ? tileName(`${c},${r}`) : m));
  const ids = state.players.map((p) => p.playerId).filter((id) => id.length > 1).sort((a, b) => b.length - a.length);
  for (const id of ids) {
    const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`(?<![\\w-])${esc}(?![\\w-])`, 'g'), spokenSeatName(state, players, id));
  }
  return out;
}
