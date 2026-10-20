// Neither Guts nor Gears — how the AI judges a position.
//
// Each seat's finishing round comes from the economy projection (ai-econ.ts)
// on its public pieces, and from the military read (ai-military.ts): how soon
// it could kill the Leaders it needs. A seat's chance of winning is its share
// of exp(-finish / spread) across the table — the sooner it finishes relative
// to the others, the larger its share. A Culture Treaty pools a seat's chance
// with its partner's (the partner's win is shared, §11.2).
//
// Moves are judged by applying them with the engine (it is pure) and reading
// the mover's chance in the resulting position, so every rule effect the
// engine knows about is counted without a second copy of the rules here.
//
// Everything is read from one seat's point of view (the viewer): its own
// hidden facts (its spy's carrier) are known to it, nobody else's are.

import type { NGGState, PlayerState } from './types.js';
import { econFromState, raceOf, type Econ, type Path, type Race } from './ai-econ.js';
import { hasLivingLeader } from './engine.js';
import { militaryRead, threatFrom, type MilitaryRead } from './ai-military.js';

export type WinPath = Path | 'military';
/** A strategy lever (leans hard, LEAN_HANDICAP) or an adaptive seat's
 *  written-down plan (`commit:<path>`, leans lightly, COMMIT_HANDICAP). */
export type Lean = WinPath | `commit:${WinPath}` | undefined;

export interface SeatRead {
  playerId: string;
  econ: Econ;
  race: Race;
  military: MilitaryRead;
  /** Best finishing round over every path (Military included). */
  eta: number;
  alive: boolean;
}

export interface TableRead {
  viewer: string;
  seats: SeatRead[];
  bySeat: Map<string, SeatRead>;
}

/** Rounds of spread in the finishing race: a one-round lead is worth about a
 *  two-to-one edge. */
const SPREAD = 1.4;

/** Rounds of softness when paths are combined: the fastest path counts most,
 *  but work on a second path still registers. */
const PATH_SOFTNESS = 1.5;

/** Rounds a strategy seat adds to every path but its own: it leans hard on
 *  its path, yet keeps playing when that path is blocked. */
const LEAN_HANDICAP = 8;

/** Rounds an adaptive seat adds to every path but the one it has committed
 *  to (the designer's ask, 2026-09-30, after Civilization V's AIs, which pick
 *  a way to win and re-check it now and then instead of drifting between
 *  all four). Light: the seat follows through on its plan, but a clearly
 *  faster path still wins inside a round. */
const COMMIT_HANDICAP = 3;

/** How many rounds sooner another path must finish before an adaptive seat
 *  drops its plan for it at upkeep. Keeps the plan from flip-flopping. */
const SWITCH_ROUNDS = 3;

/** In the first rounds a seat drops its plan for a path only this much
 *  sooner — the early pivot (the designer's ask, 2026-10-08: a seat whose
 *  drawn goal or Leader turns out poor should turn early, Military
 *  included). Seen before it: at 3 players a Chronicler seat read Military
 *  at 4.0 rounds against culture 4.6 and kept culture. */
const EARLY_SWITCH_ROUNDS = 0.5;
const EARLY_ROUNDS = 3;


/** Rounds of spread in the survival question: how the chance of being
 *  killed first falls off as the killer's clock runs later than the seat's
 *  own finish. A seat whose Leader can be killed the round it would finish
 *  keeps half its weight; two rounds of margin either way moves that to
 *  about four-fifths or one-fifth. From the designer's playtest note
 *  (2026-09-26): the AI walked its Leader out alone and never bought a
 *  guard, because being killed did not count against its own chances. */
const SURVIVAL_SPREAD = 1.4;

/** How much of a Culture Treaty partner's win counts as the viewer's own.
 *  All of it: a Culture Treaty win is shared (§11.2), and the designer's
 *  reading (2026-09-26) is that the shared win is a real win. What the AI
 *  must not do is share ITS win with a partner who is behind, or feed a
 *  rival through a treaty that shares nothing — see ai.ts pullingAhead. */
const SHARED_WIN_SHARE = 1;

