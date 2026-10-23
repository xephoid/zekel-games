import { describe, expect, it } from 'vitest';
import { randomPolicy, runGame } from '@zekel/dev/verify/exec/driver';
import { sweetlands5pVerifyAdapter, sweetlandsVerifyAdapter } from '../adapter.js';

describe('sweetlands verify driver', () => {
  it('plays a full 4p random game deterministically', () => {
    const a = runGame(sweetlandsVerifyAdapter, randomPolicy, 314, 2000);
    const b = runGame(sweetlandsVerifyAdapter, randomPolicy, 314, 2000);
    expect(a.error).toBeNull();
    expect(a.moves).toBe(b.moves);
    expect(a.winners).toEqual(b.winners);
    expect(a.divergences).toEqual(b.divergences);
  });

  it('plays a 5p (Nomads) game without driver errors', () => {
    const result = runGame(sweetlands5pVerifyAdapter, randomPolicy, 2718, 2000);
    expect(result.error).toBeNull();
  });

  it('only the known stale-castle divergence appears on the clean engine', () => {
    // The castle-occupant bookkeeping bug is filed for its own fix; until it
    // lands, it is the ONE rule allowed to fire here. Anything else is new.
    const result = runGame(sweetlandsVerifyAdapter, randomPolicy, 314, 2000);
    const otherRules = new Set(
      result.divergences.map((d) => d.ruleId).filter((id) => id !== 'castle-occupant-is-a-leader-in-the-castle'),
    );
    expect([...otherRules]).toEqual([]);
  });
});
