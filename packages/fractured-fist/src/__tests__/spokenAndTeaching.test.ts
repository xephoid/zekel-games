// Locks for the zekel Live work (docs/spoken-narration.md, docs/rules-teaching.md):
//   1. SPOKEN TEXT — every move summary uses display names (never a raw seat id),
//      printed card names, no abbreviations; the AI's narration IS its summary.
//   2. PRINTED NAMES — card_id accepts the name printed on the card.
//   3. RULES TEACHING — every move type has a rules section; the gates agree
//      with getLegalMoves across real play, and quote live values.
//   4. NEXT STEP — every human step carries a spoken question; AI steps defer.
//   5. OFFERED MOVES ARE ACCEPTED — every offered move applies without error,
//      for a physical (opaque) human seat as well as a server-tracked one.

import { describe, expect, it } from 'vitest';
import type { PlayerConfig, SessionState } from '@zekel/game-kit';
import { checkGateConsistency, unavailableMoves } from '@zekel/game-kit';
import { duplicateSectionIds, renderRulesText, validateSectionCoverage } from '@zekel/game-kit';
import { fracturedFist as g } from '../index.js';
import { resolveCardId } from '../cards.js';
import { FF_RULE_SECTIONS } from '../rulesSections.js';
import { randomInt } from '@zekel/game-kit';
import type { FFState } from '../types.js';

const HUMAN_VS_AI: PlayerConfig[] = [
  { player_id: 'p1', kind: 'human', name: 'Zeke' },
  { player_id: 'p2', kind: 'ai' },
];

function start(players = HUMAN_VS_AI, seed = 7): SessionState<FFState> {
  return g.createSession(players, { seed });
}

function schemaMoveTypes(): string[] {
  const oneOf = (g.moveSchema as { oneOf: Array<{ properties: { type: { const: string } } }> }).oneOf;
  return oneOf.map((v) => v.properties.type.const);
}

// Plays random offered moves for every seat; calls `visit` before each move.
// Throws if any offered move is refused — the "offered moves are accepted" lock.
function playRandom(
  s: SessionState<FFState>,
  seed: number,
  visit: (s: SessionState<FFState>, pid: string) => void,
  maxMoves = 400,
): SessionState<FFState> {
  let rng = seed;
  for (let i = 0; i < maxMoves && s.gameState.phase !== 'game_over'; i++) {
    const pid = s.gameState.activePlayerId;
    visit(s, pid);
    const legal = g.getLegalMoves(s, pid);
    expect(legal.length).toBeGreaterThan(0);
    const r = randomInt(rng, legal.length);
    rng = r.nextSeed;
    s = g.applyMove(s, pid, legal[r.value]!.move).newState;
  }
  return s;
}

