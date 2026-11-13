// The rulebook (rulebook.ts) against the engine. Each worked example is played
// through the real engine from its starting hand, and the counters the page
// prints after every step must be what the engine reads. The setup numbers,
// the strike example and the card groups are checked the same way. The test
// also keeps the screen tests' captured reference data
// (src/glue/__tests__/fixtures/reference.json) the engine's current one.

import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { applyMove, createInitialState } from '../engine.js';
import { CARDS, DEFAULT_LOADOUT, STARTING_DECK } from '../cards.js';
import { ffRulebook, USUAL_HAND_SIZE, USUAL_STAMINA, type RulebookCounters, type RulebookExample } from '../rulebook.js';
import { fracturedFist } from '../index.js';
import type { FFMove, FFState, TrackedPlayerState } from '../types.js';

const book = ffRulebook();

function start(hand: string[]): FFState {
  const s = createInitialState(['p1', 'p2'], { p1: 'tracked', p2: 'tracked' }, undefined, 7);
  const p = s.players['p1'] as TrackedPlayerState;
  // The example's hand, taken out of the starting deck so the counts stay real.
  const pool = [...p.hand, ...p.deck];
  for (const c of hand) {
    const i = pool.indexOf(c);
    if (i >= 0) pool.splice(i, 1);
  }
  p.hand = [...hand];
  p.deck = pool;
  p.handSize = hand.length;
  p.deckSize = pool.length;
  return s;
}

function read(s: FFState): Required<RulebookCounters> {
  const p = s.players['p1']!;
  return {
    actions: p.actions, damage: p.damageQueued, defense: p.defenseQueued, spirit: p.spirit, channels: p.channels,
    refine: p.refinePending, missteps: p.misstepCount, stamina: p.stamina,
  };
}

function expectCounters(s: FFState, want: RulebookCounters, where: string) {
  const got = read(s);
  for (const [k, v] of Object.entries(want)) expect(got[k as keyof RulebookCounters], `${where}: ${k}`).toBe(v);
}

function moveFor(step: RulebookExample['steps'][number], s: FFState): FFMove {
  const hand = (s.players['p1'] as TrackedPlayerState).hand;
  switch (step.move) {
    case 'play': return { type: 'play_card', card_id: step.card!, hand_index: hand.indexOf(step.card!) };
    case 'buy': return { type: 'buy_card', card_id: step.card! };
    case 'refine': return { type: 'refine_card', hand_index: hand.indexOf(step.card!) };
    case 'next-phase': return { type: 'advance_phase' };
    case 'end-turn': return { type: 'end_turn' };
  }
}

function play(ex: RulebookExample) {
  let s = start(ex.hand);
  expectCounters(s, ex.start, `${ex.title}, at the start`);
  for (const [i, step] of ex.steps.entries()) {
    if (step.card) expect(CARDS.some((c) => c.id === step.card), `${step.card} is a card`).toBe(true);
    s = applyMove(s, 'p1', moveFor(step, s)).newState;
    expectCounters(s, step.after, `${ex.title}, step ${i + 1}`);
  }
  return s;
}

describe('the Fractured Fist rulebook', () => {
  it('starts the game the way the engine does', () => {
    const s = createInitialState(['p1', 'p2'], { p1: 'tracked', p2: 'tracked' }, undefined, 1);
    const p = s.players['p1'] as TrackedPlayerState;
    expect(p.stamina).toBe(USUAL_STAMINA);
    expect(p.hand.length).toBe(USUAL_HAND_SIZE);
    expect(book.setup.deck).toEqual(STARTING_DECK);
    expect(book.setup.loadout).toEqual(DEFAULT_LOADOUT);
    expect(Object.keys(p.supply).filter((id) => CARDS.find((c) => c.id === id)!.type === 'TECHNIQUE').sort()).toEqual([...DEFAULT_LOADOUT].sort());
  });

  it('lists the per-player supply counts the engine deals', () => {
    const p = createInitialState(['p1', 'p2'], { p1: 'tracked', p2: 'tracked' }, undefined, 1).players['p1']!;
    const item = (n: string) => book.components.items.find((x) => x.name === n)!.count;
    expect(item('Momentum')).toBe(p.supply['momentum']);
    expect(item('Mastery')).toBe(p.supply['mastery']);
    expect(item('Focus')).toBe(p.supply['focus']! + STARTING_DECK.filter((c) => c === 'focus').length);
    expect(item('Technique cards')).toBe(DEFAULT_LOADOUT.reduce((a, id) => a + p.supply[id]!, 0));
  });

  it('plays the Technique phase example through the engine', () => {
    play(book.technique.example);
  });

  it('plays the Channel phase example through the engine, and the Attack lands in the discard pile', () => {
    const s = play(book.channel.example);
    expect((s.players['p1'] as TrackedPlayerState).discard).toContain('attack');
    for (const w of book.channel.worth) expect(CARDS.find((c) => c.id === w.card)!.value).toBe(w.spirit);
  });

  it('plays the refine example through the engine, and the Missteps are gone for good', () => {
    const s = play(book.refine.example);
    const p = s.players['p1'] as TrackedPlayerState;
    expect([...p.hand, ...p.deck, ...p.discard].filter((c) => c === 'misstep')).toHaveLength(STARTING_DECK.filter((c) => c === 'misstep').length - 2);
  });

  it('settles the strike example the way the engine does', () => {
    const { you, them } = book.strike.example;
    let s = createInitialState(['p1', 'p2'], { p1: 'tracked', p2: 'tracked' }, undefined, 3);
    const set = (pid: string, side: typeof you) => { const p = s.players[pid]!; p.damageQueued = side.damage; p.defenseQueued = side.defense; p.stamina = side.stamina; };
    set('p1', you); set('p2', them);
    s = applyMove(s, 'p1', { type: 'end_turn' }).newState;
    s = applyMove(s, 'p2', { type: 'end_turn' }).newState;
    expect(s.players['p1']!.stamina).toBe(you.stamina - Math.max(0, them.damage - you.defense));
    expect(s.players['p2']!.stamina).toBe(them.stamina - Math.max(0, you.damage - them.defense));
    expect(s.players['p1']!.stamina).toBe(you.after);
    expect(s.players['p2']!.stamina).toBe(them.after);
  });

  it('puts every card in the game in exactly one group of the card list', () => {
    const listed = book.cards.groups.flatMap((g) => g.cards);
    expect([...listed].sort()).toEqual(CARDS.map((c) => c.id).sort());
    expect(new Set(listed).size).toBe(listed.length);
  });

  it('names an effect for every effect a card can have', () => {
    const keys = new Set(CARDS.flatMap((c) => Object.keys(c.effects ?? {})));
    expect([...keys].every((k) => book.effects.list.some((e) => e.key === k))).toBe(true);
  });

  it('keeps the screen tests\' captured reference data current', () => {
    const now = JSON.parse(JSON.stringify(fracturedFist.getReferenceData()));
    const file = fileURLToPath(new URL('../glue/__tests__/fixtures/reference.json', import.meta.url));
    if (process.env['UPDATE_FIXTURES']) writeFileSync(file, JSON.stringify(now, null, 1) + '\n');
    expect(JSON.parse(readFileSync(file, 'utf8')), 'run with UPDATE_FIXTURES=1 to refresh').toEqual(now);
  });
});
