// View completeness (post-port runbook §1a): a player who lost track of the
// table can rebuild everything they are entitled to see from their view
// alone. Every public-physical field comes back from the public view, and
// every private-known field from the debauchee's view, at every step of a
// game, and nothing in the view is stale.

import { describe, expect, it } from 'vitest';
import { chooseAIMove } from '../ai.js';
import { applyMove } from '../engine/apply.js';
import { activeSeatId, currentGuesser } from '../engine/helpers.js';
import { createState } from '../engine/round.js';
import type { WordDebaucheeState } from '../types.js';
import { getPlayerView, getPublicView, type DebaucheeView } from '../views.js';
import { seats } from './support.js';

function rebuildTable(state: WordDebaucheeState): void {
  const pub = getPublicView(state);
  // Settings, seats, scores.
  expect(pub.settings).toEqual(state.settings);
  expect(pub.seats.map((s) => [s.id, s.name, s.ai, s.score])).toEqual(state.seats.map((s) => [s.id, s.name, s.ai, state.scores[s.id]]));
  expect(pub.phase).toBe(state.phase);
  expect(pub.history).toEqual(state.history);
  expect(pub.winners).toEqual(state.winners);
  const r = state.round;
  if (!r) {
    expect(pub.round).toBeNull();
    return;
  }
  const v = pub.round!;
  expect([v.number, v.of, v.debauchee, v.guessers]).toEqual([r.number, state.settings.rounds, r.debauchee, r.guessers]);
  // The clues on the table, with their answers, in play order.
  expect(v.clues.map((c) => [c.card, c.answer])).toEqual(r.played.map((p) => [p.card, p.answer]));
  // The debauchee's row of revealed tiles, the bribed clues, burned words, checks.
  expect(v.revealed).toEqual(r.revealed);
  expect(v.revealed_count).toBe(r.revealed.length);
  expect(v.bribed).toEqual(r.bribed);
  expect(v.reveals_for_scoring).toBe(r.revealed.length + r.bribed.length);
  expect(v.burned).toEqual(r.burned);
  expect(v.checks).toEqual(r.checks);
  if (state.settings.tiles === 'server') {
    // Every tile: the pool by letter, the build area row by row, in the same frame the moves use (row index, position).
    expect(v.build_area).toEqual(r.buildArea);
    expect(v.pool).toEqual(r.pool);
    expect(v.turn).toBe(state.phase === 'build' ? currentGuesser(state) : activeSeatId(state));
    if (state.settings.timer === 'laps') expect(typeof v.turns_until_reveal).toBe('number');
  } else {
    expect(v.build_area).toBeUndefined();
    expect(v.pool).toBeUndefined();
  }
}

function rebuildSecret(state: WordDebaucheeState): void {
  const r = state.round;
  if (!r) return;
  const mine = getPlayerView(state, r.debauchee) as DebaucheeView;
  expect(mine.secret.dealt_words).toEqual(r.dealtWords);
  expect(mine.secret.word).toBe(r.word);
  expect(mine.secret.hand.map((h) => h.card)).toEqual(r.hand);
  if (r.word) {
    expect(mine.secret.card?.letters).toBe(r.word.length);
    // The letters still to reveal, so the debauchee can answer a reveal without the card.
    const left = new Map<string, number>();
    for (const ch of r.word) left.set(ch, (left.get(ch) ?? 0) + 1);
    for (const ch of r.revealed) left.set(ch, (left.get(ch) ?? 0) - 1);
    expect(mine.secret.letters_left).toEqual([...left.entries()].filter(([, n]) => n > 0).map(([ch]) => ch).sort());
  }
  // A guesser's view carries nothing secret.
  for (const g of r.guessers) expect('secret' in getPlayerView(state, g)).toBe(false);
}

describe('view completeness', () => {
  it('lets every seat rebuild the table from its view at every step of a server-tiles game, under every variant', () => {
    const runs: Array<Record<string, unknown>> = [{}, { bribe: true }, { openHand: true, bribe: true }, { house: true }];
    for (const [i, options] of runs.entries()) {
      let s = createState(seats(3, [0, 1, 2]), { seed: 20 + i, rounds: 2, ...options });
      let guard = 0;
      while (s.phase !== 'game_over' && guard++ < 1500) {
        rebuildTable(s);
        rebuildSecret(s);
        const id = activeSeatId(s);
        s = applyMove(s, id, chooseAIMove(s, id, 'medium', guard)).newState;
      }
      expect(s.phase).toBe('game_over');
      rebuildTable(s);
    }
  });

  it('shows a table with its own tiles everything the server tracks, and no tile fields', () => {
    let s = createState(seats(3), { seed: 8, firstDebauchee: 'ann', bribe: true });
    rebuildTable(s);
    rebuildSecret(s);
    const deb = s.round!.debauchee;
    s = applyMove(s, deb, { type: 'choose_word', word: s.round!.dealtWords[1]! }).newState;
    rebuildTable(s);
    rebuildSecret(s);
    s = applyMove(s, deb, chooseAIMove(s, deb, 'medium', 1)).newState;
    while (s.phase === 'answer_clues') {
      const p = s.round!.played.find((x) => x.answer === null)!;
      s = applyMove(s, deb, { type: 'answer_clue', card: p.card, text: 'snappy' }).newState;
    }
    s = applyMove(s, 'ben', { type: 'burn', word: 'glad' }).newState;
    s = applyMove(s, 'cat', { type: 'call_reveal', clue: 'number' }).newState;
    s = applyMove(s, 'ben', { type: 'timer_out' }).newState;
    rebuildTable(s);
    rebuildSecret(s);
    expect(getPublicView(s).round!.burned).toEqual(['glad']);
    expect(getPublicView(s).round!.bribed).toHaveLength(1);
  });
});
