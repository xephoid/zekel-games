// The view gives each map unit its DEF now, so a table can show Metal
// Platforms (§7.10) at work outside a battle, not only the printed DEF.

import { describe, expect, it } from 'vitest';
import game from '../index.js';
import { unitById } from '../resolvers.js';
import { base2p, placeUnit } from './pendingFixtures.js';

type View = { players: Array<{ player_id: string; units: Array<{ id: string; def: number | null }> }> };

function defOf(s: ReturnType<typeof base2p>, viewer: string, unitId: string): number | null | undefined {
  const v = game.getPlayerView!(s, viewer) as View;
  return v.players.find((p) => p.player_id === 'rob')!.units.find((u) => u.id === unitId)?.def;
}

describe('a map unit carries its DEF now', () => {
  it('is the printed DEF, plus one for a robot platform once Metal Platforms is researched', () => {
    const s = base2p();
    const spinner = placeUnit(s.gameState, 'rob', '0,2', 'spinner');
    const printed = unitById('spinner')!.def!;
    expect(defOf(s, 'rob', spinner)).toBe(printed);
    s.gameState.players.find((p) => p.playerId === 'rob')!.research.push('metal-platforms');
    expect(defOf(s, 'rob', spinner)).toBe(printed + 1);
    // Public: the other seat sees the same number.
    expect(defOf(s, 'wiz', spinner)).toBe(printed + 1);
  });
});
