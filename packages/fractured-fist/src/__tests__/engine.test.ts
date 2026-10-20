import { describe, expect, it } from 'vitest';
import { applyMove, checkGameOver, createInitialState } from '../engine.js';
import { getLegalMoves } from '../legalMoves.js';
import { FOCUS_RELOADS_PER_TURN } from '../cards.js';
import type { FFOptions, FFState, TrackedPlayerState } from '../types.js';

const PLAYERS = ['p1', 'p2'];

function initBothTracked(opts?: FFOptions): FFState {
  return createInitialState(PLAYERS, { p1: 'tracked', p2: 'tracked' }, opts, 12345);
}

function initHumanVsAI(opts?: FFOptions): FFState {
  return createInitialState(PLAYERS, { p1: 'opaque', p2: 'tracked' }, opts, 12345);
}

function asTracked(s: FFState, pid: string): TrackedPlayerState {
  const p = s.players[pid]!;
  if (p.kind !== 'tracked') throw new Error('expected tracked');
  return p;
}

describe('createInitialState', () => {
  it('gives each tracked player a deck of 10 minus hand size', () => {
    const s = initBothTracked();
    const p1 = asTracked(s, 'p1');
    expect(p1.hand.length + p1.deck.length).toBe(10);
  });

  it('starts both players with 7 stamina by default', () => {
    const s = initBothTracked();
    expect(s.players.p1!.stamina).toBe(7);
    expect(s.players.p2!.stamina).toBe(7);
  });

  it('gives each player their own supply of 5 per technique (FF rule: not shared)', () => {
    const s = initBothTracked();
    // Each player has their own supply with full 5 of each technique
    expect(s.players.p1!.supply.attack).toBe(5);
    expect(s.players.p1!.supply.block).toBe(5);
    expect(s.players.p1!.supply.center).toBe(5);
    expect(s.players.p1!.supply.focus).toBe(20);
    expect(s.players.p2!.supply.attack).toBe(5);
    expect(s.players.p2!.supply.block).toBe(5);
    expect(s.players.p2!.supply.focus).toBe(20);
  });

  it('a buy by one player only decrements that player\'s supply, not the other\'s', () => {
    let s = initBothTracked();
    s.phase = 'channel';
    const p1 = asTracked(s, 'p1');
    p1.spirit = 5;
    p1.channels = 1;
    s = applyMove(s, 'p1', { type: 'buy_card', card_id: 'attack' }).newState;
    expect(s.players.p1!.supply.attack).toBe(4);
    expect(s.players.p2!.supply.attack).toBe(5);
  });

  it('starts on player 1 in technique phase, round 1', () => {
    const s = initBothTracked();
    expect(s.activePlayerId).toBe('p1');
    expect(s.phase).toBe('technique');
    expect(s.round).toBe(1);
  });

  it('rejects non-technique cards in loadout', () => {
    expect(() => initBothTracked({ loadout: ['focus'] })).toThrow();
  });

  it('rejects unknown loadout cards', () => {
    expect(() => initBothTracked({ loadout: ['not_a_real_card'] })).toThrow();
  });

  it('opaque player has counts but no contents', () => {
    const s = initHumanVsAI();
    const p1 = s.players.p1!;
    expect(p1.kind).toBe('opaque');
    expect(p1.deckSize + p1.handSize).toBe(10);
    expect(p1.handSize).toBe(5);
  });
});

describe('applyMove — illegal move rejection (tracked)', () => {
  it('rejects play by inactive player', () => {
    const s = initBothTracked();
    expect(() =>
      applyMove(s, 'p2', { type: 'play_card', card_id: 'focus', hand_index: 0 }),
    ).toThrow(/turn/);
  });

  it('rejects technique cards in channel phase', () => {
    const s = initBothTracked({ loadout: ['attack'] });
    const p1 = asTracked(s, 'p1');
    p1.hand = ['attack'];
    p1.handSize = 1;
    p1.actions = 1;
    s.phase = 'channel';
    expect(() => applyMove(s, 'p1', { type: 'play_card', card_id: 'attack', hand_index: 0 })).toThrow(
      /technique phase/,
    );
  });

  it('rejects resource cards in technique phase', () => {
    const s = initBothTracked();
    expect(() =>
      applyMove(s, 'p1', { type: 'play_card', card_id: 'focus', hand_index: 0 }),
    ).toThrow(/channel phase/);
  });
});

