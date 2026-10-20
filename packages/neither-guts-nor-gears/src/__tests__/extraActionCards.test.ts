// Designer rulings #86–#88 (2026-09-25):
//   #86 each action card type can be researched once, priced like a battle
//       strategy card; wizard Libraries / the robot Advanced Research Station
//       unlock them; the researched card is permanent (with a hero's, three);
//   #87 the Extra cards and the first bought battle strategy card count as
//       acquired types for technology without raising the target (robots 19
//       because of the new building);
//   #88 every treaty pays +2 culture a round (replaced by #112: each type pays its own amount).

import { describe, expect, it } from 'vitest';
import game from '../index.js';
import { ACTION_CARD_RESEARCH, BATTLE_CARD_TYPE_ID, ROBOT_BUILDINGS, TECH_TARGET, TREATIES, researchForSpecies } from '../data/catalogs.js';
import { hasResearchedCard, purchaseCostOf, runUpkeep, techTotal } from '../engine.js';
import type { NGGMove } from '../types.js';

const players = [{ player_id: 'a', kind: 'ai' as const }, { player_id: 'b', kind: 'ai' as const }];
function session() { return game.createSession(players, { seed: 1, aiLeaderAssignment: ['Warden Hesper Quill', 'Kestrel Nine'] }); }

/** A seat mid-Research action with Surfs on the board to pay with. */
function researching(species: 'wizard' | 'robot', buildings: string[]) {
  const s = session(); const g = s.gameState; const p = g.players[0]!;
  p.species = species; p.factionId = species === 'wizard' ? 'covenant' : 'ledger';
  p.buildings = [...buildings];
  g.phase = 'action'; g.pending = null; g.activePlayerId = 'a'; s.activePlayerId = 'a';
  g.activeAction = { ownerId: 'a', cardKind: 'research', which: 'base', slotId: 'test' } as typeof g.activeAction;
  g.units = [];
  g.tiles.forEach((t, i) => g.units.push({ id: `u-a-${i}`, typeId: 'evoker', ownerId: 'a', coord: `${t.c},${t.r}` }));
  if (species === 'wizard') {
    p.collectorsAvailable = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`surf-${i + 1}`, 1]));
  } else {
    p.collectorsAvailable = {};
    for (const [r, n] of Object.entries({ water: 3, wood: 3, ore: 3, oil: 1, ether: 1 })) for (let i = 1; i <= n; i++) p.collectorsAvailable[`${r}-collector-${i}`] = 1;
  }
  return { s, g, p };
}

