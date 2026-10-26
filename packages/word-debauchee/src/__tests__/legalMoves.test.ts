import { describe, expect, it } from 'vitest';
import { applyMove } from '../engine/apply.js';
import { getLegalMoves } from '../legalMoves.js';
import { play, start, toBuild } from './support.js';

function isTemplate(move: object): boolean {
  return JSON.stringify(move).includes('<');
}

describe('legal moves', () => {
  it('offer the debauchee the three words, then the clue combinations, then the letters to reveal', () => {
    let s = start(3, { tiles: 'server' });
    expect(getLegalMoves(s, 'ann').map((m) => m.move.type)).toEqual(['choose_word', 'choose_word', 'choose_word']);
    expect(getLegalMoves(s, 'ben')).toEqual([]);
    s = play(s, 'ann', getLegalMoves(s, 'ann')[0]!.move).state;
    const combos = getLegalMoves(s, 'ann');
    expect(combos.length).toBeGreaterThanOrEqual(1);
    expect(combos.length).toBeLessThanOrEqual(4);
    expect(combos.every((m) => m.move.type === 'play_clues')).toBe(true);
    s = toBuild(s);
    s = play(s, 'ben', { type: 'call_reveal' }).state;
    const reveals = getLegalMoves(s, 'ann');
    expect(reveals.map((m) => (m.move as { letter: string }).letter)).toEqual([...new Set(s.round!.word!.split(''))].sort());
    expect(getLegalMoves(s, 'ben')).toEqual([]);
  });

  it('lists every move the guesser on turn may make with server tiles, and nothing for the others', () => {
    let s = toBuild(start(3, { tiles: 'server' }));
    const ben = getLegalMoves(s, 'ben');
    expect(ben.filter((m) => m.move.type === 'place')).toHaveLength(26);
    expect(ben.some((m) => m.move.type === 'call_reveal')).toBe(true);
    expect(ben.some((m) => m.move.type === 'timer_out')).toBe(false);
    expect(getLegalMoves(s, 'cat').map((m) => m.move.type)).toEqual(['burn']);
    expect(getLegalMoves(s, 'ann').map((m) => m.move.type)).toEqual(['burn']);
    s = play(s, 'ben', { type: 'place', letter: 'Q' }).state;
    expect(getLegalMoves(s, 'ben').map((m) => m.move_id)).toEqual(['check:0', 'burn']);
    const cat = getLegalMoves(s, 'cat');
    expect(cat.filter((m) => m.move.type === 'place')).toHaveLength(26 * 2);
    expect(cat.filter((m) => m.move.type === 'move')).toHaveLength(1);
  });

  it('lists the table\'s reports when the table holds its own tiles', () => {
    const s = toBuild(start(3));
    expect(getLegalMoves(s, 'ben').map((m) => m.move_id)).toEqual(['check', 'call_reveal', 'burn', 'timer_out']);
    expect(getLegalMoves(s, 'cat').map((m) => m.move_id)).toEqual(['check', 'call_reveal', 'burn', 'timer_out']);
    expect(getLegalMoves(s, 'ann').map((m) => m.move_id)).toEqual(['burn', 'timer_out']);
  });

  it('are all applicable, phase by phase, for a few seeds', () => {
    for (const seed of [1, 2, 3]) {
      let s = start(4, { tiles: 'server', seed });
      for (let step = 0; step < 60 && s.phase !== 'game_over'; step++) {
        for (const seat of s.seats) {
          for (const m of getLegalMoves(s, seat.id)) {
            if (isTemplate(m.move)) continue;
            expect(() => applyMove(s, seat.id, m.move), `${seat.id} ${m.move_id} at ${s.phase}`).not.toThrow();
          }
        }
        const active = s.seats.find((x) => getLegalMoves(s, x.id).some((m) => !isTemplate(m.move) && m.move.type !== 'burn' && m.move.type !== 'timer_out'))!;
        const moves = getLegalMoves(s, active.id).filter((m) => !isTemplate(m.move) && m.move.type !== 'burn' && m.move.type !== 'timer_out');
        s = applyMove(s, active.id, moves[step % moves.length]!.move).newState;
      }
    }
  });

  it('offer nothing once the game is over', () => {
    let s = start(2, { tiles: 'server', rounds: 1 });
    s = toBuild(s);
    while (s.phase !== 'game_over') {
      const id = s.phase === 'reveal' ? 'ann' : 'ben';
      s = play(s, id, getLegalMoves(s, id).find((m) => m.move.type !== 'burn')!.move).state;
    }
    expect(getLegalMoves(s, 'ann')).toEqual([]);
  });
});
