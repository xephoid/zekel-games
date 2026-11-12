// The Adventurer Olympics game-drawn screen (glue/ao/AoScreen.tsx) against
// captured engine views. What it checks is what a screen must never get
// wrong: nothing is sent without a press, a tap sends a move the engine
// listed, Draw and Roll are only ever onDraw, exploring sends nothing until
// Place and then the listed move for that slot and turn, and a watcher can
// press nothing.

import { describe, expect, it, afterEach, beforeAll, afterAll, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LegalMove } from '@zekel/wire-types';
import type { GameScreenProps, GlueInput } from '@zekel/glue-kit';
import { isSubmissionAllowed } from '@zekel/glue-kit';
import { AoScreen, RESULT_MS } from '../AoScreen.js';

afterEach(cleanup);
const widthDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
const heightDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 1000 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 560 });
});
afterAll(() => {
  if (widthDesc) Object.defineProperty(HTMLElement.prototype, 'clientWidth', widthDesc);
  if (heightDesc) Object.defineProperty(HTMLElement.prototype, 'clientHeight', heightDesc);
});

interface Fixture { key: string; viewer: string; view: any; legalMoves: LegalMove[]; watcher: string; watcherView: any; watcherLegalMoves: LegalMove[] }
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'ao');
const FIXTURES: Fixture[] = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8')));
const fx = (key: string) => FIXTURES.find((f) => f.key === key)!;

function draw(f: Fixture, extra: Partial<GameScreenProps> = {}, inputExtra: Partial<GlueInput> = {}) {
  const onMove = vi.fn(); const onDraw = vi.fn(); const onForm = vi.fn();
  const roll = f.legalMoves.some((m) => m.move['type'] === 'resolve_report');
  const input: GlueInput = { view: f.view, previous: null, legalMoves: f.legalMoves, playerId: f.viewer, reference: null, seq: 1, engineMove: null, actorPlayerId: null, memory: new Map(), ...inputExtra };
  const utils = render(<AoScreen input={input} yourTurn busy={false} interactive nameFor={(p) => p} onMove={onMove} onForm={onForm} onDraw={roll ? onDraw : undefined} {...extra} />);
  return { ...utils, onMove, onDraw, onForm };
}

