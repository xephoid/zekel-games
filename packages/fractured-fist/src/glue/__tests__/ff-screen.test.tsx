// The Fractured Fist screen: both fighters' plates at the top, every number
// from the view, the opponent's panels gone from the side, and nothing sent
// but a move the engine listed, on a press.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { GlueInput, LegalMove } from '@zekel/glue-kit';
import { FfScreen } from '../FfScreen.js';
import { FF_MOVES, FF_REFERENCE, FF_VIEW } from './fixtures/ff.js';

function inputFor(view: unknown, legalMoves: LegalMove[], playerId: string | null = 'p1'): GlueInput {
  return {
    view, previous: null, legalMoves, playerId, reference: FF_REFERENCE, seq: 1,
    engineMove: null, actorPlayerId: null, memory: new Map(),
  };
}

function draw(opts: { view?: unknown; moves?: LegalMove[]; playerId?: string | null; yourTurn?: boolean; interactive?: boolean; sideSlot?: HTMLElement | null; phone?: boolean } = {}) {
  const onMove = vi.fn();
  const onBatch = vi.fn();
  const r = render(
    <FfScreen
      input={inputFor(opts.view ?? FF_VIEW, opts.moves ?? FF_MOVES, opts.playerId === undefined ? 'p1' : opts.playerId)}
      yourTurn={opts.yourTurn ?? true}
      busy={false}
      interactive={opts.interactive ?? true}
      onMove={onMove}
      onForm={vi.fn()}
      onBatch={onBatch}
      sideSlot={opts.sideSlot}
      phone={opts.phone}
      nameFor={(pid) => (pid === 'p1' ? 'Ada' : 'AI')}
    />,
  );
  return { ...r, onMove, onBatch };
}

afterEach(() => cleanup());