describe('applyMove — playing cards (tracked)', () => {
  it('plays a focus card in channel phase for +1 spirit', () => {
    const s = initBothTracked();
    s.phase = 'channel';
    const p1 = asTracked(s, 'p1');
    const focusIdx = p1.hand.indexOf('focus');
    expect(focusIdx).toBeGreaterThanOrEqual(0);
    const beforeSpirit = p1.spirit;
    const r = applyMove(s, 'p1', { type: 'play_card', card_id: 'focus', hand_index: focusIdx });
    const np1 = asTracked(r.newState, 'p1');
    expect(np1.spirit).toBe(beforeSpirit + 1);
    expect(np1.hand.length).toBe(p1.hand.length - 1);
    expect(np1.handSize).toBe(np1.hand.length);
  });

  it('queues damage from attack and decrements actions', () => {
    const s = initBothTracked();
    const p1 = asTracked(s, 'p1');
    p1.hand = ['attack'];
    p1.handSize = 1;
    p1.actions = 1;
    const r = applyMove(s, 'p1', { type: 'play_card', card_id: 'attack', hand_index: 0 });
    const np1 = asTracked(r.newState, 'p1');
    expect(np1.damageQueued).toBe(1);
    expect(np1.actions).toBe(0);
    expect(np1.played).toContain('attack');
  });

  it('sets refinePending when a refine effect is played', () => {
    const s = initBothTracked();
    const p1 = asTracked(s, 'p1');
    p1.hand = ['assess'];
    p1.handSize = 1;
    p1.actions = 1;
    const r = applyMove(s, 'p1', { type: 'play_card', card_id: 'assess', hand_index: 0 });
    expect(r.newState.players.p1!.refinePending).toBe(2);
  });

  it('blocks other moves while refines are pending', () => {
    let s = initBothTracked();
    const p1 = asTracked(s, 'p1');
    p1.hand = ['assess', 'focus'];
    p1.handSize = 2;
    p1.actions = 1;
    s = applyMove(s, 'p1', { type: 'play_card', card_id: 'assess', hand_index: 0 }).newState;
    expect(() => applyMove(s, 'p1', { type: 'advance_phase' })).toThrow(/refining/);
  });

  it('refine_card removes from hand and decrements pending', () => {
    const s = initBothTracked();
    const p1 = asTracked(s, 'p1');
    p1.hand = ['misstep', 'focus'];
    p1.handSize = 2;
    p1.refinePending = 1;
    p1.misstepCount = 3;
    const r = applyMove(s, 'p1', { type: 'refine_card', hand_index: 0 });
    const np1 = asTracked(r.newState, 'p1');
    expect(np1.hand).toEqual(['focus']);
    expect(np1.refinePending).toBe(0);
    expect(np1.misstepCount).toBe(2);
  });
});

describe('applyMove — buying cards (tracked)', () => {
  it('rejects buy when no channels remaining', () => {
    const s = initBothTracked();
    s.phase = 'channel';
    const p1 = asTracked(s, 'p1');
    p1.channels = 0;
    p1.spirit = 99;
    expect(() => applyMove(s, 'p1', { type: 'buy_card', card_id: 'attack' })).toThrow(/channel/);
  });

  it('rejects buy without enough spirit', () => {
    const s = initBothTracked();
    s.phase = 'channel';
    asTracked(s, 'p1').spirit = 1;
    expect(() => applyMove(s, 'p1', { type: 'buy_card', card_id: 'attack' })).toThrow(/spirit/);
  });

  it('successful buy deducts spirit, decrements supply, adds to discard', () => {
    const s = initBothTracked();
    s.phase = 'channel';
    const p1 = asTracked(s, 'p1');
    p1.spirit = 5;
    p1.channels = 1;
    const r = applyMove(s, 'p1', { type: 'buy_card', card_id: 'attack' });
    const np1 = asTracked(r.newState, 'p1');
    expect(np1.spirit).toBe(1);
    expect(np1.channels).toBe(0);
    expect(r.newState.players.p1!.supply.attack).toBe(4);
    expect(r.newState.players.p2!.supply.attack).toBe(5); // shared supply NOT decremented
    expect(np1.discard).toContain('attack');
  });
});

