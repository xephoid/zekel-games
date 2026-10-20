// Neither Guts nor Gears — instance-level gates (SPEC-instance-gates.md).
//
// A gate is one rule that admits or refuses ONE subject: a treaty, a card in a
// hand, a committed card, a defense at the current step. `check` returns null
// when the subject is open, or the refusal sentence when it is shut. That
// sentence is the rule's only home: the engine throws it, the menu leaves the
// move out on it, and the pending view prints it beside the shut option. Never
// write the same reason a second time anywhere else — if a sentence appears in
// both a throw and a view, it has already drifted.
//
// The type-level NGG_GATE_RULES in rulesSections.ts answer a different
// question ("why is this move TYPE not on the table at all") and stay as-is.

import { seatName } from './names.js';
import { BATTLE_CARDS, TREATIES, type BattleCardId } from './data/catalogs.js';
import { probeUnitDef } from './engine-battle.js';
import {
  byId, cardByInstanceId, isUnitPiece, locationOwner,
} from './engine.js';
import type { BattleUnit, CommittedCard, NGGState, TreatyInstance } from './types.js';

export interface Gate<T> {
  id: string;
  /** Governing RuleSection id (rulesSections.ts). */
  section: string;
  check(state: NGGState, playerId: string, subject: T): string | null;
}

// ---------------------------------------------------------------------------
// Treaty breaking (§5.6, §11.2, rulings 53–54)
// ---------------------------------------------------------------------------

function treatyName(t: TreatyInstance): string {
  return TREATIES.find((x) => x.id === t.type)!.name;
}

/** Whether the two partners' units share any space — heroes count, they are
 *  units too; a Coreless platform is not a unit (§7.7). */
function alliedUnitsShareSpace(state: NGGState, t: TreatyInstance): boolean {
  const [a, b] = t.partners;
  const spaces = (owner: string) => new Set<string>([
    ...state.units.filter((u) => u.ownerId === owner && isUnitPiece(u)).map((u) => u.coord),
    ...state.heroes.filter((h) => h.ownerId === owner && !h.dead && h.coord !== null).map((h) => h.coord!),
  ]);
  const mine = spaces(a);
  return [...spaces(b)].some((c) => mine.has(c));
}

function collectingOnPartnerSpace(state: NGGState, t: TreatyInstance): boolean {
  return state.placements.some((c) => t.partners.includes(c.ownerId)
    && locationOwner(state, c.coord) === (c.ownerId === t.partners[0] ? t.partners[1] : t.partners[0]));
}

export const treatyBreakGate: Gate<TreatyInstance> = {
  id: 'treaty-break',
  section: 'treaties',
  check(state, _playerId, t) {
    if (t.type === 'culture-treaty') {
      // §11.2 + ruling 54: outside the culture phase (its hero claims
      // included), and never while an action or battle is resolving — the
      // start of an action (before its effects) and its finished end are
      // boundaries, not resolution.
      if (state.phase === 'culture' || state.phase === 'claims') return 'A Culture Treaty cannot break during the culture phase (hero claims included)';
      if (state.battle) return 'A Culture Treaty cannot break while a battle resolves';
      if (state.phase === 'action' && state.activeAction?.acted && !state.activeAction.endWindow) {
        return 'A Culture Treaty cannot break while an action resolves — only before it starts or once it is finished';
      }
      if (state.pending && state.pending.kind !== 'treaty_break_decision') return 'A Culture Treaty cannot break while another decision is open';
      return null;
    }
    if (state.phase !== 'end_of_round' && state.phase !== 'treaty_break') {
      return `${treatyName(t)} breaks only at end of round (after the culture phase, §5.6)`;
    }
    if (t.type === 'open-borders' && alliedUnitsShareSpace(state, t)) {
      return 'Open Borders cannot break while allied units share a space';
    }
    if (t.type === 'shared-resources' && collectingOnPartnerSpace(state, t)) {
      return "Shared Resources cannot break while a unit is collecting from a partner's space";
    }
    return null;
  },
};

// ---------------------------------------------------------------------------
// Playing a battle card from a hand (battle commit + Extra additions)
// ---------------------------------------------------------------------------

export interface CardInHand {
  instanceId: string;
  /** The seat whose hand holds it (a Shared Tactics partner's, when borrowed). */
  ownerId: string;
}

function cardLabel(card: BattleCardId): string {
  return BATTLE_CARDS.find((c) => c.id === card)!.label;
}

/** Card instances already spoken for this battle: named in a commitment,
 *  revealed into the workspace, or staged by an Extra. One physical card, one
 *  play (probe finding #7 — Shared Tactics partners cannot both use it). */
function reservedInstances(state: NGGState): Set<string> {
  const b = state.battle;
  if (!b) return new Set();
  return new Set<string>([
    ...Object.values(b.commitments).map((c) => (typeof c === 'object' && c !== null ? c.cardInstanceId : '')).filter((x) => x !== ''),
    ...b.committed.map((c) => c.cardInstanceId),
    ...b.pendingBatch.map((c) => c.cardInstanceId),
  ]);
}

