// Neither Guts nor Gears — the AI's economy projection.
//
// The game is a race. Every purchase is judged by one question: how many
// rounds sooner does it bring this seat to a win? To answer it the AI plays
// its own economy forward, round by round, in a small model of the printed
// rules (§5–§7): collectors produce one resource each per round, each Build
// card buys one thing (two with Foreman), each Research card one research
// (two with Kettering), income arrives once a round. The model is run with
// the purchase and without it, and the difference in the finishing round is
// the purchase's worth. Surfs, Subjects, the Amphitheatre, Cores, Third
// Space, an Embassy, a Quartermaster claim: all land in one currency.
//
// The map is not ignored. What a purchase really costs is how many collectors
// its payment needs from where the seat's pieces stand — a far tile needs
// extra Surfs placed in between to reach it. That number comes from the
// engine's own payment search (payProfiles), so a wizard who reaches only two
// wood tiles is told the Amphitheatre takes six Surfs, not four, and moving a
// hero next to wood visibly makes it cheaper.
//
// Other players are modelled the same way from their public pieces; their
// hands, spies and face-down cards are never read.

import type { NGGState, PlayerState } from './types.js';
import {
  cultureTargetFor, ECONOMIC_SPEND, MAX_HEROES_PER_PLAYER, TECH_TARGET, TREATIES, buildingsForSpecies, milestonesFor,
  researchForSpecies, unitsForSpecies, type Species,
} from './data/catalogs.js';
import { heroesEligibleFor } from './resolvers.js';
import { collectorCapFor, coreSupplyFor, economicCollectorsNeeded, economicExtraAny, robotCollectorCaps } from './economicScale.js';
import {
  collectorResourceOf, cultureIncomeFor, findPayment, hasTreatyUnlock,
  heroAlivePlaced, ownedCollectorIds, speciesOf, techTotal, anchorPartners, isUnitPiece, DOWSER_COLLECTORS, DOWSER_SURFS,
} from './engine.js';

export type Res = 'water' | 'wood' | 'ore' | 'oil' | 'ether';
export const RESOURCES: Res[] = ['water', 'wood', 'ore', 'oil', 'ether'];
export type Cost = Partial<Record<Res, number>>;
export type Path = 'cultural' | 'technological' | 'economic';

/** One purchasable thing, as the model sees it. `id` is the catalog id. */
export interface SimItem {
  id: string;
  name: string;
  kind: 'unit' | 'building' | 'research';
  cost: Cost;
  max: number;
  /** Printed name of the building it needs, if any. */
  prereq: string | null;
}

const ITEMS: Partial<Record<Species, SimItem[]>> = {};
export function itemsFor(species: Species): SimItem[] {
  const cached = ITEMS[species];
  if (cached) return cached;
  const out: SimItem[] = [];
  for (const u of unitsForSpecies(species)) {
    out.push({ id: u.id, name: u.name, kind: 'unit', cost: u.cost as Cost, max: u.id === 'core' ? 15 : u.maxPerPlayer, prereq: u.requiresBuilding });
  }
  for (const b of buildingsForSpecies(species)) {
    out.push({ id: b.id, name: b.name, kind: 'building', cost: b.cost as Cost, max: b.isBase ? 3 : (b.repeatableMax ?? 1), prereq: null });
  }
  for (const r of researchForSpecies(species)) {
    // "at Home" (Metal Platforms) is met while the seat has a base.
    // An ether-OR-oil fourth resource (the Extra cards, ruling #86) is
    // modelled as oil: one collector either way, and both tiles sit in the
    // same centre of every map.
    const cost = (r.either ? { ...r.cost, oil: (r.cost.oil ?? 0) + 1 } : r.cost) as Cost;
    out.push({ id: r.id, name: r.name, kind: 'research', cost, max: 1, prereq: r.prerequisite === 'Home' ? null : r.prerequisite });
  }
  ITEMS[species] = out;
  return out;
}

export function itemById(species: Species, id: string): SimItem | undefined {
  return itemsFor(species).find((x) => x.id === id);
}
export function itemByName(species: Species, name: string): SimItem | undefined {
  const n = name.toLowerCase();
  return itemsFor(species).find((x) => x.name.toLowerCase() === n || x.id === n);
}

/** The profile key of the Economic victory spend. */
export const ECONOMIC_SPEND_ID = '__economic_spend';

export function costTotal(c: Cost): number {
  let n = 0; for (const r of RESOURCES) n += c[r] ?? 0; return n;
}

// ---------------------------------------------------------------------------
// What a purchase takes from the map
// ---------------------------------------------------------------------------

/** Collectors a purchase's payment uses, by collector kind ('any' = Surf). */
export interface PayProfile { n: number; by: Partial<Record<Res | 'any', number>> }

/** A copy of the seat owning every collector it could ever own, so the
 *  payment search answers "what would this take from here", not "can I pay
 *  it with what I hold today". */
function withFullSupply(state: NGGState, p: PlayerState): PlayerState {
  const all: Record<string, number> = {};
  if (speciesOf(p) === 'wizard') for (let i = 1; i <= economicCollectorsNeeded(state); i++) all[`surf-${i}`] = 1;
  else {
    const caps = robotCollectorCaps(state);
    for (const r of ['water', 'wood', 'ore', 'oil', 'ether'] as const) for (let i = 1; i <= caps[r]; i++) all[`${r}-collector-${i}`] = 1;
  }
  // The bank is a round's leftovers: profiles are read without it (the
  // model keeps its own round bank — see canPay).
  return { ...p, collectorsAvailable: all, corelessCollectors: [], bank: {} };
}

/** The signature of everything that decides where a seat's collectors can go:
 *  its own pieces and bases, access partners' pieces, and tile overlays. */
