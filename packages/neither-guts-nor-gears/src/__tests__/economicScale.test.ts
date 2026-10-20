// Experimental dial (2026-09-25): `economicCollectors` scales the Economic
// spend (and the collector supply with it) so the designer can test a spend
// that grows with the map. Absent, the printed rule — eleven — is untouched.

import { describe, expect, it } from 'vitest';
import game from '../index.js';
import { ECONOMIC_COLLECTORS_NEEDED, ECONOMIC_SPEND } from '../data/catalogs.js';
import { findPayment } from '../engine.js';
import { nggMoveGates } from '../moveGates.js';
import { unavailableMoves } from '@zekel/game-kit';
import type { NGGMove } from '../types.js';
import type { LegalMove } from '@zekel/game-kit';
import { collectorCapFor, coreSupplyFor, economicCollectorsFor, economicCollectorsNeeded, economicExtraAny, robotCollectorCaps } from '../economicScale.js';

const players = [{ player_id: 'a', kind: 'ai' as const }, { player_id: 'b', kind: 'ai' as const }];
const leaders = ['Warden Hesper Quill', 'Kestrel Nine'];
function session(economicCollectors?: number) {
  return game.createSession(players, { seed: 1, aiLeaderAssignment: leaders, ...(economicCollectors ? { economicCollectors } : {}) });
}
const SURF = { id: 'surf', collector: true, collectorResource: null, maxPerPlayer: 11 } as const;

describe('economic spend dial', () => {
  it('absent, the spend is the map\'s count (rulings #89, #91, #120, #133): 12 / 16 / 26; robot caps follow the map\'s tiles (#116)', () => {
    const g = session().gameState;
    expect(g.economicCollectors).toBeUndefined();
    expect(economicCollectorsNeeded(g)).toBe(12);
    expect(coreSupplyFor(g)).toBe(16);
    expect(g.players[0]!.coresInSupply).toBe(16);
    expect(collectorCapFor(g, SURF)).toBe(12);
    // Ruling #116: one water/wood/ore collector per tile of it; 4 oil, 2 ether everywhere.
    expect(robotCollectorCaps(g)).toEqual({ water: 7, wood: 6, ore: 7, oil: 4, ether: 2 }); // 2p map: 7 water / 6 wood / 7 ore
    expect(economicCollectorsFor('threeFour')).toBe(16); // ruling #133 (20 under #120)
    expect(economicCollectorsFor('fiveSix')).toBe(26);
    expect(robotCollectorCaps({ layout: 'threeFour' })).toEqual({ water: 10, wood: 8, ore: 7, oil: 4, ether: 2 });
    expect(coreSupplyFor({ layout: 'threeFour' })).toBe(20);
    expect(robotCollectorCaps({ layout: 'fiveSix' })).toEqual({ water: 21, wood: 19, ore: 8, oil: 4, ether: 2 });
    expect(coreSupplyFor({ layout: 'fiveSix' })).toBe(30);
    // The printed eleven is still the floor an override may set.
    expect(economicCollectorsNeeded({ layout: 'fiveSix', economicCollectors: ECONOMIC_COLLECTORS_NEEDED })).toBe(11);
    // On every map a robot can own more collectors than the spend needs.
    for (const layout of ['two', 'threeFour', 'fiveSix'] as const) {
      const total = Object.values(robotCollectorCaps({ layout })).reduce((x, y) => x + y, 0);
      expect(total).toBeGreaterThan(economicCollectorsFor(layout));
    }
  });

  it('rejects a dial below the printed eleven', () => {
    expect(() => session(10)).toThrow(/economicCollectors/);
  });

  it('the Surf cap and the Core supply grow with the dial; robot caps stay on the map\'s tiles', () => {
    const g = session(16).gameState;
    expect(g.economicCollectors).toBe(16);
    expect(g.players[0]!.coresInSupply).toBe(20);
    expect(collectorCapFor(g, SURF)).toBe(16);
    expect(robotCollectorCaps(g)).toEqual({ water: 7, wood: 6, ore: 7, oil: 4, ether: 2 });
    const view = game.getPublicView(session(16)) as { players: Array<{ economic_collectors: number }> };
    expect(view.players[0]!.economic_collectors).toBe(16);
  });

  it('the spend offer and the spend itself need the dialled number of tiles', () => {
    const s = session(16); const g = s.gameState; const p = g.players[0]!;
    p.species = 'wizard'; p.factionId = 'covenant';
    g.phase = 'action'; g.pending = null; g.activePlayerId = 'a'; s.activePlayerId = 'a';
    g.activeAction = { ownerId: 'a', cardKind: 'build', which: 'base', slotId: 'test' } as typeof g.activeAction;
    g.units = [];
    // Sixteen Surfs, and an anchor on every tile so any sixteen can be reached.
    p.collectorsAvailable = Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`surf-${i + 1}`, 1]));
    g.tiles.forEach((t, i) => g.units.push({ id: `u-a-${i}`, typeId: 'evoker', ownerId: 'a', coord: `${t.c},${t.r}` }));
    const offer = game.getLegalMoves(s, 'a').find((m) => m.move.type === 'economic_victory_spend');
    expect(offer).toBeDefined();
    const payment = (offer!.move as { payment: Array<{ coord: string }> }).payment;
    expect(payment).toHaveLength(16);
    expect(new Set(payment.map((x) => x.coord)).size).toBe(16);
    // Eleven collectors — the printed spend — is refused under the dial.
    expect(() => game.applyMove(s, 'a', { type: 'economic_victory_spend', payment: payment.slice(0, 11) } as never)).toThrow(/exactly 16/);
    const end = game.applyMove(s, 'a', offer!.move).newState;
    expect(end.gameState.result?.summary).toBe('a wins (Economic)');
  });

  it('findPayment adds extra any-resource placements beyond the cost', () => {
    const s = session(16); const g = s.gameState; const p = g.players[0]!;
    p.species = 'wizard'; p.factionId = 'covenant';
    g.phase = 'action'; g.units = [];
    p.collectorsAvailable = Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`surf-${i + 1}`, 1]));
    g.tiles.forEach((t, i) => g.units.push({ id: `u-a-${i}`, typeId: 'evoker', ownerId: 'a', coord: `${t.c},${t.r}` }));
    expect(findPayment(g, p, ECONOMIC_SPEND)).toHaveLength(11); // the mix alone: eleven resources
    expect(findPayment(g, p, ECONOMIC_SPEND, [], 3000, 5)).toHaveLength(16);
    // More than the seat owns: no payment.
    expect(findPayment(g, p, ECONOMIC_SPEND, [], 3000, 6)).toBeNull();
  });
});

