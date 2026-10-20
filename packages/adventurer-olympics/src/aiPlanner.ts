// Adventurer Olympics — the AI's evaluation and planning (AI-NOTES.md §2, §4).
//
// ONE "who is ahead" number, used everywhere: `outlook` = quest points already
// claimed + partial credit for open quests (progress toward the instant quests,
// the current lead in the end-of-game quests). The heuristic tiers rank their
// options by how much an option raises it; the MCTS leaf value, the public
// scoreboard (`getScoreboard`) and the balance harness's `leaderScalar` read
// the same function.
//
// The planner only uses what a player at the table knows: the map, everyone's
// kept cards and stats, the deck CONTENTS (every card nobody holds) — never the
// order of a deck or the top card.

import type { AOState, IconHex } from './types.js';
import {
  BIG_MONSTER_CARDS, COMPANION_CARDS, DUNGEON_COMPOSITION, LITTLE_MONSTER_CARDS, TILES,
  type DungeonCardKind, type StatKey,
} from './data.js';
import {
  anyArtifactOptions, effectiveStat, neighbors, exploreHexes, allEmptySlots, explorableSlots,
} from './engine.js';
import { iconHexesForTile, keyToHex, hexDistance } from './hexMap.js';

// ---------------------------------------------------------------------------
// Strategy archetypes (§4): one per path to quest points, keyed on EFFECT.
// ---------------------------------------------------------------------------
export type Archetype = 'adaptive' | 'explorer' | 'delver' | 'recruiter' | 'hunter' | 'collector';

const ALIASES: Record<string, Archetype> = {
  explorer: 'explorer', explore: 'explorer', tiles: 'explorer', map: 'explorer',
  delver: 'delver', dungeon: 'delver', dungeons: 'delver',
  recruiter: 'recruiter', recruit: 'recruiter', companions: 'recruiter', city: 'recruiter',
  hunter: 'hunter', monsters: 'hunter', fighter: 'hunter', monster: 'hunter',
  collector: 'collector', artifacts: 'collector', artifact: 'collector',
  adaptive: 'adaptive',
};

/** Free-form strategy name → archetype; undefined/unknown ⇒ adaptive. */
export function parseStrategy(s?: string): Archetype {
  if (!s) return 'adaptive';
  return ALIASES[s.trim().toLowerCase()] ?? 'adaptive';
}

/** The lever: extra value per unit of the archetype's own effect, added only
 *  when the AI DECIDES (never to the scoreboard). A companion from a Dungeon
 *  counts for the recruiter, a monster from a Dungeon for the hunter. */
const LEAN = 0.35;
// Planner constants. Swept 2026-09-29 against medium (2,000 games per
// setting, AI-NOTES.md §1): every nearby value landed within 54–56%, so these
// are the plain defaults, not a tuned peak.
const DISCOUNT_PER_TURN = 0.7;  // a target one more turn away is worth 70%
const RIVAL_WEIGHT = 0.5;       // hard: how much the best rival's gain costs me
const NEW_TILE_VALUE = 0.08;    // exploring: the fresh icons a new tile brings
function strategyBias(p: Profile, a: Archetype): number {
  switch (a) {
    case 'explorer': return LEAN * p.explored;
    case 'delver': return LEAN * p.dungeons;
    case 'recruiter': return LEAN * p.companions + 0.1 * (p.cha - 1);
    case 'hunter': return LEAN * (p.little + p.big) + 0.1 * (p.str - 1);
    case 'collector': return LEAN * p.artifacts;
    default: return 0;
  }
}

// ---------------------------------------------------------------------------
// Profiles and the outlook (the one evaluation function, §2)
// ---------------------------------------------------------------------------
export interface Profile {
  qp: number; explored: number; dungeons: number; companions: number;
  little: number; big: number; artifacts: number; cha: number; str: number; mov: number;
}