function anchorSignature(state: NGGState, p: PlayerState): string {
  // WHERE collectors may be anchored (isLegalPlacement): the tiles holding
  // the seat's (or an access partner's) units, heroes and bases — and WHERE
  // they may not go: tiles other seats hold, since the read assumes no
  // consent (AI seats refuse; a human near a rival's win would too).
  const owners = new Set([p.playerId, ...anchorPartners(state, p.playerId)]);
  const pts = new Set<string>();
  const shut = new Set<string>();
  for (const u of state.units) { if (!isUnitPiece(u)) continue; (owners.has(u.ownerId) ? pts : shut).add(u.coord); }
  for (const h of state.heroes) { if (h.dead || !h.coord) continue; (owners.has(h.ownerId) ? pts : shut).add(h.coord); }
  for (const b of state.bases) (owners.has(b.ownerId) ? pts : shut).add(b.coord);
  const ov = Object.entries(state.overlays?.activeByCoord ?? {}).map(([k, v]) => `${k}=${v}`).sort().join(',');
  // Haste (ruling #101) halves the Surfs a payment needs; Collector
  // Optimizations (#102) opens held locations — both change the profiles.
  const tech = ['haste', 'collector-optimizations'].filter((id) => p.research.includes(id)).join('+');
  return `${state.layout}|${speciesOf(p)}|${[...pts].sort().join(';')}|${[...shut].sort().join(';')}|${ov}|${tech}`;
}

/** Seats whose tiles this seat's collectors must avoid: everyone who is not
 *  an access partner (the read assumes consent is refused). */
function refusedOwners(state: NGGState, p: PlayerState): string[] {
  const partners = new Set(anchorPartners(state, p.playerId));
  return state.players.filter((q) => q.playerId !== p.playerId && !partners.has(q.playerId)).map((q) => q.playerId);
}

const PROFILE_CACHE = new Map<string, { profiles: Record<string, PayProfile | null>; caps: Record<Res, number> }>();

/** A record whose entries are worked out the first time they are read. */
function lazyRecord<V>(compute: (k: string) => V): Record<string, V> {
  const store: Record<string, V> = {};
  return new Proxy(store, {
    get(t, k) {
      if (typeof k !== 'string') return undefined;
      if (!(k in t)) t[k] = compute(k);
      return t[k];
    },
  });
}

/** Does the seat reach at least `n` of resource `r` at once? A map read
 *  answers by searching only as far as `n`; a plain record (the Leader
 *  draft's printed-cost model) is compared directly. */
function capAtLeast(cap: Record<Res, number>, r: Res, n: number): boolean {
  if (n <= 0) return true;
  const atLeast = (cap as { atLeast?: (r: Res, n: number) => boolean }).atLeast;
  return atLeast ? atLeast(r, n) : cap[r] >= n;
}

/** Per item: the collectors its payment needs from where this seat stands
 *  (next round: every collector back, nothing placed). null = out of reach.
 *  Also the most tiles of each resource the seat's collectors can reach.
 *  Each entry is searched the first time the projection asks for it. */
export function payProfiles(state: NGGState, p: PlayerState): { profiles: Record<string, PayProfile | null>; caps: Record<Res, number>; key: string } {
  const key = anchorSignature(state, p);
  const hit = PROFILE_CACHE.get(key);
  if (hit) return { ...hit, key };
  // Only what the payment search reads is kept alive by the cache.
  const view = {
    ...state, placements: [], log: [], battle: null, pending: null, actionStack: [], activeAction: null,
  } as NGGState;
  const full = withFullSupply(state, p);
  const items = itemsFor(speciesOf(p));
  const avoid = refusedOwners(state, p);
  const profiles = lazyRecord<PayProfile | null>((id) => {
    if (id === ECONOMIC_SPEND_ID) {
      // The Economic spend: the map's count of collectors on distinct tiles,
      // no stepping stones (every collector pays), no tile another seat holds.
      const needed = economicCollectorsNeeded(state);
      const spend = findPayment(view, full, ECONOMIC_SPEND as Cost, avoid, 4000, economicExtraAny(state), true);
      return spend && spend.length === needed ? { n: needed, by: {} } : null;
    }
    const it = items.find((x) => x.id === id);
    if (!it) return undefined as unknown as PayProfile | null;
    if (costTotal(it.cost) === 0) return { n: 0, by: {} };
    const pay = findPayment(view, full, it.cost, avoid, 2000);
    if (!pay) return null;
    const by: Partial<Record<Res | 'any', number>> = {};
    for (const pl of pay) { const k = (collectorResourceOf(pl.collectorId) ?? 'any') as Res | 'any'; by[k] = (by[k] ?? 0) + 1; }
    return { n: pay.length, by };
  });
  // A Haste Surf yields two, so its reach is counted in resources up to twice
  // as far.
  const capLimit = p.research.includes('haste') ? 12 : 6;
  // Searched one unit at a time, k = 1, 2, … until a payment fails or the
  // limit is reached; the search only goes as far as a question needs
  // (`atLeast`), so a resource the round never asks about is never searched
  // (2026-10-08: reading all five on every purchase was half the AI's time).
  // Asking for the full number continues the same steps, so both give the
  // answer the one-shot loop gave.
  const reach: Record<string, { k: number; done: boolean }> = {};
  const extend = (r: string, n: number): number => {
    const st = reach[r] ??= { k: 0, done: false };
    while (!st.done && st.k < n) {
      if (st.k < capLimit && findPayment(view, full, { [r]: st.k + 1 }, avoid, 800)) st.k++;
      else st.done = true;
    }
    return st.k;
  };
  const caps = lazyRecord<number>((r) => extend(r, Infinity)) as Record<Res, number>;
  Object.defineProperty(caps, 'atLeast', { value: (r: Res, n: number) => extend(r, n) >= n, enumerable: false });
  const out = { profiles, caps };
  if (PROFILE_CACHE.size > 3000) PROFILE_CACHE.clear();
  PROFILE_CACHE.set(key, out);
  return { ...out, key };
}

