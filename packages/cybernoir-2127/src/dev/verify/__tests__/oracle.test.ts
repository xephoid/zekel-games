import { describe, expect, it } from 'vitest';
import { cybernoirVerifyAdapter } from '../adapter.js';
import { makeRng, randomPolicy, runGame } from '@zekel/dev/verify/exec/driver';
import { CYBERNOIR_ORACLE_RULES, detectiveTurnEnded, expectedJail } from '../rules.js';
import type { VerifyEvent } from '@zekel/dev/verify/exec/types';
import type { CybernoirVerifyState } from '../project.js';

function baseState(): CybernoirVerifyState {
  return {
    turn: 3,
    phase: 'play',
    active: 'detective',
    pendingType: null,
    detective: {
      ap: 3,
      locationHand: ['a', 'b'],
      locationDeckCount: 10,
      locationDiscard: [],
      board: ['the_back_alley'],
      poiDeck: ['zero_kelvin', 'frostbyte', 'ma_kettle'],
      informantsFacedown: [],
      informantsRevealed: [],
      jail: [['sleet'], ['blackice'], ['hoarfrost']],
      midGameGuessSpent: false,
      upkeepPaid: true,
    },
    hacker: {
      ap: 0,
      hand: ['permafrost'],
      contactsDeckCount: 20,
      contactsDiscard: ['gus_the_noodle_guy'],
      evidenceWeapon: false,
      evidenceWitnesses: [],
      evidenceMotiveSets: [],
      truthfulCluesGiven: [],
      negativeClueCount: 0,
      overclockUsed: false,
    },
    overclockDrawsOwed: 0,
    endgameTriggered: false,
    winners: [],
  };
}

function arrestEvent(next: CybernoirVerifyState): VerifyEvent {
  return {
    moveIndex: 10,
    actor: 'detective',
    moveType: 'arrest',
    move: { type: 'arrest', target_person: 'Zero Kelvin' },
    nextPoiDeck: next.detective.poiDeck,
  };
}

function rule(id: string) {
  const found = CYBERNOIR_ORACLE_RULES.find((r) => r.id === id);
  if (!found) throw new Error(`no rule ${id}`);
  return found;
}

describe('jail oracle rules on synthetic transitions', () => {
  it('accepts the correct v2.3 arrest: stack into slot 1, nobody moves', () => {
    const prev = baseState();
    const next = structuredClone(prev);
    next.detective.poiDeck = ['frostbyte', 'ma_kettle'];
    next.detective.jail = [['sleet', 'zero_kelvin'], ['blackice'], ['hoarfrost']];
    next.detective.ap = 2;
    const event = arrestEvent(next);
    expect(rule('arrest-books-into-slot-1').check(prev, event, next)).toEqual([]);
    expect(rule('arrest-never-moves-anyone-already-jailed').check(prev, event, next)).toEqual([]);
    expect(rule('arrest-costs-one-ap').check(prev, event, next)).toEqual([]);
    expect(rule('arrest-target-at-face-up-location').check(prev, event, next)).toEqual([]);
  });

  it('catches the pre-v2.3 shift-on-arrest bug', () => {
    const prev = baseState();
    const next = structuredClone(prev);
    // The old invented behavior: push everyone along, bump-release slot 3.
    next.detective.poiDeck = ['frostbyte', 'ma_kettle', 'hoarfrost'];
    next.detective.jail = [['zero_kelvin'], ['sleet'], ['blackice']];
    next.detective.ap = 2;
    const event = arrestEvent(next);
    const slot1 = rule('arrest-books-into-slot-1').check(prev, event, next);
    expect(slot1.map((v) => v.field)).toEqual(['jail.slot1_booked']);
    const others = rule('arrest-never-moves-anyone-already-jailed').check(prev, event, next);
    expect(others.map((v) => v.field).sort()).toEqual(['jail.slot2_processing', 'jail.slot3_release_pending']);
  });

  it('accepts an arrest bundled with the turn-end jail advance', () => {
    const prev = baseState();
    prev.detective.ap = 1; // the arrest spends the last AP -> auto turn switch
    const next = structuredClone(prev);
    next.active = 'hacker';
    next.hacker.ap = 3;
    next.detective.ap = 0;
    next.detective.poiDeck = ['frostbyte', 'ma_kettle', 'hoarfrost'];
    next.detective.jail = [[], ['sleet', 'zero_kelvin'], ['blackice']];
    const event = arrestEvent(next);
    expect(detectiveTurnEnded(prev, next)).toBe(true);
    expect(rule('arrest-books-into-slot-1').check(prev, event, next)).toEqual([]);
    expect(rule('arrest-never-moves-anyone-already-jailed').check(prev, event, next)).toEqual([]);
    expect(rule('released-cards-return-to-poi-deck').check(prev, event, next)).toEqual([]);
  });

  it('expectedJail composes arrest + advance in the printed order', () => {
    const prev = baseState();
    const next = structuredClone(prev);
    next.detective.poiDeck = ['frostbyte', 'ma_kettle'];
    const { slots, released } = expectedJail(prev, arrestEvent(next), true);
    expect(slots).toEqual([[], ['sleet', 'zero_kelvin'], ['blackice']]);
    expect(released).toEqual(['hoarfrost']);
  });

  it('catches a jail that moves outside a Detective turn end', () => {
    const prev = baseState();
    prev.active = 'hacker';
    const next = structuredClone(prev);
    next.detective.jail = [[], ['sleet'], ['blackice']]; // silently advanced
    const event: VerifyEvent = { moveIndex: 5, actor: 'hacker', moveType: 'draw_contact', move: { type: 'draw_contact' } };
    const violations = rule('jail-advances-only-at-detective-turn-end').check(prev, event, next);
    expect(violations.length).toBeGreaterThan(0);
  });
});

describe('driver on the real engine', () => {
  it('plays a full random game with no divergences and no errors (clean engine)', () => {
    const result = runGame(cybernoirVerifyAdapter, randomPolicy, 42, 600);
    expect(result.error).toBeNull();
    expect(result.divergences).toEqual([]);
    expect(result.winners.length).toBeGreaterThan(0);
  });

  it('is deterministic: same seed, same game', () => {
    const a = runGame(cybernoirVerifyAdapter, randomPolicy, 77, 600);
    const b = runGame(cybernoirVerifyAdapter, randomPolicy, 77, 600);
    expect(a.moves).toBe(b.moves);
    expect(a.winners).toEqual(b.winners);
    expect(a.divergences).toEqual(b.divergences);
  });

  it('makeRng is stable', () => {
    const r1 = makeRng(9);
    const r2 = makeRng(9);
    expect([r1(), r1(), r1()]).toEqual([r2(), r2(), r2()]);
  });
});
