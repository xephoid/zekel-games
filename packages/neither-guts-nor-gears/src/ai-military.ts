// Neither Guts nor Gears — the AI's read of Leader kills.
//
// At 2–3 players the first Leader kill ends the game (§12.2), and a Leader's
// 5 defence falls to two cheap lines:
//   - a spy reveal: a wizard hero carrying an Illusionist spy with Invisible
//     researched, or a robot hero carrying an Infiltrator (Spy Attack), kills
//     one opposing hero outright when it activates in a battle (§7.3, §7.9);
//   - damage: the seat's pieces walk onto the Leader's tile and the battle
//     kills it. Asked of the engine (ai-strike.ts plays the battle out), so
//     every bonus, spell, Self Destruct and every defence on that tile counts
//     without being listed here.
// The first is about eight resources and a walk. This module estimates, for
// one seat, how many rounds until it could land such a kill: rounds to finish
// the kit (a Library of Illusion, then the Illusionist and Invisible; or a
// Diplomatic Research Station, then an Infiltrator), and rounds to walk a
// hero onto the target Leader's tile, one step per Move/Battle card.
//
// Defences push that number out: a target carrying its own Illusionist spy
// can reveal Decoy and void the kill (the attacker's spy is spent too), a
// Cleric can save once, Peace forbids entering the partner's tiles. What a
// seat cannot see is never read: another seat's spy carrier and hand stay
// hidden, so a seat holding an active spy is treated as able to use it from
// any of its heroes and to guard its Leader with it.

import type { Coord, NGGState, PlayerState } from './types.js';
import { HEROES, heroStatsForCategory, milestonesFor, unitsForSpecies } from './data/catalogs.js';
import { coordKey, neighborsOf } from './data/maps.js';
import {
  areMilitaryAllies, cultureIncomeFor, heroAlivePlaced, militaryThreshold, speciesOf, treatyBetween,
} from './engine.js';
import { unitById } from './resolvers.js';
import { econFromState, econKey, itemByName, kitRounds, payProfiles, type Econ } from './ai-econ.js';
import { cacheKey as strikeKey, strikeForce, strikeKills, type StrikePiece } from './ai-strike.js';

/** What the spy kit still needs and how long buying it takes. */
export interface KitRead { missing: string[]; buildRounds: number; reachable: boolean; armed: boolean }

export interface MilitaryRead {
  /** Rounds until this seat could have killed enough Leaders to win. */
  eta: number;
  /** The Leader it would go for (owner id), if any. */
  targetOwner: string | null;
  targetCoord: Coord | null;
  /** How the kill would land: a spy reveal, damage it can deal today, or
   *  damage once a kit (a 3-damage body + a Rook / Kestrel boost) is claimed
   *  or bought. */
  line: 'spy' | 'damage' | 'damage-kit' | null;
  /** Pieces the kit still needs, in buying order (catalog ids). */
  kitMissing: string[];
  /** The kit read this came from (reused when only positions changed). */
  kit: KitRead | null;
  /** Rounds until this seat could kill EACH rival's Leader (one kill, not
   *  the win): what a threatened seat reads its danger from. */
  byTarget: Record<string, number>;
}

const FAR = 40;

/** Hex steps from every tile to the nearest goal tile (open map). */
export function distancesFrom(state: NGGState, goals: Coord[]): Map<Coord, number> {
  const dist = new Map<Coord, number>(goals.map((c) => [c, 0]));
  const queue = [...goals];
  for (let i = 0; i < queue.length; i++) {
    const c = queue[i]!; const [x, y] = c.split(',').map(Number);
    for (const t of neighborsOf(state.tiles, x!, y!)) {
      const k = coordKey(t.c, t.r);
      if (!dist.has(k)) { dist.set(k, dist.get(c)! + 1); queue.push(k); }
    }
  }
  return dist;
}

export function heroDef(id: string) { return HEROES.find((h) => h.id === id)!; }