describe('the Adventurer Olympics screen', () => {
  it('draws every captured view, and drawing sends nothing', () => {
    for (const f of FIXTURES) {
      const { onMove, onDraw, onForm, container } = draw(f);
      expect(container.querySelector('.ao-screen'), f.key).not.toBeNull();
      expect(onMove).not.toHaveBeenCalled(); expect(onDraw).not.toHaveBeenCalled(); expect(onForm).not.toHaveBeenCalled();
      cleanup();
    }
  });

  it('a tap on a glowing hex sends the listed step', () => {
    const f = fx('move-late-multi');
    const { onMove, container } = draw(f);
    const lit = container.querySelector<HTMLElement>('.zk-hex.zk-lit:not(.ghost)')!;
    fireEvent.click(lit);
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(isSubmissionAllowed('tap', onMove.mock.calls[0]![0].move, f.legalMoves)).toBe(true);
  });

  it('End turn and Explore send their listed moves; nothing else on the board sends', () => {
    const f = fx('move-can-explore');
    const { onMove } = draw(f);
    fireEvent.click(screen.getByRole('button', { name: 'Explore · turn over a tile' }));
    fireEvent.click(screen.getByRole('button', { name: 'End turn' }));
    expect(onMove.mock.calls.map((c) => c[0].move)).toEqual([{ type: 'explore' }, { type: 'stop' }]);
  });

  it('Draw and Roll are the only presses on a draw or a roll, and they call onDraw', () => {
    for (const [key, label] of [['draw-companion', 'Draw a card'], ['roll-test', /^Roll \d/], ['roll-turn_order', 'Roll 2 dice'], ['draw-tile-forced', 'Turn over a tile']] as const) {
      const { onDraw, onMove } = draw(fx(key));
      fireEvent.click(screen.getByRole('button', { name: label }));
      expect(onDraw, key).toHaveBeenCalledTimes(1);
      expect(onMove, key).not.toHaveBeenCalled();
      cleanup();
    }
  });

  it('exploring: a slot tap sends nothing; Place sends the listed move for that slot and turn', () => {
    const f = fx('explore_place-ordinary');
    const { onMove, container } = draw(f);
    expect(screen.queryByRole('button', { name: 'Place tile' })).toBeNull();
    fireEvent.click(container.querySelector<HTMLElement>('.zk-hex.ghost.zk-lit')!);
    expect(onMove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Turn left/ }));
    fireEvent.click(screen.getByRole('button', { name: /Turn left/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Place tile' }));
    const sent = onMove.mock.calls[0]![0].move;
    expect(sent).toMatchObject({ type: 'explore', rotation: 2 });
    expect(isSubmissionAllowed('tap', sent, f.legalMoves)).toBe(true);
  });

  it('"Any rune" lists each listed take and No thanks', () => {
    const f = fx('take_artifact');
    const { onMove } = draw(f);
    fireEvent.click(screen.getByRole('button', { name: 'No thanks, draw again' }));
    expect(onMove.mock.calls[0]![0].move).toEqual({ type: 'decline_artifact' });
    const takes = f.legalMoves.filter((m) => m.move['type'] === 'take_artifact');
    expect(document.querySelectorAll('.ao-option')).toHaveLength(takes.length);
  });

  it('just after a roll it shows the tested card and the dice from the view', () => {
    const f = fx('after-roll-test');
    const me = f.view.players.find((p: any) => p.player_id === f.viewer);
    const cardId = [...me.companions, ...me.littleMonsters, ...me.bigMonsters][0] ?? 'little-1';
    const previous = { ...f.view, pending: { kind: 'roll', seat: f.viewer, payload: { rollKind: 'test', test: 'recruit', cardId } } };
    const { container } = draw(f, {}, { previous });
    const dice = container.querySelectorAll('.ao-die');
    expect(dice.length).toBe(f.view.lastRoll.dice.length);
    expect(container.querySelector('.ao-total')!.textContent).toBe(`= ${f.view.lastRoll.total}`);
  });

  it('calls an AI seat by its colour, and a person by their seat name', () => {
    const f = fx('move-late-multi');
    const names = (nameFor: (p: string) => string) => {
      const { container } = draw(f, { nameFor });
      const out = [...container.querySelectorAll('.ao-seat .top b')].map((e) => e.textContent);
      cleanup();
      return out;
    };
    const colours = f.view.players.filter((p: any) => p.player_id !== f.viewer).map((p: any) => p.colour);
    expect(names(() => 'AI (medium)').sort()).toEqual([...colours].sort());
    expect(names((p) => (p === 'p2' ? 'Sam' : 'AI (easy)'))).toContain('Sam');
  });

  it('how a test went closes by itself after a beat', () => {
    vi.useFakeTimers();
    try {
      const f = fx('after-roll-test');
      const me = f.view.players.find((p: any) => p.player_id === f.viewer);
      const cardId = [...me.companions, ...me.littleMonsters, ...me.bigMonsters][0] ?? 'little-1';
      const previous = { ...f.view, pending: { kind: 'roll', seat: f.viewer, payload: { rollKind: 'test', test: 'recruit', cardId } } };
      const { container } = draw(f, {}, { previous });
      expect(container.querySelector('.ao-panel.result')).not.toBeNull();
      act(() => { vi.advanceTimersByTime(RESULT_MS + 50); });
      expect(container.querySelector('.ao-panel.result')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a watcher sees the table and can press nothing', () => {
    const f = fx('move-late-multi');
    const { container, onMove } = draw(f, { interactive: false, yourTurn: false });
    expect(container.querySelectorAll('.zk-lit')).toHaveLength(0);
    for (const b of container.querySelectorAll<HTMLButtonElement>('.ao-turn button')) expect(b.disabled).toBe(true);
    expect(onMove).not.toHaveBeenCalled();
  });

  it('the setup panel completes the listed template with the answers only', () => {
    const f = fx('setup_standee_colour');
    const { onForm } = draw(f);
    fireEvent.click(screen.getByRole('radio', { name: /Rogue/ }));
    const colour = String(f.legalMoves[0]!.move['colour']);
    fireEvent.click(screen.getByRole('radio', { name: new RegExp(colour) }));
    fireEvent.click(screen.getByRole('button', { name: 'Take my seat' }));
    const [template, move, keys] = onForm.mock.calls[0]!;
    expect(isSubmissionAllowed('form', move, f.legalMoves, { template: template.move, editableKeys: keys })).toBe(true);
    expect(move).toMatchObject({ standee: 'Rogue', colour });
  });
});