// ---------------------------------------------------------------------------
// The model's state
// ---------------------------------------------------------------------------

export interface Econ {
  species: Species;
  culture: number;
  /** Culture that wins at this table: 35 per player (ruling #119). */
  cultureTarget: number;
  /** Income not bought with pieces: treaties, Chronicler. */
  otherIncome: number;
  subjects: number;
  coresReserve: number;
  coresSupply: number;
  /** Collectors the Economic spend needs (printed 11; the session's dial). */
  economicTarget: number;
  /** Per-type collector caps under the dial (absent = printed maxima). */
  collectorCaps?: Record<string, number>;
  /** Wizard: owned Surfs. */
  surfs: number;
  /** Robot: powered collectors by resource. */
  typed: Record<Res, number>;
  /** Most tiles of each resource reachable at once. */
  tileCap: Record<Res, number>;
  profiles: Record<string, PayProfile | null>;
  /** Identity of the map reach the profiles came from (a cache key). */
  profileKey: string;
  /** Wizard without Haste: the same reads as if Haste were held, swapped in
   *  when the model researches it (ruling #101). Absent = nothing to swap. */
  haste?: { profiles: Record<string, PayProfile | null>; caps: Record<Res, number>; key: string };
  owned: Record<string, number>;
  buildings: Set<string>;
  research: Set<string>;
  types: Set<string>;
  techBonus: number;
  buildSlots: number;
  researchSlots: number;
  foreman: boolean;
  kettering: boolean;
  /** Treaty income the seat can expect once treaties can form. */
  treatyPotential: number;
  hasUnlock: boolean;
  /** Some partner holds an unlock, so treaties can form without ours. */
  partnerUnlock: boolean;
  /** Culture milestones (§5.5) this seat has not crossed yet, lowest first. */
  milestonesLeft: number[];
  /** Unclaimed heroes this seat could take at a milestone (public pool). */
  heroPool: string[];
  /** Hero claims left before the per-player hero limit. */
  heroRoom: number;
}

export function cloneEcon(e: Econ): Econ {
  return {
    ...e, typed: { ...e.typed }, owned: { ...e.owned },
    buildings: new Set(e.buildings), research: new Set(e.research), types: new Set(e.types),
    milestonesLeft: [...e.milestonesLeft], heroPool: [...e.heroPool],
  };
}

export function incomeOf(e: Econ): number {
  let inc = e.otherIncome;
  if (e.species === 'wizard') inc += e.subjects * (e.buildings.has('Amphitheatre') ? 2 : 1);
  else { inc += e.coresReserve; if (e.buildings.has('Third Space')) inc += 5; }
  if (e.hasUnlock) inc += e.treatyPotential;
  else if (e.partnerUnlock) inc += e.treatyPotential * 0.5;
  return inc;
}

/** Expected treaty income per round once treaties can form: each seat with
 *  no treaty with us is a possible partner, one token per treaty type, and
 *  about half of offers are accepted. Each treaty type pays its own amount
 *  (ruling #112), so the tokens still free are counted richest first. */
export function treatyPotentialFor(state: NGGState, p: PlayerState): number {
  const partners = state.players.filter((q) => q.playerId !== p.playerId
    && !state.treaties.some((t) => t.partners.includes(p.playerId) && t.partners.includes(q.playerId))).length;
  const incomes = TREATIES.filter((t) => (t.id !== 'culture-treaty' || state.players.length >= 4)
    && !state.treaties.some((x) => x.type === t.id)).map((t) => t.cultureIncome).sort((a, b) => b - a);
  return incomes.slice(0, partners).reduce((a, n) => a + n, 0) * 0.5;
}

export function econFromState(state: NGGState, p: PlayerState): Econ {
  const species = speciesOf(p);
  const owned: Record<string, number> = {};
  for (const u of state.units) if (u.ownerId === p.playerId) owned[u.typeId] = (owned[u.typeId] ?? 0) + 1;
  const typed = { water: 0, wood: 0, ore: 0, oil: 0, ether: 0 } as Record<Res, number>;
  let surfs = 0;
  for (const id of ownedCollectorIds(p)) {
    const r = collectorResourceOf(id);
    if (r === null) surfs++;
    else if (!(p.corelessCollectors ?? []).includes(id)) typed[r as Res]++;
    const typeId = r === null ? 'surf' : `${r}-collector`;
    owned[typeId] = (owned[typeId] ?? 0) + 1;
  }
  owned['subject'] = p.subjects;
  owned['core'] = coreSupplyFor(state) - p.coresInSupply;
  for (const b of p.buildings) {
    const def = buildingsForSpecies(species).find((x) => x.name === b);
    if (def) owned[def.id] = p.buildingCounts[def.id] ?? 1;
  }
  owned[species === 'wizard' ? 'castle' : 'home'] = state.bases.filter((b) => b.ownerId === p.playerId).length;
  const pieceIncome = species === 'wizard'
    ? p.subjects * (p.buildings.includes('Amphitheatre') ? 2 : 1)
    : p.coresInReserve + (p.buildings.includes('Third Space') ? 5 : 0);
  const alive = (id: string) => heroAlivePlaced(state, p.playerId, id);
  const unlock = hasTreatyUnlock(state, p.playerId);
  const partnerUnlock = !unlock && state.players.some((q) => q.playerId !== p.playerId && hasTreatyUnlock(state, q.playerId));
  const { profiles, caps, key } = payProfiles(state, p);
  // The Haste reads are searched lazily, only if the model ever buys Haste.
  const haste = species === 'wizard' && !p.research.includes('haste')
    ? payProfiles(state, { ...p, research: [...p.research, 'haste'] })
    : undefined;
  const crossed = state.milestonesCrossed?.[p.playerId] ?? [];
  const heroesHeld = state.heroes.filter((h) => h.ownerId === p.playerId && !h.dead).length;
  return {
    haste,
    milestonesLeft: milestonesFor(state.players.length).filter((m) => m > p.culture && !crossed.includes(m)),
    heroPool: heroesEligibleFor(species).map((h) => h.id).filter((id) => (state.heroPool ?? []).includes(id)),
    heroRoom: Math.max(0, MAX_HEROES_PER_PLAYER - heroesHeld),
    species,
    culture: p.culture,
    cultureTarget: cultureTargetFor(state.players.length),
    economicTarget: economicCollectorsNeeded(state),
    collectorCaps: Object.fromEntries(unitsForSpecies(species).filter((u) => u.collector).map((u) => [u.id, collectorCapFor(state, u)])),
    otherIncome: cultureIncomeFor(state, p) - pieceIncome,
    subjects: p.subjects,
    coresReserve: p.coresInReserve,
    coresSupply: p.coresInSupply,
    surfs,
    typed,
    tileCap: caps,
    profiles,
    profileKey: key,
    owned,
    buildings: new Set(p.buildings),
    research: new Set(p.research),
    types: new Set(p.acquiredTypes),
    techBonus: techTotal(state, p) - p.acquiredTypes.length,
    buildSlots: p.actionCards.build,
    researchSlots: p.actionCards.research,
    foreman: alive('foreman'),
    kettering: alive('kettering'),
    treatyPotential: treatyPotentialFor(state, p),
    hasUnlock: unlock,
    partnerUnlock,
  };
}