export function leaderOf(state: NGGState, playerId: string) {
  return state.heroes.find((h) => h.ownerId === playerId && h.isLeader && !h.dead && h.coord) ?? null;
}

/** Does `ownerId` hold a guard against spy kills on its Leader: an active
 *  Illusionist spy (Decoy), a Cleric with the mana to save? `viewer` knows
 *  its own spy's carrier; for anyone else the carrier is hidden and an
 *  active Illusionist counts as a guard. */
function spyGuard(state: NGGState, ownerId: string, viewerId: string): number {
  const o = state.players.find((x) => x.playerId === ownerId)!;
  let guards = 0;
  const leader = leaderOf(state, ownerId);
  for (const s of o.spyAssignments) {
    if (!s.active || s.source !== 'illusionist') continue;
    if (viewerId === ownerId) { if (leader && s.heroId === leader.id) guards++; }
    else guards++;
  }
  const clerics = state.units.filter((u) => u.ownerId === ownerId && u.typeId === 'cleric' && leader && u.coord === leader.coord).length;
  if (clerics > 0 && o.manaCurrent >= 5) guards++;
  return guards;
}

/** Does something on the Leader's tile stop spy kills outright, for as long
 *  as the Leader stays there? Envoy in the battle (ruling #105), a standing
 *  Wall Platform (#93), a wizard's Castle (#98). Unlike a Decoy or a Cleric
 *  these are not used up, so no number of spies gets through: the spy line
 *  is closed, not slowed. (They used to count as one more guard — two rounds
 *  each — so a seat on the military plan read a Leader sitting on its
 *  Castle as five or six rounds away, every round, all game; 2026-10-08.) */
export function spyProof(state: NGGState, ownerId: string): boolean {
  const o = state.players.find((x) => x.playerId === ownerId);
  const leader = leaderOf(state, ownerId);
  if (!o || !leader) return false;
  if (state.heroes.some((h) => h.ownerId === ownerId && h.id === 'envoy' && !h.dead && h.coord === leader.coord)) return true;
  if (state.units.some((u) => u.ownerId === ownerId && u.typeId === 'wall-platform' && u.coord === leader.coord && u.allocatedCoreId)) return true;
  return speciesOf(o) === 'wizard' && state.bases.some((b) => b.ownerId === ownerId && b.coord === leader.coord);
}

/** How many pieces of `ownerId` at `coord` would kill a spy carrier with
 *  these stats before it acts: acting first (defenders win ties, §9.3) and
 *  hitting at least the carrier's defence. An Immobile Combat Platform
 *  (initiative 98, damage 6) kills any lone hero; a military hero (70, 3)
 *  kills a slow culture or economy carrier (30, defence 3). The designer's
 *  note (2026-09-26): fortify the base. */
export function counterKillers(state: NGGState, ownerId: string, coord: Coord, carrier: { init: number; def: number }): number {
  let n = 0;
  // Rook / Kestrel give +2 damage to the OTHER pieces beside them.
  const boost = state.heroes.some((h) => h.ownerId === ownerId && !h.dead && h.coord === coord && (h.id === 'rook' || h.id === 'kestrel')) ? 2 : 0;
  for (const h of state.heroes) {
    if (h.ownerId !== ownerId || h.dead || h.coord !== coord) continue;
    const st = heroStatsForCategory(heroDef(h.id).category, h.isLeader);
    const dmg = st.dmg + (h.id === 'rook' || h.id === 'kestrel' ? 0 : boost);
    if (st.init >= carrier.init && dmg >= carrier.def) n++;
  }
  for (const u of state.units) {
    if (u.ownerId !== ownerId || u.coord !== coord) continue;
    const def = unitById(u.typeId);
    if (!def || def.init === null || (def.dmg ?? 0) <= 0) continue;
    if (def.needsCore && !u.allocatedCoreId) continue;
    if (def.init >= carrier.init && (def.dmg ?? 0) + boost >= carrier.def) n++;
  }
  return n;
}

