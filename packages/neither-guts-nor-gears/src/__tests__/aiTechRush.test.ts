// The wizard tech rush the designer beat the hard AI with (docs/Neither Guts
// nor Gears beating the hard AI.md, 2026-10-07): Dowser as Leader for seven
// Surfs, Haste so each Surf makes two, Greymore at a milestone for +5 tech.
// The AI's economy model was blind to all three, so it never drafted Dowser,
// never bought Haste, and could not see a rival's rush coming.

import { describe, expect, it } from 'vitest';
import { neitherGutsNorGears as game } from '../index.js';
import { aiPickLeaderId } from '../ai.js';
import { applyBuy, cloneEcon, econFromState, etaOf, etaWithPlan, itemById } from '../ai-econ.js';
import type { NGGState } from '../types.js';

function wizardSeat() {
  const s = game.createSession([{ player_id: 'p1', kind: 'ai' }, { player_id: 'p2', kind: 'ai' }, { player_id: 'p3', kind: 'ai' }, { player_id: 'p4', kind: 'ai' }],
    { seed: 1, factionAssignment: ['covenant', 'schism', 'ledger', 'foundry'], aiLeaderAssignment: ['chronicler', 'foreman', 'envoy', 'quartermaster'] } as never);
  const g = s.gameState as NGGState;
  return { g, p: g.players.find((x) => x.playerId === 'p1')! };
}

describe('the wizard tech rush, as the AI sees it', () => {
  it('Haste makes a wizard finish sooner (each Surf makes two; the bank carries leftovers)', () => {
    const { g, p } = wizardSeat();
    const e = econFromState(g, p);
    e.buildings.add('Library of Enchantment');
    // Against Dehance — same Library, also one tech type, no economic
    // effect — on the same buying plan (greedy, no saving up), so only what
    // each research does to the economy differs. Before the fix the model
    // counted Haste as just one more type, the same as Dehance.
    const withHaste = cloneEcon(e); applyBuy(withHaste, itemById('wizard', 'haste')!);
    const withDehance = cloneEcon(e); applyBuy(withDehance, itemById('wizard', 'dehance')!);
    expect(etaWithPlan(withDehance, 'technological', null) - etaWithPlan(withHaste, 'technological', null)).toBeGreaterThan(0.5);
  });

  it('a wizard values Dowser as Leader for her four free Surfs', () => {
    const { g, p } = wizardSeat();
    expect(aiPickLeaderId(g, p, ['marshal', 'warden', 'wren'])).toBe('wren');
  });

  it('milestone heroes count: a free Greymore brings the tech finish closer', () => {
    const { g, p } = wizardSeat();
    const e = econFromState(g, p);
    expect(e.heroPool).toContain('greymore');
    const without = cloneEcon(e);
    without.heroPool = [];
    expect(etaOf(e, 'technological')).toBeLessThan(etaOf(without, 'technological') - 0.5);
  });

  it('a tech-rushing rival with Dowser and Haste reads as fast', () => {
    const { g, p } = wizardSeat();
    const plain = econFromState(g, p);
    const rush = cloneEcon(plain);
    for (let i = 0; i < 4; i++) applyBuy(rush, itemById('wizard', 'surf')!);
    rush.buildings.add('Library of Enchantment');
    applyBuy(rush, itemById('wizard', 'haste')!);
    expect(etaOf(rush, 'technological')).toBeLessThan(etaOf(plain, 'technological') - 1);
  });
});