export function profilesOf(state: AOState): Record<string, Profile> {
  const out: Record<string, Profile> = {};
  for (const pid of state.playerOrder) {
    const p = state.players[pid]!;
    out[pid] = {
      qp: p.questPoints, explored: p.exploredTileIds.length, dungeons: p.dungeonsCompleted,
      companions: p.companions.length, little: p.littleMonsters.length, big: p.bigMonsters.length,
      artifacts: p.artifacts.length,
      cha: effectiveStat(state, pid, 'charisma'), str: effectiveStat(state, pid, 'strength'), mov: effectiveStat(state, pid, 'movement'),
    };
  }
  return out;
}

const INSTANT: Array<[string, keyof Profile, number]> = [
  ['explore_3_tiles', 'explored', 3],
];
const END: Array<[string, keyof Profile]> = [
  ['most_little_monsters', 'little'], ['most_big_monsters', 'big'], ['most_artifacts', 'artifacts'],
  ['most_dungeons', 'dungeons'], ['most_companions', 'companions'],
];

/** Expected quest points for `me` from profiles + which quests are open. */
export function outlookOf(profiles: Record<string, Profile>, quests: Record<string, string>, me: string): number {
  const mine = profiles[me]!;
  const rivals = Object.keys(profiles).filter((p) => p !== me).map((p) => profiles[p]!);
  let v = mine.qp;
  for (const [q, field, need] of INSTANT) {
    if (quests[q] !== 'unclaimed') continue;
    const frac = Math.min(1, (mine[field] as number) / need);
    const best = Math.max(0, ...rivals.map((r) => Math.min(1, (r[field] as number) / need)));
    v += frac * (frac > best ? 0.6 : frac === best ? 0.4 : 0.25);
  }
  for (const [q, field] of END) {
    if (quests[q] !== 'unclaimed') continue;
    const m = mine[field] as number;
    const best = Math.max(0, ...rivals.map((r) => r[field] as number));
    if (m > best) v += Math.min(0.95, 0.55 + 0.15 * (m - best));
    else if (m === best && m > 0) v += 0.15;
  }
  // Future capability: dice for tests, steps for reaching things.
  v += 0.05 * (mine.cha - 1 + mine.str - 1) + 0.03 * (mine.mov - 2);
  return v;
}

/** The scoreboard / leaderScalar / MCTS-leaf number for one seat. */
export function outlook(state: AOState, me: string): number {
  return outlookOf(profilesOf(state), state.inPlayQuests as Record<string, string>, me);
}

/** Decision value: my outlook against the best rival's, plus my archetype lean. */
function standing(profiles: Record<string, Profile>, quests: Record<string, string>, me: string, a: Archetype): number {
  const rivals = Object.keys(profiles).filter((p) => p !== me);
  const best = Math.max(...rivals.map((r) => outlookOf(profiles, quests, r)));
  return outlookOf(profiles, quests, me) - RIVAL_WEIGHT * best + strategyBias(profiles[me]!, a);
}

// ---------------------------------------------------------------------------
// Dice: P(k six-sided dice total ≥ n), exact.
// ---------------------------------------------------------------------------
const diceCache = new Map<string, number>();
export function pAtLeast(k: number, n: number): number {
  const key = `${k}:${n}`;
  const hit = diceCache.get(key);
  if (hit !== undefined) return hit;
  let dist = [1];
  for (let i = 0; i < k; i++) {
    const next = new Array(dist.length + 6).fill(0);
    dist.forEach((w, s) => { for (let f = 1; f <= 6; f++) next[s + f] += w / 6; });
    dist = next;
  }
  const p = dist.reduce((acc, w, s) => acc + (s >= n ? w : 0), 0);
  diceCache.set(key, p);
  return p;
}

// ---------------------------------------------------------------------------
// Option values (how much an outcome raises my standing)
// ---------------------------------------------------------------------------
export interface PlanCtx {
  state: AOState;
  me: string;
  archetype: Archetype;
  /** `hard` reads real odds and the rivals; `medium` assumes a flat 60% and
   *  looks only at its own progress. */
  careful: boolean;
  /** Values that don't depend on where an icon is (every City is worth the
   *  same to me right now) — filled lazily, one decision at a time. */
  cache?: Map<string, number>;
  profiles?: Record<string, Profile>;
}