describe('spoken text', () => {
  it('names seats by display name and never says a raw seat id', () => {
    let s = start();
    const lines: string[] = [];
    let rng = 11;
    for (let i = 0; i < 300 && s.gameState.phase !== 'game_over'; i++) {
      const pid = s.gameState.activePlayerId;
      const legal = g.getLegalMoves(s, pid);
      const r = randomInt(rng, legal.length);
      rng = r.nextSeed;
      const res = g.applyMove(s, pid, legal[r.value]!.move);
      lines.push(res.summary);
      s = res.newState;
    }
    expect(lines.length).toBeGreaterThan(20);
    for (const line of lines) {
      expect(line).not.toMatch(/\bp[12]\b/);
      expect(line).not.toMatch(/\b(dmg|def)\b/);
      expect(line).not.toMatch(/_/); // no internal card ids
      expect(line).toMatch(/^(Zeke|The AI|Round) /);
      expect(line.trim().endsWith('.')).toBe(true);
    }
    expect(lines.some((l) => l.includes('strike'))).toBe(true);
  });

  it('a play reads as the physical action, with the card name as printed', () => {
    const s = start();
    const r = g.applyMove(s, 'p1', { type: 'play_card', card_id: 'Attack' });
    expect(r.summary).toBe('Zeke plays Attack: 1 damage queued.');
  });

  it('sending Missteps tells the table where to put them', () => {
    const s = start();
    const r = g.applyMove(s, 'p1', { type: 'play_card', card_id: 'distract' });
    expect(r.summary).toBe(
      "Zeke plays Distract: sends 2 Missteps to the AI. Put 2 Misstep cards in the AI's discard pile.",
    );
  });

  it('the AI narration is exactly its move summary', async () => {
    let s = start();
    s = g.applyMove(s, 'p1', { type: 'end_turn' }).newState;
    for (let i = 0; i < 30 && s.gameState.activePlayerId === 'p2' && s.gameState.phase !== 'game_over'; i++) {
      const pick = await g.getAIMove(s, 'p2', 'medium');
      const res = g.applyMove(s, 'p2', pick.move);
      expect(pick.narration).toBe(res.summary);
      // A person copying the AI's turn knows the card, never its hidden hand slot.
      expect(pick.move).not.toHaveProperty('hand_index');
      s = res.newState;
    }
  });

  it('the MCTS tier does not speak its search details', async () => {
    const all: PlayerConfig[] = [
      { player_id: 'p1', kind: 'ai' },
      { player_id: 'p2', kind: 'ai' },
    ];
    const ai = g.createSession(all, { seed: 3 });
    process.env.MCTS_BUDGET_MS = '20';
    try {
      const pick = await g.getAIMove(ai, 'p1', 'mcts');
      expect(pick.narration).not.toMatch(/sims|simulation|mcts/i);
      expect(pick.narration).toMatch(/^AI 1 /);
    } finally {
      delete process.env.MCTS_BUDGET_MS;
    }
  });
});

describe('printed card names', () => {
  it('resolves ids, printed names, and older names', () => {
    expect(resolveCardId('Devastating Blow')).toBe('devastating_blow');
    expect(resolveCardId("master's riposte")).toBe('masters_riposte');
    expect(resolveCardId('Read Opponent')).toBe('reading_the_opponent');
    expect(resolveCardId('Reading the Opponent')).toBe('reading_the_opponent');
    expect(resolveCardId('jab')).toBe('attack');
    expect(resolveCardId('focus')).toBe('focus');
    expect(resolveCardId('Counter Strike')).toBeUndefined();
  });

  it('an unknown name is refused with the accepted forms', () => {
    expect(() => g.applyMove(start(), 'p1', { type: 'play_card', card_id: 'Counter Strike' })).toThrow(
      /name printed on the card/,
    );
  });
});

describe('rules teaching', () => {
  it('every move type is governed by a rules section, ids unique, blob derived', () => {
    expect(validateSectionCoverage(FF_RULE_SECTIONS, schemaMoveTypes())).toEqual([]);
    expect(duplicateSectionIds(FF_RULE_SECTIONS)).toEqual([]);
    expect(g.getRulesText()).toBe(renderRulesText(FF_RULE_SECTIONS));
  });

  it('gates agree with getLegalMoves across real play (physical and tracked humans)', () => {
    const seats: PlayerConfig[][] = [
      HUMAN_VS_AI,
      [
        { player_id: 'p1', kind: 'human', name: 'Zeke', table: 'digital' },
        { player_id: 'p2', kind: 'ai' },
      ],
    ];
    for (const players of seats) {
      for (const seed of [1, 2, 3, 4, 5]) {
        playRandom(start(players, seed), seed * 97, (s) => {
          for (const pid of ['p1', 'p2']) {
            const problems = checkGateConsistency(g.describeMoveGates!(s, pid), g.getLegalMoves(s, pid));
            expect(problems).toEqual([]);
          }
        });
      }
    }
  });

  it('an out-of-actions technique phase greys play_card with the live count', () => {
    let s = start();
    s = g.applyMove(s, 'p1', { type: 'play_card', card_id: 'attack' }).newState;
    const grey = unavailableMoves(g.describeMoveGates!(s, 'p1'), g.getLegalMoves(s, 'p1'));
    const play = grey.find((x) => x.move_type === 'play_card')!;
    expect(play.reason).toContain('you have 0 actions left');
    expect(play.rules_section).toBe('technique-phase');
    const buy = grey.find((x) => x.move_type === 'buy_card')!;
    expect(buy.reason).toContain('Channel phase');
  });

  it('Focus reload is greyed with both stamina values when not behind', () => {
    const s = start();
    const reload = unavailableMoves(g.describeMoveGates!(s, 'p1'), g.getLegalMoves(s, 'p1')).find(
      (x) => x.move_type === 'focus_reload',
    )!;
    expect(reload.reason).toBe("only when your stamina is lower than your opponent's — yours is 7, theirs is 7");
  });

  it('a refine window greys everything else with the refines owed', () => {
    let s = start();
    s = g.applyMove(s, 'p1', { type: 'play_card', card_id: 'assess' }).newState;
    const grey = unavailableMoves(g.describeMoveGates!(s, 'p1'), g.getLegalMoves(s, 'p1'));
    expect(grey.find((x) => x.move_type === 'end_turn')!.reason).toBe('you still have 2 refines to use or skip first');
  });
});

