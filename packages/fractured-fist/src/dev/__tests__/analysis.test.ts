import { describe, it, expect } from 'vitest';
import { segmentTurns, analyzeBatch } from '@zekel/dev/harness/analysis';
import type { GameRecord, MoveRecord } from '@zekel/dev/harness/runner';

function mv(player_id: string, move: unknown): MoveRecord {
  return { turn: 0, player_id, move, narration: '', summary: '' };
}

function game(over: Partial<GameRecord> & { winners: string[]; moves: MoveRecord[] }): GameRecord {
  return {
    game_id: 'fractured-fist',
    seed: over.seed ?? 1,
    players: over.players ?? [
      { player_id: 'ai1', kind: 'ai', difficulty: 'medium' },
      { player_id: 'ai2', kind: 'ai', difficulty: 'medium' },
    ],
    options: over.options,
    moves: over.moves,
    result: { winners: over.winners, scores: {}, summary: '' },
    final_views: {},
    error: over.error,
  };
}

describe("analyzeBatch with Fractured Fist's analysis settings", () => {
  it('uses the Fractured Fist leaderScalar (stamina) for §4 when traced', () => {
    const g: GameRecord = {
      ...game({ seed: 1, winners: ['ai1'], moves: [] }),
      result: { winners: ['ai1'], scores: { ai1: 12, ai2: 0 }, summary: '' },
      score_trace: [
        { ai1: { stamina: 20 }, ai2: { stamina: 20 } }, // tied — winner not strictly behind
        { ai1: { stamina: 12 }, ai2: { stamina: 18 } }, // ai1 (winner) strictly behind
        { ai1: { stamina: 12 }, ai2: { stamina: 0 } }, // ai1 ahead
      ],
    };
    const t = analyzeBatch([g]).temporal!;
    expect(t).toBeDefined();
    expect(t.n_games).toBe(1);
    expect(t.turns_trailing_winner.mean).toBe(1); // exactly the middle snapshot
  });

  it('applies the Fractured Fist dead-turn override: no impactful play + no buy = dead', () => {
    const g: GameRecord = {
      game_id: 'fractured-fist',
      seed: 1,
      players: [
        { player_id: 'ai1', kind: 'ai', difficulty: 'medium' },
        { player_id: 'ai2', kind: 'ai', difficulty: 'medium' },
      ],
      moves: [
        // ai1: played only a Focus (resource) + refined → no board progress → DEAD.
        mv('ai1', { type: 'play_card', card_id: 'focus' }),
        mv('ai1', { type: 'refine_card' }),
        mv('ai1', { type: 'end_turn' }),
        // ai2: played Attack (damage) → impactful → NOT dead.
        mv('ai2', { type: 'play_card', card_id: 'attack' }),
        mv('ai2', { type: 'end_turn' }),
        // ai1: bought a card → progress → NOT dead.
        mv('ai1', { type: 'buy_card', card_id: 'grand_finale' }),
        mv('ai1', { type: 'end_turn' }),
      ],
      result: { winners: ['ai2'], scores: {}, summary: '' },
      final_views: {},
    };
    const turns = segmentTurns(g);
    expect(turns).toHaveLength(3);
    expect(turns.map((t) => t.is_dead)).toEqual([true, false, false]);
  });
});
