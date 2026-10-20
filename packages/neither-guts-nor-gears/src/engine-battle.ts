// Neither Guts nor Gears — battle engine (§9 trigger/sides, §10 card batches,
// §9.3–9.5 activations + reaction ladder, §9.6 retreat, §9.7 stalemate/sweep)
// plus hero removal / overlay arbitration helpers used by engine.ts.
//
// Every rule here traces to the pinned text. Discriminating details:
//  - Reactions (Decoy / Mana Shield / Cleric) do NOT consume activations
//    (ruling 29 / §9.3 "Reactions ... follow their own eligibility and timing").
//  - AoE stats are FROZEN for the killing attack (Warden's bonus applies
//    throughout, then drops — ruling 31 / §9.5).
//  - Cards resolve: batches (Counters in first-player order, then Extras whose
//    additions form the NEXT batch), then remaining Rally→Retreat→Bonus→
//    Initiative in first-player order within type (§10.2–10.3, rulings 19–27).
//  - Shared Tactics: "your" = the PLAYING player (ruling 27); the move records
//    owner vs playing player separately. Owner-first applies only when BOTH
//    partners are battle participants.
//  - Retreat: defenders first, per-player independent, ALL of that player's
//    mobile units to ONE adjacent destination (rulings 34–38, 65, 69–70).

import { GameError } from '@zekel/game-kit';
import {
  BATTLE_CARDS, HEROES, ROBOT_UNITS, WIZARD_UNITS, heroStatsForCategory, type BattleCardId,
} from './data/catalogs.js';
import { coordKey, neighborsOf } from './data/maps.js';
import { unitById, resolveBattleCard, resolveCoord } from './resolvers.js';
import { tileName } from './names.js';
import type {
  Phase,
  BattleState, BattleUnit, CommittedCard, Coord, HeroInstance, MapUnit,
  NGGMove, NGGState, PlayerState,
} from './types.js';
import {
  advanceActionStack, areMilitaryAllies, baseAt, byId, cardByInstanceId,
  checkAllLeadersDeadDraw, checkVictory, collectorsAt, effectiveResourceAt,
  finishActionCard, hasCollectionAccess, heroAlivePlaced, heroesAt, isCombatUnit,
  locationOwner, log, playerOrderFrom, speciesOf, tileAt, treatyBetween, unitsAt,
  isUnitPiece, destroyCollector, collectorLabel,
  key,
  tell, battleSeats,
} from './engine.js';
import {
  CLERIC_SAVE_MANA, counterTargetGate, defenseGate, playableCardGroups, usableClerics,
} from './gates.js';

// ---------------------------------------------------------------------------
// Effective stats (battle-persistent modifiers + hero bonuses)
// ---------------------------------------------------------------------------

/** DEF of a map unit for hit tests (Metal Platforms raises platform DEF by 1;
 *  heroes and statless pieces unaffected — §7.10). */
/** A battle unit as the log names it: whose it is, then its printed name. */
function who(u: { ownerId: string; label: string }): string {
  return `${u.ownerId}'s ${u.label}`;
}

/** A unit's live numbers for the log — what a table checks against. */
function statLine(state: NGGState, u: BattleUnit): string {
  return `initiative ${currentInitOf(state, u)}, damage ${currentDmgOf(state, u)}, defense ${currentDefOf(state, u)}`;
}

function cardLabel(c: { card: BattleCardId }): string {
  return BATTLE_CARDS.find((x) => x.id === c.card)!.label;
}

export function effectiveDef(state: NGGState, u: MapUnit, battle?: BattleState | null): number | null {
  const def0 = unitById(u.typeId);
  if (!def0 || def0.def === null) return null;
  let def = def0.def;
  const owner = byId(state, u.ownerId);
  if (owner.research.includes('metal-platforms')) def += 1;
  if (battle) {
    def += modifierSum(state, battle, u.id, u.ownerId, 'def');
  }
  return Math.max(0, def); // §7.4 floor
}

export function effectiveDefOfHero(state: NGGState, h: HeroInstance, battle?: BattleState | null): number {
  const def = HEROES.find((x) => x.id === h.id)!;
  let v = heroStatsForCategory(def.category, h.isLeader).def;
  if (battle) v += modifierSum(state, battle, h.id, h.ownerId, 'def');
  return Math.max(0, v);
}

/** Hero battle bonuses (Warden +1 DEF others; Rook/Kestrel +2 DMG others) that
 *  apply to ALLIED units only, identical effects not stacking (§7.11/§8.2). */
function heroBonusFor(battle: BattleState, targetRef: string, targetOwner: string, stat: 'dmg' | 'def'): number {
  const target = battle.units.find((u) => u.unitRef === targetRef);
  if (!target) return 0;
  let sum = 0;
  const seenEffects = new Set<string>();
  for (const src of battle.units) {
    if (src.unitRef === targetRef) continue;
    if (src.side !== target.side) continue;
    const heroId = src.unitRef;
    const hero = HEROES.find((h) => h.id === heroId);
    if (!hero) continue;
    const key = `${hero.id}:${stat}`;
    if (seenEffects.has(hero.id)) continue; // identical hero effects don't stack
    if (stat === 'def' && hero.id === 'warden') { sum += 1; seenEffects.add(hero.id); }
    if (stat === 'dmg' && (hero.id === 'rook' || hero.id === 'kestrel')) {
      // Rook + Kestrel are identical +2 effects: only one applies (§7.11).
      if (![...seenEffects].some((s) => s === 'rook' || s === 'kestrel')) sum += 2;
      seenEffects.add(hero.id);
    }
    void key;
    void targetOwner;
  }
  return sum;
}

/** Public wrapper: a unit's live DMG/DEF modifier total in the current battle
 *  (persistent spell/card modifiers + hero bonuses). */
/** Live initiative = raw + battle-persistent modifiers (Ice Blast, Initiative
 *  cards) — the ONLY place initiative order is computed from. */
export function currentInitOf(state: NGGState, u: BattleUnit): number {
  return u.init + modifierSumPub(state, u, 'init');
}

export function modifierSumPub(state: NGGState, u: BattleUnit, stat: 'init' | 'dmg' | 'def' = 'dmg'): number {
  const b = state.battle;
  if (!b) return 0;
  return modifierSum(state, b, u.unitRef, u.ownerId, stat);
}

/** A unit's live DMG (§7.1, §7.4): a unit whose printed DMG is 0 never gains
 *  damage, and modifiers never take DMG below zero. The ONE computation that
 *  attacks, menus and views all read. */
export function currentDmgOf(state: NGGState, u: BattleUnit): number {
  if (u.dmg <= 0) return 0;
  return Math.max(0, u.dmg + modifierSumPub(state, u, 'dmg'));
}

/** Spell/card modifiers recorded on the battle, rest-of-battle persistent. */
function modifierSum(state: NGGState, battle: BattleState, targetRef: string, targetOwner: string, stat: 'init' | 'dmg' | 'def'): number {
  const target = battle.units.find((u) => u.unitRef === targetRef);
  if (!target) return 0;
  let sum = stat === 'init' ? 0 : heroBonusFor(battle, targetRef, targetOwner, stat as 'dmg' | 'def');
  for (const m of battle.modifiers) {
    const applies =
      m.targetRef === targetRef
      || (m.targetRef === 'all-attacking' && target.side === 'attackers')
      || (m.targetRef === 'all-defending' && target.side === 'defenders')
      || (m.targetRef === 'all-opposing-of' && false);
    if (!applies) continue;
    const v = m[stat];
    if (v) sum += v;
  }
  void state;
  return sum;
}

// ---------------------------------------------------------------------------
// Battle start (§9.1): sides, origin hex, commitments
// ---------------------------------------------------------------------------

/** A map unit or hero as it enters a battle: its printed stat line (effective
 *  values are read live — currentDmgOf / currentDefOf / currentInitOf). */
function battleUnitFor(state: NGGState, kind: 'unit' | 'hero', id: string, ownerId: string, side: 'attackers' | 'defenders'): BattleUnit {
  if (kind === 'unit') {
    const u = state.units.find((x) => x.id === id)!;
    const def = unitById(u.typeId)!;
    return {
      unitRef: id, ownerId, isHero: false, side, typeId: u.typeId,
      init: def.init ?? 0, dmg: def.dmg ?? 0, def: def.def ?? 0,
      aoe: def.aoe, activated: false, clericUsedThisPass: false,
      label: def.name,
    };
  }
  const h = state.heroes.find((x) => x.id === id)!;
  const def = HEROES.find((x) => x.id === id)!;
  const stats = heroStatsForCategory(def.category, h.isLeader);
  return {
    unitRef: id, ownerId, isHero: true, side,
    init: stats.init, dmg: stats.dmg, def: stats.def,
    aoe: false, activated: false, clericUsedThisPass: false,
    label: def.name,
  };
}

/** Identical units of one owner in a battle get numbers — "Dragon 1",
 *  "Dragon 2" — so the choices, the battle list and the log can tell them
 *  apart (playtest 2026-09-29: an Enhance landed on one of two Dragons and
 *  nothing said which; the other attacked first at its printed damage). A
 *  number, once given, stays with its unit for the whole battle: a survivor
 *  keeps "Dragon 2" after "Dragon 1" dies, and a unit that rallies in takes
 *  the next free number. Heroes are unique and never numbered. */
export function numberDuplicateUnits(units: BattleUnit[]): void {
  const groups = new Map<string, BattleUnit[]>();
  for (const u of units) {
    if (u.isHero) continue;
    const k = `${u.ownerId}|${u.typeId ?? u.label.replace(/ \d+$/, '')}`;
    const g = groups.get(k);
    if (g) g.push(u); else groups.set(k, [u]);
  }
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const used = new Set<number>();
    for (const u of g) { const m = u.label.match(/ (\d+)$/); if (m) used.add(Number(m[1])); }
    let n = 1;
    for (const u of g) {
      if (/ \d+$/.test(u.label)) continue;
      while (used.has(n)) n++;
      u.label = `${u.label} ${n}`;
      used.add(n);
    }
  }
}

export function startBattle(
  state: NGGState, attacker: PlayerState, origin: Coord, at: Coord,
  attackers: Array<{ kind: 'unit' | 'hero'; id: string }>, defenderIds: string[],
): void {
  const units: BattleUnit[] = [];
  const push = (kind: 'unit' | 'hero', id: string, ownerId: string, side: 'attackers' | 'defenders') => {
    units.push(battleUnitFor(state, kind, id, ownerId, side));
  };
  for (const a of attackers) push(a.kind, a.id, attacker.playerId, 'attackers');
  // The attacker's OWN combat pieces already standing on the battle tile join
  // the attack (§9.1: everything of both sides in the space fights — a piece
  // parked there earlier is not exempt). Non-combat/Coreless pieces never join.
  const movers = new Set(attackers.map((a) => a.id));
  for (const u of unitsAt(state, at)) {
    if (u.ownerId !== attacker.playerId) continue;
    if (movers.has(u.id)) continue;
    if (isCombatUnit(u)) push('unit', u.id, u.ownerId, 'attackers');
  }
  for (const h of heroesAt(state, at)) {
    if (h.ownerId !== attacker.playerId) continue;
    if (movers.has(h.id)) continue;
    push('hero', h.id, h.ownerId, 'attackers');
  }
  // Defenders: every opposing non-allied combat unit (incl. heroes) present.
  for (const u of unitsAt(state, at)) {
    if (u.ownerId === attacker.playerId) continue;
    if (areMilitaryAllies(state, attacker.playerId, u.ownerId)) continue;
    if (isCombatUnit(u)) push('unit', u.id, u.ownerId, 'defenders');
  }
  for (const h of heroesAt(state, at)) {
    if (h.ownerId === attacker.playerId) continue;
    if (areMilitaryAllies(state, attacker.playerId, h.ownerId)) continue;
    push('hero', h.id, h.ownerId, 'defenders');
  }
  // Open Borders co-occupants MUST join the defense (§9.1).
  for (const u of unitsAt(state, at)) {
    if (u.ownerId === attacker.playerId) continue;
    if (units.some((x) => x.unitRef === u.id)) continue;
    const coDefender = defenderIds.includes(u.ownerId);
    if (coDefender && areMilitaryAllies(state, u.ownerId, defenderIds[0] ?? '') && isCombatUnit(u)) {
      push('unit', u.id, u.ownerId, 'defenders');
    }
  }
  numberDuplicateUnits(units);
  state.battle = {
    coord: at,
    originCoord: origin,
    units,
    commitments: {},
    committed: [],
    pendingBatch: [],
    phase: 'commit',
    cardCursor: 0,
    pass: 1,
    kills: [],
    activationQueue: [],
    activationCursor: 0,
    defense: null,
    rallyPendings: [],
    retreatCardPendings: [],
    modifiers: [],
    killThisPass: false,
  };
  state.battle.sides = Object.fromEntries(units.map((u) => [u.ownerId, u.side]));
  // Arm commitments per participant holding cards (secret until all in, §9.2).
  const participants = [...new Set(units.map((u) => u.ownerId))];
  for (const pid of participants) {
    state.battle!.commitments[pid] = 'pending';
  }
  armNextCommitment(state);
  const side = (x: 'attackers' | 'defenders') => units.filter((u) => u.side === x).map((u) => `${who(u)} (${statLine(state, u)})`).join('; ') || 'nobody';
  log(state, { phase: 'battle', actor: attacker.playerId, category: 'battle', ...key(`${attacker.playerId} attacked ${at}`), summary: `A battle begins at ${at}; ${attacker.playerId} attacks from ${origin}. Attacking: ${side('attackers')}. Defending: ${side('defenders')}` });
}

function armNextCommitment(state: NGGState): void {
  const b = state.battle!;
  const waiting = Object.entries(b.commitments).find(([, v]) => v === 'pending');
  if (!waiting) {
    // §11.2 owner first: a seat that committed no card gets one more look at
    // a Shared Tactics partner's card once that owner has decided not to
    // play it — the owner deciding later must not shut the partner out.
    const second = Object.entries(b.commitments).find(([pid, c]) => c === 'pass'
      && !(b.borrowOffered ?? []).includes(pid)
      && playableCardGroups(state, pid).some((g) => g.open.some((x) => x.ownerId !== pid)));
    if (second) {
      const [pid] = second;
      (b.borrowOffered ??= []).push(pid);
      b.commitments[pid] = 'pending';
      state.pending = { kind: 'battle_commit', forPlayerId: pid };
      state.activePlayerId = pid;
      return;
    }
    // All in — reveal together, then run card batches before activations (§9.2).
    revealCommitments(state);
    return;
  }
  const [pid] = waiting;
  state.pending = { kind: 'battle_commit', forPlayerId: pid };
  state.activePlayerId = pid;
}