// Playtest bug 2026-10-01: a Haste wizard with 20 Surfs on a mostly clear
// 3–4 player board was never offered the Economic spend, and nothing said
// why. With Haste each Surf makes two, so the payment finder covered the mix
// with 8 Surfs + 4 extras = 12, the offer (which needs all 15) dropped it, and
// the "why not" note only checked the mix, found it reachable, and stayed
// silent.
describe('Economic spend with Haste, and the why-not note', () => {
  function clearBoard4p() {
    const players = ['a', 'b', 'c', 'd'].map((id) => ({ player_id: id, kind: 'ai' as const }));
    const s = game.createSession(players, { seed: 1, aiLeaderAssignment: ['Warden Hesper Quill', 'Kestrel Nine', 'Dowser Wren Calloway', 'Marshal Corvin Ashlock'] });
    const g = s.gameState; const p = g.players[0]!;
    p.species = 'wizard'; p.factionId = 'covenant';
    g.phase = 'action'; g.pending = null; g.activePlayerId = 'a'; s.activePlayerId = 'a';
    g.activeAction = { ownerId: 'a', cardKind: 'build', which: 'base', slotId: 'test' } as typeof g.activeAction;
    // Mostly clear: only a's starting base and its Leader on the map.
    g.bases = g.bases.filter((b) => b.ownerId === 'a');
    g.units = [];
    for (const h of g.heroes) if (h.ownerId !== 'a') h.coord = null;
    p.collectorsAvailable = Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`surf-${i + 1}`, 1]));
    return s;
  }
  const greysFor = (s: ReturnType<typeof clearBoard4p>) => {
    const legal = game.getLegalMoves(s, 'a') as Array<LegalMove<NGGMove>>;
    return unavailableMoves(nggMoveGates(s.gameState, 'a', legal), legal);
  };

  it('a Haste wizard is offered the spend with all 16 Surfs, and it wins', () => {
    const s = clearBoard4p();
    s.gameState.players[0]!.research.push('haste');
    const offer = game.getLegalMoves(s, 'a').find((m) => m.move.type === 'economic_victory_spend');
    expect(offer).toBeDefined();
    const payment = (offer!.move as { payment: Array<{ coord: string }> }).payment;
    expect(payment).toHaveLength(16);
    expect(new Set(payment.map((x) => x.coord)).size).toBe(16);
    expect(game.applyMove(s, 'a', offer!.move).newState.gameState.result?.summary).toBe('a wins (Economic)');
  });

  it('when the mix is reachable but 16 separate tiles are not, the note says so', () => {
    const s = clearBoard4p(); const g = s.gameState; const p = g.players[0]!;
    // Block tiles with another seat's collectors, farthest-first, keeping the
    // mix reachable, until 16 separate tiles no longer are.
    const tiles = g.tiles.map((t) => `${t.c},${t.r}`).reverse();
    for (const coord of tiles) {
      if (!findPayment(g, p, ECONOMIC_SPEND, [], 3000, economicExtraAny(g), true)) break;
      g.placements.push({ collectorId: `surf-x-${coord}`, ownerId: 'b', coord, resource: 'water', authorizedBy: null });
      if (!findPayment(g, p, ECONOMIC_SPEND)) g.placements.pop();
    }
    expect(findPayment(g, p, ECONOMIC_SPEND)).not.toBeNull();
    expect(game.getLegalMoves(s, 'a').some((m) => m.move.type === 'economic_victory_spend')).toBe(false);
    expect(greysFor(s)).toContainEqual(expect.objectContaining({ move_type: 'economic_victory_spend', reason: expect.stringMatching(/not 16 separate tiles/) }));
  });

  it('whenever the spend is not offered on a Build, the note gives a reason', () => {
    const s = clearBoard4p();
    s.gameState.players[0]!.collectorsAvailable = { 'surf-1': 1, 'surf-2': 1, 'surf-3': 1 };
    expect(greysFor(s)).toContainEqual(expect.objectContaining({ move_type: 'economic_victory_spend', reason: expect.stringMatching(/needs 16 free collectors .* you have 3/) }));
  });
});