/** The escort `p` can send with a spy carrier: every mobile fighting unit,
 *  plus every hero beyond the first (the carrier is hidden, so each extra
 *  body in the stack is one the first strike may hit instead). */
export function escortsOf(state: NGGState, p: PlayerState): number {
  let n = Math.max(0, state.heroes.filter((h) => h.ownerId === p.playerId && !h.dead && h.coord).length - 1);
  for (const u of state.units) {
    if (u.ownerId !== p.playerId) continue;
    const def = unitById(u.typeId);
    if (!def || def.collector || def.immobile || (def.dmg ?? 0) <= 0) continue;
    if (def.needsCore && !u.allocatedCoreId) continue;
    n++;
  }
  return n;
}

/** What buying one more escort takes (the arms race: a fortified base is
 *  answered with a bigger force, not abandoned). */
export function escortKit(p: PlayerState): string[] {
  if (speciesOf(p) === 'wizard') return ['evoker'];
  return p.buildings.includes('Combat Frame Production') ? ['spinner'] : ['combat-frame-production', 'spinner'];
}

/** Could `ownerId` strike first with a spy of its own at `coord` against an
 *  attacker acting at `attackerInit`? A seat with an armed spy (an
 *  Illusionist with Invisible, or an Infiltrator) and a hero there at least
 *  as quick (defenders win ties, §9.3) kills the attacking carrier before it
 *  acts — or forces its Decoy, which spends the attacker's spy. */
export function strikesFirst(state: NGGState, ownerId: string, coord: Coord, attackerInit: number): boolean {
  const o = state.players.find((x) => x.playerId === ownerId);
  if (!o) return false;
  const armed = o.spyAssignments.some((s) => s.active && (s.source === 'infiltrator' || o.research.includes('invisible')));
  if (!armed) return false;
  return state.heroes.some((h) => h.ownerId === ownerId && !h.dead && h.coord === coord
    && heroStatsForCategory(heroDef(h.id).category, h.isLeader).init >= attackerInit);
}

/** Can `p` recruit the spy line at all from where it stands (payable), and
 *  how many rounds would buying it take? `econ` saves a second read when the
 *  caller already has the seat's economy. */
export function spyKit(state: NGGState, p: PlayerState, econ?: Econ): KitRead {
  const species = speciesOf(p);
  const profiles = econ?.profiles ?? payProfiles(state, p).profiles;
  const econOf = () => econ ?? econFromState(state, p);
  if (species === 'wizard') {
    const missing: string[] = [];
    if (!p.buildings.includes('Library of Illusion')) missing.push('library-of-illusion');
    const spyUp = p.spyAssignments.some((s) => s.active && s.source === 'illusionist');
    if (!spyUp) missing.push('illusionist');
    if (!p.research.includes('invisible')) missing.push('invisible');
    const reachable = missing.every((id) => profiles[id] !== null);
    // Paid for with the seat's real collectors, a collector bought when short.
    const buildRounds = reachable ? kitRounds(econOf(), missing) : FAR;
    return { missing, buildRounds, reachable, armed: missing.length === 0 };
  }
  const missing: string[] = [];
  if (!p.buildings.includes('Diplomatic Research Station')) missing.push('diplomatic-research-station');
  const spyUp = p.spyAssignments.some((s) => s.active && s.source === 'infiltrator');
  if (!spyUp) missing.push('infiltrator');
  const reachable = missing.every((id) => profiles[id] !== null);
  const buildRounds = reachable ? kitRounds(econOf(), missing) : FAR;
  return { missing, buildRounds, reachable, armed: missing.length === 0 };
}

/** Rounds until `p` crosses its next unclaimed culture milestone (a hero
 *  claim), on its current income. */
export function roundsToNextMilestone(state: NGGState, p: PlayerState): number {
  const crossed = state.milestonesCrossed[p.playerId] ?? [];
  const next = milestonesFor(state.players.length).find((m) => !crossed.includes(m) && m > p.culture);
  if (next === undefined) return FAR;
  const income = cultureIncomeFor(state, p);
  if (income <= 0) return FAR;
  return Math.ceil((next - p.culture) / income);
}

