// AI development 2026-09-26 (designer's playtest note): the hard AI breaks a
// treaty that turned into a bad deal, and neither offers nor accepts one.
// A Culture Treaty shares the win, so it is a bad deal only when I am the
// one pulling ahead (it would hand half my win to a partner who is behind);
// every other treaty shares nothing, so it is a bad deal when the partner is
// pulling ahead (its income or access feeds the seat most likely to beat me).

import { describe, expect, it } from 'vitest';
import game from '../index.js';
import { chooseMove } from '../ai.js';
import type { NGGMove, NGGState } from '../types.js';
import type { PlayerConfig, SessionState } from '@zekel/game-kit';
import { keepCores } from './pendingFixtures.js';

function apply(s: SessionState<NGGState>, playerId: string, move: NGGMove) {
  return game.applyMove(s, playerId, move).newState;
}

/** Four AI seats through setup (two wizards, two robots). */
function base4p(): SessionState<NGGState> {
  const players: PlayerConfig[] = ['a', 'b', 'c', 'd'].map((id) => ({ player_id: id, kind: 'ai' as const }));
  let s = game.createSession(players, { seed: 13, aiLeaderAssignment: ['Warden Hesper Quill', 'Dowser Wren Calloway', 'Kestrel Nine', 'Marshal Corvin Ashlock'] });
  let guard = 0;
  while ((s.gameState.phase === 'setup_factions' || s.gameState.phase === 'setup_leaders' || s.gameState.phase === 'setup_locations') && guard++ < 40) {
    const pid = s.activePlayerId;
    s = apply(s, pid, chooseMove(s.gameState, pid, 'hard').move);
  }
  // No drawn opening goals (engine.ts drawOpeningGoal): these cases are about
  // the treaty logic of an adaptive seat, not a goal it leans on.
  for (const p of s.gameState.players) delete p.aiPlan;
  return keepCores(s);
}

/** Put the table at the end-of-round treaty-break window with a's decision open. */
function atBreakWindow(s: SessionState<NGGState>): SessionState<NGGState> {
  const g = s.gameState;
  g.phase = 'treaty_break';
  g.pending = { kind: 'treaty_break_decision', forPlayerId: 'a' };
  g.activePlayerId = 'a'; s.activePlayerId = 'a';
  g.battle = null; g.actionStack = []; g.activeAction = null;
  return s;
}

describe('the hard AI and bad-deal treaties', () => {
  it('breaks a Peace treaty with a partner who is pulling ahead', () => {
    // Partner b is pulling ahead by culture: 125 of 140 (4p, ruling #119) with a big engine.
    const s = atBreakWindow(base4p());
    const g = s.gameState;
    g.treaties.push({ type: 'peace', partners: ['a', 'b'] });
    const b = g.players.find((p) => p.playerId === 'b')!;
    b.culture = 125; b.subjects = 5;
    expect(game.getLegalMoves(s, 'a').some((m) => m.move.type === 'break_treaty')).toBe(true);
    expect(chooseMove(g, 'a', 'hard').move).toMatchObject({ type: 'break_treaty', partner: 'b' });
  });

  it('keeps a Culture Treaty with a partner who is pulling ahead (a shared win), and breaks one when it is the seat pulling ahead', () => {
    const s = atBreakWindow(base4p());
    const g = s.gameState;
    g.treaties.push({ type: 'culture-treaty', partners: ['a', 'b'] });
    const b = g.players.find((p) => p.playerId === 'b')!;
    b.culture = 125; b.subjects = 5;
    expect(chooseMove(g, 'a', 'hard').move.type).toBe('skip_action');

    const s2 = atBreakWindow(base4p());
    const g2 = s2.gameState;
    g2.treaties.push({ type: 'culture-treaty', partners: ['a', 'b'] });
    const a = g2.players.find((p) => p.playerId === 'a')!;
    a.culture = 125; a.subjects = 5;
    expect(chooseMove(g2, 'a', 'hard').move).toMatchObject({ type: 'break_treaty', partner: 'b' });
  });

  it('declines a Peace treaty offered by a seat that is pulling ahead, and a Culture Treaty from a seat that is behind', () => {
    const s = base4p();
    const g = s.gameState;
    const b = g.players.find((p) => p.playerId === 'b')!;
    b.culture = 125; b.subjects = 5;
    g.phase = 'action';
    g.pending = { kind: 'treaty_response', forPlayerId: 'a', proposerId: 'b', treatyType: 'peace' };
    g.activePlayerId = 'a'; s.activePlayerId = 'a';
    expect(chooseMove(g, 'a', 'hard').move).toMatchObject({ type: 'respond_treaty', accept: false });

    const s2 = base4p();
    const g2 = s2.gameState;
    const a = g2.players.find((p) => p.playerId === 'a')!;
    a.culture = 125; a.subjects = 5;
    g2.phase = 'action';
    g2.pending = { kind: 'treaty_response', forPlayerId: 'a', proposerId: 'b', treatyType: 'culture-treaty' };
    g2.activePlayerId = 'a'; s2.activePlayerId = 'a';
    expect(chooseMove(g2, 'a', 'hard').move).toMatchObject({ type: 'respond_treaty', accept: false });
  });
});