export const battleCardGate: Gate<CardInHand> = {
  id: 'battle-card-play',
  section: 'battle-cards',
  check(state, playerId, c) {
    const label = cardLabel(cardByInstanceId(c.instanceId));
    if (reservedInstances(state).has(c.instanceId)) return `That ${label} is already committed this battle`;
    const b = state.battle;
    // The second look (§11.2 owner first) is at a partner's cards only.
    if (b && b.phase === 'commit' && c.ownerId === playerId && (b.borrowOffered ?? []).includes(playerId)) {
      return `You already chose not to play your own cards this battle — only a partner's card its owner did not play is open`;
    }
    // §11.2 / ruling 27 owner-first: when the owner is also in this battle and
    // has not committed yet, the owner decides first whether to play it.
    if (c.ownerId !== playerId && b
      && b.units.some((u) => u.ownerId === c.ownerId) && b.commitments[c.ownerId] === 'pending') {
      return `${seatName(state, c.ownerId)} is in this battle and has not committed yet — as its owner they decide first whether to play their ${label} (Shared Tactics)`;
    }
    return null;
  },
};

/** Every card a seat could reach right now — its own hand, then each Shared
 *  Tactics partner's — grouped by card kind in that order. The engine plays the
 *  first open instance of a kind; the menu offers a kind when any instance is
 *  open; the view shows each kind with its count, or the first shut reason. */
export interface CardKindGroup {
  card: BattleCardId;
  label: string;
  open: CardInHand[];
  shut: Array<CardInHand & { reason: string }>;
}

export function playableCardGroups(state: NGGState, playerId: string): CardKindGroup[] {
  const holdings: CardInHand[] = byId(state, playerId).hand.map((id) => ({ instanceId: id, ownerId: playerId }));
  for (const t of state.treaties.filter((x) => x.type === 'shared-tactics' && x.partners.includes(playerId))) {
    const partner = t.partners[0] === playerId ? t.partners[1] : t.partners[0];
    for (const id of byId(state, partner).hand) holdings.push({ instanceId: id, ownerId: partner });
  }
  const groups: CardKindGroup[] = [];
  for (const h of holdings) {
    const card = cardByInstanceId(h.instanceId);
    let g = groups.find((x) => x.card === card);
    if (!g) { g = { card, label: cardLabel(card), open: [], shut: [] }; groups.push(g); }
    const reason = battleCardGate.check(state, playerId, h);
    if (reason) g.shut.push({ ...h, reason });
    else g.open.push(h);
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Counter's target (§10.2, rulings 19–25)
// ---------------------------------------------------------------------------

export const counterTargetGate: Gate<CommittedCard> = {
  id: 'counter-target',
  section: 'battle-cards',
  check(state, _playerId, c) {
    const label = cardLabel(c.card);
    const pend = state.pending;
    const counter = pend?.kind === 'counter_target' ? state.battle?.committed[pend.cardIndex] : undefined;
    if (c === counter) return 'A Counter cannot target itself';
    if (c.countered) return `That ${label} was already cancelled by a Counter`;
    if (c.resolved) return `That ${label} has already resolved`;
    return null;
  },
};

// ---------------------------------------------------------------------------
// Battle defense ladder (§9.4: Decoy → Mana Shield → Cleric save)
// ---------------------------------------------------------------------------

export type DefenseSubject =
  | { kind: 'decoy' }
  | { kind: 'mana_shield' }
  /** `cleric` names a battle unit (ref or printed label); absent = any of yours. */
  | { kind: 'cleric_save'; cleric?: string };

const STEP_LABEL = { decoy: 'Decoy', mana_shield: 'Mana Shield', cleric: 'Cleric' } as const;
export const CLERIC_SAVE_MANA = 5;

/** The Clerics a seat could save with at this step: its own, on the side under
 *  attack, save not yet used this pass. */
export function usableClerics(state: NGGState, playerId: string): BattleUnit[] {
  const b = state.battle;
  const d = b?.defense;
  if (!b || !d) return [];
  const target = b.units.find((x) => x.unitRef === d.targetRef);
  return b.units.filter((x) => x.ownerId === playerId && probeUnitDef(x.unitRef)?.id === 'cleric'
    && !x.clericUsedThisPass && (!target || x.side === target.side));
}

export const defenseGate: Gate<DefenseSubject> = {
  id: 'battle-defense',
  section: 'battle-activation',
  check(state, playerId, s) {
    const d = state.battle?.defense;
    if (!d) return 'No defense step is on offer';
    const step = s.kind === 'cleric_save' ? 'cleric' : s.kind;
    if (d.step !== step) return `The ${STEP_LABEL[step]} window is not open on this attack`;
    const p = byId(state, playerId);
    switch (s.kind) {
      case 'decoy': {
        const target = state.battle!.units.find((x) => x.unitRef === d.targetRef);
        // Decoy is the Illusionist's ability (§7.3); an Infiltrator has none (§7.9).
        const spy = p.spyAssignments.find((a) => a.active && a.heroId === target?.unitRef && a.source === 'illusionist');
        if (!target?.isHero || !spy) return 'No unrevealed Illusionist spy rides that hero';
        return null;
      }
      case 'mana_shield': {
        if (!p.research.includes('mana-shield')) return 'Mana Shield is not researched';
        if (p.manaCurrent < 1) return `You hold ${p.manaCurrent} mana`;
        return null;
      }
      case 'cleric_save': {
        const mine = usableClerics(state, playerId);
        const ok = s.cleric === undefined ? mine.length > 0 : mine.some((c) => c.unitRef === s.cleric || c.label === s.cleric);
        if (!ok) return 'Name your own unused Cleric in this battle';
        if (p.manaCurrent < CLERIC_SAVE_MANA) return `A Cleric save costs ${CLERIC_SAVE_MANA} mana — you hold ${p.manaCurrent}`;
        return null;
      }
    }
  },
};