// ---------------------------------------------------------------------------
// Buying in the model
// ---------------------------------------------------------------------------

export function isTreatyUnlock(id: string): boolean {
  return id === 'embassy' || id === 'diplomatic-research-station';
}

function needsCore(e: Econ, it: SimItem): boolean {
  return e.species === 'robot' && it.kind === 'unit' && it.id !== 'core' && it.id !== 'infiltrator';
}

/** Collectors this purchase takes, Core pairing included (a robot platform
 *  with no reserve Core buys one with it: +1 water). null = out of reach. */
export function simProfile(e: Econ, it: SimItem): PayProfile | null {
  const base = e.profiles[it.id];
  if (base === undefined) {
    // No map read (the Leader draft's printed-cost model): a Haste Surf
    // makes two of one resource.
    if (hasteActive(e)) { const n = hasteMix(it.cost); return { n, by: { any: n } }; }
    const by: Partial<Record<Res | 'any', number>> = {};
    for (const r of RESOURCES) if (it.cost[r]) by[e.species === 'wizard' ? 'any' : r] = ((by[e.species === 'wizard' ? 'any' : r] ?? 0) + (it.cost[r] ?? 0));
    return { n: costTotal(it.cost), by };
  }
  if (base === null) return null;
  // Ruling #103 (Core Integration): the paired Core is free.
  if (needsCore(e, it) && e.coresReserve === 0 && !e.research.has('core-integration')) return { n: base.n + 1, by: { ...base.by, water: (base.by.water ?? 0) + 1 } };
  return base;
}

/** Can the seat buy this in the model (prerequisites, supply limits)? */
export function available(e: Econ, it: SimItem): boolean {
  if ((e.owned[it.id] ?? 0) >= (e.collectorCaps?.[it.id] ?? it.max)) return false;
  if (it.kind === 'research' && e.research.has(it.id)) return false;
  if (it.kind === 'building' && it.max === 1 && e.buildings.has(it.name)) return false;
  if (it.prereq && !e.buildings.has(it.prereq)) return false;
  if (it.id === 'core' && e.coresSupply <= 0) return false;
  if (needsCore(e, it) && e.coresReserve <= 0 && e.coresSupply <= 0) return false;
  return true;
}

/** Apply a purchase's effect to the model. */
export function applyBuy(e: Econ, it: SimItem): void {
  e.owned[it.id] = (e.owned[it.id] ?? 0) + 1;
  e.types.add(it.id);
  if (it.kind === 'research') {
    e.research.add(it.id);
    // Ruling #86: the researched Extra cards are extra purchase slots a round.
    if (it.id === 'extra-build-card') e.buildSlots += 1;
    if (it.id === 'extra-research-card') e.researchSlots += 1;
    // Ruling #101: Haste doubles each Surf's yield from next purchase on —
    // the map reads switch to the ones searched with Haste held.
    if (it.id === 'haste' && e.haste) {
      e.profiles = e.haste.profiles; e.tileCap = e.haste.caps; e.profileKey = e.haste.key; e.haste = undefined;
    }
    return;
  }
  if (it.kind === 'building') {
    e.buildings.add(it.name);
    if (isTreatyUnlock(it.id)) { e.hasUnlock = true; e.partnerUnlock = false; }
    return;
  }
  if (it.id === 'subject') { e.subjects++; return; }
  if (it.id === 'core') { e.coresReserve++; e.coresSupply--; return; }
  if (it.id === 'surf') { e.surfs++; return; }
  if (needsCore(e, it)) {
    if (e.coresReserve > 0) e.coresReserve--; else e.coresSupply--;
    const m = /^(water|wood|ore|oil|ether)-collector$/.exec(it.id);
    if (m) e.typed[m[1] as Res]++;
  }
}

/** A round's spendable production. Haste only: `demand` is what the
 *  purchases since Haste took hold have cost, `bridges` the most
 *  stepping-stone Surfs any of them needed, `fixed` the Surfs already placed
 *  before Haste was researched this round. */
