// Neither Guts nor Gears — legal move enumeration.
//
// One action per move; every constrained-set field accepts a PRINTED name and
// resolveX turns it into an id server-side. The menu must never force the model
// to invent a shape or a value (CLAUDE.md "Don't make the model guess").

import type { LegalMove } from '@zekel/game-kit';
import { GameError } from '@zekel/game-kit';
import {
  BATTLE_CARDS, cultureTargetFor, ECONOMIC_SPEND, HEROES, MAX_BASES, TREATIES,
  buildingsForSpecies, describeCost, heroStatsForCategory,
  researchForSpecies, unitsForSpecies, type BattleCardId,
  BATTLE_CARD_PURCHASE, battleCardUnlocked,
} from './data/catalogs.js';
import { collectorCapFor, economicCollectorsNeeded, economicExtraAny } from './economicScale.js';
import { coordKey, neighborsOf, tileLabel } from './data/maps.js';
import {
  heroesEligibleFor, resolveHero, unitById, buildingById, researchById,
} from './resolvers.js';
import type { BattleUnit, Coord, NGGMove, NGGState, PlayerState } from './types.js';
import {
  availableCollectorIds, byId, cardByInstanceId, checkVictory, dowserCollectorOptions, effectiveResourceAt, hasResearchedCard, actionCardSlots,
  eligibleMovers, hasCollectionAccess, hasLivingLeader, hasTreatyUnlock,
  heroAlivePlaced, isCombatUnit, locationOwner, militaryThreshold, speciesOf,
  techTotal, unitsAt, heroesAt, collectorsAt, baseAt, treatyBetween, treatyDeclinedThisRound, isBaseSite, factionPickShut,
  purchaseCostOf, paymentShortOf, openTreatyOffers, elaraSpellShut,
  isLegalPlacement, canonicalPayment, collectorResourceOf, coreSlots, countOwnedUnitsOfType,
  researchPrerequisiteShut, findPayment, refusingOwners,
  bankOf, collectorYield, pairedCoreCost,
} from './engine.js';
import { FACTIONS } from './data/catalogs.js';
import { counterTargetGate, defenseGate, playableCardGroups, treatyBreakGate, usableClerics } from './gates.js';
import {
  currentDefOf, currentDmgOf, probeUnitDef, rallyEligible, singleTargetShut, spyKillShut, withdrawalDestinations,
  tieGroupAtCursor,
} from './engine-battle.js';
import { seatName, tileName } from './names.js';

function mk(move: NGGMove, description: string): LegalMove<NGGMove> {
  return { move_id: '', description, move };
}

export function getLegalMoves(state: NGGState, playerId: string): LegalMove<NGGMove>[] {
  if (state.phase === 'game_over') return [];
  const p = byId(state, playerId);

  // ---- pendings own the clock ----
  const pend = state.pending;
  if (pend && pend.forPlayerId !== playerId) {
    // Someone else owes; nothing is yours to do.
    return [];
  }
  if (pend) return pendingMoves(state, p, pend);

  // ---- setup phases ----
  if (state.phase === 'setup_factions') {
    const reporter = state.players.find((x) => x.kind === 'human')?.playerId;
    if (playerId !== reporter) return [];
    const def: Record<string, string> = {};
    state.players.forEach((x, i) => { def[x.playerId] = FACTIONS[i % FACTIONS.length]!.id; });
    return [mk({ type: 'assign_setup_choices', selections: def }, 'Assign each player a faction (default distinct map shown; edit to each human\'s choice). Factions: ' + FACTIONS.map((f) => `${f.id} (${f.name}, ${f.species})`).join(', '))];
  }

  // ---- battle activation on the clock ----
  if (state.battle && state.battle.phase === 'activations') {
    const ref = state.battle.activationQueue[state.battle.activationCursor];
    const u = ref ? state.battle.units.find((x) => x.unitRef === ref) : undefined;
    if (u && u.ownerId === playerId) {
      // §9.3: when the units tied at this slot are all this seat's own, the
      // owner picks which acts first — every one of them is offered (the
      // engine already accepts naming any of them).
      const tie = tieGroupAtCursor(state);
      const mine = tie.length > 1 && tie.every((x) => x.ownerId === playerId) ? tie : [u];
      return mine.flatMap((x) => activationMoves(state, p, x.unitRef));
    }
    return [];
  }

  // ---- planning ----
  if (state.phase === 'planning') {
    if (state.planningOrder[0] !== playerId) return [];
    const moves: LegalMove<NGGMove>[] = [];
    for (const kind of ['build', 'move_battle', 'research'] as const) {
      const key = kind === 'move_battle' ? 'moveBattle' : kind;
      // Each held card is its own slot — the printed card, a hero-granted
      // extra, a researched extra (ruling #86) — offered while unplayed,
      // whichever went down first (§5.2).
      for (const which of actionCardSlots(p)[key]) {
        if (p.actionCardsPlayed.includes(`${kind}:${which}`)) continue;
        const tag = which === 'hero_extra' ? ' (hero-granted extra)' : which === 'researched_extra' ? ' (researched extra)' : '';
        moves.push(mk({ type: 'plan_action', card: kind, which }, `Place a ${kind} card face down on the Action Stack${tag}.`));
      }
    }
    moves.push(mk({ type: 'plan_action', card: 'pass' }, 'Pass planning (final for the round).'));
    // A Culture Treaty may break outside the culture phase when nothing is
    // resolving (§11.2) — planning is such a time.
    moves.push(...breakTreatyMoves(state, p));
    return moves;
  }

  // ---- action phase: the resolving card's owner ----
  if (state.phase === 'action' && state.activeAction) {
    if (state.activeAction.ownerId !== playerId) {
      // Treaty formation is offered only at the ACTIVE player's window.
      return [];
    }
    return actionMoves(state, p);
  }

  // ---- end of round: break-treaty window (real pending per §5.6) ----
  if (state.phase === 'treaty_break' || state.phase === 'end_of_round') {
    if (state.pending?.kind === 'treaty_break_decision' && state.pending.forPlayerId !== p.playerId) return [];
    const moves2 = breakTreatyMoves(state, p);
    moves2.push(mk({ type: 'skip_action' }, 'Keep all treaties (upkeep begins when everyone has answered).'));
    return moves2;
  }

  return [];
}

