import { describe, expect, it } from 'vitest';
import { clue } from '../data/clues.js';
import { cardFor } from '../data/deck.js';
import { TILE_TOTAL } from '../data/tiles.js';
import { createState, defaultRounds, payouts } from '../engine/round.js';
import { getLegalMoves } from '../legalMoves.js';
import { play, seats, secret, spell, start, toBuild } from './support.js';

describe('setup', () => {
  it('seats 2 to 8 players', () => {
    expect(() => createState(seats(1))).toThrow(/2 to 8/);
    expect(() => createState(seats(9).concat([{ id: 'x', name: 'X', ai: false }]))).toThrow(/2 to 8/);
    expect(start(2).seats).toHaveLength(2);
    expect(start(8).seats).toHaveLength(8);
  });

  it('goes once round the table with 5+ players and twice with 2–4', () => {
    expect(defaultRounds(2)).toBe(4);
    expect(defaultRounds(4)).toBe(8);
    expect(defaultRounds(5)).toBe(5);
    expect(defaultRounds(8)).toBe(8);
    expect(start(3, { rounds: 2 }).settings.rounds).toBe(2);
  });

  it('deals the first debauchee three words and two clues of each kind, guessers clockwise from their left', () => {
    const s = start(4, { firstDebauchee: 'cat' });
    const r = s.round!;
    expect(r.debauchee).toBe('cat');
    expect(r.guessers).toEqual(['dev', 'ann', 'ben']);
    expect(r.dealtWords).toHaveLength(3);
    expect(r.hand).toHaveLength(4);
    expect(r.hand.filter((id) => clue(id).kind === 'number')).toHaveLength(2);
    expect(s.wordDeck).toHaveLength(497);
    expect(s.numberDeck).toHaveLength(18);
    expect(s.wordClueDeck).toHaveLength(26);
    expect(s.phase).toBe('choose_word');
  });

  it('is the same game for the same seed', () => {
    const a = createState(seats(3), { seed: 42 });
    const b = createState(seats(3), { seed: 42 });
    expect(a).toEqual(b);
    expect(createState(seats(3), { seed: 43 }).wordDeck).not.toEqual(a.wordDeck);
  });

  it('lets the table hold the tiles unless an AI sits down', () => {
    expect(start(3).settings.tiles).toBe('table');
    expect(start(3, {}, [1]).settings.tiles).toBe('server');
    expect(() => start(3, { tiles: 'table' }, [1])).toThrow(/server/);
    expect(start(3, { tiles: 'server' }).round!.pool.E).toBe(18);
    expect(start(3).round!.pool).toEqual({});
  });
});