describe('end_turn and strike resolution', () => {
  it('passes turn to opponent after first player ends', () => {
    const s = initBothTracked();
    const r = applyMove(s, 'p1', { type: 'end_turn' });
    expect(r.newState.activePlayerId).toBe('p2');
    expect(r.newState.phase).toBe('technique');
    expect(r.newState.playersDoneThisRound).toContain('p1');
  });

  it('resolves strike and starts new round after both players end', () => {
    let s = initBothTracked();
    asTracked(s, 'p1').damageQueued = 3;
    asTracked(s, 'p2').defenseQueued = 1;
    s = applyMove(s, 'p1', { type: 'end_turn' }).newState;
    s = applyMove(s, 'p2', { type: 'end_turn' }).newState;
    expect(s.round).toBe(2);
    expect(s.players.p2!.stamina).toBe(7 - 2);
    expect(s.players.p1!.stamina).toBe(7);
    expect(s.phase).toBe('technique');
    expect(s.activePlayerId).toBe('p1');
    expect(s.players.p1!.damageQueued).toBe(0);
    expect(s.players.p2!.defenseQueued).toBe(0);
  });

  it('declares a winner when an opponent drops to 0 stamina', () => {
    let s = initBothTracked();
    asTracked(s, 'p1').damageQueued = 99;
    s = applyMove(s, 'p1', { type: 'end_turn' }).newState;
    s = applyMove(s, 'p2', { type: 'end_turn' }).newState;
    expect(s.phase).toBe('game_over');
    expect(s.winners).toEqual(['p1']);
    const r = checkGameOver(s);
    expect(r.game_over).toBe(true);
    expect(r.winners).toEqual(['p1']);
  });

  it('declares a tie if both reach 0', () => {
    let s = initBothTracked();
    asTracked(s, 'p1').damageQueued = 99;
    asTracked(s, 'p2').damageQueued = 99;
    s = applyMove(s, 'p1', { type: 'end_turn' }).newState;
    s = applyMove(s, 'p2', { type: 'end_turn' }).newState;
    expect(s.phase).toBe('game_over');
    expect(s.winners).toEqual([]);
  });
});

describe('deck reshuffle', () => {
  it('reshuffles discard into deck when deck empty (tracked)', () => {
    let s = initBothTracked();
    const p1 = asTracked(s, 'p1');
    p1.deck = [];
    p1.hand = [];
    p1.handSize = 0;
    p1.discard = ['focus', 'focus', 'focus', 'focus', 'focus'];
    p1.discardSize = 5;
    s = applyMove(s, 'p1', { type: 'end_turn' }).newState;
    const np1 = asTracked(s, 'p1');
    expect(np1.hand.length).toBe(5);
    expect(np1.discard.length).toBe(0);
  });
});

