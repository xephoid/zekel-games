// The Word Debauchee game-drawn screen (glue/WdScreen.tsx) against views
// captured from this package's rules (fixtures/). What it checks is what the
// screen must never get wrong: nothing is sent without a press, holding a
// tile sends nothing until Place or Move, a send is a listed move or a listed
// move completed only with the fields the engine's move names, and a watcher
// can press nothing.

import { describe, expect, it, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LegalMove } from '@zekel/wire-types';
import type { GameScreenProps, GlueInput } from '@zekel/glue-kit';
import { isSubmissionAllowed } from '@zekel/glue-kit';
import { wordDebaucheeGlue } from '../index.js';
import { WdScreen, editBetween } from '../WdScreen.js';

afterEach(cleanup);

interface Fixture { key: string; viewer: string; view: any; legalMoves: LegalMove[] }
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const FIXTURES: Fixture[] = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8')));
const fx = (key: string) => FIXTURES.find((f) => f.key === key)!;

function draw(f: Fixture, extra: Partial<GameScreenProps> = {}) {
  const onMove = vi.fn(); const onForm = vi.fn();
  const input: GlueInput = { view: f.view, previous: null, legalMoves: f.legalMoves, playerId: f.viewer, reference: null, seq: 1, engineMove: null, actorPlayerId: null, memory: new Map() };
  const yourTurn = f.legalMoves.some((m) => m.move['type'] !== 'burn');
  const utils = render(<WdScreen input={input} yourTurn={yourTurn} busy={false} interactive nameFor={(p) => p} onMove={onMove} onForm={onForm} {...extra} />);
  return { ...utils, onMove, onForm };
}

/** The form send is one the agency policy allows against this fixture's menu. */
function allowedForm(f: Fixture, call: unknown[]) {
  const [template, move, keys] = call as [LegalMove, Record<string, unknown>, string[]];
  return isSubmissionAllowed('form', move, f.legalMoves, { template: template.move, editableKeys: keys });
}

const key = (l: string) => document.querySelector(`[data-key="${l}"]`) as HTMLButtonElement;
const row = (i: number) => document.querySelector(`[data-row="${i}"]`) as HTMLElement;