interface Budget {
  any: number; left: Record<Res, number>; used: Record<Res, number>;
  demand: Record<Res, number>; bridges: number; fixed: number;
}

function budgetOf(e: Econ): Budget {
  const zero = () => ({ water: 0, wood: 0, ore: 0, oil: 0, ether: 0 });
  return { any: e.surfs, left: { ...e.typed }, used: zero(), demand: zero(), bridges: 0, fixed: 0 };
}

/** The wizard holds Haste in the model (bought, or held at the read). */
function hasteActive(e: Econ): boolean {
  return e.species === 'wizard' && e.research.has('haste');
}

/** Surfs a cost takes from paying tiles when each makes two (ruling #101). */
function hasteMix(cost: Cost): number {
  let n = 0; for (const r of RESOURCES) n += Math.ceil((cost[r] ?? 0) / 2); return n;
}

/** Surfs a Haste round has used: the round's whole demand of each resource
 *  at two per Surf (the bank carries an odd one over to later purchases),
 *  plus the stepping stones, plus whatever was placed before Haste. Stepping
 *  stones stay placed all round, so they count once, not per purchase; what
 *  they produce is not counted (it lands wherever the chain runs). */
function hasteSurfsUsed(b: Budget, demand: Record<Res, number>, bridges: number): number {
  return b.fixed + hasteMix(demand) + bridges;
}

function canPay(e: Econ, b: Budget, it: SimItem): PayProfile | null {
  const prof = simProfile(e, it);
  if (!prof) return null;
  for (const r of RESOURCES) if (!capAtLeast(e.tileCap, r, b.used[r] + (it.cost[r] ?? 0))) return null;
  if (hasteActive(e)) {
    const demand = { ...b.demand };
    for (const r of RESOURCES) demand[r] += it.cost[r] ?? 0;
    const bridges = Math.max(b.bridges, prof.n - hasteMix(it.cost));
    return hasteSurfsUsed(b, demand, bridges) <= e.surfs ? prof : null;
  }
  if ((prof.by.any ?? 0) > b.any) return null;
  for (const r of RESOURCES) if ((prof.by[r] ?? 0) > b.left[r]) return null;
  return prof;
}

function pay(e: Econ, b: Budget, it: SimItem, prof: PayProfile): void {
  for (const r of RESOURCES) b.used[r] += it.cost[r] ?? 0;
  if (hasteActive(e)) {
    for (const r of RESOURCES) b.demand[r] += it.cost[r] ?? 0;
    b.bridges = Math.max(b.bridges, prof.n - hasteMix(it.cost));
    b.any = e.surfs - hasteSurfsUsed(b, b.demand, b.bridges);
    return;
  }
  b.any -= prof.by.any ?? 0;
  for (const r of RESOURCES) b.left[r] -= prof.by[r] ?? 0;
  // Haste bought with this payment: what is placed so far stays placed.
  if (it.id === 'haste' && e.species === 'wizard') b.fixed = e.surfs - b.any;
}

// ---------------------------------------------------------------------------
// The in-model buying policy
// ---------------------------------------------------------------------------

/** Culture a purchase adds per round in the model. */
export function incomeGain(e: Econ, it: SimItem): number {
  if (e.species === 'wizard') {
    if (it.id === 'subject') return e.buildings.has('Amphitheatre') ? 2 : 1;
    if (it.id === 'amphitheatre') return e.subjects;
  } else {
    if (it.id === 'core') return 1;
    if (it.id === 'third-space') return 5;
    if (needsCore(e, it)) return e.coresReserve > 0 ? -1 : 0; // takes a reserve Core
  }
  if (isTreatyUnlock(it.id) && !e.hasUnlock) return e.partnerUnlock ? e.treatyPotential * 0.5 : e.treatyPotential;
  return 0;
}

export function isCollector(id: string): boolean {
  return id === 'surf' || /-collector$/.test(id);
}

/** Types a building opens (research and units that need it). */
function unlocksOf(e: Econ, it: SimItem): number {
  if (it.kind !== 'building') return 0;
  return itemsFor(e.species).filter((x) => x.prereq === it.name && !e.types.has(x.id)).length;
}

/** What a plan saves up for: the collectors to buy first (per kind), then
 *  the model spends greedily. `null` = no saving, greedy from the start.
 *  `first`: catalog ids bought before anything else as soon as each is
 *  payable — pieces worth having for what they make faster, not for what
 *  they score on their own (Haste and the Library it needs; the Extra cards). */
export interface Plan { wantAny: number; want: Partial<Record<Res, number>>; first?: string[] }

function collectorTarget(e: Econ, plan: Plan | null): SimItem | null {
  if (!plan) return null;
  const items = itemsFor(e.species);
  if (e.species === 'wizard') return e.surfs < plan.wantAny ? items.find((x) => x.id === 'surf')! : null;
  for (const r of RESOURCES) {
    if (e.typed[r] < (plan.want[r] ?? 0)) return items.find((x) => x.id === `${r}-collector`) ?? null;
  }
  return null;
}

