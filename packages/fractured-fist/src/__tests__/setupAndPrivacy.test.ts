// The engine-wide zekel Live hooks, adopted by Fractured Fist:
//   - getPhysicalSetup: ordered, one action per step, this session's numbers
//   - getSessionContext: persona + rules context, no loop directions
//   - privateReveals: a digital human's drawn cards go to their screen only,
//     never into the spoken summary
//   - next_step facts pass the shared checker

import { describe, expect, it } from 'vitest';
import type { PlayerConfig } from '@zekel/game-kit';
import { lintNextStepFacts } from '@zekel/game-kit';
import { fracturedFist as g } from '../index.js';

const PHYSICAL: PlayerConfig[] = [
  { player_id: 'p1', kind: 'human', name: 'Zeke' },
  { player_id: 'p2', kind: 'ai' },
];
const DIGITAL: PlayerConfig[] = [
  { player_id: 'p1', kind: 'human', name: 'Zeke', table: 'digital' },
  { player_id: 'p2', kind: 'ai' },
];

describe('physical setup steps', () => {
  it('lists one physical action per step with this session’s numbers', () => {
    const s = g.createSession(PHYSICAL, { seed: 1, startingStamina: 9, handSize: 4 });
    const steps = g.getPhysicalSetup!(s);
    const text = steps.map((x) => x.text);
    expect(steps.every((x) => x.kind === 'action')).toBe(true);
    expect(text).toContain('Shuffle your starting deck.');
    expect(text).toContain('Draw 4 cards for your opening hand.');
    expect(text).toContain('Set your stamina to 9.');
    expect(text).toContain("Set the AI's stamina to 9. The server keeps the AI's cards, so do not lay them out.");
    expect(text[text.length - 1]).toBe('Zeke takes the first turn.');
    expect(text[0]).toMatch(/^Find the technique cards for this game: Attack, Block, Assess/);
    for (const t of text) expect(t).not.toMatch(/_|get_state|apply_move/);
  });

  it('a digital human lays out nothing', () => {
    const s = g.createSession(DIGITAL, { seed: 1 });
    const text = g.getPhysicalSetup!(s).map((x) => x.text);
    expect(text.some((t) => t.includes('Shuffle'))).toBe(false);
  });
});

describe('session context for orchestrated clients', () => {
  it('has persona and rules, and no loop directions', () => {
    const ctx = g.getSessionContext!('physical');
    expect(ctx.persona).toMatch(/bookkeeper/);
    expect(ctx.rules_context).toMatch(/stamina to 0/);
    expect(JSON.stringify(ctx)).not.toMatch(/run_ai_turn|apply_move|REPORT|next_step/);
  });
});

describe('private reveals', () => {
  it("a digital human's new hand goes to them privately and is not spoken", () => {
    const s = g.createSession(DIGITAL, { seed: 2 });
    const r = g.applyMove(s, 'p1', { type: 'end_turn' });
    expect(r.privateReveals).toHaveLength(1);
    expect(r.privateReveals![0]!.player_id).toBe('p1');
    expect(r.privateReveals![0]!.text).toMatch(/^You drew .+\.$/);
    const hand = (r.newState.gameState.players.p1 as { hand: string[] }).hand;
    expect(hand).toHaveLength(5);
    // The spoken summary says how many, never which.
    expect(r.summary).toContain('draws 5 new cards');
    expect(r.summary).not.toMatch(/Focus|Misstep/);
  });

  it('a physical human and the AI reveal nothing', () => {
    const s = g.createSession(PHYSICAL, { seed: 2 });
    const r1 = g.applyMove(s, 'p1', { type: 'end_turn' });
    expect(r1.privateReveals).toBeUndefined();
  });
});

describe('next_step facts', () => {
  it('every human step passes the facts checker and carries a phase', () => {
    let s = g.createSession(PHYSICAL, { seed: 7 });
    const phases: string[] = [];
    const check = () => {
      const step = g.describeNextStep!(s)!;
      expect(lintNextStepFacts(step)).toEqual([]);
      phases.push(step.facts!.phase!);
    };
    check();
    s = g.applyMove(s, 'p1', { type: 'play_card', card_id: 'Assess' }).newState;
    check();
    s = g.applyMove(s, 'p1', { type: 'skip_refine' }).newState;
    check();
    s = g.applyMove(s, 'p1', { type: 'advance_phase' }).newState;
    check();
    expect(phases).toEqual(['Technique phase', 'Refine', 'Technique phase', 'Channel phase']);
  });
});
