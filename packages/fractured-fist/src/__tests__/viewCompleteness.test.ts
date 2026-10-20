// View-completeness locks (post-port runbook §1a; docs/view-completeness-audit.md
// 2026-08-05). Previously missing: who is still owed a turn this round, the
// focus-reload legality counter, the configurable redraw size, and (overruled
// design intent) the tracked side's face-up discard contents.

import { describe, expect, it } from 'vitest';
import { createInitialState } from '../engine.js';
import { getPublicView, getPlayerView } from '../views.js';
import type { TrackedPlayerState } from '../types.js';

function game() {
  return createInitialState(['p1', 'p2'], { p1: 'tracked', p2: 'opaque' }, undefined, 1);
}

type View = Record<string, any>;

describe('fractured-fist view completeness', () => {
  it('round progress and per-player legality counters are public', () => {
    const s = game();
    s.playersDoneThisRound = ['p2'];
    const p1 = s.players.p1 as TrackedPlayerState;
    p1.focusReloadsThisTurn = 2;
    const pub = getPublicView(s) as View;
    expect(pub.players_done_this_round).toEqual(['p2']);
    expect(pub.players.p1.focus_reloads_this_turn).toBe(2);
    expect(typeof pub.players.p1.starting_hand_size).toBe('number');
  });

  it("a tracked player's discard contents are public (face-up pile ruling)", () => {
    const s = game();
    const p1 = s.players.p1 as TrackedPlayerState;
    p1.discard = ['attack', 'block'];
    const pub = getPublicView(s) as View;
    expect(pub.players.p1.discard).toEqual(['attack', 'block']);
    // Opaque player: server doesn't track — no contents field.
    expect(pub.players.p2.discard).toBeUndefined();
  });

  it('privacy holds: tracked hand and deck contents never reach the opponent', () => {
    const s = game();
    const opponentView = getPlayerView(s, 'p2') as View;
    expect(opponentView.players.p1.hand).toBeUndefined();
    expect(opponentView.players.p1.deck_count_by_card).toBeUndefined();
  });
});