export function commitBattleCard(state: NGGState, playerId: string, cardName: string | null): string {
  const b = state.battle;
  if (!b || b.phase !== 'commit') throw new GameError('ILLEGAL_MOVE', 'No battle commitment is open');
  if (state.pending?.kind !== 'battle_commit' || state.pending.forPlayerId !== playerId) {
    throw new GameError('NOT_YOUR_TURN', 'Not your commitment');
  }
  if (cardName === null) {
    b.commitments[playerId] = 'pass'; // passing is permitted even holding cards (r17)
  } else {
    const card = resolveBattleCard(cardName);
    const instanceId = findPlayableCardInstance(state, playerId, card.id, b);
    // The instance is RESERVED the moment it commits — it stays in its owner's
    // hand until the joint reveal (it's secret), but every later selection path
    // must exclude reserved ids (probe finding #7: Shared Tactics partners
    // cannot both commit one physical instance).
    b.commitments[playerId] = { cardInstanceId: instanceId, playingPlayerId: playerId };
  }
  state.pending = null;
  // Public: that this seat has chosen — never what (secret until the reveal).
  log(state, { phase: 'battle', actor: playerId, category: 'battle-cards', summary: `${playerId} has chosen their battle card, face down` });
  const before = state.log.length;
  armNextCommitment(state);
  // The last commitment reveals every card and resolves them: say what
  // happened (a battle can even end here, before any unit acts).
  if (state.battle?.phase !== 'commit') {
    const happened = state.log.slice(before).map((e) => e.summary);
    return `${playerId} committed. ${happened.join('. ')}.`;
  }
  return `${playerId} committed (secret until all commit).`;
}

/** Find a card instance the seat may play right now: their own hand, plus a
 *  Shared Tactics partner's cards (owner-first only when BOTH partners are in
 *  the battle — ruling 27). Reserved instances (already committed or staged)
 *  are off-limits (probe finding #7). Both rules live in gates.ts
 *  battleCardGate; a refusal throws that gate's sentence verbatim. */
function findPlayableCardInstance(state: NGGState, playingPlayerId: string, cardId: BattleCardId, _b: BattleState): string {
  const group = playableCardGroups(state, playingPlayerId).find((g) => g.card === cardId);
  const open = group?.open[0];
  if (open) return open.instanceId;
  if (group && group.shut.length > 0) throw new GameError('ILLEGAL_MOVE', group.shut[0]!.reason);
  const me = byId(state, playingPlayerId);
  throw new GameError('ILLEGAL_MOVE', `You hold no playable "${BATTLE_CARDS.find((c) => c.id === cardId)!.label}" (your hand: ${me.hand.map((x) => BATTLE_CARDS.find((c) => c.id === cardByInstanceId(x))!.label).join(', ') || 'empty'})`);
}

function revealCommitments(state: NGGState): void {
  const b = state.battle!;
  const committed: CommittedCard[] = [];
  for (const [pid, c] of Object.entries(b.commitments)) {
    if (c === 'pending' || c === 'pass') continue;
    const owner = byId(state, state.cardOwners[c.cardInstanceId] ?? pid);
    owner.hand = owner.hand.filter((id) => id !== c.cardInstanceId);
    committed.push({ cardInstanceId: c.cardInstanceId, card: cardByInstanceId(c.cardInstanceId), playingPlayerId: c.playingPlayerId, ownerId: state.cardOwners[c.cardInstanceId] ?? pid, resolved: false, countered: false, batch: 0 });
  }
  b.committed = committed;
  b.phase = 'cards';
  b.cardCursor = 0;
  const passed = Object.entries(b.commitments).filter(([, c]) => c === 'pass').map(([pid]) => pid);
  const names = committed.map((c) => `${c.playingPlayerId} played ${cardLabel(c)}`).join('; ');
  log(state, { phase: 'battle', actor: null, category: 'battle-cards', ...key(names ? `Battle cards: ${names}` : 'No battle cards were played'), summary: names ? `Battle cards are revealed: ${names}${passed.length ? `; ${passed.join(' and ')} played none` : ''}` : 'Battle cards are revealed: nobody played a card' });
  resolveCardBatches(state);
}

// ---------------------------------------------------------------------------
// §10.2 Counter/Extra batches + §10.3 remaining order
// ---------------------------------------------------------------------------

