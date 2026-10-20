// Neither Guts nor Gears — the greyed-out moves (docs/rules-teaching.md).
//
// For the seat asking, every move it might expect right now that it cannot
// make, each with the reason in this game's live values: "Evoker — costs 2
// wood + 1 ore; your available collectors (surf-1, surf-2) can't pay it",
// "cast Elara's spell — costs 5 mana, you have 2". Two levels:
//  - a whole move type with nothing offered (no treaty can be offered now);
//  - one blocked option of a type (`item`): a purchasable at a Build or a
//    Research, a treaty that cannot break — greyed beside the options that
//    ARE offered.
// Only what fits the moment is listed: during your Build, the Build's items;
// in planning, planning; in a battle, the battle. Nothing about a phase you
// are not in.
//
// Consistent BY CONSTRUCTION: availability is read off the same getLegalMoves
// the tool surface uses; only the reasons are computed here, and the purchase
// reasons come from the engine's own checks (buildItemShut,
// researchPrerequisiteShut, treatyBreakGate, elaraSpellShut, …). A test sweeps
// played games to lock that nothing greyed is also offered.

import type { LegalMove, MoveGateStatus } from '@zekel/game-kit';
import {
  ECONOMIC_COLLECTORS_NEEDED, ECONOMIC_SPEND, TREATIES, buildingsForSpecies, describeCost,
  researchForSpecies, unitsForSpecies, type ResourceCost,
  BATTLE_CARD_PURCHASE, battleCardUnlocked,
} from './data/catalogs.js';
import { economicCollectorsNeeded } from './economicScale.js';
import { bankOf, hasHaste, purchaseCostOf } from './engine.js';
import {
  availableCollectorIds, buildItemShut, byId, elaraSpellShut, findPayment, hasLivingLeader,
  hasTreatyUnlock, openTreatyOffers, refusingOwners, researchPrerequisiteShut,
  speciesOf, eligibleMovers, collectorResourceOf,
} from './engine.js';
import { probeUnitDef } from './engine-battle.js';
import { treatyBreakGate } from './gates.js';
import { NGG_GATE_RULES } from './rulesSections.js';
import type { NGGMove, NGGState, PlayerState } from './types.js';
import { coordKey, neighborsOf } from './data/maps.js';

const section = (type: string): string | undefined => NGG_GATE_RULES[type]?.section;

export function nggMoveGates(state: NGGState, playerId: string, legal: Array<LegalMove<NGGMove>>): MoveGateStatus[] {
  if (state.phase === 'game_over' || state.phase.startsWith('setup')) return [];
  const p = byId(state, playerId);
  const out: MoveGateStatus[] = [];
  const offered = (type: string) => legal.filter((m) => m.move.type === type);
  const add = (move_type: string, status: MoveGateStatus['status'], reason: string, item?: string) => {
    out.push({ move_type, status, reason, ...(item !== undefined ? { item } : {}), ...(section(move_type) ? { rules_section: section(move_type)! } : {}) });
  };
  const typeLevel = (move_type: string, reasonIfNone: () => string | null) => {
    if (offered(move_type).length > 0) { out.push({ move_type, status: 'available', ...(section(move_type) ? { rules_section: section(move_type)! } : {}) }); return; }
    const r = reasonIfNone();
    if (r) add(move_type, 'gated', r);
  };

  const pend = state.pending;
  if (pend) {
    // A decision someone owes: its own options (with their reasons) are the
    // pending's view. A purchase-in-progress keeps its item reasons below.
    if (pend.forPlayerId !== playerId) return [];
    if (pend.kind !== 'second_purchase') return [];
  }

  // ---- a battle: whose unit acts ----
  if (state.battle) {
    const b = state.battle;
    if (b.phase === 'activations') {
      const ref = b.activationQueue[b.activationCursor];
      const u = b.units.find((x) => x.unitRef === ref);
      if (u && u.ownerId !== playerId) add('battle_activation', 'routine', `${u.label} (${u.ownerId}) is acting now — one activation at a time, highest initiative first`);
    }
    return out;
  }

  // ---- planning ----
  if (state.phase === 'planning') {
    if (state.planningOrder[0] !== playerId) {
      add('plan_action', 'routine', state.planningOrder.includes(playerId)
        ? `${state.planningOrder[0]} is placing a card now; you are next in turn`
        : 'you passed — passing is final for the round');
    }
    treatyBreakGates(state, p, legal, add);
    return out;
  }

  // ---- the action phase ----
  if (state.phase === 'action' && state.activeAction) {
    const a = state.activeAction;
    if (a.ownerId !== playerId) {
      add('plan_action', 'routine', `${a.ownerId}'s ${a.cardKind === 'move_battle' ? 'Move/Battle' : a.cardKind} action is resolving`);
      return out;
    }
    const buying = pend?.kind === 'second_purchase' ? pend.action : a.endWindow ? null : a.cardKind;
    if (!pend) {
      typeLevel('form_treaty', () => treatyOfferReason(state, p));
      treatyBreakGates(state, p, legal, add);
    }
    if (buying === 'build') buildGates(state, p, legal, add);
    if (buying === 'research') researchGates(state, p, legal, add);
    if (!pend && !a.endWindow && a.cardKind === 'move_battle') moveGates(state, p, legal, typeLevel, add);
    return out;
  }

  // ---- end of round ----
  if (state.phase === 'treaty_break' || state.phase === 'end_of_round') {
    treatyBreakGates(state, p, legal, add);
  }
  return out;
}

