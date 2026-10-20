import { describe, expect, it } from 'vitest';
import game from '../index.js';
import { chooseMove, searchChoices } from '../ai.js';
import { sampleHiddenState } from '../search.js';
import { unitsForSpecies, buildingsForSpecies, researchForSpecies } from '../data/catalogs.js';

const players = ['a', 'b'].map(player_id => ({ player_id, kind: 'ai' as const }));
function session() { return game.createSession(players, { seed: 1, aiLeaderAssignment: ['Warden Hesper Quill', 'Kestrel Nine'] }); }
function buildState() {
  const s = session(), g = s.gameState;
  g.phase = 'action'; g.pending = null; g.activePlayerId = 'a'; s.activePlayerId = 'a';
  g.activeAction = { ownerId: 'a', cardKind: 'build', which: 'base', slotId: 'test' } as typeof g.activeAction;
  g.players[0]!.collectorsAvailable = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`surf-${i + 1}`, 1]));
  return s;
}
function deal(s: ReturnType<typeof session>) {
  for (const p of s.gameState.players) {
    p.hand = s.gameState.battleDeck.splice(0, 3);
    for (const id of p.hand) s.gameState.cardOwners[id] = p.playerId;
  }
}

describe('balance reverification', () => {
  it('keeps unused production available after a small purchase', () => {
    const s = buildState();
    const move = game.getLegalMoves(s, 'a').find(m => m.move.type === 'build' && m.move.item === 'Surf')!.move;
    expect(move.type === 'build' && move.payment.length).toBe(2);
    const after = game.applyMove(s, 'a', move).newState;
    expect(after.gameState.players[0]!.collectorsAvailable['surf-3']).toBe(1);
  });

  it('buys the final missing distinct type and wins Technological', () => {
    const s = buildState(), p = s.gameState.players[0]!;
    p.buildings = buildingsForSpecies('wizard').map(b => b.name);
    p.research = researchForSpecies('wizard').map(r => r.id);
    // Late game with all types acquired historically, except the Evoker:
    // 25 of the 26 points (ruling #90 counts the Extra cards in the target,
    // #129 the battle strategy card type).
    p.acquiredTypes = [...[...unitsForSpecies('wizard'), ...buildingsForSpecies('wizard'), ...researchForSpecies('wizard')]
      .map(x => x.id).filter(id => id !== 'evoker'), 'battle-strategy-card'];
    const pick = chooseMove(s.gameState, 'a', 'hard', 'technological');
    expect(pick.move).toMatchObject({ type: 'build', item: 'Evoker' });
    expect(game.applyMove(s, 'a', pick.move).newState.gameState.result?.summary).toBe('a wins (Technological)');
  });

  it('keeps explicit passes and supplies executable search choices', () => {
    const s = buildState();
    const choices = searchChoices(s.gameState, 'a');
    expect(choices.some(m => m.move.type === 'skip_action')).toBe(true);
    for (const { move } of choices) expect(() => game.applyMove(structuredClone(s), 'a', move)).not.toThrow();
  });

  it('samples hidden hands independently of their actual contents and conserves cards', () => {
    const s = session(); deal(s);
    const alt = structuredClone(s);
    [alt.gameState.players[1]!.hand[0], alt.gameState.battleDeck[0]] =
      [alt.gameState.battleDeck[0]!, alt.gameState.players[1]!.hand[0]!];
    const before = structuredClone(s);
    const a = sampleHiddenState(structuredClone(s), 'a', () => 0.25);
    const b = sampleHiddenState(alt, 'a', () => 0.25);
    expect(s).toEqual(before);
    expect(a.gameState.players.map(p => p.hand)).toEqual(b.gameState.players.map(p => p.hand));
    expect(a.gameState.battleDeck).toEqual(b.gameState.battleDeck);
    expect(a.gameState.players[0]!.hand).toEqual(s.gameState.players[0]!.hand);
    expect(a.gameState.players[1]!.hand).not.toEqual(s.gameState.players[1]!.hand);
    const cards = (v: typeof s) => [...v.gameState.battleDeck, ...v.gameState.players.flatMap(p => p.hand)].sort();
    expect(cards(a)).toEqual(cards(s));
    expect(new Set(cards(a)).size).toBe(cards(a).length);
    for (const p of a.gameState.players) for (const id of p.hand) expect(a.gameState.cardOwners[id]).toBe(p.playerId);
  });

  it('preserves Shared Tactics knowledge', () => {
    const s = session(); deal(s);
    s.gameState.treaties.push({ type: 'shared-tactics', partners: ['a', 'b'] });
    const a = sampleHiddenState(structuredClone(s), 'a', () => 0.75);
    expect(a.gameState.players.map(p => p.hand)).toEqual(s.gameState.players.map(p => p.hand));
  });

  it('keeps sealed commitments consistent with sampled ownership', () => {
    const s = session(); deal(s);
    s.gameState.treaties.push({ type: 'shared-tactics', partners: ['a', 'b'] });
    // Only the commitment fields are needed by the sampler; battle mechanics
    // are exercised separately in battlecards.test.ts.
    s.gameState.battle = { phase: 'commit', commitments: {
      a: 'pending', b: { cardInstanceId: s.gameState.players[1]!.hand[0]!, playingPlayerId: 'b' },
    } } as NonNullable<typeof s.gameState.battle>;
    const sampled = sampleHiddenState(structuredClone(s), 'a', () => 0.25);
    expect(sampled.gameState.battle!.commitments.a).toBe('pending');
    const commitment = sampled.gameState.battle!.commitments.b;
    expect(typeof commitment).toBe('object');
    if (typeof commitment === 'object') expect(sampled.gameState.players[1]!.hand).toContain(commitment.cardInstanceId);
    expect(commitment).not.toEqual(s.gameState.battle!.commitments.b);
  });

  it('finishes a military expedition (no endless standoff)', () => {
    // A Ledger robot with Marshal against a Brass Circle wizard with Elara, seed
    // 82003. Until 2026-09-26 the wizard's spy killed the robot's wandering
    // Leader in round 9; with the AI defending (Leader home, armed spy strikes
    // first) the game is a standoff the robot's culture engine settles. What
    // this case guards is that it ENDS, in a normal number of rounds.
    let s = game.createSession(players, { seed: 82003,
      factionAssignment: ['ledger', 'brass-circle'], aiLeaderAssignment: ['marshal', 'elara'],
    });
    for (let i = 0; i < 1000 && !s.gameState.result; i++) {
      const move = chooseMove(s.gameState, s.activePlayerId, 'hard', 'military').move;
      s = game.applyMove(s, s.activePlayerId, move).newState;
    }
    expect(s.gameState.result).not.toBeNull();
    expect(s.gameState.round).toBeLessThan(15);
  }, 20_000);

});
