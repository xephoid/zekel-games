// Reads a Neither Guts nor Gears seat view into typed data, once, so no
// screen touches raw JSON. Everything here is what the engine sent; nothing
// is worked out. Two rules hold throughout:
//   - map pieces come from each player's own structured lists (units, heroes,
//     committed collectors), joined to the map by coord, never from the
//     "Name (owner)" strings on a tile;
//   - no prose is parsed, with one stated exception: an older engine's
//     `active_action` sentence (see activeActionOf).

import { asArr, asBool, asNum, asStr, isObj } from '@zekel/glue-kit';

export type Species = 'wizard' | 'robot';
export type CardKind = 'build' | 'research' | 'move_battle';

export interface NggPiece {
  kind: 'unit' | 'hero' | 'collector';
  owner: string;
  /** the printed name: "Dragon", "Archmage Elara", or a collector id */
  name: string;
  /** the engine's id for the piece, when it publishes one */
  id: string | null;
  leader: boolean;
  /** robot units: whether a Core powers it */
  core: 'allocated' | 'CORELESS' | null;
  /** collectors: the resource it collects */
  resource: string | null;
  /** heroes: the printed stat line */
  stats: string | null;
  /** units: the engine's DEF now, out of battle (the printed DEF plus any
   *  research raising it); null from an older engine or a statless piece */
  def: number | null;
}

export interface NggTile {
  coord: string;
  c: number;
  r: number;
  label: string;
  printedResource: string | null;
  resource: string | null;
  start: number | null;
  baseOwner: string | null;
  pieces: NggPiece[];
}

export interface NggPlayer {
  id: string;
  kind: string;
  faction: string | null;
  species: Species | null;
  culture: number;
  nextMilestones: number[];
  /** the culture that wins at this table; null from an engine that does not publish it */
  cultureTarget: number | null;
  manaCurrent: number;
  manaMax: number;
  buildings: string[];
  buildingCounts: Record<string, number>;
  research: string[];
  /** acquiredTypeNames: each type by printed name; null from an engine that gives only ids */
  tech: { acquiredTypes: string[]; acquiredTypeNames: string[] | null; bonusLive: number; total: number; target: number | null };
  /** each action card kind's copies by slot ('base', 'hero_extra', 'researched_extra'); null from an older engine */
  actionCardSlots: Record<string, string[]> | null;
  leaderKills: number;
  militaryKillsNeeded: number;
  leaderAlive: boolean;
  subjects: number;
  coresReserve: number;
  coresSupply: number;
  /** what a Haste wizard banked this round (#101); empty otherwise */
  bank: Record<string, number>;
  /** what a Core bought with a platform adds to its price: empty with Core
   *  Integration (#103); null for a wizard, or from an engine that does not say */
  pairedCoreCost: Record<string, number> | null;
  /** each unit type's limit for this seat on this map, by unit name, as the
   *  engine enforces it (collectors and Cores follow the map); null from an
   *  engine that does not say */
  unitLimits: Record<string, number> | null;
  actionCards: Record<string, number>;
  /** the planned cards by kind ("build:base"); null where they are face down
   *  to this viewer (another seat's, from an engine that hides them) */
  actionCardsPlayed: string[] | null;
  /** how many action cards the seat has played this round */
  actionCardsPlayedCount: number;
  handCount: number;
  spyRecruitments: number;
  /** spies recruited and not publicly revealed or spent; null from an older engine */
  unrevealedSpies: number | null;
  units: Array<{ id: string; type: string; coord: string; core: 'allocated' | 'CORELESS' | null; def: number | null }>;
  heroes: Array<{ name: string; coord: string | null; leader: boolean; dead: boolean; stats: string | null }>;
  bases: string[];
  collectors: Array<{ id: string; coord: string; resource: string | null }>;
  /** what the seat has not unlocked yet, each with what it needs (units and
   *  technologies by printed name); null from an engine that does not publish it */
  locked: { units: Record<string, string>; research: Record<string, string>; treaties: string | null; battleCards: string | null } | null;
  /** every collector the seat owns, on the map this round or on the board;
   *  a robot's with its Core state. Null from an engine that does not publish
   *  the list: then only the collectors placed this round are known. */
  ownedCollectors: Array<{ id: string; type: string; placedAt: string | null; core: 'allocated' | 'CORELESS' | null }> | null;
}

