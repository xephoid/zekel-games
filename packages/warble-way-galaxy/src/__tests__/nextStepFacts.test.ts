// Locks the structured facts on describeNextStep: every fact the prose
// instruction carries is also in `facts` (orchestrated clients never see the
// prose), and the facts text passes lintNextStepFacts.

import { describe, expect, it } from 'vitest';
import type { NextStep, PlayerConfig, SessionState } from '@zekel/game-kit';
import { lintNextStepFacts } from '@zekel/game-kit';
import { applyMove } from '../engine.js';
import { warbleWayGalaxy as game } from '../index.js';
import type { WarbleWayGalaxyState } from '../types.js';

const PHYSICAL: PlayerConfig[] = [{ player_id: 'p1', kind: 'human', name: 'Zeke' }];
const DIGITAL: PlayerConfig[] = [{ player_id: 'p1', kind: 'human', name: 'Zeke', table: 'digital' }];

function created(players: PlayerConfig[]): SessionState<WarbleWayGalaxyState> {
  const s = game.createSession(players, { seed: 7 });
  const gs = applyMove(s.gameState, {
    type: 'create_character', character_name: 'Zara', race: 'human', ship_name: 'Wandering Star',
    method: 'recommended', scores: { PIL: 3, MEC: 2, HAK: 1 },
  }).newState;
  return { ...s, gameState: gs };
}

function withPending(pending: unknown, encounter: unknown = null, players = PHYSICAL): NextStep {
  const s = created(players);
  const gs = { ...s.gameState, pending, encounter } as unknown as WarbleWayGalaxyState;
  return game.describeNextStep!({ ...s, gameState: gs })!;
}

function clean(step: NextStep): string {
  expect(step.facts).toBeDefined();
  expect(lintNextStepFacts(step)).toEqual([]);
  expect(step.human_response?.private).toBeUndefined();
  return [step.facts?.phase, step.facts?.reason, ...(step.facts?.options ?? []), ...(step.facts?.notes ?? [])].join(' | ');
}

const roll = {
  kind: 'roll', reason: 'hazard_check', dice_count: 3,
  score_source: { who: 'crew', crew_name: 'Kralkin (DIP+2)', ability: 'DIP', bonus: 2 },
  min_roll: 10, declared_items: [], context: {},
};

describe('warble-way-galaxy next_step facts', () => {
  it('creation: races, score rules, archetype difficulties', () => {
    const st = game.describeNextStep!(game.createSession(PHYSICAL, { seed: 7 }))!;
    const t = clean(st);
    expect(t).toContain('human, kralkin, hexapod, grull');
    expect(t).toContain('at most 3 in any one ability');
    expect(t).toContain('Ghost Smuggler (Easy ★)');
  });

  it('roll, physical and digital: target, ability, whose score, item before the roll', () => {
    const t = clean(withPending(roll));
    expect(t).toContain('3d6.');
    expect(t).toContain('It needs 10 or more.');
    expect(t).toContain("DIP (Diplomacy) +2, from Kralkin (DIP+2)'s score");
    expect(t).toContain('declared before the roll');
    expect(clean(withPending(roll, null, DIGITAL))).toContain('The server rolls the dice.');
  });

  it('level up, release crew, card draw, research peek', () => {
    expect(clean(withPending({ kind: 'level_up' }))).toContain('already be at least 1');
    expect(clean(withPending({ kind: 'release_crew' }))).toContain('takes their equipped gear');
    expect(clean(withPending({ kind: 'card_draw' }))).toContain('"7S"');
    expect(clean(withPending({ kind: 'card_draw' }, null, DIGITAL))).toContain('tracked deck');
    const peek = clean(withPending({ kind: 'res_discard', peek_count: 2 }));
    expect(peek).toContain('top 2 card(s)');
    expect(peek).toContain('same order');
    expect(clean(withPending({ kind: 'res_discard', peek_count: 2 }, null, DIGITAL))).toContain('revealed on screen');
  });

  it('hazard, mission, recruit, sacrifice', () => {
    const h = clean(withPending({ kind: 'hazard_option', card_id: 'x', must_fail: false }));
    expect(h).toContain('carrier takes the consequence');
    expect(h).toContain('Brawn');
    expect(h).toContain('best score aboard');
    expect(clean(withPending({ kind: 'hazard_option', card_id: 'x', must_fail: true }))).toContain('which option to fail');
    expect(clean(withPending({ kind: 'space_mission_offer', card_id: 'x' }))).toContain('stacks on top');
    expect(clean(withPending({ kind: 'space_recruit_offer', card_id: 'x' }))).toContain('a roll follows');
    expect(clean(withPending({ kind: 'sacrifice_offer', hazard_card_id: 'x', hazard_option: 1, carrier_who: 'self' }))).toContain(
      'counts as survived',
    );
  });

  it('ruins: setup, party turn, continue', () => {
    const setup = clean(withPending({ kind: 'ruin_setup', level: 2, depth_target: 3 }));
    expect(setup).toContain('map R2');
    expect(setup).toContain('1 is recommended');
    const turn = clean(withPending({ kind: 'ruin_turn' }));
    expect(turn).toContain('r5c3');
    expect(turn).toContain('goal G ends');
    const cont = clean(withPending({ kind: 'ruin_continue', next_level: 2, is_mission: true }));
    expect(cont).toContain('level 2');
    expect(cont).toContain('abandons it');
  });

  it('space combat, loss reroll, evade, boarding', () => {
    const combat = clean(withPending({ kind: 'space_combat_action' }, { kind: 'space_combat', stage: 'choose_action' }));
    expect(combat).toContain('Hack needs HAK');
    expect(combat).toContain('Redline needs MEC and works once per encounter');
    const reroll = clean(withPending({ kind: 'space_combat_action' }, { kind: 'space_combat', stage: 'loss_reroll_offer' }));
    expect(reroll).toContain('once per combat');
    expect(clean(withPending({ kind: 'evade_offer', card_id: 'x' }))).toContain("3d6 plus SNE against 10 plus the pirate's speed");
    expect(clean(withPending({ kind: 'boarding_decision', stage: 'board_or_leave' }))).toContain('ground-combat roll');
    expect(clean(withPending({ kind: 'boarding_decision', stage: 'take_or_abandon' }))).toContain('arrives Hobbled');
  });
});
