import { describe, expect, it } from 'vitest';
import { warbleWayGalaxy } from '../index.js';
import { ABILITY_NAMES } from '../data/abilities.js';
import type { WarbleMove } from '../types.js';

// Desync-gate lock: the client's JSON key order must never leak into state.
// The ability map's insertion order is real state — level-up options (and their
// numbered move_menu keys) enumerate it — so the same create_character spread
// declared with differently ordered keys must produce BYTE-IDENTICAL sessions.
// Caught live by the desync harness (seed 1): the assistant emitted
// { MEC, PIL, RES } where the human-sim declared { PIL, MEC, RES }, and the two
// boards' level-up menus diverged 54 turns later.
describe('create_character canonicalizes ability order', () => {
  function createWith(scores: Record<string, number>) {
    const s = warbleWayGalaxy.createSession(
      [{ player_id: 'p1', kind: 'human', name: 'Order Test' }],
      { seed: 42 },
    );
    s.sessionId = 'order-test';
    const move: WarbleMove = {
      type: 'create_character',
      character_name: 'Order Test',
      race: 'human',
      ship_name: 'Keyed Up',
      method: 'recommended',
      scores,
    } as WarbleMove;
    return warbleWayGalaxy.applyMove(s, 'p1', move).newState;
  }

  it('differently ordered score keys produce byte-identical state', () => {
    const a = createWith({ PIL: 3, MEC: 2, RES: 1 });
    const b = createWith({ MEC: 2, RES: 1, PIL: 3 });
    // Plain stringify (NOT sorted-key): insertion order must match too.
    expect(JSON.stringify(a.gameState)).toBe(JSON.stringify(b.gameState));
  });

  it('ability keys land in the canonical printed order', () => {
    const s = createWith({ RES: 1, PIL: 3, MEC: 2 });
    const canonical = Object.keys(ABILITY_NAMES);
    const keys = Object.keys(s.gameState.character!.abilities);
    const sorted = [...keys].sort((x, y) => canonical.indexOf(x) - canonical.indexOf(y));
    expect(keys).toEqual(sorted);
  });
});