describe('focus_reload (tracked)', () => {
  it('requires lower stamina than opponent', () => {
    const s = initBothTracked();
    s.players.p1!.stamina = 10;
    s.players.p2!.stamina = 10;
    expect(() => applyMove(s, 'p1', { type: 'focus_reload' })).toThrow(/stamina/);
  });

  it('discards all Focus and redraws same count', () => {
    const s = initBothTracked();
    s.players.p1!.stamina = 5;
    s.players.p2!.stamina = 10;
    const p1 = asTracked(s, 'p1');
    p1.hand = ['focus', 'focus', 'misstep'];
    p1.handSize = 3;
    p1.deck = ['attack', 'attack'];
    p1.deckSize = 2;
    const r = applyMove(s, 'p1', { type: 'focus_reload' });
    const np1 = asTracked(r.newState, 'p1');
    expect(np1.hand.length).toBe(3);
    expect(np1.hand.filter((c) => c === 'focus').length).toBeLessThanOrEqual(0);
  });

  it(`caps reloads at ${FOCUS_RELOADS_PER_TURN} per turn and stops offering it after the cap`, () => {
    const s = initBothTracked();
    s.players.p1!.stamina = 5;
    s.players.p2!.stamina = 10;
    const p1 = asTracked(s, 'p1');
    // Focus-heavy deck so every reload redraws a Focus (the loop condition the
    // harness found); the cap is what makes it terminate.
    p1.hand = ['focus'];
    p1.handSize = 1;
    p1.deck = ['focus', 'focus', 'focus', 'focus'];
    p1.deckSize = 4;

    let st = s;
    for (let i = 0; i < FOCUS_RELOADS_PER_TURN; i++) {
      // Still offered while under the cap.
      expect(getLegalMoves(st, 'p1').some((m) => m.move.type === 'focus_reload')).toBe(true);
      st = applyMove(st, 'p1', { type: 'focus_reload' }).newState;
    }
    expect(asTracked(st, 'p1').focusReloadsThisTurn).toBe(FOCUS_RELOADS_PER_TURN);
    // Cap reached: engine rejects and legalMoves no longer offers it.
    expect(() => applyMove(st, 'p1', { type: 'focus_reload' })).toThrow(/per turn/);
    expect(getLegalMoves(st, 'p1').some((m) => m.move.type === 'focus_reload')).toBe(false);
  });

  it('resets the reload budget at the start of a new round', () => {
    // p1 uses a reload, both end their turns → strike → new round resets it.
    const s = initBothTracked();
    s.players.p1!.stamina = 5;
    s.players.p2!.stamina = 10;
    const p1 = asTracked(s, 'p1');
    p1.hand = ['focus'];
    p1.handSize = 1;
    p1.deck = ['attack', 'attack', 'attack', 'attack', 'attack'];
    p1.deckSize = 5;
    let st = applyMove(s, 'p1', { type: 'focus_reload' }).newState;
    expect(asTracked(st, 'p1').focusReloadsThisTurn).toBe(1);
    st = applyMove(st, 'p1', { type: 'end_turn' }).newState; // p2 up
    st = applyMove(st, 'p2', { type: 'end_turn' }).newState; // strike → round 2
    expect(asTracked(st, 'p1').focusReloadsThisTurn).toBe(0);
  });
});

// -------- Opaque (human-side) player tests --------