export interface NggOption {
  id: string;
  label: string;
  move: Record<string, unknown> | null;
  blockedReason: string | null;
  section: string | null;
  detail: Record<string, unknown>;
}

export interface NggPending {
  kind: string;
  for: string;
  question: string;
  /** absent when the engine publishes no bounded option set */
  options: NggOption[] | null;
  repeatable: boolean;
  context: Record<string, unknown>;
}

export interface NggBattleUnit {
  label: string;
  /** the id battle moves name this unit by; null from an engine that does not publish it */
  ref: string | null;
  owner: string;
  side: string;
  init: number;
  dmg: number;
  def: number;
  activated: boolean;
}

export type NggCommitments =
  | { revealed: false; bySeat: Record<string, 'pending' | 'committed'> }
  | { revealed: true; cards: Array<{ card: string; by: string; resolved: boolean; countered: boolean }> };

export interface NggBattle {
  coord: string;
  origin: string | null;
  phase: string;
  pass: number;
  units: NggBattleUnit[];
  commitments: NggCommitments;
}

export interface NggStackEntry { position: number; owner: string; cardKind: string | null }

export interface NggTreaty { name: string; partners: [string, string]; cultureIncome: number }

export interface NggCard { card: string; effect: string }

export interface NggView {
  phase: string;
  round: number;
  activePlayerId: string | null;
  firstPlayerId: string | null;
  layout: string;
  tiles: NggTile[];
  players: NggPlayer[];
  stack: NggStackEntry[];
  /** the resolving action card; `finished` once only its end-of-action treaty window remains */
  activeAction: { cardKind: CardKind; owner: string; finished: boolean } | null;
  treaties: NggTreaty[];
  battle: NggBattle | null;
  deckCount: number;
  discard: string[];
  pending: NggPending | null;
  victory: Record<string, { culture: number; tech: number; leaderKills: number; leaderAlive: boolean }>;
  result: unknown;
  heroPoolCount: number;
  /** the seat's own private keys; empty for a watcher */
  hand: NggCard[];
  /** the viewing seat's own planned cards; null from an older engine */
  yourActionCardsPlayed: string[] | null;
  sharedHands: Record<string, NggCard[]>;
  spies: Array<{ source: string; hero: string; active: boolean }>;
  knowledge: unknown[];
  reservedHeroes: string[];
}

const CARD_KINDS: CardKind[] = ['build', 'research', 'move_battle'];

/**
 * The resolving action card. The engine publishes it structured as
 * `resolving_action: { card_kind, owner }`; an engine from before that field
 * sends only the sentence "build by p2", and this is the one place that
 * sentence is read.
 */
export function activeActionOf(raw: unknown): { cardKind: CardKind; owner: string; finished: boolean } | null {
  if (isObj(raw)) {
    const kind = asStr(raw['card_kind']);
    const owner = asStr(raw['owner']);
    return CARD_KINDS.includes(kind as CardKind) && owner ? { cardKind: kind as CardKind, owner, finished: raw['finished'] === true } : null;
  }
  if (typeof raw !== 'string') return null;
  const m = /^(build|research|move_battle) by (\S+)$/.exec(raw);
  return m ? { cardKind: m[1] as CardKind, owner: m[2]!, finished: false } : null;
}

function coordParts(coord: string): { c: number; r: number } {
  const [c, r] = coord.split(',').map((v) => parseInt(v, 10));
  return { c: Number.isFinite(c) ? c! : 0, r: Number.isFinite(r) ? r! : 0 };
}

function strOrNull(x: unknown): string | null {
  return typeof x === 'string' && x !== '' ? x : null;
}