describe('Fractured Fist screen', () => {
  it('draws both plates at the top with stamina and missteps from the view, and no opponent panels', () => {
    const { container } = draw();
    expect(screen.getByLabelText('You: stamina 6 of 7; missteps 3 of 10')).toBeTruthy();
    expect(screen.getByLabelText('Opponent: stamina 7 of 7; missteps 3 of 10')).toBeTruthy();
    // You on the left, facing the opponent on the right.
    const plates = [...container.querySelectorAll('.ff-plate')];
    expect(plates.map((p) => p.className)).toEqual(['ff-plate left active', 'ff-plate right']);
    // Seven blocks each, what is left lit.
    expect(plates[0]!.querySelectorAll('.ff-blocks .zk-track-space')).toHaveLength(7);
    expect(plates[0]!.querySelectorAll('.ff-blocks .zk-track-space.filled')).toHaveLength(6);
    expect(plates[1]!.querySelectorAll('.ff-blocks .zk-track-space.filled')).toHaveLength(7);
    // The opponent's public counts sit by their name; their discard is still drawn.
    expect(plates[1]!.textContent).toContain('Hand 5');
    expect(plates[1]!.textContent).toContain('Deck 9');
    expect(plates[1]!.textContent).toContain('Discard 1');
    expect(plates[1]!.querySelector('[data-flip-id="p:p2:discard"]')).not.toBeNull();
    expect(container.querySelector('.zk-tableau')).toBeNull();
    // Your hand, deck and discard are the bench, under the play column.
    expect(container.querySelector('.ff-bench [data-flip-id="p:p1:hand"]')).not.toBeNull();
  });

  it('shows the strike gutter as queued, without working out what gets through', () => {
    draw();
    expect(screen.getByLabelText('You hit Opponent: 1 damage against 1 defense')).toBeTruthy();
    expect(screen.getByLabelText('Opponent hits you: 0 damage against 0 defense')).toBeTruthy();
  });

  it('a tap on a lit card sends the move the engine listed; an unlit card sends nothing', () => {
    const { container, onMove } = draw();
    const lit = [...container.querySelectorAll('.ff-hand .zk-lit')];
    expect(lit).toHaveLength(1);
    fireEvent.click(lit[0]!);
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove.mock.calls[0]![0].move_id).toBe('play-2-quicken');
    const unlit = container.querySelector('.ff-hand .zk-card:not(.zk-lit)')!;
    fireEvent.click(unlit);
    expect(onMove).toHaveBeenCalledTimes(1);
  });

  it('the action bar holds the listed moves that move the turn, and the counters for this step', () => {
    const { onMove, container } = draw();
    expect(container.querySelector('.ff-counters')!.textContent).toBe('1Actions');
    fireEvent.click(screen.getByRole('button', { name: 'Advance to Channel' }));
    expect(onMove.mock.calls[0]![0].move_id).toBe('advance-phase');
    // End turn is not listed here, so there is no button for it.
    expect(screen.queryByRole('button', { name: 'End turn' })).toBeNull();
  });

  it('"Play all resources" hands the table one tap per listed play, and sends nothing itself', () => {
    const view = { ...FF_VIEW, phase: 'channel' };
    const moves: LegalMove[] = [
      { move_id: 'play-0-focus', description: 'Play Focus', move: { type: 'play_card', card_id: 'focus', hand_index: 0 } },
      { move_id: 'play-4-focus', description: 'Play Focus', move: { type: 'play_card', card_id: 'focus', hand_index: 4 } },
      { move_id: 'end', description: 'End turn', move: { type: 'end_turn' } },
    ];
    const { onMove, onBatch } = draw({ view, moves });
    fireEvent.click(screen.getByRole('button', { name: /Play all resources/ }));
    expect(onMove).not.toHaveBeenCalled();
    expect(onBatch).toHaveBeenCalledTimes(1);
    expect(onBatch.mock.calls[0]![0]).toHaveLength(2);
  });

  it('puts the supply in the side column when the table gives one, and on the board when not', () => {
    const slot = document.createElement('div');
    document.body.appendChild(slot);
    const { container } = draw({ sideSlot: slot });
    expect(slot.querySelector('.ff-supply [data-flip-id="p:p1:supply:attack"]')).not.toBeNull();
    expect(container.querySelector('.ff-supply')).toBeNull();
    cleanup();
    slot.remove();
    const inline = draw();
    expect(inline.container.querySelector('.ff-supply')).not.toBeNull();
  });

  it('draws the supply as a list: one row per stack with both counts, only a listed buy lit, the rest dim in the Channel step', () => {
    const view = { ...FF_VIEW, phase: 'channel' };
    const moves: LegalMove[] = [{ move_id: 'buy-attack', description: 'Buy Attack', move: { type: 'buy_card', card_id: 'attack' } }];
    const { container, onMove } = draw({ view, moves });
    const rows = [...container.querySelectorAll('.ff-supply .zk-card-row')];
    expect(rows.map((r) => r.getAttribute('data-flip-id'))).toEqual(['p:p1:supply:attack', 'p:p1:supply:focus', 'p:p1:supply:momentum']);
    for (const r of rows) expect(r.querySelectorAll('.zk-card-row-counts b')).toHaveLength(2);
    expect(rows[0]!.querySelector('.zk-card-row-counts')!.textContent).toBe('45');
    expect(container.querySelector('.ff-supply .zk-zone-cols')!.textContent).toBe('youthem');
    expect(container.querySelector('.ff-supply')!.classList.contains('buying')).toBe(true);
    expect(rows.filter((r) => r.classList.contains('zk-lit')).map((r) => r.getAttribute('data-flip-id'))).toEqual(['p:p1:supply:attack']);
    // The counts are text: nothing about the opponent's stacks can be pressed.
    expect(container.querySelectorAll('.zk-card-row-counts [role="button"]')).toHaveLength(0);
    fireEvent.click(rows[1]!);
    expect(onMove).not.toHaveBeenCalled();
    fireEvent.click(rows[0]!);
    expect(onMove.mock.calls[0]![0].move_id).toBe('buy-attack');
    // Off the Channel step nothing dims.
    cleanup();
    expect(draw().container.querySelector('.ff-supply')!.classList.contains('buying')).toBe(false);
  });

  it('a watcher sees both seats by name, can press nothing, and has no action bar', () => {
    const publicView = { ...FF_VIEW, players: { p1: { ...FF_VIEW.players.p1, hand: undefined }, p2: FF_VIEW.players.p2 } };
    const { container, onMove } = draw({ view: publicView, moves: [], playerId: null, yourTurn: false, interactive: false });
    expect(screen.getByLabelText('Ada: stamina 6 of 7; missteps 3 of 10')).toBeTruthy();
    expect(screen.getByLabelText('AI: stamina 7 of 7; missteps 3 of 10')).toBeTruthy();
    expect(container.querySelector('.ff-actionbar')).toBeNull();
    expect(container.querySelector('.ff-bench')).toBeNull();
    expect(container.querySelectorAll('.zk-lit')).toHaveLength(0);
    for (const c of container.querySelectorAll('.zk-card')) fireEvent.click(c);
    expect(onMove).not.toHaveBeenCalled();
  });
});