describe('opaque player flow', () => {
  it('can play a card by card_id alone (no hand_index)', () => {
    const s = initHumanVsAI();
    s.phase = 'channel';
    const before = s.players.p1!;
    const r = applyMove(s, 'p1', { type: 'play_card', card_id: 'focus' });
    const after = r.newState.players.p1!;
    expect(after.kind).toBe('opaque');
    expect(after.handSize).toBe(before.handSize - 1);
    expect(after.spirit).toBe(before.spirit + 1);
    expect(after.played).toContain('focus');
  });

  it('opaque player can play any technique in the game pool, regardless of prior bookkeeping', () => {
    // Setup with a loadout that includes a card the player has never "acquired"
    // from the server's perspective — the human is trusted to be holding it.
    const s = initHumanVsAI({ loadout: ['attack', 'flying_kick'] });
    const before = s.players.p1!;
    // flying_kick has no draw effect, so handSize cleanly drops by 1.
    const r = applyMove(s, 'p1', { type: 'play_card', card_id: 'flying_kick' });
    const after = r.newState.players.p1!;
    expect(after.kind).toBe('opaque');
    expect(after.handSize).toBe(before.handSize - 1);
    expect(after.damageQueued).toBe(2);
    expect(after.played).toContain('flying_kick');
  });

  it('rejects opaque play of a card not in the game pool', () => {
    // grand_finale is in the catalog but NOT in this game's loadout.
    const s = initHumanVsAI({ loadout: ['attack', 'block'] });
    expect(() => applyMove(s, 'p1', { type: 'play_card', card_id: 'grand_finale' })).toThrow(
      /not part of your card pool/,
    );
  });

  it('rejects opaque play of an unknown card id', () => {
    const s = initHumanVsAI();
    expect(() => applyMove(s, 'p1', { type: 'play_card', card_id: 'not_a_card' })).toThrow();
  });

  it('refine_card requires was_misstep flag for opaque players', () => {
    const s = initHumanVsAI();
    s.players.p1!.refinePending = 1;
    expect(() => applyMove(s, 'p1', { type: 'refine_card' })).toThrow(/was_misstep/);
  });

  it('refining a misstep decrements misstep count', () => {
    const s = initHumanVsAI();
    const p1 = s.players.p1!;
    p1.refinePending = 1;
    const before = p1.misstepCount;
    const r = applyMove(s, 'p1', { type: 'refine_card', was_misstep: true });
    expect(r.newState.players.p1!.misstepCount).toBe(before - 1);
    expect(r.newState.players.p1!.handSize).toBe(p1.handSize - 1);
  });

  it('focus_reload requires count for opaque players', () => {
    const s = initHumanVsAI();
    s.players.p1!.stamina = 5;
    s.players.p2!.stamina = 10;
    expect(() => applyMove(s, 'p1', { type: 'focus_reload' })).toThrow(/count required/);
  });

  it('opaque player end_turn updates counts correctly', () => {
    let s = initHumanVsAI();
    s = applyMove(s, 'p1', { type: 'end_turn' }).newState;
    const p1 = s.players.p1!;
    expect(p1.kind).toBe('opaque');
    expect(p1.handSize).toBe(5);
  });

  it('AI playing add_misstep against opaque human bumps human\'s misstep count', () => {
    const s = initHumanVsAI();
    // give the AI a misstep-dealing card in hand
    const aip2 = asTracked(s, 'p2');
    aip2.hand = ['distract'];
    aip2.handSize = 1;
    aip2.actions = 1;
    // advance to p2's turn
    s.activePlayerId = 'p2';
    const beforeMisstep = s.players.p1!.misstepCount;
    const r = applyMove(s, 'p2', { type: 'play_card', card_id: 'distract', hand_index: 0 });
    const after = r.newState.players.p1!;
    expect(after.misstepCount).toBe(beforeMisstep + 2);
    if (after.kind === 'opaque') {
      expect(after.discardSize).toBe(2);
    }
  });
});

describe('defensive move validation', () => {
  it('throws INVALID_MOVE_SHAPE for an unrecognized move type instead of returning undefined', () => {
    const s = createInitialState(PLAYERS, { p1: 'tracked', p2: 'tracked' }, undefined, 1);
    // Cast through unknown to simulate a malformed move arriving from MCP.
    expect(() =>
      applyMove(s, 'p1', { type: 'channel' } as unknown as Parameters<typeof applyMove>[2]),
    ).toThrow(/Unrecognized move type/);
  });

  it('throws when move is missing the type field entirely', () => {
    const s = createInitialState(PLAYERS, { p1: 'tracked', p2: 'tracked' }, undefined, 1);
    expect(() =>
      applyMove(s, 'p1', {} as unknown as Parameters<typeof applyMove>[2]),
    ).toThrow(/Unrecognized move type/);
  });
});

describe('default loadout', () => {
  it('uses the 7 canonical starter cards when no loadout is provided', () => {
    const s = createInitialState(PLAYERS, { p1: 'tracked', p2: 'tracked' }, undefined, 1);
    // Each player has their own supply; filter techniques only.
    const techniqueIds = Object.entries(s.players.p1!.supply)
      .filter(([id]) => id !== 'focus' && id !== 'momentum' && id !== 'mastery')
      .map(([id]) => id)
      .sort();
    expect(techniqueIds).toEqual(
      ['assess', 'attack', 'block', 'center', 'distract', 'quicken', 'react'].sort(),
    );
    expect(techniqueIds.length).toBe(7);
  });
});