/** Rounds until `p` claims one more hero at the next milestone (+1: claimed
 *  at round end, then placed). FAR when no milestone is in reach. */
function claimRounds(state: NGGState, p: PlayerState): number {
  const first = roundsToNextMilestone(state, p);
  return first >= FAR ? FAR : first + 1;
}

/** The damage kit: rounds until `p` could add ONE or TWO pieces — a hero
 *  claimed at the next milestone, mobile units bought (with their building
 *  if missing) — that turn its pieces into a force that kills `targetOwner`'s
 *  Leader. Two pieces since 2026-10-08: a Leader on its Castle with an Evoker
 *  beside it falls to an Evoker and an Enchantress bought from scratch, and
 *  with one piece only, wizard seats read that Leader as out of reach all
 *  game (the designer's Enchantress + Dragon kills were two-piece kits too). Every hero in the pool and every unit the seat can field is tried
 *  in the engine-played battle (ai-strike.ts); the soonest wins. Nothing
 *  names a combo: Marshal + Rook, a Dragon beside an Enchantress, a Self
 *  Destruct platform are all found (or not) by the battle itself. New pieces
 *  set out from the seat's bases. */
export function damageKit(state: NGGState, p: PlayerState, econ: Econ | undefined, targetOwner: string, withoutLeader = false): { rounds: number; from: Coord[]; missing: string[] } {
  const none = { rounds: FAR, from: [] as Coord[], missing: [] as string[] };
  const species = speciesOf(p);
  if (!species) return none;
  const force: StrikePiece[] = strikeForce(state, p.playerId, withoutLeader).map((f) => ({ kind: f.kind, id: f.id }));
  const bases = state.bases.filter((b) => b.ownerId === p.playerId).map((b) => b.coord);
  if (bases.length === 0) return none;
  // The answer depends only on: the attacking pieces and the target tile
  // (the pretend battle's own key), the attacker's economy (the kits'
  // rounds), its next milestone and the free heroes (the claims), and where
  // new pieces set out. Searches with the same inputs share one answer.
  const target = state.heroes.find((h) => h.ownerId === targetOwner && h.isLeader && !h.dead && h.coord);
  if (!target?.coord) return none;
  const claim = claimRounds(state, p);
  const key = [strikeKey(state, p.playerId, target.coord, force), econ ? econKey(econ) : '-', claim, state.heroPool.join('.'), bases.join(';'), species].join('#');
  const hit = KIT_CACHE.get(key);
  if (hit) return hit;
  const found = damageKitSearch(state, p, econ, targetOwner, force, bases, claim, species);
  if (KIT_CACHE.size >= 100_000) KIT_CACHE.clear();
  KIT_CACHE.set(key, found);
  return found;
}

const KIT_CACHE = new Map<string, { rounds: number; from: Coord[]; missing: string[] }>();