// ---------------------------------------------------------------------------
// Pendings
// ---------------------------------------------------------------------------

function pendingMoves(state: NGGState, p: PlayerState, pend: Exclude<NGGState['pending'], null>): LegalMove<NGGMove>[] {
  switch (pend.kind) {
    case 'choose_faction': {
      const open = FACTIONS.filter((f) => factionPickShut(state, f.id) === null);
      return open.map((f) => mk({ type: 'choose_faction', faction: f.id }, `Play ${f.name} (${f.species}).`));
    }
    case 'choose_leader': {
      const eligible = heroesEligibleFor(speciesOf(p)).filter((h) => state.heroPool.includes(h.id));
      return eligible.map((h) => mk({ type: 'choose_leader', hero: h.name }, `Choose ${h.name} as Leader${h.recommendedLeader ? ' (recommended)' : ''} — ${h.effect}`));
    }
    case 'choose_starting_location': {
      const starts = state.tiles.filter((t) => t.start != null).filter((t) => !state.bases.some((b) => b.coord === coordKey(t.c, t.r)));
      return starts.map((t) => mk({ type: 'choose_starting_location', location: `@${t.start}` }, `Start at @${t.start} (${coordKey(t.c, t.r)}, ${t.resource}).`));
    }
    case 'report_draw': {
      if (p.digital === true) {
        return [mk({ type: 'resolve_report' }, 'Draw a battle strategy card — the server deals it when you press this.')];
      }
      return [mk({ type: 'report_draw', card: 'Retreat' }, `Report the battle card you physically drew (by printed name — one of: ${BATTLE_CARDS.map((c) => c.label).join(', ')}). EDIT the card field to what you drew; do NOT invent it.`)];
    }
    case 'upkeep_reallocate_cores': {
      // Platforms on the map and collectors (off the map) both hold Cores.
      const slots = coreSlots(state, p);
      const keep: Record<string, boolean> = Object.fromEntries(slots.map((x) => [x.id, x.powered]));
      const name = (x: (typeof slots)[number]) => x.where ? `${x.label} at ${tileLabelOf(x.where)}` : `${x.label} (${x.id})`;
      const moves: LegalMove<NGGMove>[] = [mk({ type: 'reallocate_cores', allocations: keep }, `Keep the Cores where they are (${p.coresInReserve} in reserve, ${slots.filter((x) => x.powered).length} of ${slots.length} powered).`)];
      const powered = slots.filter((x) => x.powered);
      const unpowered = slots.filter((x) => !x.powered);
      for (const x of unpowered) {
        if (p.coresInReserve > 0) moves.push(mk({ type: 'reallocate_cores', allocations: { ...keep, [x.id]: true } }, `Put a reserve Core into ${name(x)}.`));
      }
      for (const x of powered) {
        moves.push(mk({ type: 'reallocate_cores', allocations: { ...keep, [x.id]: false } }, `Take the Core out of ${name(x)} into the reserve (+1 culture per round while there).`));
        // Move one Core straight across (any distance, §5.1).
        for (const y of unpowered) {
          moves.push(mk({ type: 'reallocate_cores', allocations: { ...keep, [x.id]: false, [y.id]: true } }, `Move the Core from ${name(x)} to ${name(y)}.`));
        }
      }
      return moves;
    }
    case 'access_request': {
      return [
        mk({ type: 'respond_access_request', grant: true }, `Grant ${seatName(state, pend.buyerId)} collection access at ${tileName(pend.coord)} (their collector stays safely beside your units until upkeep).`),
        mk({ type: 'respond_access_request', grant: false }, `Refuse ${seatName(state, pend.buyerId)} access at ${tileName(pend.coord)} — nothing commits.`),
      ];
    }
    case 'second_purchase': {
      const moves: LegalMove<NGGMove>[] = [];
      moves.push(mk({ type: 'skip_action' }, 'Decline the second purchase.'));
      // The actual second purchase is a fresh build/research move — enumerate it.
      if (pend.action === 'build') moves.push(...buildMoves(state, p, true));
      else moves.push(...researchMoves(state, p, true));
      return moves;
    }
    case 'smyth_reward': {
      const list = researchForSpecies(speciesOf(p)).filter((r) => !p.research.includes(r.id));
      return list.map((r) => mk({ type: 'research', kind: 'tech', tech: r.name, payment: [] }, `Smyth's reward: take ${r.name} free (cost and prerequisite waived) — ${r.effect}`));
    }
    case 'elara_spell': {
      const elara = state.heroes.find((h) => h.id === 'elara' && h.ownerId === p.playerId && !h.dead && h.coord !== null);
      if (!elara) return [mk({ type: 'cast_elara_spell', target_location: null, skip: true }, 'Elara is not in play — continue.')];
      const elaraTile = state.tiles.find((t) => coordKey(t.c, t.r) === elara.coord)!;
      const adjacent = neighborsOf(state.tiles, elaraTile.c, elaraTile.r).map((t) => coordKey(t.c, t.r));
      // Spell targets = adjacent spaces holding a valid casualty (any opponent
      // who is NOT a military ally — Peace/Open-Borders partners are skipped).
      // A Peace-partner-only tile is NOT castable (the engine Peace-blocks the
      // attack shape), so it's dropped from the menu rather than offered as a
      // guaranteed-reject trap. A truly empty tile is still offered (a legal
      // "no casualties" cast) unless a Peace partner is present.
      const castable = adjacent.filter((k) => {
        const occupants = new Set<string>([
          ...state.units.filter((u) => u.coord === k).map((u) => u.ownerId),
          ...state.heroes.filter((h) => h.coord === k && !h.dead).map((h) => h.ownerId),
        ]);
        occupants.delete(p.playerId);
        for (const owner of occupants) {
          if (treatyBetween(state, p.playerId, owner, 'peace')) return false; // Peace-blocks the cast
        }
        return true;
      });
      const moves = castable.map((k) => {
        return mk({ type: 'cast_elara_spell' as const, target_location: k }, `Cast Elara's spell at ${k} (${effectiveResourceAt(state, k)}) — 5 mana, 4 damage to all non-allied units there.`);
      });
      moves.push(mk({ type: 'cast_elara_spell', target_location: null, skip: true }, 'Skip Elara\'s spell; move normally.'));
      if (p.manaCurrent < 5) return [mk({ type: 'cast_elara_spell', target_location: null, skip: true }, `Not enough mana (${p.manaCurrent}/5) — skip Elara's spell.`)];
      return moves;
    }
    case 'treaty_response': {
      const def = TREATIES.find((t) => t.id === pend.treatyType)!;
      return [
        mk({ type: 'respond_treaty', accept: true }, `Accept ${def.name} from ${pend.proposerId} — ${def.effect} (+${def.cultureIncome} culture each per round).`),
        mk({ type: 'respond_treaty', accept: false }, `Decline ${def.name} from ${pend.proposerId}.`),
      ];
    }
    case 'treaty_break_decision': {
      const own = state.treaties.filter((t) => t.type !== 'culture-treaty' && t.partners.includes(p.playerId));
      const out = breakTreatyMoves(state, p);
      out.push(mk({ type: 'skip_action' }, `Keep all treaties (${own.map((t) => t.type).join(', ') || 'none held'}) — upkeep begins when everyone has answered.`));
      return out;
    }
    case 'battle_commit': {
      const moves: LegalMove<NGGMove>[] = [mk({ type: 'commit_battle_card', card: null }, 'Commit NO battle card (secret until all commit).')];
      // One entry per card kind with a playable instance — own hand first, then
      // a Shared Tactics partner's. Reserved instances (probe #7) and the
      // owner-first rule (§11.2) are gates.ts battleCardGate, the same rule the
      // engine throws; kinds with no open instance are left off.
      for (const g of playableCardGroups(state, p.playerId)) {
        const first = g.open[0];
        if (!first) continue;
        const def = BATTLE_CARDS.find((c) => c.id === g.card)!;
        moves.push(mk({ type: 'commit_battle_card', card: def.label }, first.ownerId === p.playerId
          ? `Commit ${def.label} — ${def.effect}`
          : `Commit partner's ${def.label} (Shared Tactics) — ${def.effect}`));
      }
      return moves;
    }
    case 'counter_target': {
      const b = state.battle!;
      const targets = b.committed.filter((c) => counterTargetGate.check(state, p.playerId, c) === null);
      // One option per played card: the payload names the card AND who played
      // it (and its batch), so two copies are two different choices (§10.2).
      const seen = new Set<string>();
      return targets.flatMap((c) => {
        const def = BATTLE_CARDS.find((x) => x.id === c.card)!;
        const key = `${c.card}|${c.playingPlayerId}|${c.batch ?? 0}`;
        if (seen.has(key)) return []; // identical copies from one player in one batch are one choice
        seen.add(key);
        return [mk({ type: 'choose_counter_target', card: def.label, played_by: c.playingPlayerId, batch: c.batch ?? 0 }, `Counter the ${def.label} played by ${c.playingPlayerId}.`)];
      });
    }
    case 'extra_selection': {
      const moves: LegalMove<NGGMove>[] = [mk({ type: 'select_extra_cards', cards: [] }, 'Add no cards (Extra resolves; nothing enters the next batch).')];
      // Own hand plus (§11.2) a Shared Tactics partner's remaining cards; the
      // owner-first gate has already passed at resolution. Reserved instances
      // never appear (probe #7). Same gate as the engine: gates.ts.
      const available = playableCardGroups(state, p.playerId).filter((g) => g.open.length > 0);
      for (const g of available) {
        const fromPartner = g.open[0]!.ownerId !== p.playerId;
        moves.push(mk({ type: 'select_extra_cards', cards: [g.label] }, `Add ${g.label}${fromPartner ? " (partner's)" : ''}.`));
      }
      // Pairs: two different cards, or two copies of one card when two are
      // playable (the Extra rule sets no same-card limit; the engine takes a
      // different physical copy for each).
      for (let i = 0; i < available.length; i++) {
        for (let j = available[i]!.open.length >= 2 ? i : i + 1; j < available.length; j++) {
          moves.push(mk({ type: 'select_extra_cards', cards: [available[i]!.label, available[j]!.label] }, `Add ${available[i]!.label} + ${available[j]!.label}.`));
        }
      }
      return moves;
    }
    case 'initiative_tie': {
      const b = state.battle!;
      return pend.tieGroup.flatMap((ref) => {
        const u = b.units.find((x) => x.unitRef === ref);
        return u && !u.activated ? [mk({ type: 'choose_initiative_order', unit: ref }, `${u.label} (${u.ownerId}) acts next — the tied allied units go in the order you pick.`)] : [];
      });
    }
    case 'battle_defense': {
      return defenseMoves(state, p);
    }
    case 'retreat': {
      return retreatMoves(state, p);
    }
    case 'rally_selection': {
      // The engine's own list (engine-battle rallyEligible): mobile units and
      // heroes next to the battle; never collectors, Immobile or Coreless
      // platforms.
      const all = rallyEligible(state, p.playerId);
      const moves: LegalMove<NGGMove>[] = [mk({ type: 'select_rally_units', units: [] }, 'Rally brings nothing into the battle.')];
      for (const group of unitGroups(all)) {
        moves.push(mk({ type: 'select_rally_units', units: group.map((e) => e.id) }, `Rally brings ${group.map((e) => `${e.label} from ${tileLabelOf(e.coord)}`).join(', ')} into the battle.`));
      }
      return moves;
    }
    case 'choose_milestone_hero': {
      const eligible = heroesEligibleFor(speciesOf(p)).filter((h) => state.heroPool.includes(h.id));
      return eligible.map((h) => mk({ type: 'choose_milestone_hero', hero: h.name }, `Claim ${h.name} — ${h.effect}`));
    }
    case 'overlay_choice': {
      const [a, b] = pend.heroIds;
      return [a, b].map((id) => mk({ type: 'resolve_overlay_choice', hero: HEROES.find((h) => h.id === id)!.name }, `Make ${HEROES.find((h) => h.id === id)!.name}'s overlay the active one (locked until a hero moves).`));
    }
    case 'place_reserved_hero': {
      const bases = state.bases.filter((b) => b.ownerId === p.playerId);
      const hero = HEROES.find((h) => h.id === pend.heroId)!;
      return bases.map((b) => mk({ type: 'place_reserved_hero', hero: hero.name, coord: b.coord }, `Place reserved ${hero.name} at your base ${b.coord} — its benefits begin.`));
    }
    case 'dowser_collector': {
      // Ruling #106: the robot picks which free collector Dowser grants.
      return dowserCollectorOptions(state, p).map((u) => mk({ type: 'choose_dowser_collector', collector: u.name }, `Take a free ${u.name} from Dowser, with a Core in it.`));
    }
    case 'choose_spy': {
      const mine = state.heroes.filter((h) => h.ownerId === p.playerId && !h.dead);
      return mine.map((h) => mk({ type: 'choose_spy', hero: HEROES.find((x) => x.id === h.id)!.name }, `Assign your spy to ${HEROES.find((x) => x.id === h.id)!.name} (PRIVATE — opponents never see this).`));
    }
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Action-phase moves for the resolving card's owner
// ---------------------------------------------------------------------------

function actionMoves(state: NGGState, p: PlayerState): LegalView<NGGMove>[] | LegalMove<NGGMove>[] {
  const kind = state.activeAction!.cardKind;
  const moves: LegalMove<NGGMove>[] = [];
  // Treaty formation: at the start of the active player's action (offered
  // beside the action itself) and at its end (the end window, §5.3/§11.1).
  moves.push(...treatyOffersFor(state, p));
  // A Culture Treaty may also break at these boundaries (the gate says when).
  moves.push(...breakTreatyMoves(state, p));
  if (state.activeAction!.endWindow) {
    moves.push(mk({ type: 'skip_action' }, `Finish the ${kind === 'move_battle' ? 'Move/Battle' : kind} action without offering a treaty.`));
    return moves;
  }
  if (kind === 'build') {
    moves.push(...buildMoves(state, p, false));
    // Economic victory spend (a special Build action). Only offered when the
    // seat actually holds the collectors AND the reach solver can cover the
    // printed mix on that many distinct tiles (else the offer is a guaranteed
    // rejection). Half the map (ruling #89), or the session's override.
    const needed = economicCollectorsNeeded(state);
    const extra = economicExtraAny(state);
    if (state.players.length >= 2 && hasLivingLeader(state, p.playerId) && availableCollectorIds(state, p).length >= needed) {
      const suggestion = suggestPayment(state, p, ECONOMIC_SPEND, extra, true);
      if (suggestion?.length === needed) {
        moves.push(mk({ type: 'economic_victory_spend', payment: suggestion }, `Economic victory spend: pay ${needed} collectors on ${needed} distinct tiles covering 3 water + 3 wood + 3 ore + 1 oil + 1 ether${extra > 0 ? ` (the other ${extra} on any resource)` : ''}. Build nothing; the spend is the action. (Suggested payment attached — edit freely.)`));
      }
    }
    moves.push(mk({ type: 'skip_action' }, 'Skip this Build action (the card is used for the round).'));
  } else if (kind === 'research') {
    moves.push(...researchMoves(state, p, false));
    moves.push(mk({ type: 'skip_action' }, 'Skip this Research action.'));
  } else {
    // Elara's spell comes first, before any movement, and movement after it
    // is optional (§6.4, §8.4).
    if (!state.activeAction!.elaraCast) moves.push(...elaraSpellMoves(state, p));
    moves.push(...moveMoves(state, p));
    moves.push(mk({ type: 'skip_action' }, state.activeAction!.elaraCast
      ? 'Do not move after Elara\'s spell (end the Move/Battle action).'
      : 'Skip this Move/Battle action.'));
  }
  return moves;
}

/** Elara's spell targets: every adjacent space, except one a Peace partner
 *  holds (the engine refuses those). Offered at the start of a Move/Battle
 *  action while Elara is in play and her owner has 5 mana. */
function elaraSpellMoves(state: NGGState, p: PlayerState): LegalMove<NGGMove>[] {
  const elara = state.heroes.find((h) => h.id === 'elara' && h.ownerId === p.playerId && !h.dead && h.coord !== null);
  if (!elara || p.manaCurrent < 5) return [];
  const elaraTile = state.tiles.find((t) => coordKey(t.c, t.r) === elara.coord)!;
  const out: LegalMove<NGGMove>[] = [];
  for (const t of neighborsOf(state.tiles, elaraTile.c, elaraTile.r)) {
    const k = coordKey(t.c, t.r);
    if (elaraSpellShut(state, p.playerId, k)) continue;
    out.push(mk({ type: 'cast_elara_spell', target_location: k }, `Cast Elara's spell at ${tileLabelOf(k)} before moving — 5 mana, 4 damage to every unit there that is not yours or an Open Borders/Peace ally's (not a battle).`));
  }
  return out;
}

// An alias used only to widen a helper's return type without TS complaints.
type LegalView<M> = LegalMove<M>;

/** Build purchases: one unit/building/base at its cost, payment computed by
 *  proposing eligible placements. Payment enumeration needs a reach solver, so
 *  the menu carries a SKELETON with the available collectors + legal spots the
 *  human edits (the engine validates the complete declared payment anyway). */
function buildMoves(state: NGGState, p: PlayerState, _isSecond: boolean): LegalMove<NGGMove>[] {
  const moves: LegalMove<NGGMove>[] = [];
  const species = speciesOf(p);
  const units = unitsForSpecies(species);
  const buildings = buildingsForSpecies(species);
  const avail = availableCollectorIds(state, p);
  // §6.3: a baseless seat cannot place new map units (it must rebuild a base
  // first). Skip those purchases up front so the menu never offers a move the
  // engine rejects; a base (isBase) and non-map tokens (subject/core) still go.
  const hasBase = state.bases.some((b) => b.ownerId === p.playerId);
  for (const u of units) {
    // Collectors, Subjects and reserve Cores stay off the map; spies ride
    // heroes. Every other unit appears at a base.
    const isMapPiece = !u.collector && u.id !== 'subject' && u.id !== 'core' && !u.grantsSpy;
    if (isMapPiece && !hasBase) continue;
    if (u.requiresBuilding && !p.buildings.includes(u.requiresBuilding)) continue;
    if (u.grantsSpy && p.spyAssignments.some((s) => s.active)) continue;
    // A spy is a hero assignment (§7.3/§7.9): with no living hero to carry it,
    // the recruitment would open a choose_spy pending nobody can answer
    // (balance harness 2026-09-22: five stranded games, all a dead-Leader seat
    // buying an Illusionist/Infiltrator).
    if (u.grantsSpy && !state.heroes.some((h) => h.ownerId === p.playerId && !h.dead)) continue;
    // Never offer a purchase that the per-type supply cap has already closed.
    if (countOwnedUnitsOfType(state, p, u.id) >= collectorCapFor(state, u)) continue;
    if (u.id === 'core' && p.coresInSupply <= 0) continue;
    if (u.needsCore && p.coresInReserve <= 0 && p.coresInSupply <= 0) continue;
    // A Core-needing piece takes a reserve Core, or a Core bought with it
    // (§6.3) — both are the buyer's options when both are possible.
    const coreWays: Array<boolean | null> = !u.needsCore ? [null]
      : [...(p.coresInReserve > 0 ? [false] : []), ...(p.coresInSupply > 0 ? [true] : [])];
    for (const pairingOn of coreWays) {
      const fullCost = pairingOn
        ? purchaseCostOf(p, { type: 'build', item: u.name, core_pairing: true }).cost
        : u.cost;
      const coreCost = pairedCoreCost(p);
      const payment = suggestPayment(state, p, fullCost);
      if (!payment) continue; // no payable line (also after refusals) — don't offer the trap
      const coreNote = pairingOn
        ? ` + a new Core bought with it (core_pairing, ${Object.keys(coreCost).length ? `+${describeCost(coreCost)}` : 'free with Core Integration'})`
        : pairingOn === false ? ' using a reserve Core' : '';
      const pairing = pairingOn ? { core_pairing: true } : {};
      // A map piece spawns at a base of the buyer's choosing: one move per
      // owned base, each naming it (a choice the rules give the player).
      const spawns = isMapPiece ? state.bases.filter((b) => b.ownerId === p.playerId).map((b) => b.coord) : [null];
      for (const at of spawns) {
        moves.push(mk(
          { type: 'build', item: u.name, payment, ...pairing, ...(at ? { at_base: at } : {}) },
          `Build ${u.name} for ${describeCost(u.cost)}${coreNote}${at ? ` at your base ${tileLabelOf(at)}` : ''} (available collectors: ${avail.join(', ') || 'none'}; edit payment placements as needed).`,
        ));
      }
    }
  }
  for (const b of buildings) {
    const held = p.buildingCounts[b.id] ?? 0;
    if (held >= (b.repeatableMax ?? 1)) continue;
    const payment = suggestPayment(state, p, b.cost);
    if (!payment) continue;
    if (!b.isBase) {
      moves.push(mk({ type: 'build', item: b.name, payment }, `Build ${b.name} for ${describeCost(b.cost)}.`));
      continue;
    }
    // A new base: one move per tile it may go on (ruling 55), named — and
    // none at the base limit, which the purchase would refuse.
    if (state.bases.filter((x) => x.ownerId === p.playerId).length >= MAX_BASES) continue;
    for (const t of state.tiles) {
      const k = coordKey(t.c, t.r);
      if (!isBaseSite(state, p.playerId, k)) continue;
      moves.push(mk({ type: 'build', item: b.name, payment, at_base: k }, `Build ${b.name} for ${describeCost(b.cost)}, a new base at ${tileLabelOf(k)}.`));
    }
  }
  return moves;
}

function tileLabelOf(coord: Coord): string {
  const [c, r] = coord.split(',').map((v) => parseInt(v, 10));
  return tileLabel(c!, r!);
}

function researchMoves(state: NGGState, p: PlayerState, _isSecond: boolean): LegalMove<NGGMove>[] {
  const moves: LegalMove<NGGMove>[] = [];
  const species = speciesOf(p);
  for (const r of researchForSpecies(species)) {
    if (p.research.includes(r.id)) continue;
    if (researchPrerequisiteShut(state, p, r) !== null) continue;
    if (r.either) {
      // The fourth resource is ether OR oil (ruling #86, priced like a battle
      // card): offer whichever the seat can pay — both, when both are payable.
      for (const leg of r.either) {
        const payment = suggestPayment(state, p, { ...r.cost, [leg]: (r.cost[leg] ?? 0) + 1 });
        if (payment) moves.push(mk({ type: 'research', kind: 'tech', tech: r.name, payment }, `Research ${r.name} for ${describeCost(r.cost)} + 1 ${leg} — ${r.effect}.`));
      }
      continue;
    }
    const payment = suggestPayment(state, p, r.cost);
    if (!payment) continue;
    moves.push(mk({ type: 'research', kind: 'tech', tech: r.name, payment }, `Research ${r.name} for ${describeCost(r.cost)} — ${r.effect}.`));
  }
  if (battleCardUnlocked(p.buildings)) {
    // The fourth resource is ether OR oil (§6.5): offer whichever the seat
    // can pay — both, when both are payable.
    for (const leg of BATTLE_CARD_PURCHASE.either) {
      const cost = { ...BATTLE_CARD_PURCHASE.cost, [leg]: 1 };
      const payment = suggestPayment(state, p, cost);
      if (payment) moves.push(mk({ type: 'research', kind: 'battle_card', payment }, `Buy a battle strategy card for ${describeCost(cost)}, then draw it.`));
    }
  }
  return moves;
}

/** A payment SUGGESTION for a purchase: the engine's payment search
 *  (findPayment) over the seat's available collectors. Surplus placements
 *  appear only where they are needed to reach. After a refusal (§6.2) the
 *  refusing seats' locations are left out; the refused collector itself stays
 *  usable elsewhere. The human may edit; the engine validates the declared
 *  payment on apply. */
export function suggestPayment(state: NGGState, p: PlayerState, cost: Partial<Record<string, number>>, extraAny = 0, distinctTiles = false): Array<{ collectorId: string; coord: Coord }> | null {
  return findPayment(state, p, cost as Parameters<typeof findPayment>[2], refusingOwners(state, p.playerId), 3000, extraAny, distinctTiles);
}

/**
 * The read-only reach question (Game.queryChoice "collector_reach"): given the
 * placements a seat has chosen so far for the purchase it is composing, in
 * order, where may each collector still in hand go next? Every prior placement
 * is checked in order against the same anchor rule the purchase uses, so the
 * answer never runs ahead of the engine. Nothing is applied.
 */
export function collectorReach(state: NGGState, playerId: string, prior: Array<{ collectorId: string; coord: Coord }>, purchase?: Record<string, unknown> | null): {
  collectors: Array<{ id: string; resource: string | null; placed_at: Coord | null }>;
  next: Record<string, Coord[]>;
  /** what the placements so far produce, by resource */
  produced: Record<string, number>;
  /** placements on a tile whose owner would be asked for consent */
  access_needed: Array<{ collectorId: string; coord: Coord; owner: string }>;
  /** Ruling #101: what a Haste wizard's bank holds; it pays before the placements */
  bank: Record<string, number>;
  /** when the purchase is named: whether the placements (and the bank) pay for it, and what is short */
  covers?: boolean;
  short?: Record<string, number>;
  short_either?: string[] | null;
} {
  const p = byId(state, playerId);
  const composing = state.phase === 'action' && !state.battle && state.activeAction?.ownerId === playerId
    && (state.activeAction.cardKind === 'build' || state.activeAction.cardKind === 'research')
    && (state.pending === null || (state.pending.kind === 'second_purchase' && state.pending.forPlayerId === playerId));
  if (!composing) throw new GameError('ILLEGAL_MOVE', 'No purchase of yours is being composed');
  const refused = state.activeAction?.refusedAccess ?? [];
  const avail = availableCollectorIds(state, p);
  const typeOf = (cid: string) => collectorResourceOf(cid);
  const spotsFor = (cid: string, before: Array<{ collectorId: string; coord: Coord }>) => legalSpotsFor(state, p, before)
    .filter((s) => !refused.some((r) => r.collectorId === cid && r.coord === s))
    .filter((s) => { const t = typeOf(cid); return !t || effectiveResourceAt(state, s) === t; });
  const placed: Array<{ collectorId: string; coord: Coord }> = [];
  // Printed tile labels ("C5") are accepted and read as the tile they name,
  // exactly as the purchase itself reads them.
  for (const pl of canonicalPayment(state, prior)) {
    if (!avail.includes(pl.collectorId)) throw new GameError('ILLEGAL_MOVE', `${pl.collectorId} is not a free collector of yours`);
    if (placed.some((x) => x.collectorId === pl.collectorId)) throw new GameError('ILLEGAL_MOVE', `${pl.collectorId} is placed twice`);
    if (!spotsFor(pl.collectorId, placed).includes(pl.coord)) throw new GameError('ILLEGAL_MOVE', `${pl.collectorId} cannot stand at ${pl.coord}`);
    placed.push(pl);
  }
  const next: Record<string, Coord[]> = {};
  for (const cid of avail) if (!placed.some((x) => x.collectorId === cid)) next[cid] = spotsFor(cid, placed);
  const produced: Record<string, number> = {};
  const bank = bankOf(p) as Record<string, number>;
  const access_needed: Array<{ collectorId: string; coord: Coord; owner: string }> = [];
  for (const pl of placed) {
    const res = effectiveResourceAt(state, pl.coord);
    // Ruling #101: a Haste wizard's Surf makes two.
    produced[res] = (produced[res] ?? 0) + collectorYield(p, pl.collectorId);
    const owner = locationOwner(state, pl.coord);
    if (owner && owner !== playerId && !hasCollectionAccess(state, playerId, owner)) access_needed.push({ ...pl, owner });
  }
  // Coverage, when the question names the purchase: the purchase's own cost.
  let coverage: { covers: boolean; short: Record<string, number>; short_either: string[] | null } | null = null;
  if (purchase && typeof purchase['type'] === 'string') {
    const { cost, either } = purchaseCostOf(p, purchase as { type: string });
    const withBank: Record<string, number> = { ...produced };
    for (const [r, n] of Object.entries(bank)) withBank[r] = (withBank[r] ?? 0) + (n ?? 0);
    const { short, either: eitherShort } = paymentShortOf(cost, either, withBank as Parameters<typeof paymentShortOf>[2]);
    coverage = { covers: Object.keys(short).length === 0 && !eitherShort, short: short as Record<string, number>, short_either: eitherShort };
  }
  return {
    collectors: avail.map((id) => ({ id, resource: typeOf(id), placed_at: placed.find((x) => x.collectorId === id)?.coord ?? null })),
    next,
    produced,
    access_needed,
    bank,
    ...(coverage ?? {}),
  };
}

/** Legal placement spots for the next collector: the engine's own placement
 *  rule (isLegalPlacement) over this payment's earlier placements. */
function legalSpotsFor(state: NGGState, p: PlayerState, prior: Array<{ collectorId: string; coord: Coord }>): Coord[] {
  return state.tiles.map((t) => coordKey(t.c, t.r)).filter((k) => isLegalPlacement(state, p, k, prior));
}

function moveMoves(state: NGGState, p: PlayerState): LegalMove<NGGMove>[] {
  const moves: LegalMove<NGGMove>[] = [];
  const myCoords = new Set<Coord>([
    ...state.units.filter((u) => u.ownerId === p.playerId).map((u) => u.coord),
    ...state.heroes.filter((h) => h.ownerId === p.playerId && !h.dead && h.coord).map((h) => h.coord!),
  ]);
  for (const from of myCoords) {
    const movers = eligibleMovers(state, p, from);
    if (movers.length === 0) continue;
    const tile = state.tiles.find((t) => coordKey(t.c, t.r) === from)!;
    for (const nt of neighborsOf(state.tiles, tile.c, tile.r)) {
      const to = coordKey(nt.c, nt.r);
      // Peace-block the way the engine's entryConflict does: the destination
      // is blocked if ANY other-side occupant (unit, hero, collector, or base
      // owner — the engine checks all four) is a Peace partner of mine.
      const others = new Set<string>([
        ...unitsAt(state, to).map((u) => u.ownerId),
        ...heroesAt(state, to).map((h) => h.ownerId),
        ...collectorsAt(state, to).map((c) => c.ownerId),
        ...(baseAt(state, to) ? [baseAt(state, to)!.ownerId] : []),
      ]);
      others.delete(p.playerId);
      let peaceBlocked = false;
      for (const o of others) if (treatyBetween(state, p.playerId, o, 'peace')) peaceBlocked = true;
      if (peaceBlocked) continue;
      // §6.4: ANY number of the eligible units may go (a group of the
      // player's choosing, not always all of them).
      for (const group of unitGroups(movers)) {
        moves.push(mk(
          { type: 'move_units', from, to, units: group.map((m) => m.id) },
          `Move ${group.map((m) => m.label).join(', ')} from ${tileLabelOf(from)} to ${tileLabelOf(to)} (${nt.resource})${[...others].length ? ' — enters opposition (battle or sweep)' : ''}.`,
        ));
      }
    }
  }
  return moves;
}

/** The groups of units a menu offers for "any number of them" (§6.4 moves,
 *  §10.1 Rally): every group when there are four or fewer; otherwise all of
 *  them, each alone, and all but one — any other group may still be named
 *  in the move itself. */
export function unitGroups<T>(units: T[]): T[][] {
  if (units.length === 0) return [];
  if (units.length <= 4) {
    const out: T[][] = [];
    for (let mask = (1 << units.length) - 1; mask >= 1; mask--) out.push(units.filter((_, i) => mask & (1 << i)));
    return out;
  }
  return [units, ...units.map((u) => [u]), ...units.map((u) => units.filter((x) => x !== u))];
}

function treatyOffersFor(state: NGGState, p: PlayerState): LegalMove<NGGMove>[] {
  return openTreatyOffers(state, p.playerId).map(({ partner, treaty: t }) =>
    mk({ type: 'form_treaty', partner, treaty_type: t.name }, `Offer ${t.name} to ${partner} — ${t.effect} (+${t.cultureIncome} culture each per round).`));
}

function breakTreatyMoves(state: NGGState, p: PlayerState): LegalMove<NGGMove>[] {
  const moves: LegalMove<NGGMove>[] = [];
  for (const t of state.treaties.filter((x) => x.partners.includes(p.playerId))) {
    // A shut treaty is left off the menu on the SAME rule the engine throws
    // (gates.ts treatyBreakGate); the pending view prints why it is shut.
    if (treatyBreakGate.check(state, p.playerId, t) !== null) continue;
    const name = TREATIES.find((x) => x.id === t.type)!.name;
    const partner = t.partners[0] === p.playerId ? t.partners[1] : t.partners[0];
    moves.push(mk({ type: 'break_treaty', treaty_type: name, partner }, `Break ${name} with ${partner}.`));
  }
  return moves;
}

// ---------------------------------------------------------------------------
// Battle moves
// ---------------------------------------------------------------------------

function activationMoves(state: NGGState, p: PlayerState, ref: string): LegalMove<NGGMove>[] {
  const b = state.battle!;
  const u = b.units.find((x) => x.unitRef === ref)!;
  const moves: LegalMove<NGGMove>[] = [];
  const opponents = b.units.filter((x) => x.side !== u.side);
  const typeId = probeUnitDef(u.unitRef)?.id;
  const isEvoker = typeId === 'evoker';
  const dmg = currentDmgOf(state, u);
  // Single-target attacks pass the engine's own targeting gate (a standing
  // opposing Wall first — singleTargetShut); an Evoker's attack is its
  // Wizard Missile and costs 1 mana (§7.2). A unit printed with DMG 0 never
  // attacks (§7.1).
  if (u.dmg > 0 && (!isEvoker || p.manaCurrent >= 1)) {
    if (u.aoe) {
      moves.push(mk({ type: 'battle_activation', unit: u.unitRef, action: { kind: 'attack', target: '' } }, `${u.label} makes its area attack — ${dmg} DMG to every opposing unit here (and the opposing side's collectors).`));
    } else {
      for (const t of opponents) {
        if (singleTargetShut(state, u, t) !== null) continue;
        moves.push(mk({ type: 'battle_activation', unit: u.unitRef, action: { kind: 'attack', target: t.unitRef } }, `${u.label}${isEvoker ? ' fires Wizard Missile at' : ' attacks'} ${t.label} (${t.ownerId}) — DMG ${dmg} vs DEF ${currentDefOf(state, t)}${isEvoker ? ' (1 mana)' : ''}.`));
      }
    }
  }
  // Abilities by unit type.
  if (typeId === 'evoker') {
    if (p.research.includes('ice-blast') && p.manaCurrent >= 3) for (const t of b.units.filter((x) => !x.activated)) moves.push(mk({ type: 'battle_activation', unit: u.unitRef, action: { kind: 'ability', ability: 'ice_blast', target: t.unitRef } }, `${u.label} casts Ice Blast on ${t.label} (${t.ownerId}) (3 mana, −100 Init).`));
    if (p.research.includes('fiery-explosion') && p.manaCurrent >= 3) moves.push(mk({ type: 'battle_activation', unit: u.unitRef, action: { kind: 'ability', ability: 'fiery_explosion' } }, `${u.label} casts Fiery Explosion (3 mana) — ${Math.max(0, 2 + (dmg - u.dmg))} DMG to every opposing unit here.`));
  }
  if (typeId === 'enchantress') {
    if (p.manaCurrent >= 2) {
      // Each line says whose unit it is and what the number becomes; own side
      // first. Enhance does nothing to a unit printed with DMG 0 (§7.4), so
      // those are not offered.
      const whose = (t: BattleUnit) => t.ownerId === p.playerId ? 'yours' : t.side === u.side ? `ally ${t.ownerId}` : `enemy ${t.ownerId}`;
      const ordered = [...b.units].sort((x, y) => Number(x.side !== u.side) - Number(y.side !== u.side));
      for (const t of ordered) {
        if (t.dmg > 0) {
          const now = currentDmgOf(state, t);
          moves.push(mk({ type: 'battle_activation', unit: u.unitRef, action: { kind: 'ability', ability: 'enhance', target: t.unitRef } }, `${u.label} Enhances ${t.label} (${whose(t)}) — DMG ${now} to ${now + 2} for this battle (2 mana).`));
        }
        if (p.research.includes('dehance')) {
          const def = currentDefOf(state, t);
          moves.push(mk({ type: 'battle_activation', unit: u.unitRef, action: { kind: 'ability', ability: 'dehance', target: t.unitRef } }, `${u.label} Dehances ${t.label} (${whose(t)}) — DEF ${def} to ${Math.max(0, def - 1)} for this battle (2 mana).`));
        }
      }
    }
  }
  if (u.isHero) {
    const spy = p.spyAssignments.find((s) => s.active && s.heroId === u.unitRef);
    if (spy) {
      const kind = spy.source === 'illusionist' ? 'invisible' : 'spy_attack';
      for (const t of opponents.filter((x) => x.isHero)) {
        if (kind === 'invisible' && !p.research.includes('invisible')) continue;
        if (spyKillShut(state, t)) continue; // rulings #93/#98: a standing Wall Platform, or a Castle on the tile, stops spies
        moves.push(mk({ type: 'battle_activation', unit: u.unitRef, action: { kind, target: t.unitRef } }, `${u.label} reveals the spy (${kind === 'invisible' ? 'Invisible' : 'Spy Attack'}) — instantly kill ${t.label}.`));
      }
    }
  }
  // Ruling #111: a robot unit with printed DMG 1 or more may self-destruct
  // instead of attacking, once its owner has the research.
  if (!u.isHero && u.dmg > 0 && p.research.includes('self-destruct') && probeUnitDef(u.unitRef)?.species === 'robot') {
    moves.push(mk({ type: 'battle_activation', unit: u.unitRef, action: { kind: 'self_destruct' } }, `${u.label} self-destructs — ${dmg + 3} DMG to every other unit and hero in this battle, every side; ${u.label} is lost.`));
  }
  moves.push(mk({ type: 'battle_activation', unit: u.unitRef, action: { kind: 'pass' } }, `${u.label} passes its activation (used for the pass).`));
  return moves;
}

/** §7.3 Decoy destinations: the engine's own withdrawal rule (the same one
 *  a retreat uses). Shared by the menu and the battle_defense pending view. */
export function decoyDestinations(state: NGGState): { allied: Coord[]; empty: Coord[] } {
  const b = state.battle!;
  const target = b.units.find((x) => x.unitRef === b.defense!.targetRef)!;
  const { allied, empty } = withdrawalDestinations(state, target.ownerId);
  return { allied, empty: allied.length === 0 ? empty : [] };
}

function defenseMoves(state: NGGState, p: PlayerState): LegalMove<NGGMove>[] {
  const b = state.battle!;
  const d = b.defense!;
  const target = b.units.find((x) => x.unitRef === d.targetRef)!;
  const moves: LegalMove<NGGMove>[] = [mk({ type: 'resolve_battle_defense', defense: { kind: 'none' } }, 'Decline this defense (later defenses remain).')];
  if (defenseGate.check(state, p.playerId, { kind: 'decoy' }) === null) {
    const { allied, empty } = decoyDestinations(state);
    for (const k of allied) {
      moves.push(mk({ type: 'resolve_battle_defense', defense: { kind: 'decoy', moveTo: k } }, `Reveal the Decoy — ${target.label} avoids the attack and moves to ${k} (allied-unit space).`));
    }
    for (const k of empty) {
      moves.push(mk({ type: 'resolve_battle_defense', defense: { kind: 'decoy', moveTo: k } }, `Reveal the Decoy — ${target.label} avoids the attack and moves to empty ${k}.`));
    }
    moves.push(mk({ type: 'resolve_battle_defense', defense: { kind: 'decoy' } }, `Reveal the Decoy — ${target.label} avoids the attack and stays in the fight.`));
  }
  if (defenseGate.check(state, p.playerId, { kind: 'mana_shield' }) === null) {
    for (let m = 1; m <= p.manaCurrent; m++) {
      moves.push(mk({ type: 'resolve_battle_defense', defense: { kind: 'mana_shield', mana: m } }, `Spend ${m} mana on Mana Shield for ${target.label}.`));
    }
  }
  if (defenseGate.check(state, p.playerId, { kind: 'cleric_save' }) === null) {
    for (const c of usableClerics(state, p.playerId)) {
      moves.push(mk({ type: 'resolve_battle_defense', defense: { kind: 'cleric_save', cleric: c.unitRef, target: d.targetRef } }, `${c.label} saves ${target.label} (5 mana).`));
    }
  }
  return moves;
}

function retreatMoves(state: NGGState, p: PlayerState): LegalMove<NGGMove>[] {
  const pend = state.pending;
  const viaCard = pend?.kind === 'retreat' && !!pend.viaCard;
  // The engine's own destination rule (withdrawalDestinations).
  const { eligible, allied } = withdrawalDestinations(state, p.playerId);
  const moves: LegalMove<NGGMove>[] = viaCard ? [] : [mk({ type: 'choose_retreat', destination: null, stay: true }, 'Stay and keep fighting.')];
  for (const k of eligible) {
    moves.push(mk({ type: 'choose_retreat', destination: k }, `${viaCard ? 'Your Retreat card takes' : 'Retreat'} all your mobile units to ${tileLabelOf(k)}${allied.includes(k) ? ' (your or an ally\'s units are there)' : ' (empty)'}.`));
  }
  return moves;
}


function coordOf(k: Coord): [number, number] {
  const [a, b] = k.split(',').map((s) => parseInt(s, 10));
  return [a!, b!];
}

// Victory probes used by views/tests.
export function victoryStatus(state: NGGState, p: PlayerState): string {
  const bits: string[] = [];
  bits.push(`culture ${p.culture}/${cultureTargetFor(state.players.length)}`);
  bits.push(`tech ${techTotal(state, p)}/${speciesOf(p) === 'wizard' ? 22 : 18}`);
  bits.push(`leader kills ${p.leaderKills}/${militaryThreshold(state.players.length)}`);
  if (!hasLivingLeader(state, p.playerId)) bits.push('cannot initiate victory (Leader dead)');
  return bits.join('; ');
}

// Re-exports for tests and the Game index.
export {
  availableCollectorIds, cardByInstanceId, checkVictory, effectiveResourceAt,
  hasCollectionAccess, heroAlivePlaced, isCombatUnit, locationOwner,
};
export { BATTLE_CARDS, coordKey, unitById, buildingById, researchById, resolveHero };
export type { BattleCardId };