describe('Word Debauchee screen', () => {
  it('draws every captured moment and sends nothing on its own', () => {
    for (const f of FIXTURES) {
      const { onMove, onForm, unmount } = draw(f);
      expect(onMove, f.key).not.toHaveBeenCalled();
      expect(onForm, f.key).not.toHaveBeenCalled();
      unmount();
    }
  });

  it('never shows a guesser the secret word', () => {
    for (const f of FIXTURES.filter((x) => !x.view.secret)) {
      const { unmount } = draw(f);
      expect(screen.queryByLabelText('Your secret word'), f.key).toBeNull();
      unmount();
    }
  });

  it('holds a letter until Place, then sends the listed move for a new row', () => {
    const f = fx('build-rows');
    const { onMove, onForm } = draw(f);
    fireEvent.click(key('S'));
    expect(onMove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Place' }));
    expect(onForm).not.toHaveBeenCalled();
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove.mock.calls[0]![0].move).toEqual({ type: 'place', letter: 'S' });
  });

  it('puts a tile in the middle of a row by completing the listed move with its index', () => {
    const f = fx('build-rows');
    const { onForm } = draw(f);
    fireEvent.click(key('S'));
    const gaps = row(0).querySelectorAll('.wd-gap');
    fireEvent.click(gaps[1]!);
    fireEvent.click(screen.getByRole('button', { name: 'Place' }));
    expect(onForm).toHaveBeenCalledTimes(1);
    const [template, move] = onForm.mock.calls[0]!;
    expect(template.move).toEqual({ type: 'place', letter: 'S', row: 0 });
    expect(move).toEqual({ type: 'place', letter: 'S', row: 0, index: 1 });
    expect(allowedForm(f, onForm.mock.calls[0]!)).toBe(true);
  });

  it('Place and Check! is one press with check set', () => {
    const f = fx('build-rows');
    const { onForm } = draw(f);
    fireEvent.click(key('S'));
    const gaps = row(1).querySelectorAll('.wd-gap');
    fireEvent.click(gaps[gaps.length - 1]!);
    fireEvent.click(screen.getByRole('button', { name: /Place and Check! NEWS/ }));
    const [, move] = onForm.mock.calls[0]!;
    expect(move).toEqual({ type: 'place', letter: 'S', row: 1, check: true });
    expect(allowedForm(f, onForm.mock.calls[0]!)).toBe(true);
  });

  it('moves a tile to a new row only on Move', () => {
    const f = fx('build-rows');
    const { onForm, onMove } = draw(f);
    fireEvent.click(within(row(0)).getAllByRole('button', { name: /tap to move it/ })[1]!);
    fireEvent.click(screen.getByRole('button', { name: 'New row' }));
    expect(onForm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Move' }));
    expect(onMove).not.toHaveBeenCalled();
    const [template, move] = onForm.mock.calls[0]!;
    expect(template.move).toEqual({ type: 'move', row: 0, index: 0 });
    expect(move).toEqual({ type: 'move', row: 0, index: 1, to_row: 'new' });
    expect(allowedForm(f, onForm.mock.calls[0]!)).toBe(true);
  });

  it('counts a move within its own row the way the engine does, with the tile lifted out', () => {
    const f = fx('build-rows');
    const { onForm } = draw(f);
    // BAD: lift B (index 0) and drop it after D (the end gap, index 3) -> ADB.
    fireEvent.click(within(row(0)).getAllByRole('button', { name: /tap to move it/ })[0]!);
    const gaps = row(0).querySelectorAll('.wd-gap');
    fireEvent.click(gaps[gaps.length - 1]!);
    fireEvent.click(screen.getByRole('button', { name: 'Move' }));
    const [, move] = onForm.mock.calls[0]!;
    expect(move).toEqual({ type: 'move', row: 0, index: 0, to_row: 0 });
    expect(allowedForm(f, onForm.mock.calls[0]!)).toBe(true);
  });

  it('sends a tile back to the pool', () => {
    const f = fx('build-rows');
    const { onForm } = draw(f);
    fireEvent.click(within(row(1)).getAllByRole('button', { name: /tap to move it/ })[2]!);
    fireEvent.click(screen.getByRole('button', { name: 'Back to the pool' }));
    const [, move] = onForm.mock.calls[0]!;
    expect(move).toEqual({ type: 'move', row: 1, index: 2 });
    expect(allowedForm(f, onForm.mock.calls[0]!)).toBe(true);
  });

  it('Undo puts the held tile back and sends nothing', () => {
    const f = fx('build-rows');
    const { onForm, onMove } = draw(f);
    fireEvent.click(key('S'));
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.queryByRole('button', { name: 'Place' })).toBeNull();
    expect(onForm).not.toHaveBeenCalled();
    expect(onMove).not.toHaveBeenCalled();
  });

  it('Reveal! and the bribes send their listed moves', () => {
    const f = fx('build-rows');
    const { onMove } = draw(f);
    fireEvent.click(screen.getByRole('button', { name: 'Reveal!' }));
    fireEvent.click(screen.getByRole('button', { name: /take a number clue/i }));
    expect(onMove.mock.calls.map((c) => c[0].move_id)).toEqual(['call_reveal', 'call_reveal:number']);
  });

  it('the debauchee keeps a word, or draws three more', () => {
    const f = fx('choose-word');
    const { onMove } = draw(f);
    const w = f.view.secret.dealt_words[1];
    fireEvent.click(screen.getByRole('button', { name: w }));
    fireEvent.click(screen.getByRole('button', { name: /Draw three more/ }));
    expect(onMove.mock.calls.map((c) => c[0].move)).toEqual([{ type: 'choose_word', word: w }, { type: 'redraw' }]);
  });

  it('hides one clue and plays the listed three', () => {
    const f = fx('play-clues');
    const { onMove } = draw(f);
    const play = screen.getByRole('button', { name: 'Play these three' }) as HTMLButtonElement;
    expect(play.disabled).toBe(true);
    const hideable = screen.getAllByRole('button', { pressed: false }).find((b) => !(b as HTMLButtonElement).disabled && b.classList.contains('wd-pick'))!;
    fireEvent.click(hideable);
    fireEvent.click(play);
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(f.legalMoves.some((m) => m.move_id === onMove.mock.calls[0]![0].move_id)).toBe(true);
  });

  it('answers a judgment clue in the debauchee\'s own words, or with the card', () => {
    const f = fx('answer-clue');
    const { onForm, onMove } = draw(f);
    fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: 'posh' } });
    fireEvent.click(screen.getByRole('button', { name: 'Say this' }));
    const [, move] = onForm.mock.calls[0]!;
    expect(move).toEqual({ type: 'answer_clue', card: 'register', text: 'posh' });
    expect(allowedForm(f, onForm.mock.calls[0]!)).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /Use the card's answer/ }));
    expect(onMove.mock.calls[0]![0].move).toEqual({ type: 'answer_clue', card: 'register' });
  });

  it('the debauchee picks the letter to lay down', () => {
    const f = fx('reveal');
    const { onMove } = draw(f);
    const first = f.view.secret.letters_left[0];
    fireEvent.click(screen.getByRole('button', { name: `Lay down ${first}` }));
    expect(onMove.mock.calls[0]![0].move).toEqual({ type: 'reveal', letter: first });
  });

  it('a watcher can press nothing that sends', () => {
    for (const f of FIXTURES) {
      const { onMove, onForm, unmount, container } = draw(f, { interactive: false, yourTurn: false });
      container.querySelectorAll('button:not(:disabled)').forEach((b) => fireEvent.click(b));
      expect(onMove, f.key).not.toHaveBeenCalled();
      expect(onForm, f.key).not.toHaveBeenCalled();
      unmount();
    }
  });

  it('keeps the clue cards in place from one event to the next, and drops a held tile', () => {
    const f = fx('build-rows');
    const props = (seq: number) => ({
      input: { view: f.view, previous: f.view, legalMoves: f.legalMoves, playerId: f.viewer, reference: null, seq, engineMove: null, actorPlayerId: null, memory: new Map() } as GlueInput,
      yourTurn: true, busy: false, interactive: true, nameFor: (p: string) => p, onMove: vi.fn(), onForm: vi.fn(),
    });
    const { rerender } = render(<WdScreen {...props(1)} />);
    const clue = document.querySelector('.wd-clue');
    fireEvent.click(key('S'));
    expect(screen.getByRole('button', { name: 'Place' })).toBeTruthy();
    rerender(<WdScreen {...props(2)} />);
    // The same element: React kept it, so its deal-in animation does not replay.
    expect(document.querySelector('.wd-clue')).toBe(clue);
    expect(screen.queryByRole('button', { name: 'Place' })).toBeNull();
  });

  it('shows the last round\'s result with the engine\'s payouts', () => {
    const f = fx('round-result');
    draw(f);
    const last = f.view.last_round;
    expect(screen.getByLabelText(`Round ${last.number} result`).textContent).toContain(last.word);
  });
});