type Add = (move_type: string, status: MoveGateStatus['status'], reason: string, item?: string) => void;

function costText(cost: ResourceCost): string { return describeCost(cost); }

function cannotPay(state: NGGState, p: PlayerState, cost: ResourceCost, withCore = false): string {
  const avail = availableCollectorIds(state, p);
  const price = `costs ${costText(cost)}${withCore ? ' (with the Core bought with it)' : ''}`;
  if (avail.length === 0) return `${price} — you have no collector free to pay (all placed this round${p.species === 'robot' ? ', or without a Core' : ''})`;
  // Ruling #101: a Haste wizard's bank pays first and each Surf makes two.
  const bank = bankOf(p);
  const banked = Object.values(bank).reduce((a, n) => a + (n ?? 0), 0);
  const total = Math.max(0, Object.values(cost).reduce((a, n) => a + (n ?? 0), 0) - banked);
  const canMake = avail.length * (hasHaste(p) ? 2 : 1);
  if (total > canMake) return `${price} — that is ${total} resources${banked ? ' beyond your bank' : ''} and you have ${avail.length} free collector${avail.length === 1 ? '' : 's'}${hasHaste(p) ? ' (two each with Haste)' : ''}`;
  if (p.species === 'robot') {
    for (const [r, n] of Object.entries(cost)) {
      const have = avail.filter((id) => collectorResourceOf(id) === r).length;
      if ((n ?? 0) > have) return `${price} — ${have === 0 ? `you have no free ${r} collector` : `you have only ${have} free ${r} collector${have === 1 ? '' : 's'}`}`;
    }
  }
  return `${price} — your free collectors (${avail.join(', ')}) cannot reach enough of it from your units, bases and earlier placements`;
}

function payable(state: NGGState, p: PlayerState, cost: ResourceCost): boolean {
  return findPayment(state, p, cost, refusingOwners(state, p.playerId)) !== null;
}

function buildGates(state: NGGState, p: PlayerState, legal: Array<LegalMove<NGGMove>>, add: Add): void {
  const species = speciesOf(p);
  const offeredItems = new Set(legal.filter((m) => m.move.type === 'build').map((m) => (m.move as { item: string }).item));
  for (const u of unitsForSpecies(species)) {
    if (offeredItems.has(u.name)) continue;
    const shut = buildItemShut(state, p, u.id);
    if (shut) { add('build', 'gated', shut, u.name); continue; }
    // Payable either way it can get its Core?
    const pairing = u.needsCore && p.coresInReserve <= 0;
    const withCore = pairing ? purchaseCostOf(p, { type: 'build', item: u.name, core_pairing: true }).cost : u.cost;
    add('build', 'gated', cannotPay(state, p, withCore, pairing), u.name);
  }
  for (const b of buildingsForSpecies(species)) {
    if (offeredItems.has(b.name)) continue;
    const shut = buildItemShut(state, p, b.id);
    add('build', 'gated', shut ?? cannotPay(state, p, b.cost), b.name);
  }
  // The Economic spend: a Build is the only time it can be made.
  if (!legal.some((m) => m.move.type === 'economic_victory_spend')) {
    const free = availableCollectorIds(state, p).length;
    const needed = economicCollectorsNeeded(state);
    // Never silent: when the spend is not offered, say why (playtest bug
    // 2026-10-01 — the note checked the mix alone, found it reachable, and
    // said nothing while the full count of tiles could not be filled).
    const reason = !hasLivingLeader(state, p.playerId) ? 'your Leader is dead — you cannot start a victory'
      : free < needed ? `needs ${needed} free collectors on ${needed} different tiles — you have ${free}`
      : !payable(state, p, ECONOMIC_SPEND) ? `needs ${costText(ECONOMIC_SPEND)} from ${needed} collectors on ${needed} different tiles — your collectors cannot reach that mix`
      : `needs ${needed} collectors on ${needed} different tiles covering ${costText(ECONOMIC_SPEND)} — your collectors reach the mix but not ${needed} separate tiles (each must be on or next to your unit, hero or base, or next to a collector of yours placed earlier this round or in this payment; tiles already holding a collector, or owned by a seat that refused access, do not count)`;
    add('economic_victory_spend', 'gated', reason);
  }
}

