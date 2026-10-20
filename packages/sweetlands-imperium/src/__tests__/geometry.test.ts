import { describe, it, expect } from 'vitest';
import {
  step, advanceToColor, colorOf, hasJunctionChoice, sameLocation,
  ringDistance, intelGainForDistance, influenceGainForDistance,
} from '../geometry.js';
import type { UnitLocation } from '../types.js';

const ring = (region: 1 | 2 | 3 | 4, ringIndex: number): UnitLocation => ({ zone: 'ring', region, ringIndex });

describe('movement geometry', () => {
  it('the ring is one 48-node CCW cycle (no road branch)', () => {
    let cur: UnitLocation = ring(1, 0);
    const seen = new Set<string>();
    for (let i = 0; i < 48; i++) {
      expect(cur.zone).toBe('ring');
      if (cur.zone === 'ring') seen.add(`${cur.region}:${cur.ringIndex}`);
      cur = step(cur, false)!;
    }
    expect(seen.size).toBe(48);
    expect(sameLocation(cur, ring(1, 0))).toBe(true); // closed the loop
  });

  it('region order around the ring is 1 -> 2 -> 3 -> 4 -> 1', () => {
    // step off region 1's exit (index 11) lands on region 2's entry
    expect(step(ring(1, 11), false)).toEqual(ring(2, 0));
    expect(step(ring(2, 11), false)).toEqual(ring(3, 0));
    expect(step(ring(3, 11), false)).toEqual(ring(4, 0));
    expect(step(ring(4, 11), false)).toEqual(ring(1, 0));
  });

  it('jump-to-next-color advances to the next matching space', () => {
    // ring index colors follow ROYGBP: 0=red,1=orange,...,5=purple,6=red,...
    expect(advanceToColor(ring(1, 0), 'orange', false)).toEqual(ring(1, 1));
    expect(advanceToColor(ring(1, 0), 'red', false)).toEqual(ring(1, 6)); // next red
    expect(advanceToColor(ring(1, 0), 'purple', false)).toEqual(ring(1, 5)); // junction purple
  });

  it('a unit at/through the junction can branch onto the road', () => {
    // from index 4 (blue), the next red is ring index 6 (ring) or road index 0 (road)
    expect(advanceToColor(ring(1, 4), 'red', false)).toEqual(ring(1, 6));
    expect(advanceToColor(ring(1, 4), 'red', true)).toEqual({ zone: 'road', region: 1, roadIndex: 0 });
    expect(hasJunctionChoice(ring(1, 4), 'red')).toBe(true);
  });

  it('no junction choice when the next color is reached before the junction', () => {
    expect(hasJunctionChoice(ring(1, 0), 'orange')).toBe(false);
  });

  it('the road leads to the castle and stops there', () => {
    const road5: UnitLocation = { zone: 'road', region: 1, roadIndex: 5 };
    expect(colorOf(road5)).toBe('purple');
    expect(step(road5, false)).toEqual({ zone: 'castle' });
    expect(step({ zone: 'castle' }, false)).toBeNull(); // dead end
  });

  it('a unit leaves a treat side-node by rejoining the ring', () => {
    const t: UnitLocation = { zone: 'treat', region: 2, slotKind: 'random' };
    expect(step(t, false)).toEqual(ring(2, 9));
  });

  it('region distance + gain tables', () => {
    expect(ringDistance(1, 1)).toBe(0);
    expect(ringDistance(1, 2)).toBe(1);
    expect(ringDistance(1, 4)).toBe(3);
    expect(ringDistance(4, 1)).toBe(1);
    expect([0, 1, 2, 3].map(intelGainForDistance)).toEqual([1, 2, 3, 2]);
    expect([0, 1, 2, 3].map(influenceGainForDistance)).toEqual([0, 1, 2, 3]);
  });
});