/** The model's pick for one purchase slot on a path. */
function pickBuy(e: Econ, b: Budget, slot: 'build' | 'research', path: Path, roundsLeft: number, plan: Plan | null): { it: SimItem; prof: PayProfile } | null {
  for (const id of plan?.first ?? []) {
    const it = itemsFor(e.species).find((x) => x.id === id);
    if (!it || owns(e, it) || (slot === 'research') !== (it.kind === 'research') || !available(e, it)) continue;
    const prof = canPay(e, b, it);
    if (prof) return { it, prof };
  }
  if (slot === 'build') {
    const target = collectorTarget(e, plan);
    if (target && available(e, target)) {
      const prof = canPay(e, b, target);
      if (prof) return { it: target, prof };
    }
  }
  let best: { it: SimItem; prof: PayProfile } | null = null; let bestScore = 0;
  for (const it of itemsFor(e.species)) {
    if ((slot === 'research') !== (it.kind === 'research')) continue;
    if (!available(e, it)) continue;
    const prof = canPay(e, b, it);
    if (!prof) continue;
    const c = Math.max(1, prof.n);
    const fresh = !e.types.has(it.id);
    let score = 0;
    if (path === 'cultural') {
      score = (incomeGain(e, it) * roundsLeft) / c;
      if (fresh) score += 0.02;
    } else if (path === 'technological') {
      if (fresh) score = (3 + unlocksOf(e, it) * 0.8) / c;
      // A spare Core lets the next platform take it instead of buying one.
      else if (e.species === 'robot' && it.id === 'core' && e.coresReserve === 0) score = 0.5;
    } else {
      if (isCollector(it.id)) score = 10;
      else if (e.species === 'robot' && it.id === 'core' && e.coresReserve === 0) score = 1;
    }
    if (score > bestScore) { bestScore = score; best = { it, prof }; }
  }
  return best;
}

/** Debug aid: what the model buys round by round on a path and plan. */
export function traceEta(e0: Econ, path: Path, plan: Plan | null, rounds = 15): string[] {
  const e = cloneEcon(e0); const out: string[] = [];
  for (let r = 1; r <= rounds; r++) {
    const before = new Set(e.types); const owned = { ...e.owned };
    simRound(e, path, Math.max(2, horizonOf(e) - r), plan);
    const bought = Object.keys(e.owned).filter((k) => (e.owned[k] ?? 0) > (owned[k] ?? 0)).map((k) => `${k}${before.has(k) ? '' : '*'}`);
    out.push(`r${r}: ${bought.join(' ') || '-'} | culture ${e.culture} types ${e.types.size + e.techBonus}`);
  }
  return out;
}

/** One model round: spend every slot, then take income. */
function simRound(e: Econ, path: Path, roundsLeft: number, plan: Plan | null): void {
  const b = budgetOf(e);
  const perBuild = e.foreman ? 2 : 1;
  const perResearch = e.kettering ? 2 : 1;
  for (let i = 0; i < e.buildSlots * perBuild; i++) {
    const pick = pickBuy(e, b, 'build', path, roundsLeft, plan);
    if (!pick) break;
    pay(e, b, pick.it, pick.prof); applyBuy(e, pick.it);
  }
  for (let i = 0; i < e.researchSlots * perResearch; i++) {
    const pick = pickBuy(e, b, 'research', path, roundsLeft, plan);
    if (!pick) break;
    pay(e, b, pick.it, pick.prof); applyBuy(e, pick.it);
  }
  e.culture += incomeOf(e);
  claimMilestones(e, path);
}

// ---------------------------------------------------------------------------
// Heroes in the model
// ---------------------------------------------------------------------------

/** A hero's effect on the economy model (the Leader draft and milestone
 *  claims). Heroes with no economic effect (military, overlays) do nothing. */
export function applyHero(e: Econ, id: string): void {
  switch (id) {
    case 'chronicler': e.otherIncome += 5; break; // ruling #114
    case 'foreman': e.foreman = true; break;
    case 'quartermaster': e.buildSlots += 1; break;
    case 'kettering': e.kettering = true; break;
    case 'archivist': e.researchSlots += 1; break;
    case 'motherboard': case 'greymore': e.techBonus += 5; break; // ruling #113
    case 'envoy': e.hasUnlock = true; e.partnerUnlock = false; break;
    case 'wren': grantDowser(e); break; // Dowser Wren Calloway, rulings #106/#117
    case 'smyth': {
      // A free technology, cost and building waived: the one that speeds the
      // seat most (Haste, then the Extra cards), else the first left.
      const open = cloneEcon({ ...e, buildings: new Set(itemsFor(e.species).filter((x) => x.kind === 'building').map((x) => x.name)) });
      const items = itemsFor(e.species).filter((it) => it.kind === 'research' && available(open, it));
      const pick = ['haste', 'extra-build-card', 'extra-research-card'].map((x) => items.find((it) => it.id === x)).find((x) => x) ?? items[0];
      if (pick) applyBuy(e, pick);
      break;
    }
    default: break;
  }
}

/** Dowser's free collectors, stopping at the supply limits: two Surfs for a
 *  wizard (ruling #124); for a robot, four collectors each with a Core from
 *  supply, the kinds it holds fewest of first. */
function grantDowser(e: Econ): void {
  for (let n = 0; n < (e.species === 'wizard' ? DOWSER_SURFS : DOWSER_COLLECTORS); n++) {
    if (e.species === 'wizard') {
      const cap = e.collectorCaps?.['surf'] ?? 99;
      if (e.surfs >= cap) return;
      e.surfs++; e.owned['surf'] = (e.owned['surf'] ?? 0) + 1; e.types.add('surf');
      continue;
    }
    if (e.coresSupply <= 0) return;
    const kinds = RESOURCES.filter((r) => (e.owned[`${r}-collector`] ?? 0) < (e.collectorCaps?.[`${r}-collector`] ?? 99));
    if (kinds.length === 0) return;
    const r = kinds.reduce((a, x) => (e.typed[x] < e.typed[a] ? x : a));
    e.typed[r]++; e.coresSupply--;
    e.owned[`${r}-collector`] = (e.owned[`${r}-collector`] ?? 0) + 1; e.types.add(`${r}-collector`);
  }
}

/** The hero each path's seat would take at a milestone, best first — the
 *  model's own policy (real claims are judged by the read when offered). */
const MILESTONE_PICKS: Record<Path, string[]> = {
  technological: ['greymore', 'motherboard', 'wren', 'quartermaster', 'archivist', 'foreman', 'kettering', 'smyth'],
  cultural: ['chronicler', 'envoy', 'quartermaster', 'foreman', 'wren', 'smyth'],
  economic: ['wren', 'quartermaster', 'foreman'],
};

