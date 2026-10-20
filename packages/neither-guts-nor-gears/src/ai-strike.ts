// Neither Guts nor Gears — could these pieces kill that Leader?
//
// Asked of the engine, not of a list of combos. The attacker's pieces are
// set down beside the Leader's tile in a copy of the game, a battle is
// started there with the engine's own startBattle, and it is played out with
// the hard AI's battle choices for every side, one engine move at a time.
// The answer is whether the Leader is dead when it ends. Every source of
// damage the rules have — a hero's bonus (Rook, Kestrel, Warden), a Leader's
// own, Enhance, Dehance, Self Destruct, Fiery Explosion, area attacks — and
// every defence (a Cleric, a Wall, Mana Shield) counts because the engine
// resolves it, with no second copy of those rules here. Designer's note
// (2026-09-30): "It should just be calculating potential damage."
//
// What the reader may not see stays out: every hand is emptied (battle cards
// are hidden) and every spy assignment is cleared (spy reveals are read by
// ai-military's spy line). Mana is topped up to the seat's maximum: the
// question is what the pieces could do, and mana refills each upkeep.

import type { Coord, HeroInstance, MapUnit, NGGMove, NGGState } from './types.js';
import { applyMoveInPlace, byId, isCombatUnit } from './engine.js';
import { runPretendBattle, startBattle } from './engine-battle.js';
import { getLegalMoves } from './legalMoves.js';
import { neighborsOf, coordKey } from './data/maps.js';
import { unitById } from './resolvers.js';
import {
  activationScore, commitScore, counterScore, defenseScore, extraScore, rallyScore, retreatScore,
} from './ai-battle.js';

/** A piece the attacker would bring: one already on the board (by id), or one
 *  it could still get (a hero claimed from the pool, a unit bought). */
export type StrikePiece =
  | { kind: 'hero' | 'unit'; id: string }
  | { kind: 'new-hero'; heroId: string }
  | { kind: 'new-unit'; typeId: string };

const CACHE = new Map<string, boolean>();
const CACHE_CAP = 250_000; // a 4-player game fights out about 50,000 (2026-10-08); a clear throws them all away
const STEP_CAP = 400;

/** Everything a strike's outcome depends on, and nothing that only moves a
 *  piece: the attacker's pieces and what they know, the target tile's
 *  defenders and what their owners know. */
export function cacheKey(state: NGGState, attackerId: string, at: Coord, force: StrikePiece[]): string {
  const seat = (pid: string) => {
    const p = byId(state, pid);
    return `${pid}:${[...p.research].sort().join('/')}:${p.manaMax}`;
  };
  // Units by type (two Spinners are the same threat whichever is which);
  // heroes by id (each hero is its own).
  const forceKey = force.map((f) => {
    if (f.kind === 'unit') { const u = state.units.find((x) => x.id === f.id); return `u:${u?.typeId}`; }
    if (f.kind === 'hero') return `h:${f.id}`;
    if (f.kind === 'new-hero') return `h:${f.heroId}`;
    return f.kind === 'new-unit' ? `u:${f.typeId}` : '';
  }).sort().join(',');
  const here = [
    ...state.units.filter((u) => u.coord === at).map((u) => `${u.ownerId}:${u.typeId}:${u.allocatedCoreId ? 1 : 0}`),
    ...state.heroes.filter((h) => h.coord === at && !h.dead).map((h) => `${h.ownerId}:${h.id}${h.isLeader ? '*' : ''}`),
    ...state.bases.filter((b) => b.coord === at).map((b) => `base:${b.ownerId}`),
  ].sort().join(',');
  const owners = [...new Set([attackerId, ...state.units.filter((u) => u.coord === at).map((u) => u.ownerId), ...state.heroes.filter((h) => h.coord === at).map((h) => h.ownerId)])];
  return `${attackerId}|${at}|${forceKey}|${here}|${owners.map(seat).join(';')}|${state.treaties.map((t) => `${t.type}:${t.partners.join('+')}`).join(',')}`;
}

/** The pieces of `pid` that could walk into a battle: heroes and mobile
 *  combat units (an immobile platform only defends where it stands).
 *  `withoutLeader`: leave the seat's own Leader home — how a seat plans ITS
 *  attack, since its defence never walks the Leader off its base (2026-10-08:
 *  with the Leader counted, the whole-force strike was paced by a piece that
 *  never moved, so the read promised a kill in three rounds every round and
 *  moving the other pieces forward gained nothing). */
export function strikeForce(state: NGGState, pid: string, withoutLeader = false): Array<{ kind: 'hero' | 'unit'; id: string; coord: Coord }> {
  const out: Array<{ kind: 'hero' | 'unit'; id: string; coord: Coord }> = [];
  for (const h of state.heroes) if (h.ownerId === pid && !h.dead && h.coord && !(withoutLeader && h.isLeader)) out.push({ kind: 'hero', id: h.id, coord: h.coord });
  for (const u of state.units) {
    if (u.ownerId !== pid || !isCombatUnit(u) || unitById(u.typeId)?.immobile) continue;
    out.push({ kind: 'unit', id: u.id, coord: u.coord });
  }
  return out;
}