describe('the debauchee picks a word and plays clues', () => {
  it('keeps one of the three dealt cards and buries the other two', () => {
    const s = start(4);
    const [w1, w2, w3] = s.round!.dealtWords as [string, string, string];
    expect(() => play(s, 'ben', { type: 'choose_word', word: w1 })).toThrow(/Only the debauchee/);
    expect(() => play(s, 'ann', { type: 'choose_word', word: 'ZZZ' })).toThrow(/one of the three/);
    const { state, summary } = play(s, 'ann', { type: 'choose_word', word: w2.toLowerCase() });
    expect(state.round!.word).toBe(w2);
    expect(state.wordDeck.slice(-2)).toEqual([w1, w3]);
    expect(state.phase).toBe('play_clues');
    expect(summary).not.toContain(w2);
  });

  it('plays three of four with one of each kind, buries the fourth, and answers the fact clues itself', () => {
    let s = start(4);
    s = play(s, 'ann', { type: 'choose_word', word: s.round!.dealtWords[0]! }).state;
    const hand = s.round!.hand;
    expect(() => play(s, 'ann', { type: 'play_clues', cards: hand.slice(0, 2) })).toThrow(/exactly 3/);
    expect(() => play(s, 'ann', { type: 'play_clues', cards: [hand[0]!, hand[0]!, hand[0]!] })).toThrow(/not in hand/);
    const numbers = s.numberDeck.length;
    const words = s.wordClueDeck.length;
    const legal = getLegalMoves(s, 'ann');
    expect(legal.length).toBeGreaterThanOrEqual(1);
    const { state } = play(s, 'ann', legal[0]!.move);
    expect(state.round!.played).toHaveLength(3);
    expect(state.numberDeck.length + state.wordClueDeck.length).toBe(numbers + words + 1);
    const card = secret(state);
    for (const p of state.round!.played) {
      const c = clue(p.card);
      if (!c.judgment) expect(p.answer).toBe(c.answer(card));
    }
  });

  it('waits for a human debauchee to answer judgment clues, in their own words or the card\'s', () => {
    // Find a seed where the first legal combo includes a judgment clue.
    for (let seed = 1; seed < 200; seed++) {
      let s = createState(seats(3), { seed, firstDebauchee: 'ann' });
      s = play(s, 'ann', { type: 'choose_word', word: s.round!.dealtWords[0]! }).state;
      const combo = getLegalMoves(s, 'ann').find((m) => m.move.type === 'play_clues' && m.move.cards.some((c) => clue(c).judgment));
      if (!combo) continue;
      s = play(s, 'ann', combo.move).state;
      expect(s.phase).toBe('answer_clues');
      const pending = s.round!.played.filter((p) => p.answer === null);
      expect(pending.length).toBeGreaterThan(0);
      const card = secret(s);
      const first = pending[0]!;
      expect(() => play(s, 'ann', { type: 'answer_clue', card: first.card, text: card.word })).toThrow(/the word itself/);
      if (first.card === 'rhymes_with') {
        expect(() => play(s, 'ann', { type: 'answer_clue', card: first.card, text: card.synonyms[0]! })).toThrow(/synonym list/);
      }
      const own = play(s, 'ann', { type: 'answer_clue', card: first.card, text: first.card === 'register' ? 'slang' : 'something' });
      expect(own.state.round!.played.find((p) => p.card === first.card)!.answer).toBe(first.card === 'register' ? 'slang' : 'something');
      let t = s;
      for (const p of pending) t = play(t, 'ann', { type: 'answer_clue', card: p.card }).state;
      expect(t.phase).toBe('build');
      for (const p of t.round!.played) expect(p.answer).toBe(clue(p.card).answer(card));
      return;
    }
    throw new Error('no seed dealt a judgment clue');
  });

  it('answers judgment clues itself for an AI debauchee', () => {
    for (let seed = 1; seed < 200; seed++) {
      let s = createState(seats(3, [0]), { seed, firstDebauchee: 'ann' });
      s = play(s, 'ann', { type: 'choose_word', word: s.round!.dealtWords[0]! }).state;
      const combo = getLegalMoves(s, 'ann').find((m) => m.move.type === 'play_clues' && m.move.cards.some((c) => clue(c).judgment));
      if (!combo) continue;
      s = play(s, 'ann', combo.move).state;
      expect(s.phase).toBe('build');
      expect(s.round!.played.every((p) => p.answer !== null)).toBe(true);
      return;
    }
    throw new Error('no seed dealt a judgment clue');
  });
});

describe('the scoring table from the rules', () => {
  const g = ['ben', 'cat', 'dev'];
  it('HAPPY cracked with GLAD, nothing revealed: 4 each', () => {
    expect(payouts('cracked', 'HAPPY', 'glad', 0, 'ann', g)).toEqual({ ann: 0, ben: 4, cat: 4, dev: 4 });
  });
  it('HAPPY cracked with CHEERFUL after 2 reveals: 6 each', () => {
    expect(payouts('cracked', 'HAPPY', 'cheerful', 2, 'ann', g)).toEqual({ ann: 0, ben: 6, cat: 6, dev: 6 });
  });
  it('HAPPY cracked with GLAD after 4 reveals: the minimum, 1 each', () => {
    expect(payouts('cracked', 'HAPPY', 'glad', 4, 'ann', g)).toEqual({ ann: 0, ben: 1, cat: 1, dev: 1 });
  });
  it('HAPPY never cracked: the debauchee scores 5', () => {
    expect(payouts('stumped', 'HAPPY', null, 5, 'ann', g)).toEqual({ ann: 5, ben: 0, cat: 0, dev: 0 });
  });
});

