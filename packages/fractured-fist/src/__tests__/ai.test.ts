import { describe, expect, it } from 'vitest';
import { chooseMove } from '../ai.js';
import { getCard } from '../cards.js';
import { applyMove, checkGameOver, createInitialState } from '../engine.js';
import { getLegalMoves } from '../legalMoves.js';
import type { FFState } from '../types.js';

const PLAYERS = ['p1', 'p2'];

function initBothTracked(opts?: Parameters<typeof createInitialState>[2]): FFState {
  return createInitialState(PLAYERS, { p1: 'tracked', p2: 'tracked' }, opts, 1);
}

function aiTurnLoop(state: FFState, playerId: string, difficulty: 'easy' | 'medium'): FFState {
  let s = state;
  let safety = 200;
  while (s.activePlayerId === playerId && s.phase !== 'game_over' && safety-- > 0) {
    const moves = getLegalMoves(s, playerId);
    if (moves.length === 0) break;
    const pick = chooseMove(s, playerId, difficulty);
    s = applyMove(s, playerId, pick.move).newState;
  }
  expect(safety).toBeGreaterThan(0);
  return s;
}

describe('chooseMove', () => {
  it('always picks a legal move at easy difficulty', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const s = createInitialState(PLAYERS, { p1: 'tracked', p2: 'tracked' }, undefined, seed);
      const legal = getLegalMoves(s, 'p1');
      const pick = chooseMove(s, 'p1', 'easy');
      const found = legal.find((m) => JSON.stringify(m.move) === JSON.stringify(pick.move));
      expect(found).toBeDefined();
    }
  });

  it('medium AI completes turns across many seeds without throwing', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const s = createInitialState(PLAYERS, { p1: 'tracked', p2: 'tracked' }, undefined, seed);
      const after = aiTurnLoop(s, 'p1', 'medium');
      expect(['p1', 'p2']).toContain(after.activePlayerId);
    }
  });

  it('two AIs can play to completion', () => {
    let s = initBothTracked({ loadout: ['attack', 'flying_kick', 'devastating_blow'] });
    let safety = 5000;
    while (s.phase !== 'game_over' && safety-- > 0) {
      const active = s.activePlayerId;
      const pick = chooseMove(s, active, 'medium');
      s = applyMove(s, active, pick.move).newState;
    }
    expect(safety).toBeGreaterThan(0);
    expect(s.phase).toBe('game_over');
    const r = checkGameOver(s);
    expect(r.game_over).toBe(true);
  });

  it('rejects asking the AI to choose for an opaque (human) player', () => {
    const s = createInitialState(PLAYERS, { p1: 'opaque', p2: 'tracked' }, undefined, 1);
    expect(() => chooseMove(s, 'p1', 'medium')).toThrow();
  });

  // -------- Parity tests against the React/JS reference (processEnemyTurn) --------

  it('in channel phase, plays all resources before buying', () => {
    // Scenario: 4 focus in hand, 0 spirit, supply has a cheap card (center, cost 2).
    // The reference impl plays all resources first (spirit → 4), then buys once.
    // The original bug was that the AI would buy center as soon as it could afford
    // it (after 2 focus played), wasting the remaining focuses.
    let s = createInitialState(['ai', 'opp'], { ai: 'tracked', opp: 'tracked' }, undefined, 1);
    s.phase = 'channel';
    const ai = s.players.ai!;
    if (ai.kind !== 'tracked') throw new Error('expected tracked');
    ai.hand = ['focus', 'focus', 'focus', 'focus'];
    ai.handSize = 4;
    ai.deck = [];
    ai.deckSize = 0;
    ai.discard = [];
    ai.discardSize = 0;
    ai.spirit = 0;
    ai.channels = 1;
    s.activePlayerId = 'ai';

    // Bot should play all 4 focuses before considering buy. After playing all
    // focuses, spirit should be 4 and hand should have no focuses.
    let movesTaken = 0;
    while (movesTaken < 4 && s.activePlayerId === 'ai' && s.phase !== 'game_over') {
      const pick = chooseMove(s, 'ai', 'medium');
      // Until all resources are exhausted, the bot must not buy.
      if ((s.players.ai as { hand: string[] }).hand.includes('focus')) {
        expect(pick.move.type).not.toBe('buy_card');
      }
      s = applyMove(s, 'ai', pick.move).newState;
      movesTaken += 1;
    }
    const after = s.players.ai!;
    if (after.kind !== 'tracked') throw new Error('expected tracked');
    expect(after.hand.filter((c) => c === 'focus').length).toBe(0);
    expect(after.spirit).toBeGreaterThanOrEqual(4);
  });

  it('never buys Focus, even when it is the only affordable buy (cost-0 filler)', () => {
    // A skilled player never buys Focus (cost 0): it dilutes the deck. Being free
    // it used to be taken as filler on otherwise-empty turns. With spirit 0 the
    // ONLY affordable buy is Focus — the AI must decline it (advance/end) rather
    // than buy junk. (This also un-masks the dead-turn metric: such a turn is now
    // correctly dead.)
    let s = createInitialState(['ai', 'opp'], { ai: 'tracked', opp: 'tracked' }, undefined, 1);
    s.phase = 'channel';
    const ai = s.players.ai!;
    if (ai.kind !== 'tracked') throw new Error('expected tracked');
    ai.hand = [];
    ai.handSize = 0;
    ai.deck = ['focus'];
    ai.deckSize = 1;
    ai.discard = [];
    ai.discardSize = 0;
    ai.spirit = 0; // only a cost-0 Focus is affordable
    ai.channels = 1;
    s.activePlayerId = 'ai';
    const pick = chooseMove(s, 'ai', 'medium');
    const boughtFocus = pick.move.type === 'buy_card' && pick.move.card_id === 'focus';
    expect(boughtFocus).toBe(false);
  });

  it('prefers a real buy over Focus even when Focus is affordable and cheaper', () => {
    // With spirit for a useful technique, the AI must never pick the free Focus.
    let s = createInitialState(['ai', 'opp'], { ai: 'tracked', opp: 'tracked' }, { loadout: ['attack', 'block'] }, 1);
    s.phase = 'channel';
    const ai = s.players.ai!;
    if (ai.kind !== 'tracked') throw new Error('expected tracked');
    ai.hand = [];
    ai.handSize = 0;
    ai.deck = ['focus', 'focus'];
    ai.deckSize = 2;
    ai.discard = [];
    ai.discardSize = 0;
    ai.spirit = 6; // affords attack/block AND (always) the free focus
    ai.channels = 1;
    s.activePlayerId = 'ai';
    const pick = chooseMove(s, 'ai', 'medium');
    expect(pick.move.type).toBe('buy_card');
    if (pick.move.type === 'buy_card') expect(pick.move.card_id).not.toBe('focus');
  });

  it('tech-phase priority follows the reference ordering (actions > damage > misstep > defense)', () => {
    // Hand contains one of each priority tier. Bot should play the highest-priority first.
    let s = createInitialState(['ai', 'opp'], { ai: 'tracked', opp: 'tracked' }, undefined, 1);
    const ai = s.players.ai!;
    if (ai.kind !== 'tracked') throw new Error('expected tracked');
    // react: actions=2; attack: damage=1; distract: add_misstep=2; block: defense=1
    ai.hand = ['react', 'attack', 'distract', 'block'];
    ai.handSize = 4;
    ai.actions = 1;
    s.activePlayerId = 'ai';

    const pick1 = chooseMove(s, 'ai', 'medium');
    expect(pick1.move.type).toBe('play_card');
    if (pick1.move.type === 'play_card') expect(pick1.move.card_id).toBe('react');
  });

  it('does not buy action-boosters (React) over defense (Block) when no useful techniques exist yet', () => {
    // Regression: with the 7-starter loadout and the AI's starting deck (only
    // focus + misstep), the AI was repeatedly buying React because the AGGRO
    // heuristic gave actions a flat +25 bonus even when the AI had no damage
    // or defense techniques to spend those actions on. The scaling fix
    // (actions weighted by useful-technique count) should make Block beat
    // React when starting from a fresh deck.
    let s = createInitialState(['ai', 'opp'], { ai: 'tracked', opp: 'tracked' }, undefined, 1);
    s.phase = 'channel';
    const ai = s.players.ai!;
    if (ai.kind !== 'tracked') throw new Error('expected tracked');
    ai.hand = []; // resources already played; force buy decision
    ai.handSize = 0;
    // Force AGGRO mode (where the bug appeared) by giving allMine high resource value
    // so avgValue*6 > maxLoadoutCost(=4). 5 focus = avg 1.0, ramp = 4 > 6 = false.
    ai.deck = ['focus', 'focus', 'focus', 'focus', 'focus'];
    ai.deckSize = 5;
    ai.discard = [];
    ai.discardSize = 0;
    ai.spirit = 3; // can afford React (3), Block (3), Momentum (3)
    ai.channels = 1;
    s.activePlayerId = 'ai';
    const pick = chooseMove(s, 'ai', 'medium');
    expect(pick.move.type).toBe('buy_card');
    if (pick.move.type === 'buy_card') {
      expect(pick.move.card_id).not.toBe('react');
      // Block is the canonical "right" answer here — defense is real value
      // when the AI has no useful techniques to spend actions on.
      expect(pick.move.card_id).toBe('block');
    }
  });

  it('does buy action-boosters once the deck has enough useful techniques', () => {
    // Once the AI has 4+ damage/defense cards in its deck, React's actions
    // bonus comes back to full strength and React becomes a reasonable buy
    // when nothing better is affordable.
    let s = createInitialState(['ai', 'opp'], { ai: 'tracked', opp: 'tracked' }, undefined, 1);
    s.phase = 'channel';
    const ai = s.players.ai!;
    if (ai.kind !== 'tracked') throw new Error('expected tracked');
    ai.hand = []; // resources already played; force buy decision
    ai.handSize = 0;
    // Force AGGRO mode AND 4 useful techniques in deck:
    //   allMine = 2 focus + 4 useful + 2 momentum = 8 cards
    //   sum = 2 (focus) + 0 (block/attack) + 4 (momentum, value 2 each) = 6
    //   avg = 0.75. ramp = 4 > 4.5 = false → AGGRO.
    //   usefulTechniqueCount = 4 → actionsUsefulness = 1.0
    ai.deck = ['focus', 'focus'];
    ai.deckSize = 2;
    ai.discard = ['block', 'block', 'block', 'attack', 'momentum', 'momentum'];
    ai.discardSize = 6;
    ai.spirit = 3;
    ai.channels = 1;
    s.activePlayerId = 'ai';
    // Now actions are valuable. We don't strictly assert React beats Block,
    // but the gap should be small / React should be a plausible pick again.
    // Concretely, the actions bonus scales to full 25, so:
    //   react: 3 + 25 = 28
    //   block: 3 + 15 = 18
    const pick = chooseMove(s, 'ai', 'medium');
    expect(pick.move.type).toBe('buy_card');
    if (pick.move.type === 'buy_card') {
      // React should be the top buy again now that actions are useful.
      expect(pick.move.card_id).toBe('react');
    }
  });

  // -------- 'hard' tuned-buy divergence (validated head-to-head vs medium) --------

  // Force a fresh channel-phase buy decision with a given affordable spirit and
  // a loadout containing an expensive payoff card (so ramp mode is on).
  function channelBuyState(loadout: string[], spirit: number): FFState {
    const s = createInitialState(['ai', 'opp'], { ai: 'tracked', opp: 'tracked' }, { loadout }, 1);
    s.phase = 'channel';
    const ai = s.players.ai!;
    if (ai.kind !== 'tracked') throw new Error('expected tracked');
    ai.hand = []; // resources already played → force a buy decision
    ai.handSize = 0;
    ai.deck = ['focus', 'focus', 'focus'];
    ai.deckSize = 3;
    ai.discard = [];
    ai.discardSize = 0;
    ai.spirit = spirit;
    ai.channels = 1;
    s.activePlayerId = 'ai';
    return s;
  }

  it('hard buys damage where medium ramps economy (the core tuning divergence)', () => {
    // Spirit 6 affords cheap damage (Attack, 4) AND economy (Mastery, 6). The
    // React/medium heuristic ramps economy first (+100 > cheap damage +10);
    // the tuned hard heuristic commits to damage. This is exactly the
    // over-ramp the 1000-game lift data flagged.
    const loadout = ['grand_finale', 'attack', 'block'];
    const hardPick = chooseMove(channelBuyState(loadout, 6), 'ai', 'hard');
    const medPick = chooseMove(channelBuyState(loadout, 6), 'ai', 'medium');
    expect(hardPick.move.type).toBe('buy_card');
    expect(medPick.move.type).toBe('buy_card');
    if (hardPick.move.type === 'buy_card') {
      expect(getCard(hardPick.move.card_id).effects?.damage ?? 0).toBeGreaterThan(0);
    }
    if (medPick.move.type === 'buy_card') {
      expect(['focus', 'momentum', 'mastery']).toContain(medPick.move.card_id);
    }
  });

  it('hard prefers the bigger-damage finisher when both are affordable (magnitude matters)', () => {
    // Spirit 10 affords both Grand Finale (+5 dmg, cost 10) and Attack (+1, 4).
    // Medium gives every damage card the same flat bonus; hard scales by amount.
    const pick = chooseMove(channelBuyState(['grand_finale', 'attack'], 10), 'ai', 'hard');
    expect(pick.move.type).toBe('buy_card');
    if (pick.move.type === 'buy_card') expect(pick.move.card_id).toBe('grand_finale');
  });

  it('faction strategy leans buys toward the player\'s own faction from a shared menu', () => {
    // Same shared supply (a Titan finisher + an Awakened heal-striker + a neutral),
    // same spirit. A Titan player must buy the Titan card; an Awakened player the
    // Awakened card. This is the §0 faction lever — each seat builds its faction's
    // deck from the co-drafted shared pool.
    const loadout = ['grand_finale', 'transcendent_strike', 'attack']; // Titan / Awakened / neutral
    const titan = chooseMove(channelBuyState(loadout, 10), 'ai', 'medium', 'titan_entertainment');
    const awakened = chooseMove(channelBuyState(loadout, 10), 'ai', 'medium', 'the_awakened');
    expect(titan.move.type).toBe('buy_card');
    expect(awakened.move.type).toBe('buy_card');
    if (titan.move.type === 'buy_card') expect(titan.move.card_id).toBe('grand_finale');
    if (awakened.move.type === 'buy_card') expect(awakened.move.card_id).toBe('transcendent_strike');
  });

  it('no strategy keeps the adaptive default (parity with plain medium)', () => {
    const loadout = ['grand_finale', 'attack', 'block'];
    const plain = chooseMove(channelBuyState(loadout, 6), 'ai', 'medium');
    const undef = chooseMove(channelBuyState(loadout, 6), 'ai', 'medium', undefined);
    expect(undef.move).toEqual(plain.move);
  });

  it('two-AI smoke run completes faster on the new heuristic', () => {
    // Sanity: with the channel-phase order fixed, games should terminate within
    // a reasonable move budget. Was previously stuck >500 moves.
    let s = createInitialState(['a', 'b'], { a: 'tracked', b: 'tracked' }, {
      loadout: ['attack', 'flying_kick', 'devastating_blow'],
    }, 42);
    let safety = 2000;
    while (s.phase !== 'game_over' && safety-- > 0) {
      const pick = chooseMove(s, s.activePlayerId, 'medium');
      s = applyMove(s, s.activePlayerId, pick.move).newState;
    }
    expect(safety).toBeGreaterThan(0);
    expect(s.phase).toBe('game_over');
  });
});