function readPlayer(p: Record<string, unknown>): NggPlayer {
  const tech = isObj(p['tech_progress']) ? p['tech_progress'] : {};
  const species = asStr(p['species']);
  return {
    id: asStr(p['player_id']),
    kind: asStr(p['kind']),
    faction: strOrNull(p['faction']),
    species: species === 'wizard' || species === 'robot' ? species : null,
    culture: asNum(p['culture']),
    nextMilestones: asArr(p['next_milestones']).map((m) => asNum(m)),
    cultureTarget: typeof p['culture_target'] === 'number' ? p['culture_target'] : null,
    manaCurrent: asNum(p['mana_current']),
    manaMax: asNum(p['mana_max']),
    buildings: asArr(p['buildings']).map((b) => asStr(b)),
    buildingCounts: isObj(p['building_counts'])
      ? Object.fromEntries(Object.entries(p['building_counts']).map(([k, v]) => [k, asNum(v)]))
      : {},
    research: asArr(p['research']).map((r) => asStr(r)),
    tech: {
      acquiredTypes: asArr(tech['acquired_types']).map((t) => asStr(t)),
      acquiredTypeNames: Array.isArray(tech['acquired_type_names']) ? asArr(tech['acquired_type_names']).map((t) => asStr(t)) : null,
      bonusLive: asNum(tech['bonus_points_live']),
      total: asNum(tech['total']),
      target: typeof tech['target'] === 'number' ? tech['target'] : null,
    },
    actionCardSlots: isObj(p['action_card_slots'])
      ? Object.fromEntries(Object.entries(p['action_card_slots']).map(([k, v]) => [k, asArr(v).map((x) => asStr(x))]))
      : null,
    leaderKills: asNum(p['leader_kills']),
    militaryKillsNeeded: asNum(p['military_kills_needed']),
    leaderAlive: asBool(p['leader_alive']),
    subjects: asNum(p['subjects']),
    coresReserve: asNum(p['cores_reserve']),
    coresSupply: asNum(p['cores_supply']),
    bank: isObj(p['bank']) ? Object.fromEntries(Object.entries(p['bank']).filter(([, n]) => typeof n === 'number' && n > 0)) as Record<string, number> : {},
    unitLimits: isObj(p['unit_limits']) ? Object.fromEntries(Object.entries(p['unit_limits']).filter(([, n]) => typeof n === 'number')) as Record<string, number> : null,
    pairedCoreCost: isObj(p['paired_core_cost']) ? Object.fromEntries(Object.entries(p['paired_core_cost']).filter(([, n]) => typeof n === 'number' && n > 0)) as Record<string, number> : null,
    actionCards: isObj(p['action_cards'])
      ? Object.fromEntries(Object.entries(p['action_cards']).map(([k, v]) => [k, asNum(v)]))
      : {},
    // An older engine published every seat's planned cards; a newer one
    // publishes only how many, and the seat's own list apart (withViewer).
    actionCardsPlayed: Array.isArray(p['action_cards_played_this_round']) ? asArr(p['action_cards_played_this_round']).map((c) => asStr(c)) : null,
    actionCardsPlayedCount: Array.isArray(p['action_cards_played_this_round']) ? asArr(p['action_cards_played_this_round']).length : asNum(p['action_cards_played_count']),
    handCount: asNum(p['battle_hand_count']),
    spyRecruitments: asNum(p['spy_recruitments']),
    unrevealedSpies: typeof p['unrevealed_spies'] === 'number' ? p['unrevealed_spies'] : null,
    units: asArr(p['units']).filter(isObj).map((u) => ({
      id: asStr(u['id']),
      type: asStr(u['type']),
      coord: asStr(u['coord']),
      core: u['core'] === 'allocated' || u['core'] === 'CORELESS' ? u['core'] : null,
      def: typeof u['def'] === 'number' ? u['def'] : null,
    })),
    heroes: asArr(p['heroes']).filter(isObj).map((h) => ({
      name: asStr(h['hero']),
      // A reserved hero is owned but not on the board yet.
      coord: typeof h['coord'] === 'string' && h['coord'] !== 'reserved' ? h['coord'] : null,
      leader: asBool(h['is_leader']),
      dead: asBool(h['dead']),
      stats: strOrNull(h['stats']),
    })),
    bases: asArr(p['bases']).map((b) => asStr(b)),
    collectors: asArr(p['committed_collectors']).filter(isObj).map((c) => ({
      id: asStr(c['collector']),
      coord: asStr(c['coord']),
      resource: strOrNull(c['resource']),
    })),
    locked: !isObj(p['locked']) ? null : {
      units: isObj(p['locked']['units']) ? Object.fromEntries(Object.entries(p['locked']['units']).map(([k, v]) => [k, asStr(v)])) : {},
      research: isObj(p['locked']['research']) ? Object.fromEntries(Object.entries(p['locked']['research']).map(([k, v]) => [k, asStr(v)])) : {},
      treaties: strOrNull(p['locked']['treaties']),
      battleCards: strOrNull(p['locked']['battle_cards']),
    },
    ownedCollectors: !Array.isArray(p['collectors']) ? null : asArr(p['collectors']).filter(isObj).map((c) => ({
      id: asStr(c['collector']),
      type: asStr(c['type']),
      placedAt: strOrNull(c['placed_at']),
      core: c['core'] === 'allocated' || c['core'] === 'CORELESS' ? c['core'] : null,
    })),
  };
}

