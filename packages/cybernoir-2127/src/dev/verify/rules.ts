// Transition rules for Cybernoir 2127, authored from the CURRENT rulebook
// (rules-v2.3.txt, next to this file — the v2.3-final text). Every rule
// cites its licensing sentence verbatim; __tests__/oracleCitations.test.ts
// string-searches the pinned text for each quote, same discipline as the
// paper encoding's linter.
//
// Transition semantics the rules must respect (engine facts, not rules facts):
// one applied engine move can BUNDLE a turn end — the engine auto-switches the
// turn when the actor hits 0 AP, and the Detective's turn end advances the
// jail inside that same transition. Helpers below detect the bundled cases so
// rules predict the composed outcome. Ability resolutions can likewise bundle
// an inline block decision; rules avoid predicting fields a block can touch
// unless they model it.
//
// Shortcut, recorded: rules consult the module's card/location data tables
// (a transcription of rulebook section 8) rather than re-transcribing them.

import { LOCATIONS, PEOPLE } from '../../data/index.js';
import type { OracleRule, RuleViolation, VerifyEvent } from '@zekel/dev/verify/exec/types';
import type { CybernoirVerifyState } from './project.js';

const ALL_PERSON_IDS = [...PEOPLE.map((p) => p.id)].sort();
const RESIDENTS_BY_LOCATION = new Map(LOCATIONS.map((l) => [l.id, l.residents]));

function fmt(value: unknown): string {
  return JSON.stringify(value);
}

function sortedEq(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((x, i) => x === sb[i]);
}

/** The Detective's turn ended inside this transition (jail advanced). A
 * pending routed to the other seat also flips `active`, so require no pending;
 * a real switch to the Hacker never creates one. */
export function detectiveTurnEnded(prev: CybernoirVerifyState, next: CybernoirVerifyState): boolean {
  return prev.active === 'detective' && next.active === 'hacker' && next.pendingType === null;
}

/** The Hacker's turn ended inside this transition (Detective start-of-turn
 * ran). The turn counter increments exactly there. */
export function hackerTurnEnded(prev: CybernoirVerifyState, next: CybernoirVerifyState): boolean {
  return next.turn === prev.turn + 1;
}

/** What the jail track must look like after this transition, per the printed
 * rules: an arrest adds to Booked and never moves anyone; a jailbreak removes
 * the freed person from their slot; a Detective turn end advances every stack
 * one slot and releases slot 3. */
export function expectedJail(
  prev: CybernoirVerifyState,
  event: VerifyEvent,
  detEnded: boolean,
): { slots: [string[], string[], string[]]; released: string[] } {
  let slots: [string[], string[], string[]] = [
    [...prev.detective.jail[0]],
    [...prev.detective.jail[1]],
    [...prev.detective.jail[2]],
  ];
  if (event.moveType === 'arrest') {
    // The engine resolves printed names server-side; recover the id by diffing
    // the POI deck instead of re-implementing name resolution here.
    const gone = prev.detective.poiDeck.filter((id) => !event.nextPoiDeck?.includes(id));
    slots[0].push(...gone);
  }
  if (event.moveType === 'jailbreak') {
    const freed = new Set(event.freedIds ?? []);
    slots = slots.map((slot) => slot.filter((id) => !freed.has(id))) as typeof slots;
  }
  let released: string[] = [];
  if (detEnded) {
    released = slots[2];
    slots = [[], slots[0], slots[1]];
  }
  return { slots, released };
}

function jailViolations(
  prev: CybernoirVerifyState,
  event: VerifyEvent,
  next: CybernoirVerifyState,
  wantSlots: readonly (0 | 1 | 2)[],
): RuleViolation[] {
  const detEnded = detectiveTurnEnded(prev, next);
  const expected = expectedJail(prev, event, detEnded);
  const violations: RuleViolation[] = [];
  const slotNames = ['jail.slot1_booked', 'jail.slot2_processing', 'jail.slot3_release_pending'] as const;
  for (const i of wantSlots) {
    if (!sortedEq(expected.slots[i], next.detective.jail[i])) {
      violations.push({
        field: slotNames[i],
        predicted: fmt([...expected.slots[i]].sort()),
        actual: fmt(next.detective.jail[i]),
      });
    }
  }
  return violations;
}

