// A client lays out each action card copy a seat holds (base, hero extra,
// researched extra) and names a planned card by its slot, so the view says
// which copies there are, and the planning moves offer exactly the unplayed
// ones. Technology types are named, not given as ids.

import { describe, expect, it } from 'vitest';
import game from '../index.js';

const two = [{ player_id: 'a', kind: 'ai' as const }, { player_id: 'b', kind: 'ai' as const }];
const KIND: Record<string, string> = { build: 'build', moveBattle: 'move_battle', research: 'research' };

describe('action card slots and type names', () => {
  it('publishes each copy by slot, matching the planning moves, and names technology types', async () => {
    let s = game.createSession(two, { seed: 11 } as never);
    s.players = two as never;
    let planningSeen = 0;
    for (let i = 0; i < 1500 && !s.gameState.result; i++) {
      const pid = s.activePlayerId;
      if (s.gameState.phase === 'planning' && s.gameState.pending === null) {
        const view = game.getPlayerView(s, pid) as { players: Array<{ player_id: string; action_card_slots: Record<string, string[]>; action_cards_played_count: number; tech_progress: { acquired_types: string[]; acquired_type_names: string[] } }>; your_action_cards_played: string[] };
        const me = view.players.find((p) => p.player_id === pid)!;
        const offered = game.getLegalMoves(s, pid).map((m) => m.move as { type: string; card?: string; which?: string })
          .filter((m) => m.type === 'plan_action' && m.card !== 'pass').map((m) => `${m.card}:${m.which}`).sort();
        const fromSlots = Object.entries(me.action_card_slots)
          .flatMap(([k, slots]) => slots.map((w) => `${KIND[k]}:${w}`))
          .filter((x) => !view.your_action_cards_played.includes(x)).sort();
        if (offered.length > 0) { expect(offered).toEqual(fromSlots); planningSeen++; }
        expect(me.tech_progress.acquired_type_names).toHaveLength(me.tech_progress.acquired_types.length);
        for (const n of me.tech_progress.acquired_type_names) expect(n).not.toMatch(/^[a-z]+(-[a-z]+)+$/);
      }
      const { move } = await game.getAIMove(s, pid, 'easy');
      s = game.applyMove(s, pid, move).newState;
    }
    expect(planningSeen).toBeGreaterThan(5);
  }, 120_000);
});