function pick(state: NGGState, pid: string, moves: NGGMove[]): NGGMove {
  const p = byId(state, pid);
  let best = moves[0]!; let bestScore = -Infinity;
  for (const m of moves) {
    let s: number;
    switch (m.type) {
      case 'battle_activation': s = activationScore(state, p, m); break;
      case 'commit_battle_card': s = commitScore(state, p, m); break;
      case 'resolve_battle_defense': s = defenseScore(state, p, m); break;
      case 'choose_retreat': s = retreatScore(state, p, m); break;
      case 'select_extra_cards': s = extraScore(state, p, m); break;
      case 'choose_counter_target': s = counterScore(state, p, m); break;
      case 'select_rally_units': s = rallyScore(state, p, m); break;
      case 'choose_initiative_order': {
        const u = state.battle?.units.find((x) => x.unitRef === m.unit);
        s = u ? u.dmg : 0; break;
      }
      default: s = 0;
    }
    if (s > bestScore) { bestScore = s; best = m; }
  }
  return best;
}

/** Would `force` of `attackerId`, walking onto the tile where `targetOwner`'s
 *  Leader stands, kill that Leader in the battle that follows? */
export function strikeKills(state: NGGState, attackerId: string, targetOwner: string, force: StrikePiece[]): boolean {
  const leader = state.heroes.find((h) => h.ownerId === targetOwner && h.isLeader && !h.dead && h.coord);
  if (!leader?.coord || force.length === 0) return false;
  const at = leader.coord;
  const key = cacheKey(state, attackerId, at, force);
  const hit = CACHE.get(key);
  if (hit !== undefined) return hit;
  const result = simulate(state, attackerId, targetOwner, at, force);
  if (CACHE.size >= CACHE_CAP) CACHE.clear();
  CACHE.set(key, result);
  return result;
}

/** A private copy with only what a battle at `at` can touch: the pieces
 *  there and the ones walking in, the collectors there (an area attack
 *  destroys them), every hero (Leader deaths decide games) and base. */
function pruned(state: NGGState, at: Coord, force: StrikePiece[]): NGGState {
  const walking = new Set(force.flatMap((f) => ('id' in f ? [f.id] : [])));
  return structuredClone({
    ...state,
    log: [],
    units: state.units.filter((u) => u.coord === at || walking.has(u.id)),
    placements: state.placements.filter((c) => c.coord === at),
  }) as NGGState;
}

function simulate(state: NGGState, attackerId: string, targetOwner: string, at: Coord, force: StrikePiece[]): boolean {
  const s = pruned(state, at, force);
  s.result = null; s.pending = null; s.battle = null; s.actionStack = []; s.activeAction = null;
  for (const p of s.players) {
    p.hand = [];
    p.spyAssignments = [];
    if (p.species === 'wizard') p.manaCurrent = Math.max(p.manaCurrent, p.manaMax);
  }
  const [x, y] = at.split(',').map(Number);
  const origin = neighborsOf(s.tiles, x!, y!).map((t) => coordKey(t.c, t.r))[0];
  if (!origin) return false;
  const attackers: Array<{ kind: 'unit' | 'hero'; id: string }> = [];
  let n = 0;
  for (const f of force) {
    if (f.kind === 'hero' || f.kind === 'unit') {
      const piece = f.kind === 'hero' ? s.heroes.find((h) => h.id === f.id) : s.units.find((u) => u.id === f.id);
      if (!piece) continue;
      piece.coord = origin;
      attackers.push({ kind: f.kind, id: f.id });
    } else if (f.kind === 'new-hero') {
      s.heroPool = s.heroPool.filter((h) => h !== f.heroId);
      const h: HeroInstance = { id: f.heroId, ownerId: attackerId, coord: origin, isLeader: false, dead: false };
      s.heroes.push(h);
      attackers.push({ kind: 'hero', id: f.heroId });
    } else if (f.kind === 'new-unit') {
      const def = unitById(f.typeId);
      if (!def) continue;
      const u: MapUnit = { id: `u-${f.typeId}-${attackerId}-strike${n++}`, typeId: f.typeId, ownerId: attackerId, coord: origin, allocatedCoreId: def.needsCore ? `strike-core-${n}` : null };
      s.units.push(u);
      attackers.push({ kind: 'unit', id: u.id });
    }
  }
  if (attackers.length === 0) return false;
  try {
    startBattle(s, byId(s, attackerId), origin, at, attackers, [targetOwner]);
  } catch {
    return false;
  }
  return playOut(s, targetOwner);
}

/** Play a battle already under way to its end with the hard AI's battle
 *  choices; true if `targetOwner`'s Leader is dead at the end. */
function playOut(start: NGGState, targetOwner: string): boolean {
  return runPretendBattle(() => playOutInner(start, targetOwner));
}

function playOutInner(start: NGGState, targetOwner: string): boolean {
  const g = start;
  try {
    for (let i = 0; i < STEP_CAP; i++) {
      const leader = g.heroes.find((h) => h.ownerId === targetOwner && h.isLeader);
      if (!leader || leader.dead) return true;
      if (!g.battle) return false;
      const pid = g.pending?.forPlayerId ?? g.activePlayerId;
      const legal = getLegalMoves(g, pid).map((l) => l.move);
      if (legal.length === 0) return false;
      applyMoveInPlace(g, pid, pick(g, pid, legal));
    }
  } catch {
    return false;
  }
  return g.heroes.some((h) => h.ownerId === targetOwner && h.isLeader && h.dead);
}

/** For an attack the AI is weighing: `after` is the position its move
 *  leads to, with the battle just started. Played out with the attacker's
 *  own hand (it knows its cards) and nobody else's; spy reveals are left to
 *  the caller's spy read. */
export function attackKillsLeader(after: NGGState, attackerId: string, targetOwner: string): boolean {
  const s = structuredClone({ ...after, log: [] }) as NGGState;
  for (const p of s.players) {
    if (p.playerId !== attackerId) p.hand = [];
    p.spyAssignments = [];
  }
  return playOut(s, targetOwner);
}
