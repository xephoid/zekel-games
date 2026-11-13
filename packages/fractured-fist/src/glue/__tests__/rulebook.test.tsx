// The rulebook page (glue/rulebook/FfRulebook.tsx) against the reference data
// captured from this package's rules (fixtures/reference.json, kept current
// by src/__tests__/rulebook.test.ts). Every card it draws must be the card
// list's, with the engine's name and cost, and the examples must print the
// counters the rules half wrote (and the engine checked).

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GameReferenceResponse } from '@zekel/wire-types';
import { FfRulebook } from '../rulebook/FfRulebook.js';
import { readRulebook } from '../rulebook/read.js';

afterEach(cleanup);

const referenceData = JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'reference.json'), 'utf8'));
const reference: GameReferenceResponse = { gameId: 'fractured-fist', rules: '', referenceData, moveSchema: null, optionsSchema: null };
const data = readRulebook(reference)!;

const section = (name: RegExp) => screen.getByRole('heading', { level: 2, name }).closest('section')!;

describe('the Fractured Fist rulebook page', () => {
  it('draws nothing without a rulebook in the reference', () => {
    const { container } = render(<FfRulebook reference={null} />);
    expect(container.innerHTML).toBe('');
    expect(readRulebook({ ...reference, referenceData: { cards: [] } })).toBeNull();
  });

  it('draws every card in the game once in the card list, by its printed name and cost', () => {
    render(<FfRulebook reference={reference} />);
    const list = section(/Every card/);
    const cards = list.querySelectorAll('.zk-card');
    expect(cards.length).toBe(data.cards.size);
    for (const def of data.cards.values()) {
      const card = within(list).getByRole('generic', { name: def.name });
      if (def.type !== 'MISSTEP') expect(card.querySelector('.zk-card-cost')?.textContent).toBe(String(def.cost));
    }
  });

  it('colours a school\'s cards by their school', () => {
    render(<FfRulebook reference={reference} />);
    const list = section(/Every card/);
    expect(within(list).getByRole('generic', { name: 'Grand Finale' }).getAttribute('data-color-key')).toBe('titan-entertainment');
    expect(within(list).getByRole('generic', { name: 'Attack' }).getAttribute('data-color-key')).toBe('starter');
  });

  it('prints each example\'s counters after every move', () => {
    render(<FfRulebook reference={reference} />);
    const tech = section(/Technique phase/);
    const moves = tech.querySelectorAll('.ffr-moves > li');
    expect(moves.length).toBe(data.text.technique.example.steps.length);
    const last = data.text.technique.example.steps.at(-1)!;
    const counts = [...moves[moves.length - 1]!.querySelectorAll('.ff-counter b')].map((b) => Number(b.textContent));
    expect(counts).toEqual(Object.keys(data.text.technique.example.start).map((k) => last.after[k as keyof typeof last.after]));
  });

  it('shows the strike example\'s stamina before and after', () => {
    render(<FfRulebook reference={reference} />);
    const { you, them } = data.text.strike.example;
    const strike = section(/The strike/);
    const shown = [...strike.querySelectorAll('.ffr-stam')].map((x) => x.getAttribute('aria-label'));
    expect(shown).toEqual([`Stamina ${you.stamina} to ${you.after}`, `Stamina ${them.stamina} to ${them.after}`]);
  });

  it('lists every effect a card can carry', () => {
    render(<FfRulebook reference={reference} />);
    const effects = section(/What the effects mean/);
    const keys = new Set([...data.cards.values()].flatMap((c) => Object.keys(c.effects)));
    for (const k of keys) expect(effects.querySelector(`.ffr-effect.${k}`), k).not.toBeNull();
  });
});