/** The view as the viewing seat reads it: its own planned cards, which the
 *  engine publishes apart from the public seat list, on its own seat. */
export function withViewer(v: NggView, me: string | null): NggView {
  if (!v.yourActionCardsPlayed || !me) return v;
  const own = v.yourActionCardsPlayed;
  return { ...v, players: v.players.map((p) => (p.id === me ? { ...p, actionCardsPlayed: own } : p)) };
}

/** Economic progress: the collectors the seat owns (a robot's without a Core
 *  counted apart, since they cannot pay). Null where the engine does not
 *  publish the owned list. */
export function econOf(p: NggPlayer): { owned: number; unpowered: number } | null {
  if (!p.ownedCollectors) return null;
  return { owned: p.ownedCollectors.length, unpowered: p.ownedCollectors.filter((c) => c.core === 'CORELESS').length };
}

/** A robot seat's Cores: fitted in a unit or collector, and spare in the reserve. */
export function coresOf(p: NggPlayer): { used: number; free: number } {
  const used = p.units.filter((u) => u.core === 'allocated').length
    + (p.ownedCollectors ?? []).filter((c) => c.core === 'allocated').length;
  return { used, free: p.coresReserve };
}

function readOption(o: Record<string, unknown>): NggOption {
  return {
    id: asStr(o['option_id']),
    label: asStr(o['label']),
    move: isObj(o['move']) ? o['move'] : null,
    blockedReason: strOrNull(o['blocked_reason']),
    section: strOrNull(o['rules_section']),
    detail: isObj(o['detail']) ? o['detail'] : {},
  };
}

function readPending(p: unknown): NggPending | null {
  if (!isObj(p)) return null;
  return {
    kind: asStr(p['kind']),
    for: asStr(p['for']),
    question: asStr(p['question']),
    options: Array.isArray(p['options']) ? p['options'].filter(isObj).map(readOption) : null,
    repeatable: asBool(p['repeatable']),
    context: isObj(p['context']) ? p['context'] : {},
  };
}

function readBattle(b: unknown): NggBattle | null {
  if (!isObj(b)) return null;
  const raw = b['commitments'];
  const commitments: NggCommitments = Array.isArray(raw)
    ? {
        revealed: true,
        cards: raw.filter(isObj).map((c) => ({
          card: asStr(c['card']), by: asStr(c['by']), resolved: asBool(c['resolved']), countered: asBool(c['countered']),
        })),
      }
    : {
        revealed: false,
        bySeat: isObj(raw)
          ? Object.fromEntries(Object.entries(raw).map(([pid, v]) => [pid, v === 'pending' ? 'pending' : 'committed'] as const))
          : {},
      };
  return {
    coord: asStr(b['coord']),
    origin: strOrNull(b['origin']),
    phase: asStr(b['phase']),
    pass: asNum(b['pass']),
    units: asArr(b['units']).filter(isObj).map((u) => ({
      label: asStr(u['unit']),
      ref: strOrNull(u['ref']),
      owner: asStr(u['owner']),
      side: asStr(u['side']),
      init: asNum(u['init']),
      dmg: asNum(u['dmg']),
      def: asNum(u['def']),
      activated: asBool(u['activated']),
    })),
    commitments,
  };
}

function readCards(x: unknown): NggCard[] {
  return asArr(x).filter(isObj).map((c) => ({ card: asStr(c['card']), effect: asStr(c['effect']) }));
}

