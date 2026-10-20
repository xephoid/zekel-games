// next_step structured facts: every human-owed setup step and the mid-game
// Intel report carry a human_response and facts free of loop directions.

import { describe, expect, it } from 'vitest';
import type { NextStep, PlayerConfig, SessionState } from '@zekel/game-kit';
import { lintNextStepFacts } from '@zekel/game-kit';
import { applyMove, autoReportMove } from '../engine.js';
import { getLegalMoves } from '../legalMoves.js';
import type { SweetlandsState } from '../types.js';
import { sweetlandsImperium as game } from '../index.js';

const players = (extra: PlayerConfig[] = []): PlayerConfig[] => [
  { player_id: 'h', name: 'Zeke', kind: 'human' },
  { player_id: 'b', kind: 'ai' },
  ...extra,
];

function session(cfg: PlayerConfig[], seed = 7): SessionState<SweetlandsState> {
  return game.createSession(cfg, { seed });
}
function withState(base: SessionState<SweetlandsState>, gs: SweetlandsState): SessionState<SweetlandsState> {
  return { ...base, gameState: gs, activePlayerId: gs.activePlayerId };
}
function clean(step: NextStep | null): NextStep {
  expect(step).not.toBeNull();
  expect(lintNextStepFacts(step!)).toEqual([]);
  expect(step!.human_response).toBeDefined();
  return step!;
}

describe('sweetlands-imperium next_step facts', () => {
  it('walks the setup steps and the mid-game Intel report', () => {
    const base = session(players());
    let s = base.gameState;

    const factions = clean(game.describeNextStep(base));
    expect(factions.facts?.phase).toBe('Setup');
    expect(factions.facts?.options).toContain('Arch Duchess of Milkshake');
    expect(factions.facts?.options?.length).toBe(4);
    expect(factions.facts?.notes).toContain('The Nomads are only used with 5 players.');
    expect(factions.human_response?.records_as).toMatch(/assign_setup_choices/);

    s = applyMove(s, 'h', { type: 'assign_setup_choices', selections: { h: 'milkshake', b: 'fudge' } }).newState;
    const foe = clean(game.describeNextStep(withState(base, s)));
    expect(foe.facts?.options).toEqual(['dragon (5 dice)', 'orc (3 dice)', 'fiend (2 dice)']);

    s = applyMove(s, 'h', { type: 'choose_foe', foe: 'dragon' }).newState;
    const secrets = clean(game.describeNextStep(withState(base, s)));
    expect(secrets.human_response?.private).toBe(true);
    expect(secrets.facts?.options).toHaveLength(2);
    expect(secrets.facts?.notes).toContain('The other one passes to the player on the right.');

    const secret = getLegalMoves(s, 'h').find((m) => m.move.type === 'choose_secret_objective')!.move;
    s = applyMove(s, 'h', secret).newState;
    expect(s.phase).toBe('setup_intel');
    const intel = clean(game.describeNextStep(withState(base, s)));
    expect(intel.human_response?.private).toBe(true);
    expect(intel.facts?.notes).toContain('3 Intel cards drawn from the shared deck.');
    expect(intel.facts?.reason).toBe('Zeke draws starting Intel.');

    s = applyMove(s, 'h', autoReportMove(s, 'h')!).newState;
    expect(s.phase).toBe('play');
    s = applyMove(s, 'h', { type: 'recall', units: [] }).newState;
    expect(s.pending?.kind).toBe('report_intel');
    const report = clean(game.describeNextStep(withState(base, s)));
    const count = s.pending?.kind === 'report_intel' ? s.pending.count : 0;
    expect(report.facts?.reason).toBe('Zeke gains Intel at the start of the turn.');
    expect(report.facts?.notes?.[0]).toBe(`${count} Intel ${count === 1 ? 'card' : 'cards'} drawn from the shared deck.`);
    expect(report.human_response?.private).toBe(true);

    // Built state: the same report owed for a Blue collect.
    const collect = structuredClone(s);
    if (collect.pending?.kind === 'report_intel') collect.pending.reason = 'collect';
    const collectStep = clean(game.describeNextStep(withState(base, collect)));
    expect(collectStep.facts?.reason).toBe('Zeke collects Intel from a Blue space.');
  });

  it('five players: the Nomads note says one seat must be the Nomads', () => {
    const base = session(players([{ player_id: 'c', kind: 'ai' }, { player_id: 'd', kind: 'ai' }, { player_id: 'e', kind: 'ai' }]));
    const step = clean(game.describeNextStep(base));
    expect(step.facts?.options?.length).toBe(5);
    expect(step.facts?.notes).toContain('With 5 players, one seat must be the Nomads.');
  });

  it('digital seats: starting Intel and a mid-game gain are a button press, not a secret answer', () => {
    const base = session([{ player_id: 'h', name: 'Zeke', kind: 'human', table: 'digital' }, { player_id: 'b', kind: 'ai' }]);
    let s = base.gameState;
    s = applyMove(s, 'h', { type: 'assign_setup_choices', selections: { h: 'milkshake', b: 'fudge' } }).newState;
    s = applyMove(s, 'h', { type: 'choose_foe', foe: 'orc' }).newState;
    s = applyMove(s, 'h', getLegalMoves(s, 'h').find((m) => m.move.type === 'choose_secret_objective')!.move).newState;
    const intel = clean(game.describeNextStep(withState(base, s)));
    expect(intel.human_response?.records_as).toBe('resolve_report {}');
    expect(intel.human_response?.private).toBeUndefined();
    expect(intel.facts?.notes).toContain('The server deals the cards.');

    s = applyMove(s, 'h', { type: 'resolve_report' }).newState;
    s = applyMove(s, 'h', { type: 'recall', units: [] }).newState;
    expect(s.pending?.kind).toBe('report_intel');
    const gain = clean(game.describeNextStep(withState(base, s)));
    expect(gain.human_response?.records_as).toBe('resolve_report {}');
  });
});