function damageKitSearch(state: NGGState, p: PlayerState, econ: Econ | undefined, targetOwner: string, force: StrikePiece[], bases: Coord[], claim: number, species: NonNullable<ReturnType<typeof speciesOf>>): { rounds: number; from: Coord[]; missing: string[] } {
  const none = { rounds: FAR, from: [] as Coord[], missing: [] as string[] };
  // Every kit with the rounds it takes, in the order they were always tried:
  // a hero claimed alone, a unit alone, two units, a fighting hero and a unit.
  // The answer is the quickest kit that kills — the first such in this order
  // among equals — so they are fought out quickest first and the search stops
  // at the first kill (2026-10-08: the same answer as trying every kit, at a
  // fraction of the pretend battles).
  type Kit = { rounds: number; extra: StrikePiece[]; missing: string[] };
  const kits: Kit[] = [];
  if (claim < FAR) {
    for (const id of state.heroPool) {
      const h = HEROES.find((x) => x.id === id);
      if (!h || (h.species !== null && h.species !== species)) continue;
      kits.push({ rounds: claim, extra: [{ kind: 'new-hero', heroId: id }], missing: [id] });
    }
  }
  if (econ) {
    const fieldable = unitsForSpecies(species).filter((u) => !u.collector && !u.immobile && u.init !== null && u.id !== 'core');
    const buyOf = (u: (typeof fieldable)[number]) => {
      const prereq = u.requiresBuilding && !p.buildings.includes(u.requiresBuilding) ? itemByName(species, u.requiresBuilding)?.id : undefined;
      return [...(prereq ? [prereq] : []), u.id];
    };
    for (const u of fieldable) {
      const buy = buyOf(u);
      kits.push({ rounds: kitRounds(econ, buy), extra: [{ kind: 'new-unit', typeId: u.id }], missing: buy });
    }
    for (let i = 0; i < fieldable.length; i++) {
      for (let j = i; j < fieldable.length; j++) {
        const a = fieldable[i]!; const b = fieldable[j]!;
        const buy = [...new Set([...buyOf(a), ...buyOf(b)])];
        // A second copy of the same unit is one more Build after the first
        // (the kit model buys each piece once).
        const rounds = a.id === b.id ? kitRounds(econ, buy) + 1 : kitRounds(econ, buy);
        kits.push({ rounds, extra: [{ kind: 'new-unit', typeId: a.id }, { kind: 'new-unit', typeId: b.id }], missing: a.id === b.id ? [...buy, b.id] : buy });
      }
    }
    if (claim < FAR) {
      for (const id of state.heroPool) {
        const h = HEROES.find((x) => x.id === id);
        if (!h || (h.species !== null && h.species !== species) || (h.category !== 'military' && h.category !== 'evo-angel')) continue;
        for (const u of fieldable) {
          const buy = buyOf(u);
          kits.push({ rounds: Math.max(claim, kitRounds(econ, buy)), extra: [{ kind: 'new-hero', heroId: id }, { kind: 'new-unit', typeId: u.id }], missing: [id, ...buy] });
        }
      }
    }
  }
  const order = kits.map((k, i) => ({ k, i })).filter((x) => x.k.rounds < FAR).sort((a, b) => a.k.rounds - b.k.rounds || a.i - b.i);
  for (const { k } of order) {
    if (strikeKills(state, p.playerId, targetOwner, [...force, ...k.extra])) return { rounds: k.rounds, from: bases, missing: k.missing };
  }
  return none;
}

/** How many rounds until `p` could kill enough Leaders to win, as `viewer`
 *  sees it (viewer's own hidden facts are known to it; others' are not). */