describe('#86 researchable Extra action cards', () => {
  it('three per species, 1 water + 1 wood + 1 ore + the species own resource (ether / oil, ruling #128), unlocked by the printed buildings', () => {
    for (const species of ['wizard', 'robot'] as const) {
      const extras = researchForSpecies(species).filter((r) => ACTION_CARD_RESEARCH[r.id]);
      expect(extras.map((r) => r.id).sort()).toEqual(['extra-build-card', 'extra-move-battle-card', 'extra-research-card']);
      for (const r of extras) {
        expect(r.cost).toEqual(species === 'wizard' ? { water: 1, wood: 1, ore: 1, ether: 1 } : { water: 1, wood: 1, ore: 1, oil: 1 });
        expect(r.either).toBeUndefined();
      }
    }
    const w = Object.fromEntries(researchForSpecies('wizard').map((r) => [r.id, r.prerequisite]));
    expect(w['extra-move-battle-card']).toBe('Library of Evocation');
    expect(w['extra-research-card']).toBe('Library of Illusion');
    expect(w['extra-build-card']).toBe('Library of Enchantment');
    for (const r of researchForSpecies('robot').filter((r) => ACTION_CARD_RESEARCH[r.id])) expect(r.prerequisite).toBe('Advanced Research Station');
    const ars = ROBOT_BUILDINGS.find((b) => b.id === 'advanced-research-station')!;
    expect(ars.cost).toEqual({ ore: 2, wood: 1 });
  });

  it('is offered only behind its building, paying ether (ruling #128), and the purchase grants a permanent card', () => {
    const none = researching('wizard', []);
    expect(game.getLegalMoves(none.s, 'a').some((m) => m.move.type === 'research' && (m.move as { tech?: string }).tech === 'Extra Build Card')).toBe(false);
    const { s, g, p } = researching('wizard', ['Library of Enchantment']);
    const offers = game.getLegalMoves(s, 'a').filter((m) => m.move.type === 'research' && (m.move as { tech?: string }).tech === 'Extra Build Card');
    expect(offers.length).toBeGreaterThanOrEqual(1);
    const payment = (offers[0]!.move as { payment: Array<{ coord: string }> }).payment;
    expect(payment).toHaveLength(4);
    expect(purchaseCostOf(p, offers[0]!.move as { type: string })).toEqual({ cost: { water: 1, wood: 1, ore: 1, ether: 1 }, either: null });
    // A three-collector payment is refused: it cannot cover all four resources.
    expect(() => game.applyMove(s, 'a', { ...(offers[0]!.move as object), payment: payment.slice(0, 3) } as NGGMove)).toThrow(/costs/);
    expect(p.actionCards.build).toBe(1);
    const after = game.applyMove(s, 'a', offers[0]!.move).newState.gameState;
    const pa = after.players[0]!;
    expect(pa.actionCards.build).toBe(2);
    expect(hasResearchedCard(pa, 'build')).toBe(true);
    expect(pa.acquiredTypes).toContain('extra-build-card');
    expect(pa.heroExtraCards.build).toBeUndefined();
  });

  it('robots research the same three cards behind the Advanced Research Station', () => {
    const { s } = researching('robot', ['Advanced Research Station']);
    const names = new Set(game.getLegalMoves(s, 'a').filter((m) => m.move.type === 'research' && m.move.kind === 'tech').map((m) => (m.move as { tech: string }).tech));
    expect(names.has('Extra Build Card')).toBe(true);
    expect(names.has('Extra Move/Battle Card')).toBe(true);
    expect(names.has('Extra Research Card')).toBe(true);
  });

  it('planning offers the printed, hero and researched cards as three slots, each once per round; the hero card alone leaves at upkeep', () => {
    const s = session(); const g = s.gameState; const p = g.players[0]!;
    p.research.push('extra-build-card'); p.actionCards.build = 3; p.heroExtraCards.build = 'quartermaster';
    g.phase = 'planning'; g.planningOrder = ['a', 'b']; g.activePlayerId = 'a'; s.activePlayerId = 'a';
    const plans = game.getLegalMoves(s, 'a').filter((m) => m.move.type === 'plan_action' && m.move.card === 'build').map((m) => (m.move as { which?: string }).which);
    expect(plans).toEqual(['base', 'hero_extra', 'researched_extra']);
    expect(() => game.applyMove(s, 'a', { type: 'plan_action', card: 'research', which: 'researched_extra' })).toThrow(/not researched/);
    const s2 = game.applyMove(s, 'a', { type: 'plan_action', card: 'build', which: 'researched_extra' }).newState;
    expect(() => game.applyMove(s2, 'b', { type: 'plan_action', card: 'build', which: 'researched_extra' })).toThrow();
    const g2 = s2.gameState;
    expect(g2.players[0]!.actionCardsPlayed).toEqual(['build:researched_extra']);
    // The hero dies: only the hero's card is removed at upkeep; the researched one stays.
    const q = { id: 'quartermaster', ownerId: 'a', coord: null, dead: true, isLeader: false } as unknown as (typeof g2.heroes)[number];
    g2.heroes.push(q);
    runUpkeep(g2);
    expect(g2.players[0]!.actionCards.build).toBe(2);
    expect(g2.players[0]!.heroExtraCards.build).toBeUndefined();
    expect(hasResearchedCard(g2.players[0]!, 'build')).toBe(true);
  });
});

describe('#87 technology counting', () => {
  it('targets are 26 for both species (rulings #86, #90, #101-#103, #111, #121, #129); the Extra cards add their points', () => {
    expect(TECH_TARGET).toEqual({ wizard: 26, robot: 26 });
    const g = session().gameState; const p = g.players[0]!;
    p.species = 'wizard';
    p.acquiredTypes = ['surf', 'castle'];
    const before = techTotal(g, p);
    p.acquiredTypes.push('extra-build-card', 'extra-move-battle-card', 'extra-research-card');
    expect(techTotal(g, p)).toBe(before + 3);
  });

  it('the first bought battle strategy card is one acquired type; a second buy adds nothing', () => {
    const { s, g } = researching('wizard', ['Embassy']);
    const buy = game.getLegalMoves(s, 'a').find((m) => m.move.type === 'research' && m.move.kind === 'battle_card');
    expect(buy).toBeDefined();
    const before = techTotal(g, g.players[0]!);
    const after = game.applyMove(s, 'a', buy!.move).newState.gameState;
    expect(after.players[0]!.acquiredTypes).toContain(BATTLE_CARD_TYPE_ID);
    expect(techTotal(after, after.players[0]!)).toBe(before + 1);
    expect(after.players[0]!.acquiredTypes.filter((t) => t === BATTLE_CARD_TYPE_ID)).toHaveLength(1);
  });
});

describe('#88 / #92 / #96 / #112 treaty income', () => {
  it('each treaty type pays its own amount since #112 (Open Borders, Shared Resources, Peace, Culture Treaty, Shared Tactics)', () => {
    expect(TREATIES.map((t) => t.cultureIncome)).toEqual([5, 4, 3, 1, 2]);
  });
});