/** Turn on whoever is about to win (the designer's ask, 2026-09-30, after
 *  Civilization V's AIs, which all grow hostile to the player closest to
 *  victory). The seat finishing soonest — the leader — has its weight in the
 *  viewer's read cut by the chance the viewer could kill that Leader before
 *  the leader finishes, up to this share. Being able to stop the leader is
 *  then worth something on its own: buying the pieces and walking toward that
 *  Leader score, not only the kill. Capped below 1 so the kill itself still
 *  counts for more than the threat (a full cut made a sure kill look
 *  pointless — see the survival note in chanceFrom).
 *
 *  ON (0.5) since 2026-10-08, the designer's call. History: off from
 *  2026-09-30, when at 4 players the new AI won 21% of games against the
 *  previous hard with this at 0.5 and 55% with it off (every seat turned on
 *  the leader and a quiet seat finished technology meanwhile). Against the
 *  scripted tech rush on 2026-10-08, after the threat clock was fixed, it
 *  made no difference to how often the rush won (17 of 24 either way) but
 *  turned some of the AI's wins into Military wins against the rusher. The
 *  leader pull in ai.ts quickMoveLook follows this value. */
export const STOP_SHARE: number = 0.5;

/** The seat closest to winning, as the viewer should treat it: the alive
 *  rival finishing soonest, if it finishes before the viewer does. A Culture
 *  Treaty partner is never it — its win is the viewer's win too. */
export function leaderAgainst(state: NGGState, viewerId: string, seats: SeatRead[]): SeatRead | null {
  const mine = seats.find((s) => s.playerId === viewerId);
  if (!mine?.alive) return null;
  const partners = new Set(state.treaties.filter((t) => t.type === 'culture-treaty' && t.partners.includes(viewerId)).flatMap((t) => t.partners));
  let best: SeatRead | null = null;
  for (const s of seats) {
    if (s.playerId === viewerId || !s.alive || partners.has(s.playerId)) continue;
    if (!best || s.eta < best.eta) best = s;
  }
  return best && best.eta < mine.eta ? best : null;
}

function etaFor(race: Race, military: MilitaryRead, lean: Lean): number {
  const byPath = { ...race.byPath, military: military.eta };
  const committed = lean?.startsWith('commit:') ? lean.slice('commit:'.length) : null;
  const toward = committed ?? lean;
  const handicap = committed ? COMMIT_HANDICAP : LEAN_HANDICAP;
  const etas = toward
    ? (Object.keys(byPath) as Array<keyof typeof byPath>).map((k) => byPath[k] + (k === toward ? 0 : handicap))
    : [race.byPath.cultural, race.byPath.technological, race.byPath.economic, military.eta];
  const lo = Math.min(...etas);
  let sum = 0;
  for (const e of etas) sum += Math.exp(-(e - lo) / PATH_SOFTNESS);
  return lo - PATH_SOFTNESS * Math.log(sum);
}

export function readSeat(state: NGGState, p: PlayerState, viewerId: string, lean?: Lean): SeatRead {
  const econ = econFromState(state, p);
  const race = raceOf(econ);
  const military = militaryRead(state, p, viewerId, { econ });
  const alive = hasLivingLeader(state, p.playerId);
  return { playerId: p.playerId, econ, race, military, eta: alive ? etaFor(race, military, lean) : 99, alive };
}

/** Re-read a seat's military only: its economy (and so its kit) unchanged,
 *  positions, guards and Leaders re-read. */
export function rereadMilitary(state: NGGState, prev: SeatRead, viewerId: string, lean?: Lean): SeatRead {
  const p = state.players.find((x) => x.playerId === prev.playerId)!;
  const military = militaryRead(state, p, viewerId, { kit: prev.military.kit, econ: prev.econ });
  const alive = hasLivingLeader(state, p.playerId);
  return { ...prev, military, alive, eta: alive ? etaFor(prev.race, military, lean) : 99 };
}

const READ_CACHE = new WeakMap<NGGState, Map<string, TableRead>>();

export function readTable(state: NGGState, viewerId: string, lean?: Lean): TableRead {
  const key = `${viewerId}|${lean ?? ''}`;
  let byViewer = READ_CACHE.get(state);
  const hit = byViewer?.get(key);
  if (hit) return hit;
  const seats = state.players.filter((p) => p.species).map((p) => readSeat(state, p, viewerId, p.playerId === viewerId ? lean : undefined));
  const out: TableRead = { viewer: viewerId, seats, bySeat: new Map(seats.map((s) => [s.playerId, s])) };
  if (!byViewer) { byViewer = new Map(); READ_CACHE.set(state, byViewer); }
  byViewer.set(key, out);
  return out;
}