function cached(ctx: PlanCtx, key: string, compute: () => number): number {
  if (!ctx.cache) ctx.cache = new Map();
  const hit = ctx.cache.get(key);
  if (hit !== undefined) return hit;
  const v = compute();
  ctx.cache.set(key, v);
  return v;
}

function gainOf(ctx: PlanCtx, change: (p: Profile) => void, rivalChange?: (profiles: Record<string, Profile>) => void): number {
  if (!ctx.profiles) ctx.profiles = profilesOf(ctx.state);
  const profiles = ctx.profiles;
  const quests = ctx.state.inPlayQuests as Record<string, string>;
  const before = ctx.careful
    ? standing(profiles, quests, ctx.me, ctx.archetype)
    : outlookOf(profiles, quests, ctx.me) + strategyBias(profiles[ctx.me]!, ctx.archetype);
  const after: Record<string, Profile> = {};
  for (const [k, v] of Object.entries(profiles)) after[k] = { ...v };
  change(after[ctx.me]!);
  rivalChange?.(after);
  const now = ctx.careful
    ? standing(after, quests, ctx.me, ctx.archetype)
    : outlookOf(after, quests, ctx.me) + strategyBias(after[ctx.me]!, ctx.archetype);
  return now - before;
}

function testOdds(ctx: PlanCtx, stat: StatKey, numbers: number[]): number {
  if (numbers.length === 0) return 0;
  if (!ctx.careful) return 0.6;
  const k = effectiveStat(ctx.state, ctx.me, stat);
  return numbers.reduce((a, n) => a + pAtLeast(k, n), 0) / numbers.length;
}

function companionEV(ctx: PlanCtx, extra: (p: Profile) => void = () => {}): number {
  const deck = ctx.state.decks.companion.map((id) => COMPANION_CARDS.find((c) => c.id === id)!);
  if (deck.length === 0) return 0;
  const k = effectiveStat(ctx.state, ctx.me, 'charisma');
  let total = 0;
  for (const c of deck) {
    const p = ctx.careful ? pAtLeast(k, c.number) : 0.6;
    total += p * gainOf(ctx, (me) => {
      me.companions += 1;
      me.cha += c.bonus.charisma ?? 0; me.str += c.bonus.strength ?? 0; me.mov += c.bonus.movement ?? 0;
      extra(me);
    });
  }
  return total / deck.length;
}

function monsterEV(ctx: PlanCtx, which: 'little' | 'big', extra: (p: Profile) => void = () => {}): number {
  const ids = ctx.state.decks[which];
  const list = which === 'little' ? LITTLE_MONSTER_CARDS : BIG_MONSTER_CARDS;
  const nums = ids.map((id) => list.find((c) => c.id === id)!.number);
  if (nums.length === 0) return 0;
  return testOdds(ctx, 'strength', nums) * gainOf(ctx, (me) => { me[which] += 1; extra(me); });
}

export function artifactValueFor(ctx: PlanCtx, artifact: string): number {
  return artifactEV(ctx, artifact);
}

function artifactEV(ctx: PlanCtx, artifact: string): number {
  const holder = ctx.state.playerOrder.find((pid) => ctx.state.players[pid]!.artifacts.includes(artifact as never));
  if (holder === ctx.me) return 0;
  return gainOf(ctx, (me) => { me.artifacts += 1; }, holder ? (ps) => { ps[holder]!.artifacts -= 1; } : undefined);
}

