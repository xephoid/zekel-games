import type { PlayerConfig } from '@zekel/game-kit';
import { GameError } from '@zekel/game-kit';
import { describe, expect, it } from 'vitest';
import { WORD_DEBAUCHEE_CHOICES } from '../choices.js';
import { MOVE_TYPES } from '../engine/moves.js';
import { wordDebauchee } from '../index.js';

const human = (id: string, name?: string): PlayerConfig => ({ player_id: id, kind: 'human', name });
const ai = (id: string, difficulty: PlayerConfig['difficulty'] = 'medium'): PlayerConfig => ({ player_id: id, kind: 'ai', difficulty });

describe('the module seam', () => {
  it('creates a session from player configs with display names, and refuses bad seats', () => {
    const s = wordDebauchee.createSession([human('p1', 'Zeke'), ai('p2')], { seed: 3, firstDebauchee: 'Zeke' });
    expect(s.gameState.seats.map((x) => x.name)).toEqual(['Zeke', 'the AI']);
    expect(s.gameState.round!.debauchee).toBe('p1');
    expect(s.gameState.settings.tiles).toBe('server');
    expect(s.activePlayerId).toBe('p1');
    expect(() => wordDebauchee.createSession([human('p1')], {})).toThrow(GameError);
    expect(() => wordDebauchee.createSession([human('p1'), human('p1')], {})).toThrow(/Duplicate/);
    expect(() => wordDebauchee.createSession([human('p1'), ai('p2')], { tiles: 'table' })).toThrow(GameError);
  });

  it('plays an all-AI game to the end through the seam', async () => {
    let s = wordDebauchee.createSession([ai('p1', 'easy'), ai('p2', 'hard'), ai('p3', 'medium')], { seed: 11 });
    let moves = 0;
    while (!wordDebauchee.isGameOver(s)) {
      const id = s.activePlayerId;
      const step = wordDebauchee.describeNextStep(s)!;
      expect(step.status).toBe('ai_to_move');
      expect(step.active_player_id).toBe(id);
      const { move, narration } = await wordDebauchee.getAIMove(s, id);
      expect(narration.length).toBeGreaterThan(5);
      expect(narration).not.toContain(s.gameState.round!.word ?? '§');
      expect(wordDebauchee.getLegalMoves(s, id).some((l) => l.move.type === move.type)).toBe(true);
      s = wordDebauchee.applyMove(s, id, move).newState;
      if (++moves > 3000) throw new Error('stuck');
    }
    const over = wordDebauchee.isGameOver(s)!;
    expect(over.game_over).toBe(true);
    expect(over.winners.length).toBeGreaterThan(0);
    expect(Object.keys(over.scores)).toEqual(['p1', 'p2', 'p3']);
    expect(wordDebauchee.describeNextStep(s)!.status).toBe('game_over');
    expect(wordDebauchee.getScoreboard(s).p1!.rounds_as_debauchee).toBe(2); // three seats go twice round
  });

  it('keeps the secret out of the public view and out of another seat\'s view', () => {
    const s = wordDebauchee.createSession([human('p1'), human('p2'), human('p3')], { seed: 5, firstDebauchee: 'p2' });
    const mine = wordDebauchee.getPlayerView(s, 'p2') as { secret: { dealt_words: string[] } };
    expect(mine.secret.dealt_words).toHaveLength(3);
    for (const w of mine.secret.dealt_words) {
      expect(JSON.stringify(wordDebauchee.getPublicView(s))).not.toContain(w);
      expect(JSON.stringify(wordDebauchee.getPlayerView(s, 'p1'))).not.toContain(w);
    }
    const step = wordDebauchee.describeNextStep(s)!;
    expect(step.status).toBe('human_to_move');
    expect(step.human_response?.private).toBe(true);
    const aiFirst = wordDebauchee.createSession([human('p1'), ai('p2')], { seed: 5, firstDebauchee: 'p2' });
    const aiStep = wordDebauchee.describeNextStep(aiFirst)!;
    expect(aiStep.status).toBe('ai_to_move');
    expect(aiStep.instruction).toContain('AI seat');
    expect(aiStep.human_response).toBeUndefined();
    expect(wordDebauchee.getChoiceOwed(s, 'p2')).toBe('which-word');
    expect(wordDebauchee.getChoiceOwed(s, 'p1')).toBeNull();
  });

  it('lists the setup step while the table owes the first debauchee, and declares gates that agree with the legal moves', () => {
    const s = wordDebauchee.createSession([human('p1'), ai('p2')], { seed: 5 });
    expect(s.gameState.phase).toBe('setup');
    expect(wordDebauchee.getSetupChecklist(s)).toHaveLength(1);
    expect(wordDebauchee.getSetupChecklist(s)[0]!.move_type).toBe('choose_first_debauchee');
    expect(wordDebauchee.describeNextStep(s)!.status).toBe('human_to_move');
    expect(wordDebauchee.getChoiceOwed(s, 'p1')).toBe('first-debauchee');
    const t = wordDebauchee.applyMove(s, 'p1', { type: 'choose_first_debauchee', player: 'p2' }).newState;
    expect(wordDebauchee.getSetupChecklist(t)).toEqual([]);
    expect(t.gameState.round!.debauchee).toBe('p2');
    expect(wordDebauchee.describeMoveGates(t, 'p1').length).toBeGreaterThan(5);
  });

  it('maps engine refusals onto GameError codes', () => {
    const s = wordDebauchee.createSession([human('p1'), human('p2')], { seed: 5, firstDebauchee: 'p1' });
    expect(() => wordDebauchee.applyMove(s, 'p2', { type: 'choose_word', word: 'x' })).toThrow(GameError);
    try {
      wordDebauchee.applyMove(s, 'p2', { type: 'choose_word', word: 'x' });
    } catch (e) {
      expect((e as GameError).error_code).toBe('NOT_YOUR_TURN');
    }
    expect(() => wordDebauchee.applyMove(s, 'nobody', { type: 'burn', word: 'x' })).toThrow(/No player/);
  });

  it('covers every move type in the choice catalog and the rules', () => {
    const covered = new Set(WORD_DEBAUCHEE_CHOICES.flatMap((c) => c.resolvedBy));
    for (const t of MOVE_TYPES) expect(covered.has(t), t).toBe(true);
    for (const c of WORD_DEBAUCHEE_CHOICES) if (c.owner === 'auto') expect(c.why, c.id).toBeTruthy();
    expect(wordDebauchee.getRulesText()).toContain('Scoring');
    expect(wordDebauchee.getRulesSections().length).toBeGreaterThan(8);
    expect(wordDebauchee.getSessionStartGuidance()).toContain('SECRET');
    expect((wordDebauchee.getReferenceData() as { word_cards: number }).word_cards).toBe(500);
    expect(wordDebauchee.getBalanceAxes().map((a) => a.name)).toEqual(['tiers', 'timer', 'players']);
  });

  it('suggests a medium move to the seat on the move, and nothing at a table with its own tiles while building', () => {
    const s = wordDebauchee.createSession([human('p1'), human('p2')], { seed: 5, firstDebauchee: 'p1' });
    expect(wordDebauchee.getSuggestedMove(s, 'p1')?.move.type).toBe('choose_word');
    expect(wordDebauchee.getSuggestedMove(s, 'p2')).toBeNull();
    const setup = wordDebauchee.getPhysicalSetup(s);
    expect(setup[0]!.text).toContain('144 tiles');
  });
});