/** The seat view as typed data, or null when it is not an NGnG view. */
export function readView(view: unknown): NggView | null {
  if (!isObj(view) || view['game_id'] !== 'neither-guts-nor-gears') return null;
  const players = asArr(view['players']).filter(isObj).map(readPlayer);
  const map = isObj(view['map']) ? view['map'] : {};

  // Every piece, by coord, from the owners' own lists.
  const byCoord = new Map<string, NggPiece[]>();
  const put = (coord: string | null, piece: NggPiece) => {
    if (!coord) return;
    const list = byCoord.get(coord) ?? [];
    list.push(piece);
    byCoord.set(coord, list);
  };
  for (const p of players) {
    for (const h of p.heroes) {
      if (h.dead) continue;
      put(h.coord, { kind: 'hero', owner: p.id, name: h.name, id: null, leader: h.leader, core: null, resource: null, stats: h.stats, def: null });
    }
    for (const u of p.units) {
      put(u.coord, { kind: 'unit', owner: p.id, name: u.type, id: u.id, leader: false, core: u.core, resource: null, stats: null, def: u.def });
    }
    for (const c of p.collectors) {
      put(c.coord, { kind: 'collector', owner: p.id, name: c.id, id: c.id, leader: false, core: null, resource: c.resource, stats: null, def: null });
    }
  }

  const tiles: NggTile[] = asArr(map['tiles']).filter(isObj).map((t) => {
    const coord = asStr(t['coord']);
    const { c, r } = coordParts(coord);
    return {
      coord, c, r,
      label: asStr(t['label']),
      printedResource: strOrNull(t['printed_resource']),
      resource: strOrNull(t['current_resource']),
      start: typeof t['start'] === 'number' ? t['start'] : null,
      baseOwner: strOrNull(t['base_owner']),
      pieces: byCoord.get(coord) ?? [],
    };
  });

  const victory: NggView['victory'] = {};
  if (isObj(view['victory_status'])) {
    for (const [pid, v] of Object.entries(view['victory_status'])) {
      if (!isObj(v)) continue;
      victory[pid] = { culture: asNum(v['culture']), tech: asNum(v['tech']), leaderKills: asNum(v['leader_kills']), leaderAlive: asBool(v['leader_alive']) };
    }
  }

  return {
    phase: asStr(view['phase']),
    round: asNum(view['round']),
    activePlayerId: strOrNull(view['active_player_id']),
    firstPlayerId: strOrNull(view['first_player_id']),
    layout: asStr(view['layout']),
    tiles,
    players,
    stack: asArr(view['action_stack']).filter(isObj).map((a) => ({
      position: asNum(a['position']),
      owner: asStr(a['owner']),
      cardKind: strOrNull(a['card_kind']),
    })),
    activeAction: activeActionOf(view['resolving_action'] ?? view['active_action']),
    treaties: asArr(view['treaties']).filter(isObj).map((t) => {
      const partners = asArr(t['partners']).map((x) => asStr(x));
      return { name: asStr(t['treaty']), partners: [partners[0] ?? '', partners[1] ?? ''] as [string, string], cultureIncome: asNum(t['culture_income']) };
    }),
    battle: readBattle(view['battle']),
    deckCount: asNum(view['battle_deck_count']),
    discard: asArr(view['battle_discard']).map((c) => asStr(c)),
    pending: readPending(view['pending']),
    victory,
    result: view['result'] ?? null,
    heroPoolCount: asNum(view['hero_pool_count']),
    hand: readCards(view['your_battle_hand']),
    yourActionCardsPlayed: Array.isArray(view['your_action_cards_played']) ? asArr(view['your_action_cards_played']).map((c) => asStr(c)) : null,
    sharedHands: isObj(view['shared_tactics_hands'])
      ? Object.fromEntries(Object.entries(view['shared_tactics_hands']).map(([pid, cards]) => [pid, readCards(cards)]))
      : {},
    spies: asArr(view['your_spy_assignments']).filter(isObj).map((s) => ({ source: asStr(s['source']), hero: asStr(s['hero']), active: asBool(s['active']) })),
    knowledge: asArr(view['your_knowledge']),
    reservedHeroes: asArr(view['your_reserved_heroes']).map((h) => asStr(h)),
  };
}

export function playerOf(v: NggView, id: string | null): NggPlayer | null {
  return id ? v.players.find((p) => p.id === id) ?? null : null;
}

export function tileAt(v: NggView, coord: string | null): NggTile | null {
  return coord ? v.tiles.find((t) => t.coord === coord) ?? null : null;
}

/** "D4" for an engine coord; the coord itself only if the map lacks it. */
export function labelOf(v: NggView, coord: string | null): string {
  return tileAt(v, coord)?.label ?? coord ?? '';
}

/** The move's `type`, for filtering legal moves. */
export function moveType(move: Record<string, unknown>): string {
  return asStr(move['type']);
}