export const CYBERNOIR_ORACLE_RULES: OracleRule<CybernoirVerifyState>[] = [
  {
    id: 'arrest-books-into-slot-1',
    on: ['arrest'],
    citation: {
      section: '5.1',
      quote: 'Place the matching POI card on Booked (slot 1) of the jail track',
    },
    check: (prev, event, next) => jailViolations(prev, event, next, [0]),
  },
  {
    id: 'arrest-never-moves-anyone-already-jailed',
    on: ['arrest'],
    citation: {
      section: '5.1',
      quote: 'an arrest never moves anyone already jailed',
    },
    check: (prev, event, next) => jailViolations(prev, event, next, [1, 2]),
  },
  {
    id: 'arrest-costs-one-ap',
    on: ['arrest'],
    citation: {
      section: '5.1',
      quote: 'X Make an Arrest — target any person at a face-up location you have played.',
    },
    check: (prev, _event, next) => {
      const want = prev.detective.ap - 1;
      if (next.detective.ap !== want) {
        return [{ field: 'detective.ap', predicted: String(want), actual: String(next.detective.ap) }];
      }
      return [];
    },
  },
  {
    id: 'arrest-target-at-face-up-location',
    on: ['arrest'],
    citation: {
      section: '5.1',
      quote: 'Make an Arrest — target any person at a face-up location you have played.',
    },
    check: (prev, event, _next) => {
      const gone = prev.detective.poiDeck.filter((id) => !event.nextPoiDeck?.includes(id));
      const reachable = new Set(prev.detective.board.flatMap((loc) => RESIDENTS_BY_LOCATION.get(loc) ?? []));
      return gone
        .filter((id) => !reachable.has(id))
        .map((id) => ({
          field: 'arrest.target',
          predicted: 'a person resident at a face-up board location',
          actual: id,
        }));
    },
  },
  {
    id: 'jail-advances-only-at-detective-turn-end',
    on: '*',
    citation: {
      section: '5.1',
      quote: 'End of turn: advance each card on the jail track one slot.',
    },
    check: (prev, event, next) => {
      if (event.moveType === 'arrest' || event.moveType === 'jailbreak') return []; // covered above
      return jailViolations(prev, event, next, [0, 1, 2]);
    },
  },
  {
    id: 'released-cards-return-to-poi-deck',
    on: '*',
    citation: {
      section: '5.1',
      quote:
        'A card advancing off the third slot is released — the POI card returns facedown into the hidden POI deck',
    },
    check: (prev, event, next) => {
      if (!detectiveTurnEnded(prev, next)) return [];
      const { released } = expectedJail(prev, event, detectiveTurnEnded(prev, next));
      const deck = new Set(next.detective.poiDeck);
      return released
        .filter((id) => !deck.has(id))
        .map((id) => ({
          field: 'poiDeck.releasedCard',
          predicted: `${id} back in the POI deck`,
          actual: 'missing',
        }));
    },
  },
  {
    id: 'poi-cards-only-deck-informant-or-jail',
    on: '*',
    citation: {
      section: '6',
      quote: 'POI cards only leave it to become informants or to sit on the jail track',
    },
    check: (_prev, _event, next) => {
      const all = [
        ...next.detective.poiDeck,
        ...next.detective.informantsFacedown,
        ...next.detective.informantsRevealed,
        ...next.detective.jail.flat(),
      ].sort();
      if (!sortedEq(all, ALL_PERSON_IDS)) {
        return [
          {
            field: 'poi.conservation',
            predicted: `every POI card split across deck, informants, and jail`,
            actual: fmt(all),
          },
        ];
      }
      return [];
    },
  },
  {
    id: 'recruit-costs-three-ap-and-goes-facedown',
    on: ['recruit_informant'],
    citation: {
      section: '5.1',
      quote:
        'XXX Recruit Informant — target any person at a face-up location you have played (same reach as an Arrest — v2.3 clarification; you can only flip people you have canvassed): place their POI card facedown as an informant.',
    },
    check: (prev, _event, next) => {
      const violations: RuleViolation[] = [];
      const wantAp = prev.detective.ap - 3;
      if (next.detective.ap !== wantAp) {
        violations.push({ field: 'detective.ap', predicted: String(wantAp), actual: String(next.detective.ap) });
      }
      const added = next.detective.informantsFacedown.filter(
        (id) => !prev.detective.informantsFacedown.includes(id),
      );
      if (added.length !== 1) {
        violations.push({
          field: 'informantsFacedown',
          predicted: 'exactly one new facedown informant',
          actual: fmt(added),
        });
      }
      const reachable = new Set(prev.detective.board.flatMap((loc) => RESIDENTS_BY_LOCATION.get(loc) ?? []));
      for (const id of added) {
        if (!reachable.has(id)) {
          violations.push({
            field: 'recruit.target',
            predicted: 'a person resident at a face-up board location',
            actual: id,
          });
        }
      }
      return violations;
    },
  },
  {
    id: 'upkeep-one-ap-per-kept-informant',
    on: ['upkeep_choice'],
    citation: {
      section: '5.1',
      quote:
        "Informant upkeep: pay 1 AP per informant you have from previous turns. Any informant you don't pay for is released (returned facedown to your hidden POI deck).",
    },
    check: (prev, _event, next) => {
      const violations: RuleViolation[] = [];
      const kept = next.detective.informantsFacedown.length + next.detective.informantsRevealed.length;
      const wantAp = 4 - kept;
      if (next.detective.ap !== wantAp) {
        violations.push({ field: 'detective.ap', predicted: String(wantAp), actual: String(next.detective.ap) });
      }
      const prevInformants = [...prev.detective.informantsFacedown, ...prev.detective.informantsRevealed];
      const nowInformants = new Set([...next.detective.informantsFacedown, ...next.detective.informantsRevealed]);
      const deck = new Set(next.detective.poiDeck);
      for (const id of prevInformants) {
        if (!nowInformants.has(id) && !deck.has(id)) {
          violations.push({
            field: 'informant.released',
            predicted: `${id} back in the POI deck`,
            actual: 'missing',
          });
        }
      }
      return violations;
    },
  },
  {
    id: 'mandatory-location-play-to-board',
    on: ['play_location'],
    citation: {
      section: '5.1',
      quote: 'Play 1 Location card face up to the board.',
    },
    check: (prev, _event, next) => {
      const added = next.detective.board.filter((id) => !prev.detective.board.includes(id));
      const violations: RuleViolation[] = [];
      if (added.length !== 1) {
        violations.push({ field: 'board', predicted: 'exactly one new face-up Location', actual: fmt(added) });
      } else if (!prev.detective.locationHand.includes(added[0]!)) {
        violations.push({
          field: 'board.playedFrom',
          predicted: `${added[0]} played from the Location hand`,
          actual: 'not in hand',
        });
      }
      if (next.detective.ap !== prev.detective.ap) {
        violations.push({
          field: 'detective.ap',
          predicted: `${prev.detective.ap} (the mandatory play is free)`,
          actual: String(next.detective.ap),
        });
      }
      return violations;
    },
  },
  {
    id: 'buy-clue-costs-three-cards-no-ap',
    on: ['buy_clue'],
    citation: {
      section: '5.1',
      quote: 'Discard 3 Locations (v2.3; the v1.9 cost of 4 was a banking-era dial) Gain a Clue — Hacker chooses which category.',
    },
    check: (prev, _event, next) => {
      const violations: RuleViolation[] = [];
      const handDelta = prev.detective.locationHand.length - next.detective.locationHand.length;
      if (handDelta !== 3) {
        violations.push({ field: 'locationHand', predicted: '3 cards discarded', actual: `${handDelta} left the hand` });
      }
      const discardDelta = next.detective.locationDiscard.length - prev.detective.locationDiscard.length;
      if (discardDelta !== 3) {
        violations.push({
          field: 'locationDiscard',
          predicted: '3 cards added',
          actual: `${discardDelta} added`,
        });
      }
      if (next.detective.ap !== prev.detective.ap) {
        violations.push({
          field: 'detective.ap',
          predicted: `${prev.detective.ap} (the cost is the cards, not AP)`,
          actual: String(next.detective.ap),
        });
      }
      const allGiven = prev.hacker.truthfulCluesGiven.length === 3;
      if (!allGiven && next.pendingType !== 'clue_reveal_pending' && next.phase === 'play') {
        violations.push({
          field: 'pendingType',
          predicted: 'clue_reveal_pending (Hacker chooses which category)',
          actual: String(next.pendingType),
        });
      }
      return violations;
    },
  },
  {
    id: 'truthful-clue-categories-never-repeat',
    on: ['clue_reveal'],
    citation: {
      section: '3',
      quote: 'each truthful clue category can be given only once',
    },
    check: (prev, _event, next) => {
      // A reveal must add exactly one NEW category (never a repeat).
      const added = next.hacker.truthfulCluesGiven.filter((c) => !prev.hacker.truthfulCluesGiven.includes(c));
      if (added.length !== 1 || next.hacker.truthfulCluesGiven.length !== prev.hacker.truthfulCluesGiven.length + 1) {
        return [
          {
            field: 'truthfulCluesGiven',
            predicted: 'exactly one not-yet-given category added',
            actual: fmt(next.hacker.truthfulCluesGiven),
          },
        ];
      }
      return [];
    },
  },
  {
    id: 'draw-contact-one-ap-one-card',
    on: ['draw_contact'],
    citation: {
      section: '5.2',
      quote: 'X Draw a Contact',
    },
    check: (prev, _event, next) => {
      const violations: RuleViolation[] = [];
      if (next.hacker.ap !== prev.hacker.ap - 1) {
        violations.push({
          field: 'hacker.ap',
          predicted: String(prev.hacker.ap - 1),
          actual: String(next.hacker.ap),
        });
      }
      if (next.hacker.hand.length !== prev.hacker.hand.length + 1) {
        violations.push({
          field: 'hacker.hand',
          predicted: `${prev.hacker.hand.length + 1} cards`,
          actual: `${next.hacker.hand.length} cards`,
        });
      }
      return violations;
    },
  },
  {
    id: 'contacts-deck-reshuffles-from-discard',
    on: ['draw_contact'],
    citation: {
      section: '5.2',
      quote: 'if the Contacts deck runs out, reshuffle the discard pile into a new deck',
    },
    check: (prev, _event, next) => {
      if (prev.hacker.contactsDeckCount > 0) {
        const want = prev.hacker.contactsDeckCount - 1;
        if (next.hacker.contactsDeckCount !== want) {
          return [{ field: 'contactsDeckCount', predicted: String(want), actual: String(next.hacker.contactsDeckCount) }];
        }
        return [];
      }
      if (prev.hacker.contactsDiscard.length === 0) {
        // Deck AND discard empty: the reshuffle rule cannot manufacture a
        // card, and the book says nothing else. Any accepted draw here is a
        // divergence (and a known silent spot: the paper audit's
        // silent-draw-nothing-left).
        return [
          {
            field: 'contactsDeckCount',
            predicted: 'no draw possible — deck and discard are both empty, and the rulebook is silent here',
            actual: 'the engine accepted the draw',
          },
        ];
      }
      const want = prev.hacker.contactsDiscard.length - 1;
      const violations: RuleViolation[] = [];
      if (next.hacker.contactsDeckCount !== want) {
        violations.push({
          field: 'contactsDeckCount',
          predicted: `${want} (reshuffled discard minus the draw)`,
          actual: String(next.hacker.contactsDeckCount),
        });
      }
      if (next.hacker.contactsDiscard.length !== 0) {
        violations.push({
          field: 'contactsDiscard',
          predicted: 'empty after the reshuffle',
          actual: `${next.hacker.contactsDiscard.length} cards`,
        });
      }
      return violations;
    },
  },
  {
    id: 'contacts-conservation',
    on: '*',
    citation: {
      section: '2',
      quote: "Contacts deck 25 The Hacker's copy of the 25 People — their draw deck for playing people and evidence",
    },
    check: (_prev, _event, next) => {
      const evidenceCards =
        (next.hacker.evidenceWeapon ? 1 : 0) +
        next.hacker.evidenceWitnesses.length +
        next.hacker.evidenceMotiveSets.reduce((n, set) => n + set.length, 0);
      const total =
        next.hacker.hand.length + next.hacker.contactsDeckCount + next.hacker.contactsDiscard.length + evidenceCards;
      // 25 People plus the Weapon card the components table shuffles in.
      if (total !== 26) {
        return [
          {
            field: 'contacts.conservation',
            predicted: '26 cards across hand, deck, discard, and Evidence (25 People + the Weapon)',
            actual: String(total),
          },
        ];
      }
      return [];
    },
  },
  {
    id: 'evidence-stays-on-the-table',
    on: '*',
    citation: {
      section: '5.2',
      quote: 'A card played as Evidence stays on the table for the rest of the game.',
    },
    check: (prev, _event, next) => {
      const violations: RuleViolation[] = [];
      if (prev.hacker.evidenceWeapon && !next.hacker.evidenceWeapon) {
        violations.push({ field: 'evidenceWeapon', predicted: 'true (permanent)', actual: 'false' });
      }
      for (const w of prev.hacker.evidenceWitnesses) {
        if (!next.hacker.evidenceWitnesses.includes(w)) {
          violations.push({ field: 'evidenceWitnesses', predicted: `${w} stays on the table`, actual: 'missing' });
        }
      }
      if (next.hacker.evidenceMotiveSets.length < prev.hacker.evidenceMotiveSets.length) {
        violations.push({
          field: 'evidenceMotiveSets',
          predicted: `${prev.hacker.evidenceMotiveSets.length} completed sets stay`,
          actual: String(next.hacker.evidenceMotiveSets.length),
        });
      }
      return violations;
    },
  },
  {
    id: 'evidence-complete-forces-final-guess',
    on: '*',
    citation: {
      section: '5.3',
      quote:
        'the moment the Hacker completes all 3 pieces of Evidence, the Detective makes the final guess immediately',
    },
    check: (prev, _event, next) => {
      const complete = (s: CybernoirVerifyState): boolean =>
        s.hacker.evidenceWeapon && s.hacker.evidenceWitnesses.length >= 3 && s.hacker.evidenceMotiveSets.length >= 3;
      if (!complete(prev) && complete(next) && next.phase !== 'game_over' && next.pendingType !== 'endgame_final_guess') {
        return [
          {
            field: 'pendingType',
            predicted: 'endgame_final_guess (immediately)',
            actual: String(next.pendingType),
          },
        ];
      }
      return [];
    },
  },
  {
    id: 'final-guess-decides-the-game',
    on: ['final_guess'],
    citation: {
      section: '5.3',
      quote: 'Correct = the Detective wins; wrong = the Hacker is exonerated and wins.',
    },
    check: (_prev, _event, next) => {
      if (next.phase !== 'game_over' || next.winners.length !== 1) {
        return [
          {
            field: 'phase',
            predicted: 'game_over with exactly one winner',
            actual: `${next.phase} winners=${fmt(next.winners)}`,
          },
        ];
      }
      return [];
    },
  },
  {
    id: 'mid-game-guess-once-costs-four-ap',
    on: ['guess_location'],
    citation: {
      section: '5.1',
      quote: "XXXX Guess the Hacker's Location — you get exactly one mid-game chance.",
    },
    check: (prev, _event, next) => {
      const violations: RuleViolation[] = [];
      if (prev.detective.midGameGuessSpent) {
        violations.push({
          field: 'guess.legality',
          predicted: 'illegal (the one mid-game chance is spent)',
          actual: 'the engine accepted a second mid-game guess',
        });
      }
      if (next.phase !== 'game_over') {
        if (!next.detective.midGameGuessSpent) {
          violations.push({ field: 'midGameGuessSpent', predicted: 'true', actual: 'false' });
        }
        if (next.detective.ap !== prev.detective.ap - 4) {
          violations.push({
            field: 'detective.ap',
            predicted: String(prev.detective.ap - 4),
            actual: String(next.detective.ap),
          });
        }
      }
      return violations;
    },
  },
  {
    id: 'extra-draw-costs-four-ap',
    on: ['draw_extra_location'],
    citation: {
      section: '5.1',
      quote: 'XXXX Draw an extra Location card',
    },
    check: (prev, _event, next) => {
      const violations: RuleViolation[] = [];
      if (next.detective.ap !== prev.detective.ap - 4) {
        violations.push({
          field: 'detective.ap',
          predicted: String(prev.detective.ap - 4),
          actual: String(next.detective.ap),
        });
      }
      if (next.detective.locationDeckCount !== prev.detective.locationDeckCount - 1) {
        violations.push({
          field: 'locationDeckCount',
          predicted: String(prev.detective.locationDeckCount - 1),
          actual: String(next.detective.locationDeckCount),
        });
      }
      return violations;
    },
  },
  {
    id: 'jailbreak-frees-and-prices-a-negative-clue',
    on: ['jailbreak'],
    citation: {
      section: '5.2',
      quote: 'Free (give the Detective a Negative Clue) Jailbreak — free one person from arrest',
    },
    check: (prev, event, next) => {
      const violations: RuleViolation[] = [];
      const freed = prev.detective.jail.flat().filter((id) => !next.detective.jail.flat().includes(id));
      if (freed.length !== 1) {
        violations.push({ field: 'jail.freed', predicted: 'exactly one person freed', actual: fmt(freed) });
      }
      if (next.hacker.negativeClueCount !== prev.hacker.negativeClueCount + 1) {
        violations.push({
          field: 'negativeClueCount',
          predicted: String(prev.hacker.negativeClueCount + 1),
          actual: String(next.hacker.negativeClueCount),
        });
      }
      if (next.hacker.ap !== prev.hacker.ap) {
        violations.push({
          field: 'hacker.ap',
          predicted: `${prev.hacker.ap} (Jailbreak is Free)`,
          actual: String(next.hacker.ap),
        });
      }
      void event;
      return violations;
    },
  },
  {
    id: 'overclock-plus-one-ap-once-per-turn',
    on: ['overclock'],
    citation: {
      section: '5.2',
      quote: 'Overclock — gain +1 AP this turn. Once per turn',
    },
    check: (prev, _event, next) => {
      const violations: RuleViolation[] = [];
      if (prev.hacker.overclockUsed) {
        violations.push({
          field: 'overclock.legality',
          predicted: 'illegal (once per turn)',
          actual: 'the engine accepted a second Overclock this turn',
        });
      }
      if (next.hacker.ap !== prev.hacker.ap + 1) {
        violations.push({
          field: 'hacker.ap',
          predicted: String(prev.hacker.ap + 1),
          actual: String(next.hacker.ap),
        });
      }
      if (!next.hacker.overclockUsed) {
        violations.push({ field: 'overclockUsed', predicted: 'true', actual: 'false' });
      }
      return violations;
    },
  },
  {
    id: 'detective-turn-starts-with-four-ap-and-the-mandatory-draw',
    on: '*',
    citation: {
      section: '5.1',
      quote: 'Draw a Location card. (Free, mandatory.',
    },
    check: (prev, event, next) => {
      if (!hackerTurnEnded(prev, next)) return [];
      // A burn rebuilds the Location deck inside the same transition; the
      // simple minus-one prediction does not apply.
      if (event.moveType === 'burn_safehouse' || event.moveType === 'burn_choice') return [];
      const violations: RuleViolation[] = [];
      if (prev.detective.locationDeckCount === 0) {
        if (!next.endgameTriggered || (next.pendingType !== 'endgame_final_guess' && next.phase !== 'game_over')) {
          violations.push({
            field: 'endgameTriggered',
            predicted: 'endgame: the mandatory draw is impossible',
            actual: `endgameTriggered=${next.endgameTriggered} pending=${String(next.pendingType)}`,
          });
        }
        return violations;
      }
      if (next.detective.ap !== 4) {
        violations.push({ field: 'detective.ap', predicted: '4', actual: String(next.detective.ap) });
      }
      const owed = next.overclockDrawsOwed === 0 ? prev.overclockDrawsOwed : 0;
      const drawn = Math.min(1 + owed, prev.detective.locationDeckCount);
      const wantDeck = prev.detective.locationDeckCount - drawn;
      if (next.detective.locationDeckCount !== wantDeck) {
        violations.push({
          field: 'locationDeckCount',
          predicted: String(wantDeck),
          actual: String(next.detective.locationDeckCount),
        });
      }
      return violations;
    },
  },
  {
    id: 'hacker-turn-starts-with-three-ap',
    on: '*',
    citation: {
      section: '2',
      quote: 'Detective has 4 AP, Hacker has 3 AP',
    },
    check: (prev, _event, next) => {
      if (!detectiveTurnEnded(prev, next)) return [];
      if (next.hacker.ap !== 3) {
        return [{ field: 'hacker.ap', predicted: '3', actual: String(next.hacker.ap) }];
      }
      return [];
    },
  },
  {
    id: 'win-back-returns-the-poi-card-to-the-deck',
    on: ['win_back'],
    citation: {
      section: '6',
      quote:
        "The POI card returns facedown to the hidden POI deck (the Detective may re-recruit it later at full XXX cost), and the Hacker's Contact goes to their discard",
    },
    check: (prev, _event, next) => {
      const violations: RuleViolation[] = [];
      const removed = prev.detective.informantsRevealed.filter(
        (id) => !next.detective.informantsRevealed.includes(id),
      );
      if (removed.length !== 1) {
        violations.push({
          field: 'informantsRevealed',
          predicted: 'exactly one revealed informant removed',
          actual: fmt(removed),
        });
      }
      const deck = new Set(next.detective.poiDeck);
      for (const id of removed) {
        if (!deck.has(id)) {
          violations.push({ field: 'poiDeck.wonBack', predicted: `${id} back in the POI deck`, actual: 'missing' });
        }
      }
      return violations;
    },
  },
  {
    id: 'location-cards-conservation',
    on: '*',
    citation: {
      section: '2',
      quote: 'Location cards 19',
    },
    check: (_prev, _event, next) => {
      // The safehouse card sits outside every projected zone (the Hacker holds
      // it), so 19 - 1 = 18 cards circulate among deck, hand, board, discard.
      const total =
        next.detective.locationDeckCount +
        next.detective.locationHand.length +
        next.detective.board.length +
        next.detective.locationDiscard.length;
      if (total !== 18) {
        return [
          {
            field: 'locations.conservation',
            predicted: '18 cards across deck, hand, board, discard (19 minus the safehouse)',
            actual: String(total),
          },
        ];
      }
      return [];
    },
  },
];