describe('Fractured Fist screen on a phone (build item 7)', () => {
  it('a tap on a lit card opens it up close and sends nothing; Play sends the listed move', () => {
    const { container, onMove } = draw({ phone: true });
    const lit = container.querySelector('.ff-hand .zk-lit')!;
    fireEvent.click(lit);
    expect(onMove).not.toHaveBeenCalled();
    const sheet = screen.getByRole('dialog', { name: 'Quicken' });
    expect(sheet.textContent).toContain('In your hand · can be played now');
    expect(sheet.textContent).toContain('+2 Draw.');
    expect(sheet.querySelector('.ff-printed')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Play Quicken' }));
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove.mock.calls[0]![0].move_id).toBe('play-2-quicken');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('any card can be looked at; one with no listed play has no Play button', () => {
    const { container, onMove } = draw({ phone: true });
    // A Misstep in your hand, their discard on your side of the table, a card in your played row.
    fireEvent.click(container.querySelector('.ff-hand .zk-card.zk-look')!);
    expect(screen.getByRole('dialog').textContent).toContain('In your hand');
    expect(screen.queryByRole('button', { name: /^(Play|Remove) / })).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[0]!);
    fireEvent.click(container.querySelector('[data-flip-id="p:p1:played"] .zk-card')!);
    expect(screen.getByRole('dialog', { name: 'Attack' }).textContent).toContain('Your played cards');
    expect(screen.queryByRole('button', { name: /^Play / })).toBeNull();
    expect(onMove).not.toHaveBeenCalled();
  });

  it('a watcher or an off-turn seat can look but never gets a Play button', () => {
    const { container } = draw({ phone: true, yourTurn: false });
    fireEvent.click(container.querySelector('.ff-hand .zk-card')!);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Play / })).toBeNull();
  });

  it('the supply is a sheet from the action bar: the count is the stacks the engine lists a buy for, a lit row buys on its tap', () => {
    const view = { ...FF_VIEW, phase: 'channel' };
    const moves: LegalMove[] = [
      { move_id: 'buy-attack', description: 'Buy Attack', move: { type: 'buy_card', card_id: 'attack' } },
      { move_id: 'buy-focus', description: 'Buy Focus', move: { type: 'buy_card', card_id: 'focus' } },
    ];
    const { container, onMove } = draw({ view, moves, phone: true });
    // Not in the stack, not in the side column: behind the button.
    expect(container.querySelector('.ff-supply')).toBeNull();
    const button = screen.getByRole('button', { name: /^Supply/ });
    expect(button.textContent).toBe('Supply2 to buy');
    fireEvent.click(button);
    const sheet = screen.getByRole('dialog', { name: 'Supply' });
    const rows = [...sheet.querySelectorAll('.zk-card-row')];
    expect(rows).toHaveLength(3);
    expect(rows.filter((r) => r.classList.contains('zk-lit'))).toHaveLength(2);
    // An unlit row opens the card up close; a lit one buys, as on a desktop.
    fireEvent.click(rows[2]!);
    expect(onMove).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Momentum' }).textContent).toContain('In the supply');
    fireEvent.click(screen.getAllByRole('button', { name: 'Close' }).at(-1)!);
    fireEvent.click(rows[0]!);
    expect(onMove.mock.calls[0]![0].move_id).toBe('buy-attack');
  });

  it('buttons share one row with their short words, keeping the full words for a screen reader', () => {
    draw({ phone: true });
    const advance = screen.getByRole('button', { name: 'Advance to Channel' });
    expect(advance.textContent).toBe('To Channel');
    // Off the Channel step the Supply button opens the sheet but counts nothing.
    expect(screen.getByRole('button', { name: /^Supply/ }).textContent).toBe('Supply');
  });
});