/** §5.5: each milestone crossed earns a hero claim from the public pool.
 *  The model takes its path's best hero still free (the pool is shared, so
 *  every seat's model hopes for the same heroes; a rival's read is what
 *  matters most, and there this is the claim that rival would make). */
function claimMilestones(e: Econ, path: Path): void {
  while (e.milestonesLeft.length > 0 && e.culture >= e.milestonesLeft[0]!) {
    e.milestonesLeft.shift();
    if (e.heroRoom <= 0) continue;
    const pick = MILESTONE_PICKS[path].find((id) => e.heroPool.includes(id) && (id !== 'envoy' || !e.hasUnlock));
    if (!pick) continue;
    e.heroPool = e.heroPool.filter((x) => x !== pick);
    e.heroRoom--;
    applyHero(e, pick);
  }
}

// ---------------------------------------------------------------------------
// Finishing rounds
// ---------------------------------------------------------------------------

const MAX_ROUNDS = 40;

/** Rounds the model expects a game to run, for weighing income: about 13 at
 *  the two-player target of 100, longer as the target grows with the table. */
function horizonOf(e: Econ): number {
  return Math.round(8 + (5 * e.cultureTarget) / 100);
}
const FAR = MAX_ROUNDS + 5;

function collectorCount(e: Econ): number {
  return e.surfs + RESOURCES.reduce((a, r) => a + e.typed[r], 0);
}

/** Rounds (fractional) until the model reaches the path's target. Round 0 is
 *  the rest of this round (the caller applies its purchase, then income). */
export function etaWithPlan(e0: Econ, path: Path, plan: Plan | null): number {
  const e = cloneEcon(e0);
  const techTarget = TECH_TARGET[e.species];
  const before0 = e.culture;
  e.culture += incomeOf(e);
  claimMilestones(e, path);
  const target = e.cultureTarget;
  if (path === 'cultural' && e.culture >= target) return frac(before0, e.culture, 0, target);
  if (path === 'technological' && e.types.size + e.techBonus >= techTarget) return 0;
  if (path === 'economic' && !e.profiles[ECONOMIC_SPEND_ID]) return FAR;
  // Whole-round finishes are flat: buying now or next round can land on the
  // same round. A small credit for what is already held today keeps a head
  // start worth taking.
  const heldEconomic = 0.03 * collectorCount(e0);
  const heldTech = 0.03 * (e0.types.size + e0.techBonus);
  for (let r = 1; r <= MAX_ROUNDS; r++) {
    const roundsLeft = Math.max(2, horizonOf(e) - r);
    const before = e.culture;
    if (path === 'economic' && collectorCount(e) >= e.economicTarget) return r - heldEconomic;
    simRound(e, path, roundsLeft, plan);
    if (path === 'cultural' && e.culture >= target) return frac(before, e.culture, r, target);
    if (path === 'technological' && e.types.size + e.techBonus >= techTarget) return r - heldTech;
  }
  if (path === 'cultural') return MAX_ROUNDS + (target - e.culture) / Math.max(0.5, incomeOf(e));
  return FAR;
}

/** Plans worth trying on the culture path: spend at once, or first save up
 *  the collectors a big income purchase takes from here. */
function culturePlans(e: Econ): Array<Plan | null> {
  const plans: Array<Plan | null> = [null];
  const items = itemsFor(e.species);
  const targets = e.species === 'wizard' ? ['amphitheatre', 'embassy'] : ['third-space', 'diplomatic-research-station'];
  for (const id of targets) {
    const it = items.find((x) => x.id === id);
    if (!it || !available(e, it)) continue;
    const prof = simProfile(e, it);
    if (!prof) continue;
    if (e.species === 'wizard') {
      if ((prof.by.any ?? 0) > e.surfs) plans.push({ wantAny: prof.by.any ?? 0, want: {} });
    } else {
      const want: Partial<Record<Res, number>> = {};
      let short = false;
      for (const r of RESOURCES) { const n = prof.by[r] ?? 0; if (n > e.typed[r]) { want[r] = n; short = true; } }
      if (short) plans.push({ wantAny: 0, want });
    }
  }
  if (e.species === 'wizard') {
    for (const k of [3, 4]) if (e.surfs < k) plans.push({ wantAny: k, want: {} });
    const haste = hasteFirst(e);
    if (haste) {
      plans.push({ wantAny: 0, want: {}, first: haste });
      if (e.surfs < 5) plans.push({ wantAny: 5, want: {}, first: haste });
    }
  } else if (e.typed.water < 3) {
    plans.push({ wantAny: 0, want: { water: 3 } });
  }
  return plans;
}

/** Plans worth trying on the technology path: owning every type means
 *  paying for the dearest ones, so save up the collectors they take first. */
function techPlans(e: Econ): Array<Plan | null> {
  const plans: Array<Plan | null> = [null];
  if (e.species === 'wizard') {
    for (const k of [5, 7, 9, 11]) if (e.surfs < k) plans.push({ wantAny: k, want: {} });
    // The wizard tech rush (the designer's games, 2026-10-07): Haste, then
    // the Extra Build and Research cards, so more purchases fit in a round.
    const rush = [...(hasteFirst(e) ?? []), 'extra-build-card', 'library-of-illusion', 'extra-research-card'];
    for (const k of [0, 7]) if (k === 0 || e.surfs < k) plans.push({ wantAny: k, want: {}, first: rush });
  } else {
    // Robots hold 15 Cores and every collector and platform takes one: the
    // five platforms and one collector of each kind already use ten, so the
    // plan saves up only the few more collectors the dearest pieces need.
    // Third Space takes 3 wood.
    plans.push({ wantAny: 0, want: { water: 3, wood: 3, ore: 2, oil: 1, ether: 1 } });
    plans.push({ wantAny: 0, want: { water: 2, wood: 3, ore: 1, oil: 1, ether: 1 } });
  }
  return plans;
}