function dungeonEV(ctx: PlanCtx): number {
  const withDungeon = (me: Profile) => { me.dungeons += 1; };
  // The Dungeon deck never shrinks (cards always go back under), so its
  // contents are always the printed composition.
  const n = 24;
  let ev = 0;
  for (const [kind, c] of Object.entries(DUNGEON_COMPOSITION) as Array<[DungeonCardKind, number]>) {
    let v = 0;
    switch (kind) {
      case 'little_monster': v = monsterEV(ctx, 'little', withDungeon); break;
      case 'big_monster': v = monsterEV(ctx, 'big', withDungeon); break;
      case 'double_little_monsters': {
        const p = testOdds(ctx, 'strength', ctx.state.decks.little.map((id) => LITTLE_MONSTER_CARDS.find((x) => x.id === id)!.number));
        v = p * p * gainOf(ctx, (me) => { me.little += 2; me.dungeons += 1; }) + p * (1 - p) * gainOf(ctx, (me) => { me.little += 1; });
        break;
      }
      case 'companion': v = companionEV(ctx, withDungeon); break;
      case 'any_artifact': {
        const opts = anyArtifactOptions(ctx.state, ctx.me);
        v = opts.length ? Math.max(...opts.map((o) => artifactEV(ctx, o.artifact))) + gainOf(ctx, withDungeon) : 0;
        break;
      }
      case 'map': v = ctx.state.tileStack.length ? gainOf(ctx, (me) => { me.explored += 1; me.dungeons += 1; }) : 0; break;
    }
    ev += (c / n) * v;
  }
  return ev;
}

/** What triggering this icon is worth to me right now. */
export function iconValue(ctx: PlanCtx, icon: IconHex): number {
  return cached(ctx, `icon:${icon.kind}`, () => iconValueUncached(ctx, icon));
}

function iconValueUncached(ctx: PlanCtx, icon: IconHex): number {
  switch (icon.kind) {
    case 'city': return companionEV(ctx);
    case 'little_monster': return monsterEV(ctx, 'little');
    case 'big_monster': return monsterEV(ctx, 'big');
    case 'dungeon': return dungeonEV(ctx);
    default: return artifactEV(ctx, icon.kind);
  }
}

/** Exploring: a tile toward "Explore 3 tiles", and new icons to chase.
 *  (Holding back the last tiles when behind was tried and measured worse at
 *  every player count — AI-NOTES.md §1.) */
export function exploreValue(ctx: PlanCtx): number {
  return cached(ctx, 'explore', () => exploreValueUncached(ctx));
}

function exploreValueUncached(ctx: PlanCtx): number {
  if (ctx.state.tileStack.length === 0) return 0;
  return gainOf(ctx, (me) => { me.explored += 1; }) + NEW_TILE_VALUE;
}

// ---------------------------------------------------------------------------
// Paths and targets
// ---------------------------------------------------------------------------
interface Paths { dist: Map<string, number>; parent: Map<string, string> }

/** Shortest walks from `from`: no entering another standee; an uncompleted
 *  icon may END a walk but never be walked through. */
export function walks(state: AOState, me: string, from: string): Paths {
  const blocked = new Set(state.playerOrder.filter((p) => p !== me).map((p) => state.players[p]!.hexKey));
  const openIcon = new Set(state.iconHexes.filter((h) => !h.completed).map((h) => h.key));
  const dist = new Map<string, number>([[from, 0]]);
  const parent = new Map<string, string>();
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur !== from && openIcon.has(cur)) continue; // stop here: it triggers
    for (const n of neighbors(cur)) {
      if (state.hexes[n] !== true || blocked.has(n) || dist.has(n)) continue;
      dist.set(n, dist.get(cur)! + 1);
      parent.set(n, cur);
      queue.push(n);
    }
  }
  return { dist, parent };
}

export interface Target {
  kind: 'icon' | 'explore' | 'stay';
  hex: string;
  value: number;
  /** Steps needed (an explore needs one more step left on arrival). */
  steps: number;
  score: number;
}

function turnsNeeded(steps: number, stepsLeft: number, movement: number): number {
  if (steps <= stepsLeft) return 0;
  return 1 + Math.ceil((steps - stepsLeft) / Math.max(1, movement));
}

/** Every worthwhile destination, best first. `onIcon` = the failed icon I'm
 *  standing on at the start of my turn (try-again), if any. */