export function resolveCardBatches(state: NGGState): void {
  const b = state.battle!;
  // Current batch = unresolved committed Counters (first-player order), then Extras.
  const fpo = playerOrderFrom(state, state.firstPlayerIndex);
  const byFpo = (x: CommittedCard, y: CommittedCard) => fpo.indexOf(x.playingPlayerId) - fpo.indexOf(y.playingPlayerId);
  const counters = b.committed.filter((c) => !c.resolved && !c.countered && c.card === 'counter').sort(byFpo);
  if (counters.length > 0) {
    const target = counters[0]!;
    if (byId(state, target.playingPlayerId).kind === 'ai') {
      // AI counter policy (mechanical): counter the first opposing unresolved card.
      const opp = b.committed.find((c) => !c.resolved && !c.countered && c.playingPlayerId !== target.playingPlayerId && c !== target);
      markCountered(state, target, opp ?? null);
      return resolveCardBatches(state);
    }
    // A Counter with nothing it may cancel resolves with no target, for a
    // person as for the AI: owing a choice with no legal answer would stall
    // the battle (the shut options would all carry counterTargetGate's reason).
    if (!b.committed.some((c) => c !== target && counterTargetGate.check(state, target.playingPlayerId, c) === null)) {
      markCountered(state, target, null);
      return resolveCardBatches(state);
    }
    const idx = b.committed.indexOf(target);
    state.pending = { kind: 'counter_target', forPlayerId: target.playingPlayerId, cardIndex: idx };
    state.activePlayerId = target.playingPlayerId;
    return;
  }
  const extras = b.committed.filter((c) => !c.resolved && !c.countered && c.card === 'extra').sort(byFpo);
  if (extras.length > 0) {
    const target = extras[0]!;
    if (byId(state, target.playingPlayerId).kind === 'ai') {
      // AI extra policy: play up to two remaining own-hand non-extra cards.
      const owner = byId(state, target.playingPlayerId);
      const adds = owner.hand.slice(0, 2);
      applyExtraSelection(state, target, adds);
      return resolveCardBatches(state);
    }
    const idx = b.committed.indexOf(target);
    state.pending = { kind: 'extra_selection', forPlayerId: target.playingPlayerId, cardIndex: idx };
    state.activePlayerId = target.playingPlayerId;
    return;
  }
  // Batch exhausted: if pendingBatch has additions, fold them in and repeat.
  if (b.pendingBatch.length > 0) {
    const nextBatch = Math.max(0, ...b.committed.map((c) => c.batch ?? 0)) + 1;
    for (const c of b.pendingBatch) c.batch = nextBatch;
    b.committed.push(...b.pendingBatch);
    log(state, { phase: 'battle', actor: null, category: 'battle-cards', summary: `The cards added by Extra resolve next: ${b.pendingBatch.map((c) => `${c.playingPlayerId}'s ${cardLabel(c)}`).join(', ')}` });
    b.pendingBatch = [];
    return resolveCardBatches(state);
  }
  resolveRemainingCards(state);
}

function markCountered(state: NGGState, counter: CommittedCard, target: CommittedCard | null): void {
  const b = state.battle!;
  counter.resolved = true;
  discardCommitted(state, counter);
  if (target) {
    target.countered = true;
    target.resolved = true;
    // Countered cards go to the public discard too; an Extra's would-be
    // additions stay secret in hand (ruling 20/23).
    discardCommitted(state, target);
    log(state, { phase: 'battle', actor: counter.playingPlayerId, category: 'battle-cards', ...key(`${counter.playingPlayerId}'s Counter cancelled ${target.playingPlayerId}'s ${cardLabel(target)}`, { id: target.playingPlayerId, line: `${counter.playingPlayerId}'s Counter cancelled your ${cardLabel(target)}`, loss: true, notify: true }), summary: `${counter.playingPlayerId}'s Counter cancels ${target.playingPlayerId}'s ${cardLabel(target)}; both cards are discarded` });
  } else {
    log(state, { phase: 'battle', actor: counter.playingPlayerId, category: 'battle-cards', summary: `${counter.playingPlayerId}'s Counter has nothing to cancel and is discarded` });
  }
  void b;
}

export function chooseCounterTarget(state: NGGState, playerId: string, cardTarget: string, playedBy?: string, batch?: number): string {
  const b = state.battle!;
  if (state.pending?.kind !== 'counter_target' || state.pending.forPlayerId !== playerId) throw new GameError('NOT_YOUR_TURN', 'Not your Counter');
  const counter = b.committed[state.pending.cardIndex]!;
  // Target: an eligible UNRESOLVED card by printed name, narrowed to the
  // player who played it (and its batch) — two copies played by different
  // players are different targets (§10.2).
  const want = resolveBattleCard(cardTarget);
  const named = b.committed.filter((c) => c.card === want.id
    && (playedBy === undefined || c.playingPlayerId === playedBy)
    && (batch === undefined || (c.batch ?? 0) === batch));
  const candidates = named.filter((c) => counterTargetGate.check(state, playerId, c) === null);
  const players = [...new Set(candidates.map((c) => c.playingPlayerId))];
  if (playedBy === undefined && players.length > 1) {
    throw new GameError('AMBIGUOUS_MOVE', `More than one player played "${want.label}" — say whose to counter (played_by: ${players.join(' or ')})`);
  }
  if (candidates.length === 0) {
    const shut = named.map((c) => counterTargetGate.check(state, playerId, c)).find((r) => r !== null);
    if (shut) throw new GameError('ILLEGAL_MOVE', shut);
    throw new GameError('ILLEGAL_MOVE', `No unresolved "${want.label}" to counter. Unresolved: ${b.committed.filter((c) => !c.resolved && !c.countered && c !== counter).map((c) => `${BATTLE_CARDS.find((x) => x.id === c.card)!.label} (${c.playingPlayerId})`).join(', ') || 'none'}`);
  }
  state.pending = null;
  const target = candidates[0]!;
  markCountered(state, counter, target);
  resolveCardBatches(state);
  return `Counter cancels ${target.playingPlayerId}'s ${want.label}.`;
}

export function selectExtraCards(state: NGGState, playerId: string, cards: string[]): string {
  const b = state.battle!;
  if (state.pending?.kind !== 'extra_selection' || state.pending.forPlayerId !== playerId) throw new GameError('NOT_YOUR_TURN', 'Not your Extra');
  if (cards.length > 2) throw new GameError('ILLEGAL_MOVE', 'Extra adds up to two cards');
  const extra = b.committed[state.pending.cardIndex]!;
  const added: CommittedCard[] = [];
  const takenIds = new Set<string>();
  for (const name of cards) {
    const card = resolveBattleCard(name);
    const id = findPlayableCardInstance(state, playerId, card.id, b);
    if (takenIds.has(id)) throw new GameError('ILLEGAL_MOVE', 'An Extra cannot add the same physical card twice');
    takenIds.add(id);
    const ownerId = state.cardOwners[id] ?? playerId;
    byId(state, ownerId).hand = byId(state, ownerId).hand.filter((x) => x !== id);
    added.push({ cardInstanceId: id, card: card.id, playingPlayerId: playerId, ownerId, resolved: false, countered: false });
  }
  state.pending = null;
  applyExtraSelection(state, extra, null, added);
  resolveCardBatches(state);
  return `Extra adds ${added.length} card(s).`;
}

function applyExtraSelection(state: NGGState, extra: CommittedCard, aiHandIds: string[] | null, addedCards?: CommittedCard[]): void {
  const b = state.battle!;
  extra.resolved = true;
  discardCommitted(state, extra);
  let added = addedCards ?? [];
  if (aiHandIds) {
    added = [];
    for (const id of aiHandIds) {
      const ownerId = state.cardOwners[id] ?? extra.playingPlayerId;
      byId(state, ownerId).hand = byId(state, ownerId).hand.filter((x) => x !== id);
      added.push({ cardInstanceId: id, card: cardByInstanceId(id), playingPlayerId: extra.playingPlayerId, ownerId, resolved: false, countered: false });
    }
  }
  b.pendingBatch.push(...added);
  log(state, { phase: 'battle', actor: extra.playingPlayerId, category: 'battle-cards', ...(added.length ? key(`${extra.playingPlayerId}'s Extra added ${added.map(cardLabel).join(' and ')}`) : {}), summary: added.length
    ? `${extra.playingPlayerId}'s Extra adds ${added.map(cardLabel).join(' and ')} from hand`
    : `${extra.playingPlayerId}'s Extra adds no cards` });
}

/** A committed card that finished (resolved or countered) goes to the public
 *  discard (§10.1); the physical-deck remainder is credited on discards so
 *  conservation holds across report-drawn physical cards too. */
function discardCommitted(state: NGGState, c: CommittedCard): void {
  // Played cards (incl. countered ones) go to the PUBLIC discard (§10.1); the
  // physical remainder view derives from the pool and needs no mutation.
  state.battleDiscard.push(c.cardInstanceId);
}

// §10.3 after batches: Rally → Retreat → Bonus → Initiative, FPO within type.
function resolveRemainingCards(state: NGGState): void {
  const b = state.battle!;
  const fpo = playerOrderFrom(state, state.firstPlayerIndex);
  const byFpo = (x: CommittedCard, y: CommittedCard) => fpo.indexOf(x.playingPlayerId) - fpo.indexOf(y.playingPlayerId);
  // Every surviving Rally, each card its own selection, in first-player order.
  const rallies = b.committed.filter((c) => !c.countered && !c.resolved && c.card === 'rally').sort(byFpo);
  b.rallyPendings = rallies.map((c) => ({ playingPlayerId: c.playingPlayerId, cardInstanceId: c.cardInstanceId }));
  continueRallies(state);
}

/** A seat's units that a Rally may bring in: its own mobile units and heroes
 *  on tiles ADJACENT to the battle — never a collector, an Immobile Combat
 *  Platform, or a Coreless platform (not a unit, cannot act — §7.7). */
export function rallyEligible(state: NGGState, playerId: string): Array<{ kind: 'unit' | 'hero'; id: string; label: string; coord: Coord }> {
  const b = state.battle!;
  const battleTile = tileAt(state, b.coord);
  const adjacent = new Set(neighborsOf(state.tiles, battleTile.c, battleTile.r).map((t) => coordKey(t.c, t.r)));
  const out: Array<{ kind: 'unit' | 'hero'; id: string; label: string; coord: Coord }> = [];
  for (const u of state.units) {
    if (u.ownerId !== playerId || !adjacent.has(u.coord)) continue;
    const def = unitById(u.typeId);
    if (!def || def.collector || def.immobile || !isCombatUnit(u)) continue;
    out.push({ kind: 'unit', id: u.id, label: def.name, coord: u.coord });
  }
  for (const h of state.heroes) {
    if (h.ownerId !== playerId || h.dead || !h.coord || !adjacent.has(h.coord)) continue;
    out.push({ kind: 'hero', id: h.id, label: HEROES.find((x) => x.id === h.id)!.name, coord: h.coord });
  }
  return out;
}

/** Resolve the queued Rally cards one at a time. A card whose player has
 *  nothing to bring resolves without a question. */
function continueRallies(state: NGGState): void {
  const b = state.battle!;
  while (b.rallyPendings.length > 0) {
    const head = b.rallyPendings[0]!;
    const card = b.committed.find((c) => c.cardInstanceId === head.cardInstanceId)!;
    if (rallyEligible(state, head.playingPlayerId).length === 0) {
      card.resolved = true;
      discardCommitted(state, card);
      b.rallyPendings.shift();
      log(state, { phase: 'battle', actor: head.playingPlayerId, category: 'battle-cards', summary: `${head.playingPlayerId}'s Rally has no unit next to the battle to bring in` });
      continue;
    }
    state.pending = { kind: 'rally_selection', forPlayerId: head.playingPlayerId, cardInstanceId: head.cardInstanceId };
    state.activePlayerId = head.playingPlayerId;
    return;
  }
  resolveRetreatCards(state);
}

export function selectRallyUnits(state: NGGState, playerId: string, unitIds: string[]): string {
  const b = state.battle!;
  const pendRally = state.pending;
  if (pendRally?.kind !== 'rally_selection' || pendRally.forPlayerId !== playerId) throw new GameError('NOT_YOUR_TURN', 'Not your Rally');
  // Move any number of OWN eligible mobile units from ADJACENT locations into
  // the battle (the playing player's units — ruling 27 borrowed-card reading).
  const eligible = rallyEligible(state, playerId);
  const picked: typeof eligible = [];
  for (const want of unitIds) {
    const m = eligible.find((e) => (e.id === want || e.label.toLowerCase() === want.toLowerCase()) && !picked.includes(e));
    if (!m) throw new GameError('ILLEGAL_MOVE', `Rally brings your own mobile units from tiles next to the battle — "${want}" is not one (eligible: ${eligible.map((e) => `${e.label} (${e.id}) at ${e.coord}`).join(', ') || 'none'})`);
    picked.push(m);
  }
  const origins = new Set<Coord>();
  for (const m of picked) {
    origins.add(m.coord);
    if (m.kind === 'unit') state.units.find((x) => x.id === m.id)!.coord = b.coord;
    else state.heroes.find((x) => x.id === m.id)!.coord = b.coord;
    b.units.push(battleUnitFor(state, m.kind, m.id, playerId, sideOf(b, playerId)));
  }
  numberDuplicateUnits(b.units);
  for (const c of origins) refreshOverlay(state, c);
  refreshOverlay(state, b.coord);
  const card = b.committed.find((c) => c.cardInstanceId === pendRally.cardInstanceId)!;
  card.resolved = true;
  discardCommitted(state, card);
  b.rallyPendings = b.rallyPendings.filter((r) => r.cardInstanceId !== pendRally.cardInstanceId);
  state.pending = null;
  log(state, { phase: 'battle', actor: playerId, category: 'battle-cards', ...key(`${playerId}'s Rally brought ${picked.length ? picked.map((m) => m.label).join(', ') : 'nothing'} into the battle`), summary: `Rally brings ${picked.length ? picked.map((m) => `${m.label} from ${m.coord}`).join(', ') : 'nothing'} into the battle at ${b.coord}` });
  continueRallies(state);
  return `Rally resolves.`;
}

function sideOf(b: BattleState, playerId: string): 'attackers' | 'defenders' {
  // The side a seat joined on — kept after its units retreat, so a card it
  // played still reads "your"/"opposing" from the right side.
  const joined = b.sides?.[playerId];
  if (joined) return joined;
  return b.units.some((u) => u.ownerId === playerId && u.side === 'defenders') ? 'defenders' : 'attackers';
}

/** Surviving Retreat cards, in first-player order: each withdraws ALL of its
 *  PLAYING player's mobile units by the normal retreat rules (§9.6, §10.1).
 *  Where they go is that player's choice; with one eligible destination, or
 *  none, there is nothing to ask. */
function resolveRetreatCards(state: NGGState): void {
  const b = state.battle!;
  const fpo = playerOrderFrom(state, state.firstPlayerIndex);
  for (;;) {
    const c = b.committed.filter((x) => !x.resolved && !x.countered && x.card === 'retreat')
      .sort((x, y) => fpo.indexOf(x.playingPlayerId) - fpo.indexOf(y.playingPlayerId))[0];
    if (!c) break;
    const pid = c.playingPlayerId;
    const mobile = b.units.filter((u) => u.ownerId === pid && isMobileInBattle(u));
    const { eligible } = withdrawalDestinations(state, pid);
    if (mobile.length > 0 && eligible.length > 1 && byId(state, pid).kind === 'human') {
      state.pending = { kind: 'retreat', forPlayerId: pid, viaCard: c.cardInstanceId };
      state.activePlayerId = pid;
      return;
    }
    c.resolved = true;
    discardCommitted(state, c);
    // An AI seat takes the first eligible destination (allied-unit spaces
    // come first); a single destination leaves no choice.
    applyRetreatForPlayer(state, pid, eligible[0] ?? null, 'card');
  }
  if (b.units.length === 0 || allOneSide(state, b)) { settleBattle(state); return; }
  // Bonus then Initiative (persistent modifiers).
  const bonuses = b.committed.filter((c) => !c.countered && !c.resolved && c.card.startsWith('bonus-')).sort((x, y) => fpo.indexOf(x.playingPlayerId) - fpo.indexOf(y.playingPlayerId));
  for (const c of bonuses) {
    applyBonus(state, c);
    c.resolved = true;
    discardCommitted(state, c);
  }
  const inits = b.committed.filter((c) => !c.countered && !c.resolved && c.card === 'initiative').sort((x, y) => fpo.indexOf(x.playingPlayerId) - fpo.indexOf(y.playingPlayerId));
  for (const c of inits) {
    // −100 Init to all OPPOSING units (relative to the playing player).
    for (const u of b.units) {
      if (u.ownerId !== c.playingPlayerId && u.side !== sideOf(b, c.playingPlayerId)) {
        b.modifiers.push({ targetRef: u.unitRef, init: -100, source: `initiative-${c.cardInstanceId}` });
      }
    }
    c.resolved = true;
    discardCommitted(state, c);
    log(state, { phase: 'battle', actor: c.playingPlayerId, category: 'battle-cards', summary: `${c.playingPlayerId}'s Initiative card: every opposing unit gets initiative minus 100 for this battle` });
  }
  beginActivations(state);
}

function applyBonus(state: NGGState, c: CommittedCard): void {
  const b = state.battle!;
  // "your"/"opposing" read from the PLAYING player (ruling 27). Record in the
  // modifiers table too — `currentDefOf` / hero defense recompute from the
  // catalog, so a plain BattleUnit mutation never reaches hit tests
  // (probe finding #6: a +1 DEF Dragon still died to a Spinner).
  // "Your units" are the PLAYING player's own units — not an ally's (§10.1,
  // §10.3); "opposing units" are everyone on the other side.
  const mySide = sideOf(b, c.playingPlayerId);
  for (const u of b.units) {
    switch (c.card) {
      case 'bonus-def-plus': {
        if (u.ownerId === c.playingPlayerId) b.modifiers.push({ targetRef: u.unitRef, def: 1, source: `bonus-${c.cardInstanceId}` });
        break;
      }
      case 'bonus-dmg-plus': {
        if (u.ownerId === c.playingPlayerId && u.dmg > 0) b.modifiers.push({ targetRef: u.unitRef, dmg: 1, source: `bonus-${c.cardInstanceId}` });
        break;
      }
      case 'bonus-def-minus': {
        if (u.side !== mySide) b.modifiers.push({ targetRef: u.unitRef, def: -1, source: `bonus-${c.cardInstanceId}` });
        break;
      }
      case 'bonus-dmg-minus': {
        if (u.side !== mySide && u.dmg > 0) b.modifiers.push({ targetRef: u.unitRef, dmg: -1, source: `bonus-${c.cardInstanceId}` });
        break;
      }
    }
  }
  const hit = b.units.filter((u) => b.modifiers.some((m) => m.targetRef === u.unitRef && m.source === `bonus-${c.cardInstanceId}`));
  log(state, { phase: 'battle', actor: c.playingPlayerId, category: 'battle-cards', summary: `${c.playingPlayerId}'s ${cardLabel(c)} card applies for the rest of the battle to: ${hit.map((u) => `${who(u)} (now ${statLine(state, u)})`).join('; ') || 'no unit'}` });
}

function allOneSide(state: NGGState, b: BattleState): boolean {
  const sides = new Set(b.units.map((u) => u.side));
  void state;
  return sides.size <= 1;
}

// ---------------------------------------------------------------------------
// Initiative passes + activation (§9.3)
// ---------------------------------------------------------------------------

function beginActivations(state: NGGState): void {
  const b = state.battle!;
  b.phase = 'activations';
  b.pass = 1;
  b.killThisPass = false;
  for (const u of b.units) { u.activated = false; u.clericUsedThisPass = false; }
  queuePass(state);
}

function queuePass(state: NGGState): void {
  const b = state.battle!;
  const order = [...b.units].sort((x, y) => {
    const xi = currentInitOf(state, x), yi = currentInitOf(state, y);
    if (yi !== xi) return yi - xi;
    // Opposing-side ties: defenders first (§9.3). Same-side ties: agreement or
    // the earlier-FPO owner picks — engine default surfaces an initiative_tie
    // pending when both are human; AI/all-AI resolves deterministically.
    if (x.side !== y.side) return x.side === 'defenders' ? -1 : 1;
    const fpo = playerOrderFrom(state, state.firstPlayerIndex);
    return fpo.indexOf(x.ownerId) - fpo.indexOf(y.ownerId);
  });
  b.activationQueue = order.map((u) => u.unitRef);
  b.activationCursor = 0;
  delete b.tieSettled;
  offerNextActivation(state);
}

function offerNextActivation(state: NGGState): void {
  const b = state.battle!;
  while (b.activationCursor < b.activationQueue.length) {
    const ref = b.activationQueue[b.activationCursor]!;
    const u = b.units.find((x) => x.unitRef === ref);
    if (!u || u.activated) { b.activationCursor += 1; continue; }
    state.pending = null;
    // §9.3: allied units tied on initiative go in the order their owners
    // agree; failing that, the tied owner earliest in first-player order
    // picks which goes next. Asked once per slot.
    const tie = tieGroupAtCursor(state);
    const owners = [...new Set(tie.map((x) => x.ownerId))];
    if (owners.length > 1 && b.tieSettled !== b.activationCursor) {
      const chooser = playerOrderFrom(state, state.firstPlayerIndex).find((pid) => owners.includes(pid))!;
      state.pending = { kind: 'initiative_tie', forPlayerId: chooser, tieGroup: tie.map((x) => x.unitRef) };
      state.activePlayerId = chooser;
      return;
    }
    state.activePlayerId = u.ownerId;
    return; // the owner picks this unit's activation (legalMoves enumerates)
  }
  endPass(state);
}

/** The not-yet-activated units tied with the unit on the clock: same side,
 *  same current initiative (the queue keeps them together). */
export function tieGroupAtCursor(state: NGGState): BattleUnit[] {
  const b = state.battle!;
  const head = b.units.find((x) => x.unitRef === b.activationQueue[b.activationCursor]);
  if (!head || head.activated) return [];
  const init = currentInitOf(state, head);
  return b.activationQueue.slice(b.activationCursor)
    .map((ref) => b.units.find((x) => x.unitRef === ref))
    .filter((x): x is BattleUnit => !!x && !x.activated && x.side === head.side && currentInitOf(state, x) === init);
}

/** Put a tied unit next in the pass (it keeps its single activation). */
function bringToCursor(state: NGGState, unitRef: string): void {
  const b = state.battle!;
  const done = b.activationQueue.slice(0, b.activationCursor);
  const rest = b.activationQueue.slice(b.activationCursor).filter((r) => r !== unitRef);
  b.activationQueue = [...done, unitRef, ...rest];
}

export function chooseInitiativeOrder(state: NGGState, playerId: string, unit: string): string {
  const b = state.battle;
  const pend = state.pending;
  if (!b || pend?.kind !== 'initiative_tie' || pend.forPlayerId !== playerId) throw new GameError('NOT_YOUR_TURN', 'No initiative tie awaits your pick');
  const pick = b.units.find((x) => pend.tieGroup.includes(x.unitRef) && !x.activated && (x.unitRef === unit || x.label.toLowerCase() === unit.toLowerCase()));
  if (!pick) throw new GameError('ILLEGAL_MOVE', `Pick one of the tied units: ${pend.tieGroup.join(', ')}`);
  bringToCursor(state, pick.unitRef);
  b.tieSettled = b.activationCursor;
  state.pending = null;
  log(state, { phase: 'battle', actor: playerId, category: 'battle', summary: `Initiative tie: ${playerId} picks ${who(pick)} to act next` });
  offerNextActivation(state);
  return `${pick.label} acts next.`;
}

/** Re-sort the REMAINING activation queue by current initiative (Ice Blast,
 *  ruling 45: the blasted unit drops to the back of the pass). Units that
 *  already acted keep their single activation; the queue is re-sorted but the
 *  cursor keeps pointing at the same "already served" prefix — never a second
 *  activation for acted units. */
export function resortRemainingQueue(state: NGGState): void {
  const b = state.battle!;
  const done = b.activationQueue.slice(0, b.activationCursor);
  const remaining = b.activationQueue
    .slice(b.activationCursor)
    .filter((ref) => { const u = b.units.find((x) => x.unitRef === ref); return !!u && !u.activated; });
  const fpo = playerOrderFrom(state, state.firstPlayerIndex);
  remaining.sort((ra, rb) => {
    const ua = b.units.find((x) => x.unitRef === ra)!;
    const ub = b.units.find((x) => x.unitRef === rb)!;
    const ia = currentInitOf(state, ua), ib = currentInitOf(state, ub);
    if (ib !== ia) return ib - ia;
    if (ua.side !== ub.side) return ua.side === 'defenders' ? -1 : 1;
    return fpo.indexOf(ua.ownerId) - fpo.indexOf(ub.ownerId);
  });
  b.activationQueue = [...done, ...remaining];
}

function endPass(state: NGGState): void {
  const b = state.battle!;
  // §9.6 retreat window first (both sides remain): defenders declare first,
  // each allied player independently. THEN, if the pass had no kill and the
  // battle still stands, it's a stalemate (§9.7).
  const sidesAlive = new Set(b.units.map((u) => u.side));
  if (sidesAlive.size < 2) { settleBattle(state); return; }
  // Defenders declare first; within a side, first-player order (§5.6).
  const fpo = playerOrderFrom(state, state.firstPlayerIndex);
  const bySeat = (x: string, y: string) => fpo.indexOf(x) - fpo.indexOf(y);
  const defenders = [...new Set(b.units.filter((u) => u.side === 'defenders').map((u) => u.ownerId))].sort(bySeat);
  const attackers = [...new Set(b.units.filter((u) => u.side === 'attackers').map((u) => u.ownerId))].sort(bySeat);
  const order = [...defenders, ...attackers].filter((pid) => b.units.some((u) => u.ownerId === pid));
  offerNextRetreat(state, order);
}

function offerNextRetreat(state: NGGState, order: string[]): void {
  const b = state.battle!;
  while (order.length > 0) {
    const pid = order.shift()!;
    // Only a seat that could actually retreat is asked (§9.6: with no eligible
    // adjacent destination, the player cannot retreat).
    if (!b.units.some((u) => u.ownerId === pid && isMobileInBattle(u))) continue;
    if (withdrawalDestinations(state, pid).eligible.length === 0) continue;
    if (byId(state, pid).kind === 'ai') {
      // AI stay/retreat policy: AI stands (conservative).
      log(state, { phase: 'battle', actor: pid, category: 'retreat', summary: `${pid} stays in the battle (does not retreat)` });
      continue;
    }
    state.pending = { kind: 'retreat', forPlayerId: pid };
    state.activePlayerId = pid;
    (b as unknown as { __retreatOrder?: string[] }).__retreatOrder = order;
    return;
  }
  nextPassOrSettle(state);
}

export function chooseRetreat(state: NGGState, playerId: string, move: Extract<NGGMove, { type: 'choose_retreat' }>): string {
  const b = state.battle!;
  const pend = state.pending;
  if (pend?.kind !== 'retreat' || pend.forPlayerId !== playerId) throw new GameError('NOT_YOUR_TURN', 'Not your retreat decision');
  if (pend.viaCard) {
    // A Retreat card: the retreat itself is the card's effect; only where
    // the units go is the player's choice (§10.1).
    if (move.stay || !move.destination) throw new GameError('ILLEGAL_MOVE', 'Your Retreat card withdraws your units — choose where they go');
    const dest = resolveCoord(state.tiles, move.destination);
    assertLegalRetreatDestination(state, playerId, dest);
    const card = b.committed.find((c) => c.cardInstanceId === pend.viaCard)!;
    state.pending = null;
    card.resolved = true;
    discardCommitted(state, card);
    applyRetreatForPlayer(state, playerId, dest, 'card');
    resolveRetreatCards(state);
    return `${playerId} retreats to ${dest} (Retreat card).`;
  }
  const order = ((b as unknown as { __retreatOrder?: string[] }).__retreatOrder ?? []);
  if (move.stay || move.destination === null) {
    state.pending = null;
    log(state, { phase: 'battle', actor: playerId, category: 'retreat', summary: `${playerId} declines to retreat` });
    offerNextRetreat(state, order);
    return `${playerId} stays.`;
  }
  const dest = resolveCoord(state.tiles, move.destination);
  assertLegalRetreatDestination(state, playerId, dest);
  state.pending = null;
  applyRetreatForPlayer(state, playerId, dest, 'choose');
  offerNextRetreat(state, order);
  return `${playerId} retreats to ${dest}.`;
}

/** Retreat per rulings 34–38, 65, 69–70: ALL of the player's mobile units to
 *  ONE adjacent destination; allied-unit space first, else eligible empty
 *  adjacent; own/OB-partner bases or Coreless platforms count as empty;
 *  Peace/entry/attack-origin restrictions apply. `destination=null` picks the
 *  default legal destination (card retreat). */
function applyRetreatForPlayer(state: NGGState, playerId: string, destination: Coord | null, via: 'choose' | 'card'): void {
  const b = state.battle!;
  const mobile = b.units.filter((u) => u.ownerId === playerId && isMobileInBattle(u));
  if (mobile.length === 0) return;
  if (!destination) {
    log(state, { phase: 'battle', actor: playerId, category: 'retreat', summary: `${playerId} cannot retreat: no adjacent tile they may move to` });
    return;
  }
  assertLegalRetreatDestination(state, playerId, destination);
  for (const u of mobile) {
    moveBattleUnitHome(state, u, destination);
    b.units = b.units.filter((x) => x.unitRef !== u.unitRef);
  }
  refreshOverlay(state, b.coord);
  refreshOverlay(state, destination);
  log(state, { phase: 'battle', actor: playerId, category: 'retreat', ...key(`${playerId} retreated to ${destination}`, { id: playerId, line: `You retreated to ${destination}` }), ...tell(battleSeats(state).filter((x) => x !== playerId)), summary: `${playerId} ${via === 'card' ? 'uses the Retreat card: ' : ''}retreats ${mobile.map((u) => u.label).join(', ')} from ${b.coord} to ${destination}` });
}

function isMobileInBattle(u: BattleUnit): boolean {
  if (u.isHero) return true; // heroes move; Decoy remains the individual exception
  const def = probeUnitDef(u.unitRef);
  return !(def?.collector || def?.immobile);
}

const UNIT_TYPE_IDS = [...WIZARD_UNITS, ...ROBOT_UNITS].map((u) => u.id).sort((a, b) => b.length - a.length);

/** The printed unit def behind a map unit's id ("u-<type>-<owner>-<seq>").
 *  The type is the longest catalog id the ref starts with, so a player id
 *  containing hyphens ("player-a") never changes the answer. Heroes → null. */
export function probeUnitDef(unitRef: string) {
  const type = UNIT_TYPE_IDS.find((id) => unitRef.startsWith(`u-${id}-`));
  return type ? unitById(type) ?? null : null;
}

function moveBattleUnitHome(state: NGGState, u: BattleUnit, dest: Coord): void {
  if (u.isHero) {
    const h = state.heroes.find((x) => x.id === u.unitRef)!;
    h.coord = dest;
  } else {
    const unit = state.units.find((x) => x.id === u.unitRef)!;
    unit.coord = dest;
  }
}

/** Where a seat's withdrawing units may go — a retreat (§9.6, a Retreat
 *  card included) or a Decoy hero (§7.3). The ONE statement of the rule, read
 *  by the moves, the menus and the views:
 *   - a map tile ADJACENT to the battle, never the attack's origin (ruling 69);
 *   - holding no piece of another player, except an Open Borders partner's
 *     (a Peace partner's location is never entered);
 *   - allied-unit spaces (your or an Open Borders partner's units/heroes)
 *     first; only when none is eligible, empty spaces — which may hold your
 *     own or an Open Borders partner's bases, collectors or Coreless
 *     platforms (ruling 38). A distant allied army gives no priority. */
export function withdrawalDestinations(state: NGGState, playerId: string): { allied: Coord[]; empty: Coord[]; eligible: Coord[] } {
  const b = state.battle!;
  const battleTile = tileAt(state, b.coord);
  const friendly = (owner: string) => owner === playerId || treatyBetween(state, playerId, owner, 'open-borders');
  const allied: Coord[] = [];
  const empty: Coord[] = [];
  for (const t of neighborsOf(state.tiles, battleTile.c, battleTile.r)) {
    const k = coordKey(t.c, t.r);
    if (k === b.originCoord) continue;
    const owners = [
      ...unitsAt(state, k).map((u) => u.ownerId),
      ...heroesAt(state, k).map((h) => h.ownerId),
      ...collectorsAt(state, k).map((c) => c.ownerId),
      ...(baseAt(state, k) ? [baseAt(state, k)!.ownerId] : []),
    ];
    if (!owners.every(friendly)) continue;
    const hasUnits = unitsAt(state, k).some(isUnitPiece) || heroesAt(state, k).length > 0;
    if (hasUnits) allied.push(k);
    else empty.push(k);
  }
  return { allied, empty, eligible: allied.length > 0 ? allied : empty };
}

/** Whether a seat may retreat to a tile now (withdrawalDestinations). */
export function retreatDestinationLegal(state: NGGState, playerId: string, dest: Coord): boolean {
  return withdrawalDestinations(state, playerId).eligible.includes(dest);
}

function assertLegalRetreatDestination(state: NGGState, playerId: string, dest: Coord): void {
  if (!retreatDestinationLegal(state, playerId, dest)) {
    const { eligible } = withdrawalDestinations(state, playerId);
    throw new GameError('ILLEGAL_MOVE', `${dest} is not an eligible retreat destination — eligible now: ${eligible.join(', ') || 'none'} (an adjacent tile with your or an Open Borders ally's units first, otherwise an empty adjacent tile; never the attack's origin — §9.6)`);
  }
}

function nextPassOrSettle(state: NGGState): void {
  const b = state.battle!;
  const sidesAlive = new Set(b.units.map((u) => u.side));
  if (sidesAlive.size < 2) { settleBattle(state); return; }
  // §9.7: the retreat window is over; if the pass produced no kill, stalemate.
  if (!b.killThisPass) { applyStalemate(state); return; }
  b.pass += 1;
  b.killThisPass = false;
  for (const u of b.units) { u.activated = false; u.clericUsedThisPass = false; }
  log(state, { phase: 'battle', actor: null, category: 'battle', summary: `The battle at ${b.coord} goes on to pass ${b.pass}; every unit may act again. Still fighting: ${b.units.map((u) => `${who(u)} (${statLine(state, u)})`).join('; ')}` });
  queuePass(state);
}

/** §9.7 stalemate: ALL surviving attacking units still in the battle return
 *  together to the origin hex (incl. Rally reinforcements from other hexes). */
function applyStalemate(state: NGGState): void {
  const b = state.battle!;
  const returned: string[] = [];
  for (const u of b.units.filter((x) => x.side === 'attackers')) {
    moveBattleUnitHome(state, u, b.originCoord);
    returned.push(who(u));
  }
  b.units = b.units.filter((x) => x.side !== 'attackers');
  refreshOverlay(state, b.coord);
  refreshOverlay(state, b.originCoord);
  log(state, { phase: 'battle', actor: null, category: 'battle', ...key(`Stalemate at ${b.coord}: the attackers went back`), ...tell(battleSeats(state)), summary: `Stalemate: nobody was killed this pass, so the attackers go back to ${b.originCoord}: ${returned.join(', ') || 'none'}` });
  settleBattle(state);
}

/** Battle completion (§9.7): enemy combat presence destroys unprotected
 *  opposing base/collector/Coreless platform here; kill credit already
 *  recorded per death. Victory checks ride on any Leader kills. */
let pretendDepth = 0;

/** Run `fn` as the AI's pretend battle (ai-strike.ts): when the battle
 *  settles, the game does not carry on into the rest of the action card,
 *  the end of the round and upkeep. Without this, a pretend battle that
 *  ended ran a pretend upkeep, whose AI plan read started more pretend
 *  battles inside it (2026-09-30: a six-player round 1 took five minutes). */
export function runPretendBattle<T>(fn: () => T): T {
  pretendDepth += 1;
  try { return fn(); } finally { pretendDepth -= 1; }
}

export function settleBattle(state: NGGState): void {
  const b = state.battle!;
  // Every committed card that never resolved still goes to the public discard
  // (§10.1: played cards — incl. countered — are discarded; conservation).
  for (const c of b.committed) {
    if (!state.battleDiscard.includes(c.cardInstanceId)) discardCommitted(state, c);
    c.resolved = true;
  }
  // §9.7: an enemy COMBAT presence still at the location destroys unprotected
  // opposing bases, collectors and Coreless platforms there — nobody left
  // standing (everyone retreated or died) destroys nothing.
  const standing = new Set<string>([
    ...unitsAt(state, b.coord).filter(isCombatUnit).map((u) => u.ownerId),
    ...heroesAt(state, b.coord).map((h) => h.ownerId),
  ]);
  const removed = sweepLocation(state, null, b.coord, standing);
  // Always say how the battle ended — also when it ends before anyone fought
  // (every unit of one side withdrew during the cards).
  const left = [...new Set(b.units.map((u) => u.ownerId))];
  const fought = b.phase === 'activations' || b.kills.length > 0;
  log(state, {
    phase: 'battle', actor: null, category: 'battle',
    ...key(`The battle at ${b.coord} is over: ${left.length ? `${left.join(' and ')} ${left.length === 1 ? 'holds' : 'hold'} it` : 'nobody is left'}`), summary: `The battle at ${b.coord} is over${fought ? '' : ' before any unit acted'}: ${left.length ? `${left.join(' and ')} ${left.length === 1 ? 'holds' : 'hold'} the tile` : 'nobody is left there'}${removed.length ? `; removed: ${removed.join(', ')}` : ''}`,
  });
  // Kill credit is already recorded per death in killHero — do NOT re-credit
  // here (a single Leader death must advance the ledger exactly once, §12.2).
  state.battle = null;
  // Victory was checked at each kill (killHero → checkLeaderKillVictory) and
  // thresholds are rechecked here for completeness (e.g. a treaty change).
  if (state.phase !== 'game_over') {
    for (const p of state.players) {
      if (checkVictory(state, p.playerId)) return;
    }
    checkAllLeadersDeadDraw(state);
    // A pretend battle (runPretendBattle) stops here: the action card, the
    // round and upkeep do not go on in the AI's private copy.
    if (state.phase !== ('game_over' as Phase) && pretendDepth === 0) finishActionCard(state);
  }
}
// ---------------------------------------------------------------------------
// Activations (one per unit per pass: ONE attack OR ability, or pass)
// ---------------------------------------------------------------------------

export function battleActivation(state: NGGState, playerId: string, move: Extract<NGGMove, { type: 'battle_activation' }>): string {
  const b = state.battle;
  if (!b || b.phase !== 'activations') throw new GameError('ILLEGAL_MOVE', 'No activation is open');
  const ref = b.activationQueue[b.activationCursor];
  let u = ref ? b.units.find((x) => x.unitRef === ref) : undefined;
  if (!u) throw new GameError('ILLEGAL_MOVE', 'No unit awaits activation');
  if (u.ownerId !== playerId) throw new GameError('NOT_YOUR_TURN', `The activation belongs to ${u.ownerId}`);
  if (move.unit !== u.unitRef && move.unit !== u.label) {
    // Tolerate name or id. It names the unit on the clock — or, when the
    // tie at this slot is all this seat's own units, whichever of them the
    // owner wants to act first (§9.3).
    const tie = tieGroupAtCursor(state);
    const soleOwner = tie.every((x) => x.ownerId === playerId);
    const named = (soleOwner ? tie : [u]).find((x) => x.unitRef === move.unit)
      ?? (soleOwner ? tie : [u]).find((x) => x.label === move.unit);
    if (!named) throw new GameError('ILLEGAL_MOVE', `The unit to activate is ${u.label} (${u.unitRef})${soleOwner && tie.length > 1 ? ` or another of your tied units (${tie.map((x) => x.unitRef).join(', ')})` : ''} — one activation per pass, in initiative order`);
    if (named !== u) { bringToCursor(state, named.unitRef); u = named; }
  }
  const choice = move.action;
  if (choice.kind === 'pass') {
    u.activated = true; // a passed activation is used (ruling 67)
    log(state, { phase: 'battle', actor: playerId, category: 'battle', summary: `${who(u)} passes (does not act this pass)` });
    advanceAfterActivation(state);
    return `${u.label} passes.`;
  }
  if (choice.kind === 'attack') {
    if (u.dmg <= 0) throw new GameError('ILLEGAL_MOVE', `${u.label} has DMG 0 and cannot attack`);
    // An AoE unit's attack always resolves as the area attack (§7.1: it hits
    // every opposing unit; the `target` field is unused/optional there).
    if (u.aoe) return doAoEAttack(state, u, currentDmgOf(state, u));
    return doSingleTargetAttack(state, playerId, u, choice.target, 'attack');
  }
  if (choice.kind === 'spy_attack' || choice.kind === 'invisible') {
    // Instant-kill replace-the-attack abilities (§7.3/§7.9): reveal the spy.
    return doInstantKill(state, playerId, u, choice.target, choice.kind);
  }
  if (choice.kind === 'self_destruct') return doSelfDestruct(state, playerId, u);
  if (choice.kind === 'ability') {
    return doAbility(state, playerId, u, choice.ability, choice.target ?? null, choice.mana ?? 0);
  }
  throw new GameError('ILLEGAL_MOVE', `Unknown activation action`);
}

/** Ruling #93: does a Wall Platform stand on this unit's side of the battle? */
export function wallStandsFor(state: NGGState, unit: BattleUnit): boolean {
  return state.battle!.units.some((x) => x.side === unit.side && probeUnitDef(x.unitRef)?.wallFirst);
}

/** Ruling #98: is the battle on a tile holding a wizard's Castle, with this
 *  unit on the Castle owner's side (the owner and its allies)? A robot's Home
 *  does not count. */
export function castleStandsFor(state: NGGState, unit: BattleUnit): boolean {
  const b = state.battle!;
  const base = state.bases.find((x) => x.coord === b.coord);
  if (!base || byId(state, base.ownerId).species !== 'wizard') return false;
  // The owner's side: where it joined, else where its units fight, else it
  // holds the tile, so it defends.
  const ownerSide = b.sides?.[base.ownerId] ?? b.units.find((x) => x.ownerId === base.ownerId)?.side ?? 'defenders';
  return unit.side === ownerSide;
}

/** Why no spy kill (Invisible or Spy Attack) can land on this unit, or null:
 *  a standing Wall Platform on its side (#93), or its side's Castle on the
 *  battle tile (#98). The one check the menu and the rule both read. */
export function spyKillShut(state: NGGState, unit: BattleUnit): string | null {
  if (wallStandsFor(state, unit)) return 'A standing Wall Platform on that side stops spy attacks — Spy Attack and Invisible cannot kill a hero it protects';
  if (castleStandsFor(state, unit)) return 'A Castle on this tile stops spy attacks on its side — Spy Attack and Invisible cannot kill a hero it protects';
  if (envoyStandsFor(state, unit)) return 'Envoy Sable Marrow in this battle stops spy attacks on its side — Spy Attack and Invisible cannot kill a hero it protects';
  return null;
}

/** Ruling #105: is Envoy in the battle on this unit's side? */
export function envoyStandsFor(state: NGGState, unit: BattleUnit): boolean {
  return state.battle!.units.some((x) => x.side === unit.side && x.isHero && x.unitRef === 'envoy');
}

/** §9.3 single-target targeting, the ONE gate every single-target attack
 *  passes (a unit's attack and the Evoker's Wizard Missile alike): the
 *  target is an opposing unit, and while any opposing Wall Platform stands
 *  it must be one of them. */
export function singleTargetShut(state: NGGState, attacker: BattleUnit, target: BattleUnit): string | null {
  const b = state.battle!;
  if (target.side === attacker.side) return `${target.label} is not an opposing unit`;
  const walls = b.units.filter((x) => x.side !== attacker.side && probeUnitDef(x.unitRef)?.wallFirst);
  if (walls.length > 0 && !walls.includes(target)) return 'A standing opposing Wall Platform must be the target of single-target attacks while it stands';
  return null;
}

function doSingleTargetAttack(state: NGGState, playerId: string, attacker: BattleUnit, targetName: string, kind: 'attack'): string {
  const b = state.battle!;
  if (attacker.dmg <= 0) throw new GameError('ILLEGAL_MOVE', `${attacker.label} has DMG 0 and cannot attack (its DMG cannot be increased if inherent)`);
  const target = resolveBattleTarget(b, attacker, targetName);
  const shut = singleTargetShut(state, attacker, target);
  if (shut) throw new GameError('ILLEGAL_MOVE', shut);
  // §7.2 Wizard Missile: the Evoker's attack costs 1 mana per attack.
  if (probeUnitDef(attacker.unitRef)?.id === 'evoker') {
    const owner = byId(state, attacker.ownerId);
    if (owner.manaCurrent < 1) throw new GameError('ILLEGAL_MOVE', 'Wizard Missile costs 1 mana per attack');
    owner.manaCurrent -= 1;
  }
  attacker.activated = true;
  void playerId; void kind;
  return beginAttackResolution(state, attacker, target, 'attack');
}

function resolveBattleTarget(b: BattleState, attacker: BattleUnit, want: string): BattleUnit {
  const eligible = b.units.filter((x) => x.side !== attacker.side);
  const byRef = eligible.find((x) => x.unitRef === want);
  if (byRef) return byRef;
  const m = eligible.filter((x) => x.label.toLowerCase() === want.toLowerCase());
  if (m.length === 0) throw new GameError('ILLEGAL_MOVE', `No opposing unit "${want}". Targets: ${eligible.map((x) => `${x.label} (${x.unitRef}, ${x.ownerId})`).join(', ')}`);
  if (m.length > 1) throw new GameError('AMBIGUOUS_MOVE', `Several opposing units are "${want}" — name one by its ref: ${m.map((x) => `${x.unitRef} (${x.ownerId})`).join(', ')}`);
  return m[0]!;
}

/** Decoy is the ILLUSIONIST's ability (§7.3); a robot Infiltrator carries
 *  Spy Attack, never Decoy (§7.9). */
export function decoySpyOn(state: NGGState, target: BattleUnit): { source: 'illusionist' | 'infiltrator'; heroId: string; active: boolean } | undefined {
  if (!target.isHero) return undefined;
  return byId(state, target.ownerId).spyAssignments.find((s) => s.active && s.heroId === target.unitRef && s.source === 'illusionist');
}

/** The §9.4 reaction ladder as sequential pendings: declare → Decoy → Mana
 *  Shield → Cleric → remove. Instant-kills skip Mana Shield (Decoy/Cleric only). */
function beginAttackResolution(state: NGGState, attacker: BattleUnit, target: BattleUnit, kind: 'attack' | 'instant-kill' | 'aoe', aoeSet?: string[]): string {
  const b = state.battle!;
  const damage = kind === 'attack' ? currentDmgOf(state, attacker) : kind === 'aoe' ? attacker.dmg : Number.POSITIVE_INFINITY;
  b.defense = { attackerRef: attacker.unitRef, targetRef: target.unitRef, damage, kind, aoeWouldDie: aoeSet, step: 'decoy', shieldSpent: 0 };
  log(state, { phase: 'battle', actor: attacker.ownerId, category: 'battle', ...(kind === 'aoe' ? {} : key(kind === 'instant-kill' ? `${who(attacker)} went for an instant kill on ${who(target)}` : `${who(attacker)} attacked ${who(target)}`)), summary: kind === 'instant-kill'
    ? `${who(attacker)} targets ${who(target)} for an instant kill`
    : kind === 'aoe'
      ? `${who(attacker)}'s area attack reaches ${who(target)}: ${damage} damage against defense ${currentDefOf(state, target)}`
      : `${who(attacker)} attacks ${who(target)}: ${damage} damage against defense ${currentDefOf(state, target)}` });
  // Decoy: the attacked hero carries an unrevealed Illusionist spy.
  if (decoySpyOn(state, target)) {
    if (byId(state, target.ownerId).kind === 'ai') {
      // AI Decoy policy: reveal to avoid death; the attack then lands nowhere.
      applyDecoy(state, target, null, attacker);
      return finishAttack(state, attacker);
    }
    state.pending = { kind: 'battle_defense', forPlayerId: target.ownerId };
    state.activePlayerId = target.ownerId;
    return `${target.label} is attacked — Decoy decision for ${target.ownerId}.`;
  }
  return afterDecoyStep(state, attacker, target, kind, aoeSet);
}

function afterDecoyStep(state: NGGState, attacker: BattleUnit, target: BattleUnit, kind: 'attack' | 'instant-kill' | 'aoe', aoeSet?: string[]): string {
  const b = state.battle!;
  if (b.defense) b.defense.step = 'mana_shield';
  // Mana Shield: wizard-eligible (Evoker/Enchantress/Cleric), researched, mana available.
  if (kind === 'instant-kill') return afterManaShieldStep(state, attacker, target, kind, aoeSet);
  const targetOwner = byId(state, target.ownerId);
  const eligibleType = ['evoker', 'enchantress', 'cleric'].some((t) => probeUnitDef(target.unitRef)?.id === t);
  if (targetOwner.species === 'wizard' && targetOwner.research.includes('mana-shield') && eligibleType && targetOwner.manaCurrent > 0) {
    const declared = b.defense?.damage ?? currentDmgOf(state, attacker);
    if (declared < currentDefOf(state, target)) return afterManaShieldStep(state, attacker, target, kind, aoeSet);
    if (targetOwner.kind === 'ai') {
      // AI Mana Shield policy: spend enough to survive if affordable — from
      // the DECLARED damage (incl. bonuses), not the raw stat line.
      const need = declared - currentDefOf(state, target) + 1;
      const spend = Math.min(targetOwner.manaCurrent, Math.max(0, need));
      if (spend > 0) targetOwner.manaCurrent -= spend;
      if (b.defense) b.defense.shieldSpent = spend;
      log(state, { phase: 'battle', actor: target.ownerId, category: 'battle', ...key(`${who(target)} was shielded by Mana Shield`), summary: `${target.ownerId} spends ${spend} mana on Mana Shield for ${who(target)}` });
      return afterManaShieldStep(state, attacker, target, kind, aoeSet);
    }
    state.pending = { kind: 'battle_defense', forPlayerId: target.ownerId };
    state.activePlayerId = target.ownerId;
    return `${target.label} would take ${declared} — Mana Shield decision for ${target.ownerId}.`;
  }
  return afterManaShieldStep(state, attacker, target, kind, aoeSet);
}

/** The Cleric step (§9.4–9.5): every allied Cleric owner who could save the
 *  target is asked in first-player order until one saves it; one owner's
 *  refusal does not speak for another's. */
function afterManaShieldStep(state: NGGState, attacker: BattleUnit, target: BattleUnit, kind: 'attack' | 'instant-kill' | 'aoe', aoeSet?: string[]): string {
  const b = state.battle!;
  const d = b.defense!;
  d.step = 'cleric';
  // Effective incoming damage was fixed at DECLARATION time (d.damage includes
  // the hero +2 / card bonuses) — never recompute from raw stats here, or
  // Kestrel's bonus vanishes at lethality time (probe finding #5).
  const dmg = kind === 'instant-kill' ? Number.POSITIVE_INFINITY : Math.max(0, d.damage - (d.shieldSpent ?? 0));
  if (dmg < currentDefOf(state, target)) {
    log(state, { phase: 'battle', actor: attacker.ownerId, category: 'battle', ...key(`${who(target)} survived the attack`), summary: `${who(attacker)}'s attack does not kill ${who(target)}` });
    return finishAttack(state, attacker);
  }
  const declined = d.clericDeclinedBy ?? [];
  const fpo = playerOrderFrom(state, state.firstPlayerIndex);
  const clerics = b.units
    .filter((x) => x.side === target.side && probeUnitDef(x.unitRef)?.id === 'cleric' && !x.clericUsedThisPass
      && !declined.includes(x.ownerId) && byId(state, x.ownerId).manaCurrent >= CLERIC_SAVE_MANA)
    .sort((x, y) => fpo.indexOf(x.ownerId) - fpo.indexOf(y.ownerId));
  const cu = clerics[0];
  if (cu) {
    const cuOwner = byId(state, cu.ownerId);
    if (cuOwner.kind === 'ai') {
      // AI Cleric policy: save the unit.
      cuOwner.manaCurrent -= CLERIC_SAVE_MANA;
      cu.clericUsedThisPass = true;
      log(state, { phase: 'battle', actor: cu.ownerId, category: 'battle', ...key(`${cuOwner.playerId}'s Cleric saved ${who(target)}`), summary: `${cuOwner.playerId} spends 5 mana: their Cleric saves ${who(target)}` });
      return finishAttack(state, attacker);
    }
    state.pending = { kind: 'battle_defense', forPlayerId: cu.ownerId };
    state.activePlayerId = cu.ownerId;
    return `${target.label} would die — ${cu.ownerId}'s Cleric may prevent it (5 mana).`;
  }
  // No defense: the target dies.
  killBattleUnit(state, target, attacker.ownerId);
  return finishAttack(state, attacker);
}

export function currentDefOf(state: NGGState, u: BattleUnit): number {
  const b = state.battle!;
  if (u.isHero) {
    const h = state.heroes.find((x) => x.id === u.unitRef)!;
    return effectiveDefOfHero(state, h, b);
  }
  const base = probeUnitDef(u.unitRef)?.def ?? u.def;
  const withMetal = byId(state, u.ownerId).research.includes('metal-platforms') ? base + 1 : base;
  return Math.max(0, withMetal + modifierSum(state, b, u.unitRef, u.ownerId, 'def'));
}

function finishAttack(state: NGGState, attacker: BattleUnit): string {
  const b = state.battle;
  // A casualty-boundary victory (probe finding #3) can END the game inside the
  // kill below — stop processing: no further activations may run.
  if (!b || state.phase === 'game_over') return 'Game over.';
  b.defense = null;
  if (allOneSide(state, b)) { settleBattle(state); return 'Battle over.'; }
  advanceAfterActivation(state);
  return `${attacker.label} acts.`;
}

export function advanceAfterActivation(state: NGGState): void {
  const b = state.battle!;
  b.activationCursor += 1;
  offerNextActivation(state);
}

// ---------------------------------------------------------------------------
// Defenses (the battle_defense pending carries which defense is on offer)
// ---------------------------------------------------------------------------

export function resolveBattleDefense(state: NGGState, playerId: string, defense: Extract<NGGMove, { type: 'resolve_battle_defense' }>['defense']): string {
  const b = state.battle;
  if (!b || state.phase === 'game_over') throw new GameError('ILLEGAL_MOVE', 'No battle is resolving');
  if (state.pending?.kind !== 'battle_defense' || state.pending.forPlayerId !== playerId) throw new GameError('NOT_YOUR_TURN', 'Not your defense decision');
  const d = b.defense;
  if (!d) throw new GameError('ILLEGAL_MOVE', 'No defense step is on offer');
  const attacker = b.units.find((x) => x.unitRef === d.attackerRef)!;
  const target = b.units.find((x) => x.unitRef === d.targetRef)!;
  // Validate the chosen defense against the CURRENT step before any state moves.
  if (defense.kind !== 'none' && defense.kind !== 'decoy' && defense.kind !== 'mana_shield' && defense.kind !== 'cleric_save') {
    throw new GameError('ILLEGAL_MOVE', `Unknown defense kind`);
  }
  // Declining is always legal at any step; every other choice passes the one
  // defense gate first (gates.ts — the same sentence the pending view prints).
  if (defense.kind !== 'none') {
    // A Cleric save must name its Cleric ('' names none, so the gate refuses).
    const shut = defenseGate.check(state, playerId, defense.kind === 'cleric_save' ? { kind: 'cleric_save', cleric: defense.cleric ?? '' } : { kind: defense.kind });
    if (shut) throw new GameError('ILLEGAL_MOVE', shut);
  }
  if (defense.kind === 'mana_shield') {
    const p = byId(state, playerId);
    const spend = defense.mana;
    if (typeof spend !== 'number' || !Number.isFinite(spend) || !Number.isInteger(spend) || spend < 0) {
      throw new GameError('ILLEGAL_MOVE', 'Mana Shield spends a non-negative integer amount of mana');
    }
    if (spend > p.manaCurrent) throw new GameError('ILLEGAL_MOVE', `You hold ${p.manaCurrent} mana`);
  }
  if (defense.kind === 'cleric_save'
    && defense.target !== undefined && defense.target !== d.targetRef && !b.units.some((x) => x.unitRef === defense.target && x.unitRef === target.unitRef)) {
    throw new GameError('ILLEGAL_MOVE', 'The Cleric saves the unit under attack');
  }
  // A rejected defense (an illegal destination, an out-of-ladder step that
  // cleared validation but failed the engine check — e.g. Decoy's §7.3
  // destination) must NOT consume the window: restore the pending on throw so
  // the seat can answer again (probe #9's "stay" test hit exactly this).
  const savedPending = state.pending;
  state.pending = null;
  try {
    return resolveBattleDefenseBody(state, b, d, playerId, defense, attacker, target);
  } catch (e) {
    state.pending = savedPending;
    state.activePlayerId = savedPending.forPlayerId;
    throw e;
  }
}

/** The defense effects live behind the restored-pending guard above. */
function resolveBattleDefenseBody(
  state: NGGState, b: NonNullable<NGGState['battle']>, d: NonNullable<NonNullable<NGGState['battle']>['defense']>,
  playerId: string, defense: Extract<NGGMove, { type: 'resolve_battle_defense' }>['defense'],
  attacker: NonNullable<NGGState['battle']>['units'][number], target: NonNullable<NGGState['battle']>['units'][number],
): string {
  if (d.kind === 'aoe') {
    switch (defense.kind) {
      case 'none': {
        // A Cleric refusal is that owner's alone; another owner may still save.
        return stepAoEAfterStepDecline(state, attacker, d.targetRef, d.step === 'cleric' ? `cleric:${playerId}` : d.step);
      }
      case 'decoy': {
        applyDecoy(state, target, defense.moveTo ?? null, attacker);
        d.aoeWouldDie = d.aoeWouldDie!.filter((x) => x !== target.unitRef);
        return stepAoEDefenses(state, attacker);
      }
      case 'mana_shield': {
        const p = byId(state, playerId);
        p.manaCurrent -= defense.mana;
        log(state, { phase: 'battle', actor: playerId, category: 'battle', ...key(`${who(target)} was shielded by Mana Shield`), summary: `${playerId} spends ${defense.mana} mana on Mana Shield for ${who(target)}` });
        const survives = d.damage - defense.mana < currentDefOf(state, target);
        if (survives) d.aoeWouldDie = d.aoeWouldDie!.filter((x) => x !== target.unitRef);
        else return stepAoEAfterStepDecline(state, attacker, d.targetRef, 'mana_shield');
        return stepAoEDefenses(state, attacker);
      }
      case 'cleric_save': {
        const p = byId(state, playerId);
        const cleric = usableClerics(state, playerId).find((x) => x.unitRef === defense.cleric || x.label === defense.cleric)!;
        p.manaCurrent -= CLERIC_SAVE_MANA;
        cleric.clericUsedThisPass = true;
        log(state, { phase: 'battle', actor: playerId, category: 'battle', ...key(`${playerId}'s Cleric saved ${who(target)}`), summary: `${playerId} spends 5 mana: their Cleric saves ${who(target)}` });
        d.aoeWouldDie = d.aoeWouldDie!.filter((x) => x !== target.unitRef);
        return stepAoEDefenses(state, attacker);
      }
    }
  }
  switch (defense.kind) {
    case 'none': {
      // Declining one defense leaves LATER defenses available (§9.4).
      if (d.step === 'decoy') return afterDecoyStep(state, attacker, target, d.kind, d.aoeWouldDie);
      if (d.step === 'mana_shield') return afterManaShieldStep(state, attacker, target, d.kind, d.aoeWouldDie);
      // This Cleric owner declines; another allied owner may still save.
      d.clericDeclinedBy = [...(d.clericDeclinedBy ?? []), playerId];
      return afterManaShieldStep(state, attacker, target, d.kind, d.aoeWouldDie);
    }
    case 'decoy': {
      applyDecoy(state, target, defense.moveTo ?? null, attacker);
      return finishAttack(state, attacker);
    }
    case 'mana_shield': {
      const p = byId(state, playerId);
      p.manaCurrent -= defense.mana;
      d.shieldSpent = (d.shieldSpent ?? 0) + defense.mana;
      log(state, { phase: 'battle', actor: playerId, category: 'battle', ...key(`${who(target)} was shielded by Mana Shield`), summary: `${playerId} spends ${defense.mana} mana on Mana Shield for ${who(target)}` });
      return afterManaShieldStep(state, attacker, target, d.kind, d.aoeWouldDie);
    }
    case 'cleric_save': {
      const p = byId(state, playerId);
      const cleric = usableClerics(state, playerId).find((x) => x.unitRef === defense.cleric || x.label === defense.cleric)!;
      p.manaCurrent -= CLERIC_SAVE_MANA;
      cleric.clericUsedThisPass = true;
      log(state, { phase: 'battle', actor: playerId, category: 'battle', ...key(`${playerId}'s Cleric saved ${who(target)}`), summary: `${playerId} spends 5 mana: their Cleric saves ${who(target)}` });
      return finishAttack(state, attacker);
    }
  }
}

/** Decoy (§7.3): reveal the spy, the hero takes no damage, and it MAY move to
 *  an eligible adjacent allied-unit space (else eligible empty adjacent); never
 *  the attack-origin hex while the battle continues (ruling 69); only the hero.
 *  When no move is chosen the hero STAYS in the battle (the avoidance is the
 *  reveal's effect — withdrawing it from the battle silently would strip its
 *  attacks, targetability, and ally bonus, probe finding #9). */
function applyDecoy(state: NGGState, target: BattleUnit, moveTo: Coord | null, attacker: BattleUnit): void {
  const b = state.battle!;
  const owner = byId(state, target.ownerId);
  if (moveTo) {
    // §7.3 destination: the same rule as retreat (§9.6) — an eligible
    // adjacent allied-unit space, or only when none is eligible an eligible
    // empty one; never the attack origin (ruling 69).
    const { eligible } = withdrawalDestinations(state, target.ownerId);
    if (!eligible.includes(moveTo)) {
      throw new GameError('ILLEGAL_MOVE', `Decoy may move ${target.label} to: ${eligible.map((k) => tileName(k)).join(', ') || 'nowhere (stay in the battle)'} — an adjacent space with your or an Open Borders ally's units first, otherwise an eligible empty one, never the attack's origin (§7.3)`);
    }
    const h = state.heroes.find((x) => x.id === target.unitRef)!;
    h.coord = moveTo;
    // Moved OUT — the hero leaves the battle formation.
    b.units = b.units.filter((x) => x.unitRef !== target.unitRef);
    refreshOverlay(state, b.coord);
    refreshOverlay(state, moveTo);
  }
  // Only now, with every legality gate cleared, does the spy reveal happen
  // (a rejected destination never spends the Decoy — probe round-2 #5).
  owner.spyAssignments = owner.spyAssignments.filter((s) => !(s.heroId === target.unitRef && s.active));
  // No move: the hero REMAINS in battle.units at the coordinate.
  // The attacking seat is stopped and told: its attack found a Decoy (a
  // Self Destruct's own side dodging its own blast tells nobody).
  const told = attacker.ownerId !== target.ownerId
    ? { id: attacker.ownerId, line: `${who(target)} was a Decoy and avoided your ${attacker.label}'s attack${moveTo ? `, then moved to ${moveTo}` : ''}`, notify: true }
    : undefined;
  log(state, { phase: 'battle', actor: target.ownerId, category: 'battle', ...key(`${who(target)} was a Decoy and avoided the attack`, told), summary: `${who(target)} is revealed as a Decoy spy and avoids the attack${moveTo ? `, then moves to ${moveTo}` : ' and stays in the battle'}; that spy assignment ends` });
}

// ---------------------------------------------------------------------------
// Instant-kill spy attacks (Spy Attack / Invisible) + abilities
// ---------------------------------------------------------------------------

function doInstantKill(state: NGGState, playerId: string, attacker: BattleUnit, targetName: string, kind: 'spy_attack' | 'invisible'): string {
  const b = state.battle!;
  const p = byId(state, playerId);
  const spy = p.spyAssignments.find((s) => s.active && s.heroId === attacker.unitRef);
  if (!spy) throw new GameError('ILLEGAL_MOVE', `${attacker.label} carries no active spy assignment`);
  if (spy.source === 'illusionist' && kind === 'spy_attack') throw new GameError('ILLEGAL_MOVE', 'Wizard spies use Invisible (research-gated), not Spy Attack');
  if (spy.source === 'infiltrator' && kind === 'invisible') throw new GameError('ILLEGAL_MOVE', 'Robot spies use Spy Attack, not Invisible');
  if (kind === 'invisible' && !p.research.includes('invisible')) throw new GameError('ILLEGAL_MOVE', 'Invisible requires the Invisible research');
  const opposingHeroes = b.units.filter((x) => x.side !== attacker.side && x.isHero);
  const target = opposingHeroes.find((x) => x.unitRef === targetName || x.label.toLowerCase() === targetName.toLowerCase());
  if (!target) throw new GameError('ILLEGAL_MOVE', `Spy attacks instantly kill one OPPOSING HERO in the battle (${opposingHeroes.map((x) => x.label).join(', ') || 'none present'})`);
  // Designer rulings #93 and #98 (2026-09-25): a standing Wall Platform on the
  // target's side, or that side's Castle on the battle tile, stops spies — no
  // spy kill lands there. The spy is not revealed or spent by the refusal.
  const blocked = spyKillShut(state, target);
  if (blocked) throw new GameError('ILLEGAL_MOVE', blocked);
  attacker.activated = true;
  spy.active = false; // revealing ends/expends the assignment
  log(state, { phase: 'battle', actor: playerId, category: 'battle', ...key(`${who(attacker)} was revealed as a spy (${kind === 'invisible' ? 'Invisible' : 'Spy Attack'})`), summary: `${who(attacker)} is revealed as a spy and uses ${kind === 'invisible' ? 'Invisible' : 'Spy Attack'}` });
  return beginAttackResolution(state, attacker, target, 'instant-kill');
}

function doAbility(state: NGGState, playerId: string, u: BattleUnit, ability: string, target: string | null, mana: number): string {
  const b = state.battle!;
  const p = byId(state, playerId);
  const def = probeUnitDef(u.unitRef);
  const isHero = u.isHero;
  if (isHero) throw new GameError('ILLEGAL_MOVE', 'Heroes have attacks and spy abilities only');
  switch (def?.id) {
    case 'evoker': {
      if (ability === 'wizard_missile') {
        // The Evoker's attack IS Wizard Missile: the same single-target
        // attack, Wall rule and mana cost (§7.2, §9.3).
        return doSingleTargetAttack(state, playerId, u, target ?? '', 'attack');
      }
      if (ability === 'ice_blast') {
        if (!p.research.includes('ice-blast')) throw new GameError('ILLEGAL_MOVE', 'Ice Blast requires research');
        if (p.manaCurrent < 3) throw new GameError('ILLEGAL_MOVE', 'Ice Blast costs 3 mana');
        const t = b.units.find((x) => x.unitRef === target || x.label === target);
        if (!t) throw new GameError('ILLEGAL_MOVE', 'Ice Blast targets one unit');
        p.manaCurrent -= 3;
        // The −100 persists for the battle, incl. negative (§9.3) — recorded in
        // the modifiers table; every initiative read goes through currentInitOf
        // (raw + modifiers), never a direct mutation.
        b.modifiers.push({ targetRef: t.unitRef, init: -100, source: `ice-blast-${u.unitRef}` });
        u.activated = true;
        log(state, { phase: 'battle', actor: playerId, category: 'battle', ...key(`${who(u)} cast Ice Blast on ${who(t)}`), summary: `${who(u)} casts Ice Blast (3 mana): ${who(t)} gets initiative minus 100 for this battle and moves to the back of this pass` });
        // The blasted unit drops to the back of THIS pass (rules note 45):
        // advance the cursor first (the blasting unit is done), then re-sort
        // the remaining queue so the order changes THIS pass; already-acted
        // units keep exactly one activation (probe finding #10).
        b.activationCursor += 1;
        resortRemainingQueue(state);
        offerNextActivation(state);
        return 'Ice Blast reorders the pass.';
      }
      if (ability === 'fiery_explosion') {
        if (!p.research.includes('fiery-explosion')) throw new GameError('ILLEGAL_MOVE', 'Fiery Explosion requires research');
        if (p.manaCurrent < 3) throw new GameError('ILLEGAL_MOVE', 'Fiery Explosion costs 3 mana');
        p.manaCurrent -= 3;
        u.activated = true;
        // 2 DMG AoE plus the Evoker's own damage bonuses (designer ruling
        // 2026-09-24: the spell takes DMG modifiers like any attack).
        return doAoEAttack(state, u, Math.max(0, 2 + modifierSumPub(state, u, 'dmg')));
      }
      throw new GameError('ILLEGAL_MOVE', `Evoker has no ability "${ability}" (wizard_missile / ice_blast / fiery_explosion)`);
    }
    case 'enchantress': {
      if (ability === 'enhance' || ability === 'dehance') {
        if (ability === 'dehance' && !p.research.includes('dehance')) throw new GameError('ILLEGAL_MOVE', 'Dehance requires research');
        if (p.manaCurrent < 2) throw new GameError('ILLEGAL_MOVE', `${ability} costs 2 mana`);
        const t = b.units.find((x) => x.unitRef === target || x.label === target);
        if (!t) throw new GameError('ILLEGAL_MOVE', `${ability} targets one unit`);
        p.manaCurrent -= 2;
        // Record via the modifiers table ONLY (the BattleUnit's raw dmg/def
        // stays the printed stat; effective reads add modifiers on top —
        // anything else double-counts, probe "Enhance grants +2").
        if (ability === 'enhance') { b.modifiers.push({ targetRef: t.unitRef, dmg: 2, source: `enhance-${u.unitRef}` }); } // +2 since ruling #109
        else { b.modifiers.push({ targetRef: t.unitRef, def: -1, source: `dehance-${u.unitRef}` }); }
        u.activated = true;
        log(state, { phase: 'battle', actor: playerId, category: 'battle', ...key(ability === 'enhance' ? `${who(u)} cast Enhance on ${who(t)}` : `${who(u)} cast Dehance on ${who(t)}`), summary: ability === 'enhance'
          ? `${who(u)} casts Enhance (2 mana): ${who(t)} gets damage plus 2 for this battle`
          : `${who(u)} casts Dehance (2 mana): ${who(t)} gets defense minus 1 for this battle` });
        advanceAfterActivation(state);
        return `${ability} applies.`;
      }
      throw new GameError('ILLEGAL_MOVE', `Enchantress has no ability "${ability}" (enhance / dehance)`);
    }
    default:
      throw new GameError('ILLEGAL_MOVE', `${u.label} has no activated combat ability`);
  }
}

/** AoE (§9.5): compute the would-die set with FROZEN stats (Warden's bonus
 *  applies throughout the killing attack), resolve protections, then remove
 *  casualties together. Humans get REAL defense decisions per dying target
 *  (probe finding #4): the ladder walks the frozen set — each target gets
 *  Decoy → Mana Shield → Cleric (per-owner, asked once), and removals happen
 *  simultaneously at the end, so Warden's bonus holds through the whole pass.
 */
/** Ruling #111 (2026-09-27): a robot unit with printed DMG 1 or more blows
 *  itself up on its activation instead of attacking — its current DMG + 3
 *  to every other unit and hero in the battle, every side, with the
 *  reactions of an area attack (Decoy, Mana Shield, Cleric); the unit is
 *  lost when the batch resolves (its Core goes back to the supply). */
function doSelfDestruct(state: NGGState, playerId: string, u: BattleUnit): string {
  const p = byId(state, playerId);
  if (!p.research.includes('self-destruct')) throw new GameError('ILLEGAL_MOVE', 'Self Destruct is not researched');
  const def = u.isHero ? undefined : probeUnitDef(u.unitRef);
  if (u.isHero || !def || def.species !== 'robot') throw new GameError('ILLEGAL_MOVE', 'Only a robot unit (not a hero) can self-destruct');
  if (u.dmg <= 0) throw new GameError('ILLEGAL_MOVE', `${u.label} has printed DMG 0 and cannot self-destruct`);
  const b = state.battle!;
  u.activated = true;
  const dmg = currentDmgOf(state, u) + 3;
  const wouldDie: string[] = [];
  const nonLethal: string[] = [];
  for (const t of b.units) {
    if (t.unitRef === u.unitRef) continue;
    if (dmg >= currentDefOf(state, t)) wouldDie.push(t.unitRef);
    else if (decoySpyOn(state, t)) nonLethal.push(t.unitRef);
  }
  log(state, { phase: 'battle', actor: playerId, category: 'battle', ...key(`${who(u)} self-destructed`), summary: `${who(u)} self-destructs: ${dmg} damage to every other unit and hero in the battle, every side` });
  b.defense = {
    attackerRef: u.unitRef, targetRef: '', damage: dmg, kind: 'aoe',
    aoeWouldDie: [...wouldDie, ...nonLethal], aoeNonLethal: nonLethal, step: 'decoy', selfDestruct: true,
  };
  return stepAoEDefenses(state, u);
}

function doAoEAttack(state: NGGState, attacker: BattleUnit, dmg: number): string {
  const b = state.battle!;
  attacker.activated = true;
  const targets = b.units.filter((x) => x.side !== attacker.side);
  const wouldDie: string[] = [];
  const nonLethal: string[] = [];
  for (const t of targets) {
    if (dmg >= currentDefOf(state, t)) wouldDie.push(t.unitRef);
    else if (decoySpyOn(state, t)) nonLethal.push(t.unitRef); // attacked all the same (§7.3)
  }
  // Frozen-set record: the ladder walks this list; survivals are SPLICED out,
  // final removals happen together at the end.
  b.defense = {
    attackerRef: attacker.unitRef,
    targetRef: '', // AoE marker
    damage: dmg,
    kind: 'aoe',
    aoeWouldDie: [...wouldDie, ...nonLethal],
    aoeNonLethal: nonLethal,
    step: 'decoy',
  };
  return stepAoEDefenses(state, attacker);
}


/** AoE: the current defense step was declined for this target — record it and
 *  resume the same target's ladder (the next defense may still apply). */
function stepAoEAfterStepDecline(state: NGGState, attacker: BattleUnit, ref: string, stepName: string): string {
  const b = state.battle!;
  const d = b.defense!;
  (d.aoeDeclined ??= []).push(`${ref}:${stepName}`);
  // The ref stays at the FRONT (we did not shift); resume the walk for it.
  return stepAoEDefenses(state, attacker);
}

/** Walk the frozen would-die set: per target, Decoy → Mana Shield → Cleric.
 *  Human decisions arm battle_defense pendings (resolved by the dispatcher);
 *  AI seats resolve per their stated policy. */
/** AI Cleric policy in an area attack: with only one save left (one usable
 *  Cleric, or the mana for one), don't spend it on another piece while the
 *  owner's Leader is still on the dying list. The dying list runs in battle
 *  order, so a Cleric is asked about itself before the Leader standing with
 *  it; saving itself let the Leader die (2026-09-30, the AI's kill read). */
export function keepClericForLeader(state: NGGState, ownerId: string, target: BattleUnit, wouldDie: string[]): boolean {
  if (target.isHero && state.heroes.some((h) => h.id === target.unitRef && h.isLeader)) return false;
  const b = state.battle!;
  const leaderDying = wouldDie.some((r) => r !== target.unitRef && b.units.some((u) => u.unitRef === r && u.ownerId === ownerId && u.isHero)
    && state.heroes.some((h) => h.id === r && h.isLeader && h.ownerId === ownerId));
  if (!leaderDying) return false;
  const usable = b.units.filter((x) => x.ownerId === ownerId && probeUnitDef(x.unitRef)?.id === 'cleric' && !x.clericUsedThisPass).length;
  const saves = Math.min(usable, Math.floor(byId(state, ownerId).manaCurrent / CLERIC_SAVE_MANA));
  return saves <= 1;
}

function stepAoEDefenses(state: NGGState, attacker: BattleUnit): string {
  const b = state.battle!;
  const d = b.defense!;
  while (state.phase !== 'game_over' && state.battle !== null && d.kind === 'aoe' && d.aoeWouldDie && d.aoeWouldDie.length > 0) {
    const ref = d.aoeWouldDie[0]!;
    const target = b.units.find((x) => x.unitRef === ref);
    if (!target) { d.aoeWouldDie.shift(); continue; }
    d.targetRef = ref;
    const declined = (d.aoeDeclined ?? []).filter((x) => x.startsWith(`${ref}:`)).map((x) => x.slice(ref.length + 1));
    const lethal = !(d.aoeNonLethal ?? []).includes(ref);
    // 1) Decoy (hero + unrevealed spy) — defense side.
    const owner = byId(state, target.ownerId);
    if (target.isHero && !declined.includes('decoy')) {
      const spy = decoySpyOn(state, target);
      if (spy) {
        d.step = 'decoy';
        // AI policy: spend the Decoy only to avoid a death.
        if (owner.kind === 'ai' && !lethal) { d.aoeWouldDie.shift(); continue; }
        if (owner.kind === 'ai') {
          applyDecoy(state, target, null, attacker);
          d.aoeWouldDie.shift();
          continue;
        }
        state.pending = { kind: 'battle_defense', forPlayerId: target.ownerId };
        state.activePlayerId = target.ownerId;
        return `${target.label} faces the AoE — Decoy decision for ${target.ownerId}.`;
      }
    }
    // A hit that does not kill needs no further defense.
    if (!lethal) { d.aoeWouldDie.shift(); continue; }
    // 2) Mana Shield (wizard-eligible types, researched, mana available). AI
    //    policy: spend the full amount needed — the AoE's damage was fixed at
    //    declaration INCLUDING bonuses (probe finding: insufficient spend left
    //    a unit alive only in the bug; the spend must cover it or the unit is
    //    confirmed dying).
    const eligibleType = ['evoker', 'enchantress', 'cleric'].some((t) => probeUnitDef(ref)?.id === t);
    const shieldOk = !declined.includes('mana_shield') && owner.species === 'wizard' && owner.research.includes('mana-shield') && eligibleType && owner.manaCurrent > 0;
    if (shieldOk) {
      d.step = 'mana_shield';
      const rawNeed = d.damage - currentDefOf(state, target); // need N+1 points to survive
      if (owner.kind === 'ai') {
        if (owner.manaCurrent > rawNeed) {
          const spend = rawNeed + 1;
          owner.manaCurrent -= spend;
          log(state, { phase: 'battle', actor: owner.playerId, category: 'battle', ...key(`${who(target)} was shielded by Mana Shield`), summary: `${owner.playerId} spends ${spend} mana on Mana Shield for ${who(target)}, which survives the area attack` });
          d.aoeWouldDie.shift();
          continue;
        }
        // Can't afford survival → decline the shield, fall through to Cleric.
        (d.aoeDeclined ??= []).push(`${ref}:mana_shield`);
      } else {
        state.pending = { kind: 'battle_defense', forPlayerId: target.ownerId };
        state.activePlayerId = target.ownerId;
        return `${target.label} would take ${d.damage} from the AoE — Mana Shield decision for ${target.ownerId}.`;
      }
    }
    // 3) Cleric save — the OWNER may save any one dying unit per pass per Cleric
    //    (§9.4); once per cleric per pass, even in an AoE (probe finding #4).
    const fpo = playerOrderFrom(state, state.firstPlayerIndex);
    const cleric = b.units
      .filter((x) => x.side === target.side && probeUnitDef(x.unitRef)?.id === 'cleric' && !x.clericUsedThisPass
        && !declined.includes(`cleric:${x.ownerId}`) && byId(state, x.ownerId).manaCurrent >= CLERIC_SAVE_MANA)
      .sort((x, y) => fpo.indexOf(x.ownerId) - fpo.indexOf(y.ownerId))[0];
    if (cleric) {
      d.step = 'cleric';
      const cOwner = byId(state, cleric.ownerId);
      if (cOwner.kind === 'ai' && keepClericForLeader(state, cleric.ownerId, target, d.aoeWouldDie)) {
        // AI policy, not a rule: one save left and this owner's Leader is
        // also about to die in this blast — keep the save for the Leader.
        (d.aoeDeclined ??= []).push(`${ref}:cleric:${cleric.ownerId}`);
        continue;
      }
      if (cOwner.kind === 'ai') {
        cOwner.manaCurrent -= 5;
        cleric.clericUsedThisPass = true;
        d.aoeWouldDie.shift();
        log(state, { phase: 'battle', actor: cleric.ownerId, category: 'battle', ...key(`${cleric.ownerId}'s Cleric saved ${who(target)}`), summary: `${cleric.ownerId} spends 5 mana: their Cleric saves ${who(target)} from the area attack` });
        continue;
      }
      state.pending = { kind: 'battle_defense', forPlayerId: cleric.ownerId };
      state.activePlayerId = cleric.ownerId;
      return `${target.label} would die to the AoE — ${cleric.ownerId}'s Cleric may prevent it (5 mana).`;
    }
    // No defense available → stays on the dying list.
    d.aoeWouldDie.shift();
    // Track confirmed deaths on the defense record so the final removal knows.
    (d.aoeConfirmedDeaths ??= []).push(ref);
  }
  // All decisions in → simultaneous removal with FROZEN stats honored through.
  // The entire casualty batch resolves FIRST (§12.1); the kill-victory check
  // fires only after the batch (a Leader kill ending the game mid-batch must
  // not orphan its simultaneous casualties — probe round-2 finding #1).
  const dying = (d.aoeConfirmedDeaths ?? []).map((ref) => b.units.find((x) => x.unitRef === ref)).filter((x): x is BattleUnit => !!x);
  // The area attack hits every unit of the opposing side at the location,
  // and collectors die to any hit (§7.1; designer ruling 2026-09-24): the
  // opposing side's collectors on the battle tile are destroyed with them.
  // A self-destruct (ruling #111) hits every side, collectors included.
  const blast = !!d.selfDestruct;
  const what = blast ? 'self-destruct' : 'area attack';
  const opposing = new Set<string>([
    ...Object.entries(b.sides ?? {}).filter(([, side]) => side !== attacker.side).map(([pid]) => pid),
    ...b.units.filter((x) => x.side !== attacker.side).map((x) => x.ownerId),
  ]);
  const collectorsHit = collectorsAt(state, b.coord).filter((c) => blast || opposing.has(c.ownerId));
  for (const c of collectorsHit) destroyCollector(state, c, `${attacker.label}'s ${what}`);
  if (collectorsHit.length > 0) b.killThisPass = true;
  for (const t of dying) killBattleUnit(state, t, attacker.ownerId, true);
  if (blast) {
    // The unit is lost in its own blast: out of the battle, off the map, its
    // Core back to the supply.
    b.units = b.units.filter((x) => x.unitRef !== attacker.unitRef);
    b.killThisPass = true;
    const mu = state.units.find((x) => x.id === attacker.unitRef);
    log(state, { phase: 'battle', actor: attacker.ownerId, category: 'destroyed', ...key(`${who(attacker)} was lost in its own blast`, { id: attacker.ownerId, line: `Your ${attacker.label} was lost in its own blast`, loss: true, notify: true }), summary: `${who(attacker)} is lost in its own blast and goes back to the supply` });
    if (mu) removeMapUnit(state, mu, true);
  }
  if (dying.length > 0) checkLeaderKillVictoryAfterBatch(state);
  const killedNames = [...dying.map(who), ...collectorsHit.map((c) => `${c.ownerId}'s ${collectorLabel(c.collectorId)}`)];
  log(state, { phase: 'battle', actor: attacker.ownerId, category: 'battle', ...key(`${who(attacker)}'s ${what} ${killedNames.length ? `killed ${killedNames.join(', ')}` : 'killed nothing'}`), summary: `${who(attacker)}'s ${what} (${d.damage} damage to every ${blast ? 'other unit and hero here, every side' : 'opposing unit here'}) ${killedNames.length ? `kills ${killedNames.join(', ')}` : 'kills nothing'}` });
  return finishAttack(state, attacker);
}

// ---------------------------------------------------------------------------
// Killing + hero death bookkeeping
// ---------------------------------------------------------------------------

export function killBattleUnit(state: NGGState, target: BattleUnit, killerOwnerId: string, deferVictoryCheck = false): void {
  const b = state.battle!;
  b.units = b.units.filter((x) => x.unitRef !== target.unitRef);
  b.killThisPass = true;
  b.kills.push({ victimRef: target.unitRef, killerOwnerId });
  const leader = target.isHero && state.heroes.find((x) => x.id === target.unitRef)?.isLeader;
  log(state, { phase: 'battle', actor: killerOwnerId, category: target.isHero ? 'hero-death' : 'battle', ...key(`${target.ownerId}'s ${leader ? 'Leader ' : ''}${target.label} was killed`, { id: target.ownerId, line: `Your ${leader ? 'Leader ' : ''}${target.label} was killed`, loss: true, notify: true }), summary: `${target.ownerId}'s ${leader ? 'Leader ' : ''}${target.label} is killed by ${killerOwnerId}${target.isHero ? '' : ' and goes back to the supply'}` });
  if (target.isHero) {
    const h = state.heroes.find((x) => x.id === target.unitRef)!;
    killHero(state, h, killerOwnerId, deferVictoryCheck, true);
  } else {
    const u = state.units.find((x) => x.id === target.unitRef);
    if (u) removeMapUnit(state, u, true);
  }
}

/** A hero is permanently removed (non-Leader) or the kill is credited; a
 *  Leader's death can end the game at 2–3p (§12.2) and marks the seat unable
 *  to initiate (ruling 74). Extra action cards granted by a dying hero stay
 *  usable for the rest of the round and are removed at the next upkeep. */
export function killHero(state: NGGState, h: HeroInstance, killerOwnerId: string, deferVictoryCheck = false, alreadyLogged = false): void {
  h.dead = true;
  if (!alreadyLogged) log(state, { phase: state.phase, actor: killerOwnerId, category: 'hero-death', ...key(`${h.ownerId}'s ${h.isLeader ? 'Leader ' : ''}${HEROES.find((x) => x.id === h.id)!.name} was killed`, { id: h.ownerId, line: `Your ${h.isLeader ? 'Leader ' : ''}${HEROES.find((x) => x.id === h.id)!.name} was killed`, loss: true, notify: true }), summary: `${h.ownerId}'s ${h.isLeader ? 'Leader ' : ''}${HEROES.find((x) => x.id === h.id)!.name} is killed by ${killerOwnerId}` });
  // A spy assignment is carried by its hero (§7.3/§7.9): it ends with the
  // hero, so its owner may recruit a replacement. Nothing is announced — the
  // assignment was secret.
  for (const s of byId(state, h.ownerId).spyAssignments) if (s.active && s.heroId === h.id) { s.active = false; s.endedUnseen = true; }
  // An Economy hero's overlay leaves with it (§8.3).
  refreshOverlay(state, h.coord);
  if (h.isLeader) {
    // No Military credit for killing one's own Leader (a self-destruct blast, ruling #111).
    if (killerOwnerId !== h.ownerId) byId(state, killerOwnerId).leaderKills += 1;
    // §12.1–12.2: the game can end THE MOMENT the kill lands — victory is
    // checked at the casualty boundary, not deferred to battle settlement
    // (further activations after a result could kill the winner's own Leader).
    // AoE batches (§12.1 simultaneous casualties) defer: every dying unit is
    // removed first, then the caller runs checkLeaderKillVictoryAfterBatch once.
    if (!deferVictoryCheck) checkLeaderKillVictory(state, killerOwnerId);
  }
  // Motherboard/Greymore's bonus point drops with them (techTotal recomputes).
  // Chronicler income ceases (computed live). Nothing else to tear down here.
}

/** After a SIMULTANEOUS casualty batch (AoE §12.1): run the kill-victory check
 *  for every seat that could have landed the final blow, then the all-dead
 *  draw guard — once, not per kill, so the batch is never orphaned mid-way
 *  (probe round-2 finding #1). */
export function checkLeaderKillVictoryAfterBatch(state: NGGState): void {
  for (const p of state.players) checkLeaderKillVictory(state, p.playerId);
}

/** A Leader kill can end the game immediately (2–3p: first kill; else the
 *  per-count threshold in the pin's victory table). */
function checkLeaderKillVictory(state: NGGState, killerOwnerId: string): void {
  // The military win requires the kill to have been credited by killHero.
  if (checkVictory(state, killerOwnerId)) return;
  checkAllLeadersDeadDraw(state);
}

/** A non-hero map unit dies: destroyed pieces return to supply (ruling 40);
 *  an operating platform's Core dies with it (ruling 39). */
export function removeMapUnit(state: NGGState, u: MapUnit, alreadyLogged = false): void {
  const p = byId(state, u.ownerId);
  const def = unitById(u.typeId)!;
  state.units = state.units.filter((x) => x.id !== u.id);
  if (u.allocatedCoreId) {
    // The Core dies too; both return to supply (not the owned reserve).
    p.coresInSupply += 1;
    log(state, { phase: state.phase, actor: null, category: 'core', summary: `${u.ownerId}'s Core is lost with its platform and goes back to the supply` });
  }
  if (def.collector) {
    // Free the collector's supply slot.
    const slot = Object.keys(p.collectorsAvailable).find((k) => k.startsWith(u.typeId) && p.collectorsAvailable[k] === 0);
    if (slot) p.collectorsAvailable[slot] = 1;
  }
  if (!alreadyLogged) log(state, { phase: state.phase, actor: null, category: 'destroyed', ...key(`${u.ownerId}'s ${def.name} at ${u.coord} was destroyed`, { id: u.ownerId, line: `Your ${def.name} at ${u.coord} was destroyed`, loss: true, notify: true }), summary: `${u.ownerId}'s ${def.name} at ${u.coord} is destroyed and goes back to the supply` });
}

/** Sweep unprotected opposing non-combat pieces at a location (§6.4, §9.7):
 *  combat units that entered (`actor`) or were left standing after a battle
 *  (`sweepers`) destroy every base, collector and Coreless platform there
 *  whose owner is hostile to them and has no protection — no combat unit of
 *  its own, or of an Open Borders ally, on the tile. A collector the owner of
 *  a sweeping unit authorised is spared by THAT player only (§6.2). With no
 *  sweeper there is no sweep. Returns what was removed. */
export function sweepLocation(state: NGGState, actor: PlayerState | null, coord: Coord, sweepers?: Set<string>): string[] {
  const removed: string[] = [];
  const by = [...(sweepers ?? new Set(actor ? [actor.playerId] : []))];
  if (by.length === 0) return removed;
  const combatOwners = new Set<string>([
    ...unitsAt(state, coord).filter(isCombatUnit).map((u) => u.ownerId),
    ...heroesAt(state, coord).map((h) => h.ownerId),
  ]);
  const isProtected = (owner: string) => combatOwners.has(owner)
    || [...combatOwners].some((c) => treatyBetween(state, c, owner, 'open-borders'));
  const hostileTo = (w: string, owner: string) => w !== owner && !areMilitaryAllies(state, w, owner);
  for (const u of [...unitsAt(state, coord)]) {
    if (isCombatUnit(u) || isProtected(u.ownerId) || !by.some((w) => hostileTo(w, u.ownerId))) continue;
    removeMapUnit(state, u);
    removed.push(`${u.ownerId}'s ${unitById(u.typeId)?.name ?? u.typeId}`);
  }
  for (const c of [...collectorsAt(state, coord)]) {
    if (isProtected(c.ownerId)) continue;
    if (!by.some((w) => w !== c.authorizedBy && hostileTo(w, c.ownerId))) continue;
    destroyCollector(state, c, 'left without protection');
    removed.push(`${c.ownerId}'s ${collectorLabel(c.collectorId)}`);
  }
  const base = baseAt(state, coord);
  if (base && !isProtected(base.ownerId) && by.some((w) => hostileTo(w, base.ownerId))) {
    state.bases = state.bases.filter((b) => b !== base);
    removed.push(`${base.ownerId}'s base`);
    log(state, { phase: state.phase, actor: actor?.playerId ?? null, category: 'destroyed', ...key(`${base.ownerId}'s base at ${coord} was destroyed`, { id: base.ownerId, line: `Your base at ${coord} was destroyed!`, loss: true, notify: true }), summary: `${base.ownerId}'s base at ${coord} is destroyed` });
  }
  return removed;
}

// ---------------------------------------------------------------------------
// Economy overlay arbitration (§8.3): two Economy heroes sharing one tile.
// ---------------------------------------------------------------------------

const ECONOMY_HEROES = ['wren', 'ida', 'derrick', 'mayhew'];

function economyHeroesAt(state: NGGState, coord: Coord): HeroInstance[] {
  return heroesAt(state, coord).filter((h) => ECONOMY_HEROES.includes(h.id));
}

/** §8.3, the ONE update run whenever the heroes on a tile change (placement,
 *  movement, Rally, retreat, Decoy, stalemate return, death): an Economy
 *  hero alone makes its overlay active; none leaves the printed terrain; two
 *  or more owe a choice whenever the set of them differs from the set the
 *  standing choice was made for. An owed choice is queued and asked as soon
 *  as no other decision is open (armOverlayChoice), so it never overwrites —
 *  or is overwritten by — another pending. */
export function refreshOverlay(state: NGGState, coord: Coord | null): void {
  if (!coord) return;
  const ov = state.overlays;
  const here = economyHeroesAt(state, coord).map((h) => h.id).sort();
  const dequeue = () => { if (ov.queue) ov.queue = ov.queue.filter((c) => c !== coord); };
  if (here.length === 0) {
    delete ov.activeByCoord[coord];
    if (ov.lockedWith) delete ov.lockedWith[coord];
    dequeue();
    return;
  }
  if (here.length === 1) {
    ov.activeByCoord[coord] = here[0]!;
    (ov.lockedWith ??= {})[coord] = here;
    dequeue();
    return;
  }
  const locked = ov.lockedWith?.[coord];
  const unchanged = !!locked && locked.length === here.length && locked.every((id, i) => id === here[i]);
  if (unchanged && here.includes(ov.activeByCoord[coord] ?? '')) return; // the choice stands (§8.3)
  if (ov.lockedWith) delete ov.lockedWith[coord];
  ov.queue = [...(ov.queue ?? []).filter((c) => c !== coord), coord];
}

/** Ask the next owed overlay choice, if no other decision is open. The owner
 *  of both heroes chooses; with different owners, the one earliest in
 *  first-player order (§8.3). */
export function armOverlayChoice(state: NGGState): void {
  if (state.pending || state.result) return;
  const ov = state.overlays;
  while (ov.queue && ov.queue.length > 0) {
    const coord = ov.queue[0]!;
    const here = economyHeroesAt(state, coord);
    if (here.length < 2) { refreshOverlay(state, coord); ov.queue = ov.queue.filter((c) => c !== coord); continue; }
    const owners = [...new Set(here.map((h) => h.ownerId))];
    const chooser = owners.length === 1 ? owners[0]! : playerOrderFrom(state, state.firstPlayerIndex).find((pid) => owners.includes(pid))!;
    state.pending = { kind: 'overlay_choice', forPlayerId: chooser, heroIds: here.map((h) => h.id) };
    state.activePlayerId = chooser;
    return;
  }
  delete ov.queue;
}

export function resolveOverlayChoice(state: NGGState, playerId: string, heroName: string): string {
  if (state.pending?.kind !== 'overlay_choice' || state.pending.forPlayerId !== playerId) {
    throw new GameError('ILLEGAL_MOVE', 'No overlay arbitration awaits you');
  }
  const ids = state.pending.heroIds;
  const pick = ids.find((id) => id === heroName || HEROES.find((h) => h.id === id)!.name.toLowerCase() === heroName.toLowerCase());
  if (!pick) throw new GameError('ILLEGAL_MOVE', `Choose one of the Economy heroes sharing the tile: ${ids.map((id) => HEROES.find((h) => h.id === id)!.name).join(', ')}`);
  const coord = state.heroes.find((x) => x.id === pick)!.coord!;
  state.overlays.activeByCoord[coord] = pick;
  (state.overlays.lockedWith ??= {})[coord] = economyHeroesAt(state, coord).map((h) => h.id).sort();
  if (state.overlays.queue) state.overlays.queue = state.overlays.queue.filter((c) => c !== coord);
  state.pending = null;
  const res = effectiveResourceAt(state, coord);
  log(state, { phase: state.phase, actor: playerId, category: 'overlay', ...key(`${playerId} set ${HEROES.find((x) => x.id === pick)!.name}'s overlay: ${coord} now produces ${res}`), summary: `${playerId} picks ${HEROES.find((x) => x.id === pick)!.name}'s overlay at ${coord}: the tile now produces ${res} until one of those heroes moves` });
  return `Overlay set: ${pick} at ${coord}.`;
}
