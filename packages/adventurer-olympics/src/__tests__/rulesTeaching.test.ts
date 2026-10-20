// Adventurer Olympics rules-teaching locks (docs/rules-teaching.md; post-port §7a):
//   1. COVERAGE — every move type in the move schema is tagged to ≥1 rules section
//   2. SINGLE SOURCE — getRulesText is rendered from the sections
//   3. CONSISTENCY — at every state of real games, what the gates say is
//      available / unavailable agrees with getLegalMoves, for every seat
import { describe, expect, it } from 'vitest';
import type { PlayerConfig, SessionState } from '@zekel/game-kit';
import { duplicateSectionIds, renderRulesText, validateSectionCoverage } from '@zekel/game-kit';
import { checkGateConsistency } from '@zekel/game-kit';
import { adventurerOlympics as game } from '../index.js';
import { AORuleSections } from '../rulesSections.js';
import type { AOState } from '../types.js';

const schemaTypes = (): string[] =>
  ((game.moveSchema as { properties: { type: { enum: string[] } } }).properties.type.enum);

describe('rules sections', () => {
  it('every move type is tagged to a rules section', () => {
    expect(validateSectionCoverage(AORuleSections, schemaTypes())).toEqual([]);
  });

  it('section ids are unique', () => {
    expect(duplicateSectionIds(AORuleSections)).toEqual([]);
  });

  it('the rules text is rendered from the sections', () => {
    expect(game.getRulesText!()).toBe(renderRulesText(AORuleSections));
  });
});

describe('gate declarations agree with the legal moves', () => {
  for (const table of ['physical', 'digital'] as const) {
    it(`over whole games with a ${table} human seat`, async () => {
      for (const seed of [1, 2, 3]) {
        let s: SessionState<AOState> = game.createSession(
          [
            { player_id: 'a', kind: 'human', name: 'Alice', table } as PlayerConfig,
            { player_id: 'b', kind: 'ai', name: 'Bob' } as PlayerConfig,
            { player_id: 'c', kind: 'ai', name: 'Chris' } as PlayerConfig,
          ],
          { seed },
        );
        let moves = 0;
        while (!game.isGameOver(s) && moves < 1500) {
          for (const pid of ['a', 'b', 'c']) {
            const problems = checkGateConsistency(game.describeMoveGates!(s, pid), game.getLegalMoves(s, pid));
            expect(problems, `seed ${seed} move ${moves} seat ${pid} (${s.gameState.pending?.kind})`).toEqual([]);
          }
          const seat = s.gameState.pending!.seat;
          const move = s.gameState.players[seat]!.kind === 'ai'
            ? (await game.getAIMove!(s, seat, 'medium')).move
            : (game.autoResolveReport!(s, seat) ?? { move: game.getLegalMoves(s, seat)[0]!.move }).move;
          s = game.applyMove(s, seat, move).newState;
          moves++;
        }
        expect(game.isGameOver(s), `seed ${seed}`).not.toBeNull();
      }
    });
  }
});