/** A wizard without Haste: the pieces that get it (the Library first). */
function hasteFirst(e: Econ): string[] | null {
  if (e.species !== 'wizard' || e.research.has('haste')) return null;
  return ['library-of-enchantment', 'haste'];
}

/** The best finishing round over the plans worth trying. */
export function etaOf(e: Econ, path: Path): number {
  const plans = path === 'cultural' ? culturePlans(e) : path === 'technological' ? techPlans(e) : [null];
  let best = FAR;
  for (const plan of plans) best = Math.min(best, etaWithPlan(e, path, plan));
  return best;
}

/** Fractional finishing round so small income changes still register. */
function frac(before: number, after: number, round: number, target: number): number {
  const gained = after - before;
  if (gained <= 0) return round;
  return round - 1 + (target - before) / gained;
}

export interface Race { path: Path; eta: number; byPath: Record<Path, number> }

const RACE_CACHE = new Map<string, Race>();

export function econKey(e: Econ): string {
  return [e.species, e.culture, e.cultureTarget, e.economicTarget, e.otherIncome, e.subjects, e.coresReserve, e.coresSupply, e.surfs,
    RESOURCES.map((r) => e.typed[r]).join('.'), e.profileKey, JSON.stringify(e.owned),
    [...e.buildings].sort().join('.'), [...e.research].sort().join('.'), [...e.types].sort().join('.'),
    e.techBonus, e.buildSlots, e.researchSlots, e.foreman, e.kettering, e.treatyPotential, e.hasUnlock, e.partnerUnlock,
    e.milestonesLeft.join('.'), e.heroPool.join('.'), e.heroRoom, e.haste?.key ?? ''].join('|');
}

export function raceOf(e: Econ): Race {
  const key = econKey(e);
  const hit = RACE_CACHE.get(key);
  if (hit) return hit;
  const out = raceUncached(e);
  if (RACE_CACHE.size > 20000) RACE_CACHE.clear();
  RACE_CACHE.set(key, out);
  return out;
}

function raceUncached(e: Econ): Race {
  const byPath: Record<Path, number> = {
    cultural: etaOf(e, 'cultural'),
    technological: etaOf(e, 'technological'),
    economic: etaOf(e, 'economic'),
  };
  let path: Path = 'cultural';
  for (const k of ['technological', 'economic'] as Path[]) if (byPath[k] < byPath[path] - 0.5) path = k;
  return { path, eta: byPath[path], byPath };
}

/** Rounds a purchase saves on the path (positive = sooner), against leaving
 *  the slot unused this round. */
export function purchaseGain(e: Econ, it: SimItem, path: Path, base = etaOf(e, path)): number {
  const w = cloneEcon(e);
  applyBuy(w, it);
  return base - etaOf(w, path);
}

export const FAR_ROUNDS = FAR;

/** Rounds until the seat owns every item in `kit` (catalog ids, bought in the
 *  order given, each once its prerequisite stands), buying collectors when it
 *  is short. Round 1 is next round; the current round's purchases are the
 *  caller's to apply. FAR when a piece is out of reach. */
export function kitRounds(e0: Econ, kit: string[]): number {
  if (kit.length === 0) return 0;
  const e = cloneEcon(e0);
  const items = itemsFor(e.species);
  const want = kit.map((id) => items.find((x) => x.id === id)).filter((x): x is SimItem => !!x);
  if (want.some((it) => simProfile(e, it) === null)) return FAR;
  const collector = e.species === 'wizard' ? items.find((x) => x.id === 'surf')! : null;
  for (let r = 1; r <= 12; r++) {
    const b = budgetOf(e);
    const perBuild = e.foreman ? 2 : 1;
    const perResearch = e.kettering ? 2 : 1;
    for (const slot of ['build', 'research'] as const) {
      const n = slot === 'build' ? e.buildSlots * perBuild : e.researchSlots * perResearch;
      for (let i = 0; i < n; i++) {
        const next = want.find((it) => (slot === 'research') === (it.kind === 'research') && available(e, it) && !owns(e, it));
        const prof = next ? canPay(e, b, next) : null;
        if (next && prof) { pay(e, b, next, prof); applyBuy(e, next); continue; }
        // Short of production for the next piece: a collector now — a Surf,
        // or the robot collector of the kind the piece is shortest of.
        const extra = slot === 'build' ? (collector ?? shortCollector(e, b, next ?? want.find((it) => !owns(e, it)))) : null;
        if (extra && available(e, extra)) {
          const cp = canPay(e, b, extra);
          if (cp) { pay(e, b, extra, cp); applyBuy(e, extra); }
        }
        break;
      }
    }
    if (want.every((it) => owns(e, it))) return r;
  }
  return FAR;
}

/** The robot collector the next kit piece is shortest of. */
function shortCollector(e: Econ, b: Budget, it: SimItem | undefined): SimItem | null {
  if (!it || e.species !== 'robot') return null;
  const prof = simProfile(e, it);
  if (!prof) return null;
  for (const r of RESOURCES) {
    if ((prof.by[r] ?? 0) > e.typed[r]) {
      const c = itemsFor(e.species).find((x) => x.id === `${r}-collector`);
      if (c && available(e, c)) return c;
    }
  }
  void b;
  return null;
}

function owns(e: Econ, it: SimItem): boolean {
  if (it.kind === 'research') return e.research.has(it.id);
  if (it.kind === 'building') return e.buildings.has(it.name);
  return (e.owned[it.id] ?? 0) > 0;
}