function researchGates(state: NGGState, p: PlayerState, legal: Array<LegalMove<NGGMove>>, add: Add): void {
  const offeredTechs = new Set(legal.filter((m) => m.move.type === 'research' && m.move.kind === 'tech').map((m) => (m.move as { tech: string }).tech));
  for (const r of researchForSpecies(speciesOf(p))) {
    if (p.research.includes(r.id) || offeredTechs.has(r.name)) continue;
    const price = r.either
      ? `costs ${costText(r.cost)} + either ${r.either.map((x) => `1 ${x}`).join(' or ')} — your free collectors (${availableCollectorIds(state, p).join(', ') || 'none'}) cannot reach that`
      : cannotPay(state, p, r.cost);
    add('research', 'gated', researchPrerequisiteShut(state, p, r) ?? price, r.name);
  }
  if (!legal.some((m) => m.move.type === 'research' && m.move.kind === 'battle_card')) {
    const unlock = BATTLE_CARD_PURCHASE.unlockedBy[p.species === 'robot' ? 'robot' : 'wizard'];
    const reason = !battleCardUnlocked(p.buildings)
      ? `needs ${/^[AEIOU]/.test(unlock) ? 'an' : 'a'} ${unlock} first`
      : `costs ${describeCost(BATTLE_CARD_PURCHASE.cost)} + either 1 ${BATTLE_CARD_PURCHASE.either.join(' or 1 ')} — your free collectors (${availableCollectorIds(state, p).join(', ') || 'none'}) cannot reach that`;
    add('research', 'gated', reason, 'battle strategy card');
  }
}

function moveGates(state: NGGState, p: PlayerState, legal: Array<LegalMove<NGGMove>>, typeLevel: (t: string, r: () => string | null) => void, add: Add): void {
  typeLevel('move_units', () => {
    const tiles = new Set([
      ...state.units.filter((u) => u.ownerId === p.playerId).map((u) => u.coord),
      ...state.heroes.filter((h) => h.ownerId === p.playerId && !h.dead && h.coord).map((h) => h.coord!),
    ]);
    const movers = [...tiles].flatMap((c) => eligibleMovers(state, p, c));
    if (movers.length === 0) return 'you have no unit that can move (collectors, Immobile Combat Platforms and platforms without a Core cannot)';
    return 'every space next to your units belongs to a Peace partner (Peace forbids entering)';
  });
  const elara = state.heroes.find((h) => h.id === 'elara' && h.ownerId === p.playerId && !h.dead);
  if (elara && !legal.some((m) => m.move.type === 'cast_elara_spell') && !state.activeAction?.elaraCast) {
    let reason: string;
    if (elara.coord === null) reason = 'Elara is reserved (no base to place her) — she has no effect until placed';
    else if (p.manaCurrent < 5) reason = `costs 5 mana — you have ${p.manaCurrent}`;
    else {
      const t = state.tiles.find((x) => coordKey(x.c, x.r) === elara.coord)!;
      const r = neighborsOf(state.tiles, t.c, t.r).map((n) => elaraSpellShut(state, p.playerId, coordKey(n.c, n.r))).find((x) => x !== null);
      reason = r ?? 'no space next to Elara can be targeted';
    }
    add('cast_elara_spell', 'gated', reason);
  }
}

function treatyOfferReason(state: NGGState, p: PlayerState): string | null {
  const others = state.players.filter((q) => q.playerId !== p.playerId);
  if (others.every((q) => state.treaties.some((t) => t.partners.includes(p.playerId) && t.partners.includes(q.playerId)))) {
    return 'you already hold a treaty with every other player (one per pair)';
  }
  if (!hasTreatyUnlock(state, p.playerId) && others.every((q) => !hasTreatyUnlock(state, q.playerId))) {
    return `a treaty needs an unlock on one side — ${p.species === 'wizard' ? 'an Embassy' : 'a Diplomatic Research Station'} or an active Envoy Sable Marrow; no one who could partner with you has one`;
  }
  if (openTreatyOffers(state, p.playerId).length === 0) {
    return 'every treaty you could offer is already committed, or was turned down this round (offer it again next round)';
  }
  return null;
}

function treatyBreakGates(state: NGGState, p: PlayerState, legal: Array<LegalMove<NGGMove>>, add: Add): void {
  for (const t of state.treaties.filter((x) => x.partners.includes(p.playerId))) {
    const name = TREATIES.find((x) => x.id === t.type)!.name;
    const partner = t.partners[0] === p.playerId ? t.partners[1] : t.partners[0];
    const isOffered = legal.some((m) => m.move.type === 'break_treaty' && (m.move as { treaty_type: string }).treaty_type === name
      && (m.move as { partner: string }).partner === partner);
    if (isOffered) continue;
    const shut = treatyBreakGate.check(state, p.playerId, t);
    if (shut) add('break_treaty', 'gated', shut, `${name} with ${partner}`);
  }
}