describe('Word Debauchee glue', () => {
  it('reads a tile that arrived or moved between two build areas', () => {
    expect(editBetween(['GLA'], ['GLAD'])).toEqual({ kind: 'add', row: 0, index: 3, letter: 'D' });
    expect(editBetween(['GLA'], ['GLA', 'D'])).toEqual({ kind: 'add', row: 1, index: 0, letter: 'D' });
    expect(editBetween(['GLA', 'D'], ['GLAD'])).toEqual({ kind: 'move', from: [1, 0], row: 0, index: 3 });
    expect(editBetween(['BAD'], ['ADB'])).toEqual({ kind: 'move', from: [0, 0], row: 0, index: 2 });
    expect(editBetween(['GLA'], ['GL'])).toBeNull();
  });

  it('asks who goes first only when every seat is known, and not under The House', () => {
    const ai = [{ position: 0, kind: 'human' as const, host: true }, { position: 1, kind: 'ai' as const, host: false }];
    const keys = wordDebaucheeGlue.setupFields({} as never, ai).map((f) => f.key);
    expect(keys).toEqual(['house', 'first', 'bribe', 'openHand']);
    const friend = [{ position: 0, kind: 'human' as const, host: true }, { position: 1, kind: 'human' as const, host: false }];
    expect(wordDebaucheeGlue.setupFields({} as never, friend).map((f) => f.key)).toEqual(['bribe', 'openHand']);
    const first = wordDebaucheeGlue.setupFields({} as never, ai).find((f) => f.key === 'first')!;
    expect(wordDebaucheeGlue.setupInPlay!(first, { house: 'yes' })).toBe(false);
    expect(wordDebaucheeGlue.setupInPlay!(first, { house: 'no' })).toBe(true);
  });

  it('the server holds the tiles; the answers become the engine\'s options', () => {
    expect(wordDebaucheeGlue.setupOptions!({ house: 'no', first: 'p2', bribe: 'yes', openHand: 'no' }, [])).toEqual({ tiles: 'server', timer: 'laps', bribe: true, firstDebauchee: 'p2' });
    expect(wordDebaucheeGlue.setupOptions!({ house: 'yes', bribe: 'no', openHand: 'yes' }, [])).toEqual({ tiles: 'server', timer: 'laps', openHand: true, house: true });
  });

  it('the menu\'s fill-in moves ask before they send', () => {
    const f = fx('answer-clue');
    const own = f.legalMoves.find((m) => m.move_id?.endsWith(':own'))!;
    const input = { view: f.view, previous: null, legalMoves: f.legalMoves, playerId: f.viewer, reference: null, seq: 1, engineMove: null, actorPlayerId: null, memory: new Map() } as GlueInput;
    const form = wordDebaucheeGlue.formFor!(own, input)!;
    expect(form.build({})).toBeNull();
    expect(form.build({ text: 'posh' })).toEqual({ type: 'answer_clue', card: 'register', text: 'posh' });
    const place = f.legalMoves[0]!;
    expect(wordDebaucheeGlue.formFor!(place, input)).toBeNull();
  });
});