export function rankTargets(ctx: PlanCtx, onIcon: IconHex | null): Target[] {
  const { state, me } = ctx;
  const p = state.players[me]!;
  const movement = effectiveStat(state, me, 'movement');
  const { dist } = walks(state, me, p.hexKey);
  const out: Target[] = [];
  const turnsLeft = !ctx.careful ? 99 : state.endingPhase === 2 ? 0 : state.endingPhase === 1 ? 1 : 99;
  const push = (t: Omit<Target, 'score'>) => {
    const turns = turnsNeeded(t.steps, p.stepsLeft, movement);
    if (turns > turnsLeft) return;
    out.push({ ...t, score: t.value * Math.pow(DISCOUNT_PER_TURN, turns) });
  };
  if (onIcon) push({ kind: 'stay', hex: onIcon.key, value: iconValue(ctx, onIcon), steps: 0 });
  for (const icon of state.iconHexes) {
    if (icon.completed || icon.key === p.hexKey) continue;
    const d = dist.get(icon.key);
    if (d === undefined) continue;
    push({ kind: 'icon', hex: icon.key, value: iconValue(ctx, icon), steps: d });
  }
  if (state.tileStack.length > 0) {
    const ev = exploreValue(ctx);
    let best: { hex: string; d: number } | null = null;
    const fromHere = exploreHexes(state);
    const openIcons = new Set(state.iconHexes.filter((h) => !h.completed).map((h) => h.key));
    for (const [hex, d] of dist) {
      if (hex !== p.hexKey && openIcons.has(hex)) continue;
      if (!fromHere.has(hex)) continue;
      if (!best || d < best.d || (d === best.d && hex < best.hex)) best = { hex, d };
    }
    if (best) push({ kind: 'explore', hex: best.hex, value: ev, steps: best.d + 1 });
  }
  const worthwhile = out.filter((t) => t.value > 0);
  // With nothing else worth doing, explore anyway: a table where every AI
  // just stops never ends (the stall found in this gate).
  if (worthwhile.length === 0) {
    const explore = out.find((t) => t.kind === 'explore');
    if (explore) return [{ ...explore, value: 0.01, score: 0.01 }];
  }
  return worthwhile.sort((a, b) => b.score - a.score || a.hex.localeCompare(b.hex));
}

/** First step toward `hex` along a shortest walk (null if already there). */
export function firstStepToward(state: AOState, me: string, hex: string): string | null {
  const from = state.players[me]!.hexKey;
  if (from === hex) return null;
  const { parent } = walks(state, me, from);
  let cur = hex;
  if (!parent.has(cur)) return null;
  while (parent.get(cur) !== from) cur = parent.get(cur)!;
  return cur;
}

// ---------------------------------------------------------------------------
// Tile placement: where the new tile's icons land matters.
// ---------------------------------------------------------------------------
export function placementScore(ctx: PlanCtx, tileId: number, slot: string, rotation: number): number {
  const { state, me } = ctx;
  const def = TILES.find((t) => t.id === tileId)!;
  const c = keyToHex(slot);
  const icons = iconHexesForTile({ tileId, center: { q: c.q, r: c.r, key: slot }, rotation }, def);
  const myHex = state.players[me]!.hexKey;
  const rivals = state.playerOrder.filter((p) => p !== me).map((p) => state.players[p]!.hexKey);
  let v = 0;
  for (const icon of icons) {
    const worth = iconValue(ctx, { ...icon });
    const mine = hexDistance(myHex, icon.key);
    const theirs = Math.min(...rivals.map((h) => hexDistance(h, icon.key)));
    v += worth * (Math.pow(0.8, mine) - 0.6 * Math.pow(0.8, theirs));
  }
  return v;
}

/** Placement choices worth searching (hard / MCTS), best first. */
export function rankPlacements(ctx: PlanCtx, tileId: number, context: string): Array<{ slot: string; rotation: number; score: number }> {
  const slots = context === 'ordinary' ? explorableSlots(ctx.state, ctx.me) : allEmptySlots(ctx.state);
  const out: Array<{ slot: string; rotation: number; score: number }> = [];
  for (const slot of slots) for (let r = 0; r < 6; r++) out.push({ slot, rotation: r, score: placementScore(ctx, tileId, slot, r) });
  return out.sort((a, b) => b.score - a.score || a.slot.localeCompare(b.slot) || a.rotation - b.rotation);
}
