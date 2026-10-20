// View-completeness locks (post-port runbook §1a; docs/view-completeness-audit.md
// 2026-08-05). Previously: the items ledger had no ids to join equipped-gear /
// ship-part id lists against; ruin party tokens dropped is_character/unnamed/
// has_attacked; space-combat modifiers and several one-shot flags were absent;
// journey legs were prose-only; the face-up travel discard was count-only.

import { describe, expect, it } from 'vitest';
import { createInitialState } from '../engine.js';
import { getView } from '../views.js';
import type { WarbleWayGalaxyState } from '../types.js';

function freshState(): WarbleWayGalaxyState {
  return createInitialState([{ player_id: 'p1', kind: 'human' }], { seed: 3 });
}

type View = Record<string, any>;

describe('warble-way-galaxy view completeness', () => {
  it('the items ledger carries ids joinable to equipped gear and ship parts', () => {
    const s = freshState();
    s.items.push({ id: 'itm-1', name: 'Blaster', type: 'gun' } as never);
    const v = getView(s) as View;
    const entry = (v.items as View[]).find((i) => i.id === 'itm-1');
    expect(entry).toBeDefined();
    expect(entry!.name).toBe('Blaster');
  });

  it('the face-up travel discard exposes contents, draw pile stays count-only', () => {
    const s = freshState();
    s.deck.discard.push('AS', '7H');
    const v = getView(s) as View;
    expect(v.travel_deck.discard).toEqual(['AS', '7H']);
    expect(typeof v.travel_deck.cards_in_draw_pile).toBe('number');
    // Draw-pile order/content must not appear.
    expect(v.travel_deck.remaining).toBeUndefined();
  });

  it('habitat one-shot flags and the bulkheads spend are visible', () => {
    const s = freshState();
    s.bulkheads_spent = true;
    const v = getView(s) as View;
    expect(v.bulkheads_spent).toBe(true);
    expect(v.habitat.docks_unnamed_roll_available).toBe(true);
    expect(v.habitat.fabrication_available_this_visit).toBe(true);
  });

  it('journey legs carry the structured kind + mission id beside the prose', () => {
    const s = freshState();
    const missionId = (getView(s) as View).habitat.missions[0].id as string;
    s.journey_stack.push({
      purpose: { kind: 'mission_outbound', mission_id: missionId },
      cards_remaining: 3,
    } as never);
    const v = getView(s) as View;
    expect(v.journey.legs[0].kind).toBe('mission_outbound');
    expect(v.journey.legs[0].mission_id).toBe(missionId);
  });

  it('space-combat exchange modifiers and one-shot spends are visible', () => {
    const s = freshState();
    s.encounter = {
      kind: 'space_combat',
      pirate_rank: '3',
      stage: 'choose_action',
      reroll_used: false,
      volley_used: true,
      pirate_debuff: 2,
      player_buff: 1,
      redline_used: true,
      survivors_rolled: false,
    } as never;
    const v = getView(s) as View;
    expect(v.space_combat.opening_volley_used).toBe(true);
    expect(v.space_combat.pirate_debuff).toBe(2);
    expect(v.space_combat.player_buff).toBe(1);
    expect(v.space_combat.redline_used).toBe(true);
    expect(v.space_combat.survivors_roll_used).toBe(false);
  });

  it('ruin party tokens expose is_character / unnamed / has_attacked and the attacker turn index', () => {
    const s = freshState();
    s.encounter = {
      kind: 'ruin_run',
      origin: { type: 'discovery', card_id: 'x' },
      target_depth: 1,
      level: 1,
      board: {
        threat_level: 1,
        start_cell: 'r1c1',
        tokens: [
          { name: 'Warble', is_character: true, cell: 'r1c1', moved: false, acted: false, ended: false },
          { name: 'Body', is_character: false, unnamed: true, cell: 'r2c2', moved: true, acted: true, ended: false, has_attacked: true },
        ],
        attackers: [],
        closed_spots: [],
        round: 2,
        attacker_turn_index: 1,
      },
    } as never;
    const v = getView(s) as View;
    const party = v.ruin.party as View[];
    expect(party[0]).toMatchObject({ is_character: true, unnamed: false, has_attacked: false });
    expect(party[1]).toMatchObject({ is_character: false, unnamed: true, has_attacked: true });
    expect(v.ruin.attacker_turn_index).toBe(1);
  });
});