describe('next_step', () => {
  it('asks a spoken question for every human phase, and defers AI turns', () => {
    let s = start();
    const tech = g.describeNextStep!(s)!;
    expect(tech.status).toBe('human_to_move');
    expect(tech.instruction).toContain("It is Zeke's turn");
    expect(tech.human_response!.ask).toBe(
      'Technique phase, you have 1 action. Which technique card do you play? Or are you moving on to the Channel phase?',
    );
    expect(tech.human_response!.records_as).toContain('play_card');

    const refining = g.applyMove(s, 'p1', { type: 'play_card', card_id: 'assess' }).newState;
    const ref = g.describeNextStep!(refining)!.human_response!;
    expect(ref.ask).toContain('You may refine 2 cards');
    expect(ref.records_as).toContain('was_misstep');

    s = g.applyMove(s, 'p1', { type: 'advance_phase' }).newState;
    const ch = g.describeNextStep!(s)!.human_response!;
    expect(ch.ask).toMatch(/^Channel phase, you have 0 spirit and 1 channel\./);
    expect(ch.records_as).toContain('buy_card');

    s = g.applyMove(s, 'p1', { type: 'end_turn' }).newState;
    expect(g.describeNextStep!(s)).toBeNull();
  });

  it('setup needs no reports from the human', () => {
    expect(g.getSetupChecklist!(start())).toEqual([]);
  });
});

describe('harness suggestion for a physical seat', () => {
  it('always suggests an offered move, and a game played on it finishes using every move type', async () => {
    const seen = new Set<string>();
    for (const seed of [1, 2, 3]) {
      let s = start(HUMAN_VS_AI, seed);
      for (let i = 0; i < 3000 && s.gameState.phase !== 'game_over'; i++) {
        const pid = s.gameState.activePlayerId;
        let move;
        if (pid === 'p1') {
          move = g.getSuggestedMove!(s, 'p1')!.move;
          const offered = g.getLegalMoves(s, 'p1').map((lm) => JSON.stringify(lm.move));
          expect(offered).toContain(JSON.stringify(move));
          seen.add(move.type);
        } else {
          move = (await g.getAIMove(s, pid, 'medium')).move;
        }
        s = g.applyMove(s, pid, move).newState;
        s = { ...s, moveLog: [...s.moveLog, {} as never] };
      }
      expect(s.gameState.phase).toBe('game_over');
    }
    expect([...seen].sort()).toEqual(
      ['advance_phase', 'buy_card', 'end_turn', 'focus_reload', 'play_card', 'refine_card', 'skip_refine'].sort(),
    );
  });

  it('defers to the AI for a server-tracked seat', () => {
    expect(g.getSuggestedMove!(start(), 'p2')).toBeNull();
  });
});