export function militaryRead(state: NGGState, p: PlayerState, viewerId: string = p.playerId, opts: { kit?: KitRead | null; econ?: Econ } = {}): MilitaryRead {
  const none: MilitaryRead = { eta: FAR, targetOwner: null, targetCoord: null, line: null, kitMissing: [], kit: null, byTarget: {} };
  if (!p.species) return none;
  const myHeroes = state.heroes.filter((h) => h.ownerId === p.playerId && !h.dead && h.coord);
  if (myHeroes.length === 0 || !leaderOf(state, p.playerId)) return none;
  const moves = Math.max(1, p.actionCards.moveBattle);
  const kit = opts.kit ?? spyKit(state, p, opts.econ);
  none.kit = kit;
  // Only an armed spy's carrier is known — to its owner.
  const carrier = p.spyAssignments.find((s) => s.active)?.heroId ?? null;
  const knowsCarrier = viewerId === p.playerId && carrier !== null;
  // A seat planning its own attack leaves its Leader home — as spy carrier
  // and in the strike force — since its defence never walks the Leader off
  // its base (2026-10-08). A rival's threat is read with its Leader in: a
  // human may walk it.
  const ownPlan = viewerId === p.playerId;
  const carriers = (knowsCarrier ? myHeroes.filter((h) => h.id === carrier) : myHeroes).filter((h) => !(ownPlan && h.isLeader));
  const spyWorks = speciesOf(p) === 'robot' || p.research.includes('invisible') || kit.missing.includes('invisible');
  let best = none;
  const byTarget: Record<string, number> = {};
  const kills = militaryThreshold(state.players.length) - p.leaderKills;
  const escorts = escortsOf(state, p);
  const kitMissingByTarget: Record<string, string[]> = {};
  for (const q of state.players) {
    if (q.playerId === p.playerId || !q.species) continue;
    if (areMilitaryAllies(state, p.playerId, q.playerId)) continue;
    if (treatyBetween(state, p.playerId, q.playerId, 'peace')) continue;
    const target = leaderOf(state, q.playerId);
    if (!target) continue;
    const dist = distancesFrom(state, [target.coord!]);
    // Fractional, not rounded up: with two Move/Battle cards one step left
    // the rounded walk unchanged, so the first step of every strike read as
    // worth nothing and the pieces never left home (2026-10-08).
    const walk = (from: Coord[]) => {
      let d = FAR; for (const c of from) d = Math.min(d, dist.get(c) ?? FAR);
      return d / moves;
    };
    let eta = FAR; let line: MilitaryRead['line'] = null;
    // The spy line. A known carrier that is not on the map (reserved, no
    // base) leaves no carrier at all: the line is closed, not infinite
    // (harness 2026-09-27: 23 six-player games crashed on an escort count
    // taken over an empty list).
    if (kit.reachable && spyWorks && carriers.length > 0 && !spyProof(state, q.playerId)) {
      const travel = walk(carriers.map((h) => h.coord!));
      const quickest = Math.max(...carriers.map((h) => heroStatsForCategory(heroDef(h.id).category, h.isLeader).init));
      const first = strikesFirst(state, q.playerId, target.coord!, quickest);
      const guards = spyGuard(state, q.playerId, viewerId) + (first ? 1 : 0);
      // Their spy strikes first and my own carrier is my Leader: walking it
      // in alone hands them the game. Only another hero beside it (a body
      // their one strike may take instead) keeps this line open.
      const heroEscorts = myHeroes.length - 1;
      if (first && knowsCarrier && carriers.some((h) => h.isLeader) && heroEscorts < 1) { /* spy line closed */ }
      else {
      // A fortified tile: pieces there that would kill the carrier before it
      // acts. Each needs a body to absorb its strike — an escort in hand, or
      // one bought first (the arms race: answer a bigger defence with a
      // bigger force). Two rounds a piece for the fight and the loss.
      const killers = Math.min(...carriers.map((h) => counterKillers(state, q.playerId, target.coord!, heroStatsForCategory(heroDef(h.id).category, h.isLeader))));
      const short = Number.isFinite(killers) ? Math.max(0, killers - escorts) : 0;
      const escortRounds = short > 0 ? kitRounds(opts.econ ?? econFromState(state, p), Array.from({ length: short }, () => escortKit(p)).flat()) : 0;
      // Armed the round the kit completes, striking the round after at the
      // earliest; a guarded Leader costs a spent spy and a rebuy per guard.
      // The slower of the two sets the pace, but the faster still counts a
      // little: both have to happen, and progress on either is progress.
      const arm = kit.armed ? 0 : kit.buildRounds + 1;
      const ready = Math.max(arm, escortRounds);
      const e = Math.max(ready, travel) + 0.3 * Math.min(ready, travel) + guards * 2 + killers * 2;
      if (e < eta) { eta = e; line = 'spy'; }
      }
    }
    // The damage line: would my pieces, walking onto that Leader's tile,
    // kill it in the battle the engine plays out (ai-strike.ts)? Each stack
    // where it stands, then the whole force gathered (paced by its farthest
    // piece). The Leader's own tile defends as it stands: an Immobile Combat
    // Platform, a Cleric, Mana Shield, a Warden all count there.
    const force = strikeForce(state, p.playerId, ownPlan);
    const stacks = new Map<Coord, StrikePiece[]>();
    for (const f of force) { const a = stacks.get(f.coord) ?? []; a.push({ kind: f.kind, id: f.id }); stacks.set(f.coord, a); }
    let todayKills = false;
    for (const [c, stack] of stacks) {
      const e = walk([c]); // the step onto the Leader's tile IS the attack
      if (e >= eta) continue;
      if (strikeKills(state, p.playerId, q.playerId, stack)) { eta = e; line = 'damage'; todayKills = true; }
    }
    if (stacks.size > 1) {
      // Paced by the farthest piece, but every piece's walk counts a little:
      // with the farthest alone setting the number, moving any other group
      // forward gained nothing, so only one piece walked at a time (a Marshal
      // wandered alone while two Enchantresses sat at home for two rounds
      // after a first kill, 2026-10-08).
      let far = 0; let sum = 0;
      for (const c of stacks.keys()) { const w = walk([c]); far = Math.max(far, w); sum += w; }
      const e = far + 0.25 * (sum / stacks.size);
      if (e < eta && strikeKills(state, p.playerId, q.playerId, force.map((f) => ({ kind: f.kind, id: f.id })))) { eta = e; line = 'damage'; todayKills = true; }
    }
    if (!todayKills) {
      // One more piece — claimed or bought — then walk. Both have to
      // happen; the slower sets the pace.
      const dk = damageKit(state, p, opts.econ, q.playerId, ownPlan);
      if (dk.rounds < FAR && dk.from.length > 0) {
        const travel = walk(dk.from);
        const e = Math.max(dk.rounds, travel) + 0.3 * Math.min(dk.rounds, travel) + 1;
        if (e < eta) { eta = e; line = 'damage-kit'; kitMissingByTarget[q.playerId] = dk.missing; }
      }
    }
    // On the economy read's clock (round 0 = the rest of this round, a finish
    // at this round's income reads between -1 and 0): a strike this round —
    // a force next door with a Move/Battle card — lands during the actions,
    // before that income, so it must read below it. Walks counted in rounds
    // from now (one step with one card = 1) are a round late on that clock.
    // Before this (2026-10-08), with a strike that also cost a round of its
    // own, Zeke's Enchantress + Evoker + Enchantress next to a Chronicler read
    // as 1.3 rounds away while the AI's culture win read as this round; he
    // killed it during the actions.
    if (eta < FAR) eta = Math.max(-0.9, eta - 1);
    byTarget[q.playerId] = eta;
    // More kills needed at 4+ players: each further kill is another walk.
    eta += Math.max(0, kills - 1) * 4;
    if (eta < best.eta) best = { eta, targetOwner: q.playerId, targetCoord: target.coord, line, kitMissing: line === 'spy' ? kit.missing : line === 'damage-kit' ? kitMissingByTarget[q.playerId] ?? [] : [], kit, byTarget };
  }
  return { ...best, byTarget };
}

/** Rounds until someone could kill `p`'s Leader, and who — the soonest
 *  single kill any seat could land on it, whether or not that seat's best
 *  plan is aimed elsewhere today. */
export function threatTo(state: NGGState, p: PlayerState): { eta: number; from: string | null } {
  let eta = FAR; let from: string | null = null;
  for (const q of state.players) {
    if (q.playerId === p.playerId || !q.species) continue;
    const e = militaryRead(state, q, p.playerId).byTarget[p.playerId];
    if (e !== undefined && e < eta) { eta = e; from = q.playerId; }
  }
  return { eta, from };
}

/** The same threat, read from a set of seat reads already made. */
export function threatFrom(seats: Array<{ playerId: string; alive: boolean; military: MilitaryRead }>, playerId: string): number {
  let eta = FAR;
  for (const s of seats) {
    if (s.playerId === playerId || !s.alive) continue;
    const e = s.military.byTarget[playerId];
    if (e !== undefined && e < eta) eta = e;
  }
  return eta;
}

export function isAlivePlaced(state: NGGState, pid: string, heroId: string): boolean {
  return heroAlivePlaced(state, pid, heroId);
}
