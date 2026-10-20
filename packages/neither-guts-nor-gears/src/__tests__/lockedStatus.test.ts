// Each seat's public view says what it has not unlocked yet and what it needs:
// units whose building is missing, technologies whose prerequisite is
// missing, treaty formation and the battle-card purchase. Building the thing
// clears the line; nothing about cost, caps or timing is in it.

import { describe, expect, it } from 'vitest';
import game from '../index.js';

const two = [{ player_id: 'a', kind: 'ai' as const }, { player_id: 'b', kind: 'ai' as const }];

async function started(seed: number) {
  // Leaders pinned: Envoy unlocks treaties by herself, and the AI's draft
  // may take her (it did after ruling #124 weakened Dowser).
  let s = game.createSession(two, { seed, aiLeaderAssignment: ['chronicler', 'foreman'] } as never);
  s.players = two as never;
  for (let i = 0; i < 200 && s.gameState.phase.startsWith('setup'); i++) {
    const pid = s.activePlayerId;
    const { move } = await game.getAIMove(s, pid, 'easy');
    s = game.applyMove(s, pid, move).newState;
  }
  return s;
}

type Locked = { units: Record<string, string>; research: Record<string, string>; treaties: string | null; battle_cards: string | null };
const lockedOf = (s: unknown, pid: string) =>
  ((game.getPlayerView(s as never, pid) as { players: Array<{ player_id: string; locked: Locked; species: string }> }).players.find((p) => p.player_id === pid)!);

describe('locked status', () => {
  it('names what each seat still needs, and clears as it builds', async () => {
    const s = await started(3);
    for (const pid of ['a', 'b']) {
      const me = lockedOf(s, pid);
      const species = me.species as 'wizard' | 'robot';
      const unlock = species === 'wizard' ? 'Embassy' : 'Diplomatic Research Station';
      expect(me.locked.treaties).toContain(unlock);
      expect(me.locked.battle_cards).toMatch(/^needs an? (Embassy|Defense Research Station)$/);
      expect(Object.keys(me.locked.units).length).toBeGreaterThan(0);
      for (const why of [...Object.values(me.locked.units), ...Object.values(me.locked.research)]) expect(why).toMatch(/^needs /);
      // Build every building: nothing a building unlocks stays locked.
      const g = structuredClone(s);
      const p = g.gameState.players.find((x) => x.playerId === pid)!;
      p.buildings = ['Embassy', 'Diplomatic Research Station', 'Defense Research Station', 'Combat Frame Production', 'Dragon Hoard',
        'Library of Enchantment', 'Library of Illusion', 'Library of Evocation', 'Temple'];
      const after = lockedOf(g, pid).locked;
      expect(after).toEqual({ units: {}, research: {}, treaties: null, battle_cards: null });
    }
  });
});
