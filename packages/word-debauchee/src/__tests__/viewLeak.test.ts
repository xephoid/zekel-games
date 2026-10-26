import { describe, expect, it } from 'vitest';
import { applyMove } from '../engine/apply.js';
import { getLegalMoves } from '../legalMoves.js';
import { describeNextStep } from '../nextStep.js';
import type { WordDebaucheeState } from '../types.js';
import { getPlayerView, getPublicView } from '../views.js';
import { play, start, toBuild } from './support.js';

/** Whole-word, case-blind. The secret is upper case in state; views and
 *  summaries must not carry it in any case. */
function mentions(text: string, word: string): boolean {
  return new RegExp(`\\b${word}\\b`, 'i').test(text);
}

function secrets(s: WordDebaucheeState): string[] {
  return s.round ? [...s.round.dealtWords] : [];
}

describe('views and summaries keep the secret', () => {
  it('shows the dealt words, the chosen word, its card and the hand only to the debauchee', () => {
    let s = start(4, { tiles: 'server' });
    const dealt = secrets(s);
    for (const w of dealt) {
      expect(mentions(JSON.stringify(getPublicView(s)), w)).toBe(false);
      expect(mentions(JSON.stringify(getPlayerView(s, 'ben')), w)).toBe(false);
      expect(mentions(JSON.stringify(describeNextStep(s)), w)).toBe(false);
    }
    const mine = getPlayerView(s, 'ann') as { secret: { dealt_words: string[]; word: string | null; hand: unknown[] } };
    expect(mine.secret.dealt_words).toEqual(dealt);
    expect(mine.secret.word).toBeNull();
    expect(mine.secret.hand).toHaveLength(4);
    s = toBuild(s);
    const word = s.round!.word!;
    const me = getPlayerView(s, 'ann') as { secret: { word: string; card: { synonyms: string[] }; letters_left: string[] } };
    expect(me.secret.word).toBe(word);
    expect(me.secret.card.synonyms.length).toBeGreaterThan(0);
    expect(me.secret.letters_left).toEqual([...new Set(word.split(''))].sort());
    expect('secret' in getPlayerView(s, 'cat')).toBe(false);
  });

  it('never leaks the word in the public view, another seat\'s view, next_step or a summary before the round ends', () => {
    for (const seed of [11, 12, 13]) {
      let s = start(3, { tiles: 'server', seed });
      for (let step = 0; step < 40 && s.round?.number === 1; step++) {
        const word = s.round.word;
        const dealt = secrets(s);
        const active = s.seats.find((x) => getLegalMoves(s, x.id).some((m) => !JSON.stringify(m.move).includes('<') && m.move.type !== 'burn'))!;
        const moves = getLegalMoves(s, active.id).filter((m) => !JSON.stringify(m.move).includes('<') && m.move.type !== 'burn');
        const r = applyMove(s, active.id, moves[step % moves.length]!.move);
        const ended = r.newState.round?.number !== 1;
        const texts = [JSON.stringify(getPublicView(r.newState)), JSON.stringify(getPlayerView(r.newState, 'ben')), JSON.stringify(describeNextStep(r.newState))];
        for (const w of dealt) {
          if (w === word && ended) continue; // the card is turned face up at the end
          for (const t of texts) expect(mentions(t, w), `${w} in ${t.slice(0, 80)}`).toBe(false);
          if (!(w === word && ended)) expect(mentions(r.summary, w), `${w} in summary: ${r.summary}`).toBe(false);
        }
        s = r.newState;
      }
    }
  });

  it('turns the card face up when the round ends', () => {
    let s = toBuild(start(2, { tiles: 'server', rounds: 1 }));
    const word = s.round!.word!;
    while (s.phase !== 'game_over') {
      const id = s.phase === 'reveal' ? 'ann' : 'ben';
      s = play(s, id, getLegalMoves(s, id).find((m) => m.move.type !== 'burn')!.move).state;
    }
    expect(getPublicView(s).history[0]!.word).toBe(word);
  });
});