/** The viewer's chance of winning from a set of seat reads. */
export function chanceFrom(state: NGGState, viewerId: string, seats: SeatRead[]): number {
  if (state.result) return state.result.winners.includes(viewerId) ? 1 : 0;
  const by = new Map(seats.map((s) => [s.playerId, s]));
  // The viewer's own weight is its finishing race discounted by whether it
  // lives to finish: the soonest any other seat could kill its Leader,
  // against its own finishing round. Rivals are NOT discounted: a rival the
  // viewer could kill counts in full until it is dead, so landing the kill
  // is worth doing (discounting them made a sure kill look pointless — the
  // read already treated the target as gone).
  const weight = (pid: string) => {
    const s = by.get(pid);
    if (!s || !s.alive) return 0;
    if (pid !== viewerId) return Math.exp(-s.eta / SPREAD);
    const threat = threatFrom(seats, pid);
    const survival = 1 / (1 + Math.exp(-(threat - s.eta) / SURVIVAL_SPREAD));
    return Math.exp(-s.eta / SPREAD) * survival;
  };
  // The leader's weight, cut by the viewer's chance of killing it first.
  const lead = leaderAgainst(state, viewerId, seats);
  const myKill = lead ? by.get(viewerId)?.military.byTarget[lead.playerId] : undefined;
  const stop = lead && myKill !== undefined ? STOP_SHARE / (1 + Math.exp(-(lead.eta - myKill) / SPREAD)) : 0;
  const weightOf = (pid: string) => weight(pid) * (lead && pid === lead.playerId ? 1 - stop : 1);
  let total = 0;
  for (const s of seats) total += weightOf(s.playerId);
  if (total <= 0) return 0;
  let mine = weight(viewerId);
  if (by.get(viewerId)?.alive) {
    for (const t of state.treaties) {
      if (t.type !== 'culture-treaty' || !t.partners.includes(viewerId)) continue;
      const partner = t.partners[0] === viewerId ? t.partners[1] : t.partners[0];
      mine += SHARED_WIN_SHARE * weight(partner);
    }
  }
  return Math.min(1, mine / total);
}

/** The viewer's chance in a position, every seat read fresh. */
export function chanceAll(state: NGGState, viewerId: string, lean?: Lean): number {
  if (state.result) return state.result.winners.includes(viewerId) ? 1 : 0;
  return chanceFrom(state, viewerId, readTable(state, viewerId, lean).seats);
}

/** The viewer's chance after a move that changed only its own pieces: its
 *  seat is read fresh; the others keep their economy from `before` and have
 *  their military re-read (the viewer's Leader and guards may have moved). */
export function chanceSelf(before: NGGState, after: NGGState, viewerId: string, lean?: Lean): number {
  if (after.result) return after.result.winners.includes(viewerId) ? 1 : 0;
  const base = readTable(before, viewerId, lean);
  const seats = base.seats.map((s) => {
    if (s.playerId === viewerId) return readSeat(after, after.players.find((x) => x.playerId === viewerId)!, viewerId, lean);
    return rereadMilitary(after, s, viewerId);
  });
  return chanceFrom(after, viewerId, seats);
}

/** The way to win an adaptive AI seat should commit to this round: the path
 *  it would finish soonest by, unless it already has a plan and that plan is
 *  within SWITCH_ROUNDS of the best — then it keeps the plan. Read on the
 *  seat's own public position (no lean), at upkeep (engine.ts runUpkeep). */
export function commitPath(state: NGGState, p: PlayerState): { path: WinPath; since: number } | null {
  if (!p.species || !hasLivingLeader(state, p.playerId)) return null;
  const s = readSeat(state, p, p.playerId);
  const byPath: Record<WinPath, number> = { ...s.race.byPath, military: s.military.eta };
  const paths = Object.keys(byPath) as WinPath[];
  const best = paths.reduce((a, b) => (byPath[b] < byPath[a] ? b : a));
  const prev = p.aiPlan;
  // The drawn opening goal (engine.ts drawOpeningGoal) holds through its
  // opening rounds; then the early pivot, then the usual margin.
  if (prev?.openingUntil !== undefined && state.round <= prev.openingUntil) return prev;
  const margin = state.round <= EARLY_ROUNDS ? EARLY_SWITCH_ROUNDS : SWITCH_ROUNDS;
  if (prev && byPath[prev.path] <= byPath[best] + margin) return prev;
  return { path: best, since: state.round };
}
