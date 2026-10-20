// The Game contract (CLAUDE.md): applyMove never changes the state it is
// given — not on success, and not when the move throws partway through.
// The MCP layer relies on this: apply_move saves the pre-move session as the
// undo snapshot AFTER calling applyMove, and a rejected move must leave the
// stored session exactly as it was.
import { describe, expect, it } from 'vitest';
import type { PlayerConfig, SessionState } from '@zekel/game-kit';
import { adventurerOlympics as game } from '../index.js';
import type { AOState } from '../types.js';

function allAi(seed: number): SessionState<AOState> {
  return game.createSession(
    [{ player_id: 'a', kind: 'ai' }, { player_id: 'b', kind: 'ai' }] as PlayerConfig[],
    { seed },
  );
}

describe('applyMove leaves its input unchanged', () => {
  it('every move of a full AI game leaves the state it was given untouched', async () => {
    let s = allAi(31);
    let moves = 0;
    while (!game.isGameOver(s) && moves < 3000) {
      const seat = s.gameState.pending!.seat;
      const { move } = await game.getAIMove!(s, seat, 'medium');
      const before = JSON.stringify(s);
      const next = game.applyMove(s, seat, move).newState;
      expect(JSON.stringify(s), `move ${moves}: ${JSON.stringify(move)}`).toBe(before);
      expect(next).not.toBe(s);
      s = next;
      moves++;
    }
    expect(game.isGameOver(s)).not.toBeNull();
  });

  it('two different tile placements can be tried from the same state', async () => {
    let s = allAi(12);
    // Play until a seat has a revealed tile to place.
    let guard = 0;
    while (s.gameState.pending?.kind !== 'explore_place' && guard++ < 3000) {
      const seat = s.gameState.pending!.seat;
      const pending = s.gameState.pending!;
      const explore = pending.kind === 'move' || pending.kind === 'try_again'
        ? game.getLegalMoves(s, seat).find((m) => m.move.type === 'explore' && m.move.slot === undefined)
        : undefined;
      const move = explore?.move ?? (await game.getAIMove!(s, seat, 'medium')).move;
      s = game.applyMove(s, seat, move).newState;
    }
    const seat = s.gameState.pending!.seat;
    const places = game.getLegalMoves(s, seat).filter((m) => m.move.type === 'explore');
    expect(places.length).toBeGreaterThan(1);
    const before = JSON.stringify(s);
    const first = game.applyMove(s, seat, places[0]!.move).newState;
    const second = game.applyMove(s, seat, places[places.length - 1]!.move).newState;
    expect(JSON.stringify(s)).toBe(before);
    expect(JSON.stringify(first.gameState.placedTiles)).not.toBe(JSON.stringify(second.gameState.placedTiles));
  });

  it('a move that throws partway leaves the input unchanged', () => {
    const s = game.createSession(
      [
        { player_id: 'a', kind: 'human', table: 'digital', name: 'Alice' } as PlayerConfig,
        { player_id: 'b', kind: 'ai' } as PlayerConfig,
      ],
      { seed: 7 },
    );
    // A test roll whose icon is missing: the Roll button advances the dice
    // stream and the engine writes the roll to the log BEFORE it looks the
    // icon up and fails — so a copy-less applyMove would leave both changes
    // behind in the caller's state.
    s.gameState.pending = {
      kind: 'roll',
      seat: 'a',
      payload: { rollKind: 'test', diceCount: 2, number: 7, test: 'strength', cardId: 'companion-1', iconKey: 'no-such-hex' },
    };
    s.activePlayerId = 'a';
    const before = JSON.stringify(s);
    expect(() => game.applyMove(s, 'a', { type: 'resolve_report' })).toThrow();
    expect(JSON.stringify(s)).toBe(before);
  });
});