describe('building with server-held tiles', () => {
  it('places one tile per turn, from the pool, in turn order', () => {
    let s = toBuild(start(4, { tiles: 'server' }));
    expect(s.round!.turnIndex).toBe(0);
    expect(() => play(s, 'cat', { type: 'place', letter: 'G' })).toThrow(/Ben's turn/);
    expect(() => play(s, 'ann', { type: 'place', letter: 'G' })).toThrow(/debauchee/);
    expect(() => play(s, 'ben', { type: 'place', letter: '1' })).toThrow(/not a letter/);
    let r = play(s, 'ben', { type: 'place', letter: 'g' });
    expect(r.summary).toContain('Ben places G in a new row');
    s = r.state;
    expect(s.round!.buildArea).toEqual(['G']);
    expect(s.round!.pool.G).toBe(3);
    expect(s.round!.turnIndex).toBe(1);
    r = play(s, 'cat', { type: 'place', letter: 'L', row: 0 });
    s = r.state;
    expect(s.round!.buildArea).toEqual(['GL']);
    expect(() => play(s, 'dev', { type: 'place', letter: 'A', row: 3 })).toThrow(/Row 3/);
    expect(() => play(s, 'dev', { type: 'place', letter: 'A', row: 0, index: 9 })).toThrow(/off the end/);
    r = play(s, 'dev', { type: 'place', letter: 'A', row: 0, index: 0 });
    s = r.state;
    expect(s.round!.buildArea).toEqual(['AGL']);
    expect(s.phase).toBe('reveal'); // three guessers, three tiles: the lap is over
    const total = Object.values(s.round!.pool).reduce((a, b) => a + b, 0) + s.round!.buildArea.join('').length;
    expect(total).toBe(TILE_TOTAL);
  });

  it('moves a tile within the build area or back to the pool', () => {
    let s = toBuild(start(3, { tiles: 'server', timer: 'sand' }));
    s = play(s, 'ben', { type: 'place', letter: 'A' }).state;
    s = play(s, 'cat', { type: 'place', letter: 'G', row: 0 }).state; // AG
    s = play(s, 'ben', { type: 'move', row: 0, index: 1, to_row: 0, to_index: 0 }).state; // GA
    expect(s.round!.buildArea).toEqual(['GA']);
    s = play(s, 'cat', { type: 'move', row: 0, index: 0, to_row: 'new' }).state; // A / G
    expect(s.round!.buildArea).toEqual(['A', 'G']);
    s = play(s, 'ben', { type: 'move', row: 1, index: 0, to_row: 0, to_index: 1 }).state; // AG
    expect(s.round!.buildArea).toEqual(['AG']);
    s = play(s, 'cat', { type: 'move', row: 0, index: 0 }).state; // back to pool
    expect(s.round!.buildArea).toEqual(['G']);
    expect(s.round!.pool.A).toBe(13);
    expect(() => play(s, 'ben', { type: 'move', row: 0, index: 4 })).toThrow(/no tile at index/);
  });

  it('cracks the round when a placed tile completes a synonym and the player checks', () => {
    const s = toBuild(start(4, { tiles: 'server' }));
    const syn = secret(s).synonyms[0]!;
    const { state, summary } = spell(s, syn);
    expect(summary).toContain(`"Check! ${syn.toUpperCase()}." Ann: "Yes."`);
    expect(summary).toContain('Cracked with');
    expect(state.history[0]!.outcome).toBe('cracked');
    expect(state.history[0]!.synonym).toBe(syn);
    const each = Math.max(1, syn.length - state.history[0]!.revealed);
    expect(state.scores.ben).toBe(each);
    expect(state.scores.ann).toBe(0);
    expect(state.round!.number).toBe(2);
    expect(state.round!.debauchee).toBe('ben');
    expect(state.round!.guessers).toEqual(['cat', 'dev', 'ann']);
    expect(state.round!.buildArea).toEqual([]);
    expect(state.round!.pool.E).toBe(18);
  });

  it('answers "no" to a word not on the list, which stays on the table', () => {
    let s = toBuild(start(3, { tiles: 'server', timer: 'sand' }));
    s = play(s, 'ben', { type: 'place', letter: 'Q' }).state;
    const r = play(s, 'cat', { type: 'place', letter: 'Q', row: 0, check: true });
    expect(r.summary).toContain('"Check! QQ." Ann: "No."');
    expect(r.state.round!.checks).toEqual([{ by: 'cat', word: 'QQ', yes: false }]);
    expect(r.state.round!.buildArea).toEqual(['QQ']);
    expect(r.state.phase).toBe('build');
  });

  it('lets only the player whose tile just completed a row check it, and only before the next move', () => {
    let s = toBuild(start(3, { tiles: 'server', timer: 'sand' }));
    s = play(s, 'ben', { type: 'place', letter: 'Q' }).state;
    expect(() => play(s, 'cat', { type: 'check', row: 0 })).toThrow(/whose tile just completed/);
    expect(play(s, 'ben', { type: 'check', row: 0 }).summary).toContain('"No."');
    const t = play(s, 'cat', { type: 'place', letter: 'Q', row: 0 }).state;
    expect(() => play(t, 'ben', { type: 'check', row: 0 })).toThrow(/whose tile just completed/);
    expect(() => play(t, 'cat', { type: 'check' })).toThrow(/which row/);
  });

  it('refuses a check on a burned word', () => {
    let s = toBuild(start(3, { tiles: 'server' }));
    const syn = secret(s).synonyms[0]!;
    s = play(s, 'ann', { type: 'burn', word: syn }).state;
    expect(s.round!.burned).toEqual([syn]);
    expect(() => spell(s, syn)).toThrow(/burned/);
    expect(() => play(s, 'ben', { type: 'burn', word: 'two words' })).toThrow(/not a word/);
  });
});

describe('reveals', () => {
  it('come round every lap under the laps timer, and the debauchee picks a letter of the word', () => {
    let s = toBuild(start(3, { tiles: 'server' })); // guessers ben, cat: a lap is two turns
    s = play(s, 'ben', { type: 'place', letter: 'Q' }).state;
    expect(s.phase).toBe('build');
    const r = play(s, 'cat', { type: 'place', letter: 'Q' });
    expect(r.summary).toContain('come back round: Ann reveals a letter');
    s = r.state;
    expect(s.phase).toBe('reveal');
    expect(() => play(s, 'ben', { type: 'place', letter: 'Q' })).toThrow(/reveal is owed/);
    expect(() => play(s, 'ben', { type: 'reveal', letter: 'A' })).toThrow(/Only the debauchee/);
    const word = s.round!.word!;
    const notIn = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').find((l) => !word.includes(l))!;
    expect(() => play(s, 'ann', { type: 'reveal', letter: notIn })).toThrow(/not a letter of the word/);
    const letter = word[0]!;
    const pool = s.round!.pool[letter]!;
    const rv = play(s, 'ann', { type: 'reveal', letter: letter.toLowerCase() });
    expect(rv.summary).toContain(`Ann reveals ${letter}`);
    s = rv.state;
    expect(s.round!.revealed).toEqual([letter]);
    expect(s.round!.pool[letter]).toBe(pool - 1);
    expect(s.phase).toBe('build');
    expect(s.round!.turnsSinceReveal).toBe(0);
    expect(s.round!.guessers[s.round!.turnIndex]).toBe('ben');
  });

  it('come every tilesPerReveal tiles in a duel', () => {
    let s = toBuild(start(2, { tiles: 'server', tilesPerReveal: 3 }));
    for (let i = 0; i < 2; i++) {
      s = play(s, 'ben', { type: 'place', letter: 'E' }).state;
      expect(s.phase).toBe('build');
    }
    s = play(s, 'ben', { type: 'place', letter: 'E' }).state;
    expect(s.phase).toBe('reveal');
  });

  it('can be called by the guesser on turn, ending their turn', () => {
    let s = toBuild(start(4, { tiles: 'server' }));
    expect(() => play(s, 'cat', { type: 'call_reveal' })).toThrow(/Ben's turn/);
    const r = play(s, 'ben', { type: 'call_reveal' });
    expect(r.summary).toContain('"Reveal!"');
    s = r.state;
    expect(s.phase).toBe('reveal');
    s = play(s, 'ann', getLegalMoves(s, 'ann')[0]!.move).state;
    expect(s.round!.guessers[s.round!.turnIndex]).toBe('cat');
  });

  it('take the tile from the build area when the pool has none', () => {
    let s = toBuild(start(3, { tiles: 'server' }));
    const letter = s.round!.word![0]!;
    s = play(s, 'ben', { type: 'place', letter }).state;
    s = play(s, 'cat', { type: 'place', letter: 'Q' }).state; // lap over: reveal owed
    s.round!.pool[letter] = 0;
    const r = play(s, 'ann', { type: 'reveal', letter });
    expect(r.summary).toContain('taken from');
    expect(r.state.round!.buildArea).toEqual(['Q']);
    expect(r.state.round!.revealed).toEqual([letter]);
  });

  it('stump the table when the last letter goes down, paying the debauchee the word length', () => {
    let s = toBuild(start(3, { tiles: 'server' }));
    const word = s.round!.word!;
    let summary = '';
    while (s.round!.number === 1) {
      if (s.phase === 'reveal') {
        const r = play(s, 'ann', getLegalMoves(s, 'ann')[0]!.move);
        s = r.state;
        summary = r.summary;
      } else {
        s = play(s, s.round!.guessers[s.round!.turnIndex]!, { type: 'call_reveal' }).state;
      }
    }
    expect(summary).toContain(`the word was ${word}`);
    expect(summary).toContain('stumped');
    expect(s.history[0]).toMatchObject({ outcome: 'stumped', word, revealed: word.length });
    expect(s.scores.ann).toBe(word.length);
    expect(s.scores.ben).toBe(0);
  });
});

describe('timers at a table with its own tiles', () => {
  it('reports the sand or the lap; the server does not count turns', () => {
    let s = toBuild(start(4));
    expect(() => play(s, 'ben', { type: 'place', letter: 'G' })).toThrow(/table holds its own tiles/);
    // Any guesser may call a reveal or check; the table keeps its own turn order.
    expect(play(s, 'dev', { type: 'call_reveal' }).state.phase).toBe('reveal');
    const r = play(s, 'cat', { type: 'timer_out' });
    expect(r.summary).toContain('come back round');
    s = play(r.state, 'ann', getLegalMoves(r.state, 'ann')[0]!.move).state;
    expect(s.round!.revealed).toHaveLength(1);
    const syn = secret(s).synonyms[1]!;
    expect(() => play(s, 'ann', { type: 'check', word: syn })).toThrow(/debauchee/);
    const c = play(s, 'dev', { type: 'check', word: syn });
    expect(c.summary).toContain('"Yes."');
    expect(c.state.scores.dev).toBe(Math.max(1, syn.length - 1));
  });

  it('refuses a reported timer when the server counts laps, and accepts it under sand', () => {
    const laps = toBuild(start(3, { tiles: 'server' }));
    expect(() => play(laps, 'ben', { type: 'timer_out' })).toThrow(/counts the laps/);
    let sand = toBuild(start(3, { tiles: 'server', timer: 'sand' }));
    sand = play(sand, 'ben', { type: 'place', letter: 'Q' }).state;
    sand = play(sand, 'cat', { type: 'place', letter: 'Q' }).state;
    expect(sand.phase).toBe('build'); // no lap counting under sand
    const r = play(sand, 'ann', { type: 'timer_out' });
    expect(r.summary).toContain('sand has run out');
    expect(r.state.phase).toBe('reveal');
  });
});

describe('a whole game', () => {
  it('ends once every player has been the debauchee the right number of times, highest total wins', () => {
    let s = start(2, { tiles: 'server' });
    let rounds = 0;
    while (s.phase !== 'game_over') {
      if (s.round!.number > rounds) rounds = s.round!.number;
      if (s.phase === 'build') {
        s = play(s, s.round!.guessers[s.round!.turnIndex]!, { type: 'call_reveal' }).state;
      } else {
        const deb = s.round!.debauchee;
        s = play(s, deb, getLegalMoves(s, deb)[0]!.move).state;
      }
    }
    expect(rounds).toBe(4);
    expect(s.history).toHaveLength(4);
    expect(s.history.map((h) => h.debauchee)).toEqual(['ann', 'ben', 'ann', 'ben']);
    const annWords = s.history.filter((h) => h.debauchee === 'ann').reduce((a, h) => a + h.word.length, 0);
    expect(s.scores.ann).toBe(annWords);
    const best = Math.max(s.scores.ann!, s.scores.ben!);
    expect(s.winners).toEqual(s.seats.filter((x) => s.scores[x.id] === best).map((x) => x.id));
    expect(() => play(s, 'ann', { type: 'burn', word: 'x' })).toThrow(/game is over/);
  });

  it('shares a tie', () => {
    let s = start(2, { tiles: 'server', rounds: 2 });
    // Both rounds cracked at once: both debauchees score 0.
    for (let i = 0; i < 2; i++) {
      s = toBuild(s);
      s = spell(s, secret(s).synonyms[0]!).state;
    }
    expect(s.phase).toBe('game_over');
    expect(s.winners).toEqual(['ann', 'ben']);
  });
});

describe('the deck between rounds', () => {
  it('returns the played clue cards and the buried one under their decks', () => {
    let s = start(3, { tiles: 'server' });
    s = toBuild(s);
    s = spell(s, secret(s).synonyms[0]!).state;
    expect(s.numberDeck.length + s.wordClueDeck.length).toBe(48 - 4);
    expect(cardFor(s.history[0]!.word)).toBeDefined();
  });
});
