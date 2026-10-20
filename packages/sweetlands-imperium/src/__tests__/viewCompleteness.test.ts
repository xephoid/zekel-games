// View-completeness lock (post-port runbook §1a; docs/view-completeness-audit.md
// 2026-08-05). Previously unit locations were prose-only AND ambiguous: each
// region's ring runs ROYGBP twice, so "region 2 ring (yellow)" matched two
// spaces. Views now carry the structured UnitLocation plus an indexed label.

import { describe, expect, it } from 'vitest';
import type { PlayerConfig } from '@zekel/game-kit';
import { createInitialState } from '../engine.js';
import { getPublicView } from '../views.js';

const ai = (id: string): PlayerConfig => ({ player_id: id, kind: 'ai' });

type View = Record<string, any>;

describe('sweetlands-imperium view completeness', () => {
  it('unit locations are structured (zone + region + index), not prose-only', () => {
    const s = createInitialState([ai('a'), ai('b')], { seed: 7 });
    const p = s.players.find((x) => x.playerId === 'a')!;
    p.units.knight = { zone: 'ring', region: p.homeRegion, ringIndex: 9 };
    const pub = getPublicView(s) as View;
    const seen = pub.players.find((x: View) => x.player_id === 'a');
    expect(seen.unit_locations.knight).toEqual({ zone: 'ring', region: p.homeRegion, ringIndex: 9 });
    expect(seen.unit_locations.leader).toEqual(p.units.leader);
  });

  it('the prose label carries the space index, disambiguating repeated colours', () => {
    const s = createInitialState([ai('a'), ai('b')], { seed: 7 });
    const p = s.players.find((x) => x.playerId === 'a')!;
    // Ring indices 3 and 9 are the SAME colour (two ROYGBP runs) — the label
    // must tell them apart.
    p.units.knight = { zone: 'ring', region: p.homeRegion, ringIndex: 3 };
    const label3 = ((getPublicView(s) as View).players.find((x: View) => x.player_id === 'a')).units.knight;
    p.units.knight = { zone: 'ring', region: p.homeRegion, ringIndex: 9 };
    const label9 = ((getPublicView(s) as View).players.find((x: View) => x.player_id === 'a')).units.knight;
    expect(label3).not.toBe(label9);
    expect(label3).toContain('space 3');
    expect(label9).toContain('space 9');
  });
});
