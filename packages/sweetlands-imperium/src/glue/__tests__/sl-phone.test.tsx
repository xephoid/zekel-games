// The Sweetlands table on a phone (zekel-universe docs/games/sweetlands-phone-build.md,
// boards docs/design/sweetlands-candy/Phone-*.dc.html): one column with the
// board always in view, zoom by land, the side column in the table's menu.
// It moves no rule and adds no move: everything sent is still a listed move.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { sweetlandsGlue } from '../index.js';
import { SlScreen } from '../SlScreen.js';
import { zoomView, LAND_MIDDLE } from '../Board.js';
import type { LegalMove } from '@zekel/glue-kit';
import { SL_SCREEN_VIEW, slProps } from './sl-fixtures.js';

beforeEach(() => { localStorage.setItem('zk:sl-how-to-play-seen', '1'); });
afterEach(cleanup);

describe('the opt-in and the top bar (item 1)', () => {
  it('has a phone layout', () => {
    expect(sweetlandsGlue.phone).toBe(true);
  });

  it('gives the top bar a short title and the round in a few letters', () => {
    const plan = sweetlandsGlue.plan(slProps().input)!;
    expect(plan.title).toBe('Sweetlands Imperium');
    expect((plan as { titleShort?: string }).titleShort).toBe('Sweetlands');
    expect(plan.statusShort).toBe('R4');
    const setup = sweetlandsGlue.plan(slProps({ view: { ...SL_SCREEN_VIEW, phase: 'setup_secrets' } }).input)!;
    expect(setup.statusShort).toBe('Setup');
  });
});

/** The props a phone table passes: phone set, the menu closed. */
function phoneProps(over: Parameters<typeof slProps>[0] = {}, props: Record<string, unknown> = {}) {
  return slProps(over, { phone: true, openMenu: vi.fn(), ...props } as never);
}

describe('the screen in one column (item 3)', () => {
  it('draws one column: chips, zoom, board, then the turn panel and hand; the side column is not in it', () => {
    const { container } = render(<SlScreen {...phoneProps()} />);
    const col = container.querySelector('.sl-screen.phone')!;
    expect(col).toBeTruthy();
    const parts = [...col.children].map((el) => el.className.split(' ')[0]);
    expect(parts).toEqual(['sl-chips', 'sl-zoom', 'sl-board-box', 'sl-under']);
    expect(screen.queryByLabelText('Players and their pieces')).toBeNull();
    expect(container.querySelector('.sl-guide')).toBeNull();
    expect(screen.queryByRole('button', { name: 'How to play' })).toBeNull();
    expect(within(col.querySelector('.sl-under')! as HTMLElement).getByRole('region', { name: 'What to do now' })).toBeTruthy();
    expect(within(col.querySelector('.sl-under')! as HTMLElement).getByRole('region', { name: 'Your hand' })).toBeTruthy();
  });

  it('keeps the desktop columns off a phone', () => {
    const { container } = render(<SlScreen {...slProps()} />);
    expect(container.querySelector('.sl-screen.phone')).toBeNull();
    expect(screen.getByLabelText('Players and their pieces')).toBeTruthy();
  });

  it('shows a score chip per seat, and the row opens the menu on the Players tab', () => {
    const props = phoneProps();
    render(<SlScreen {...props} />);
    const chips = screen.getByRole('button', { name: /^Scores/ });
    expect(chips.querySelectorAll('.sl-chip')).toHaveLength(2);
    expect([...chips.querySelectorAll('.sl-chip-n')].map((n) => n.textContent)).toEqual(['2/5', '5/5']);
    expect(chips.querySelector('.sl-chip.me')).toBeTruthy();
    fireEvent.click(chips);
    expect((props as unknown as { openMenu: () => void }).openMenu).toHaveBeenCalledTimes(1);
  });
});

describe('zoom by land (item 4)', () => {
  it('offers All, Yours and the other three lands, and marks the one on screen', () => {
    const { container } = render(<SlScreen {...phoneProps()} />);
    const group = screen.getByRole('group', { name: 'Zoom the board' });
    const buttons = within(group).getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['All', 'Yours', 'Fudge', 'Jellybean', 'Cheesecake']);
    const win = container.querySelector('.sl-board-fit')!;
    expect(win.getAttribute('data-zoom')).toBe('all');
    expect(buttons[0]!.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(within(group).getByRole('button', { name: /Jellybean/ }));
    expect(win.getAttribute('data-zoom')).toBe('3');
    expect(within(group).getByRole('button', { name: /Jellybean/ }).getAttribute('aria-pressed')).toBe('true');
    // "Yours" is the seat's home land (Milkshake's, region 1).
    fireEvent.click(within(group).getByRole('button', { name: /^Yours/ }));
    expect(win.getAttribute('data-zoom')).toBe('1');
    fireEvent.click(within(group).getByRole('button', { name: 'All' }));
    expect(win.getAttribute('data-zoom')).toBe('all');
  });

  it('has no zoom off a phone', () => {
    const { container } = render(<SlScreen {...slProps()} />);
    expect(screen.queryByRole('group', { name: 'Zoom the board' })).toBeNull();
    expect(container.querySelector('[data-zoom]')).toBeNull();
  });

  it('doubles the board on the land’s middle, never showing past the board’s edge', () => {
    const W = 364; const H = 286;
    expect(zoomView('all', W, H)).toEqual({ x: 0, y: 0, z: 1 });
    for (const r of [1, 2, 3, 4] as const) {
      const v = zoomView(r, W, H);
      expect(v.z).toBe(2);
      // clamped: the doubled board still covers the whole window
      expect(v.x).toBeLessThanOrEqual(0); expect(v.x).toBeGreaterThanOrEqual(W - W * 2);
      expect(v.y).toBeLessThanOrEqual(0); expect(v.y).toBeGreaterThanOrEqual(H - H * 2);
    }
    // The top land sits against the top edge; the bottom land against the bottom.
    expect(zoomView(3, W, H).y).toBe(0);
    expect(zoomView(1, W, H).y).toBeCloseTo(H - H * 2);
    // Fudge's land is on the right, Cheesecake's on the left.
    expect(zoomView(2, W, H).x).toBeLessThan(zoomView(4, W, H).x);
    expect(Object.keys(LAND_MIDDLE)).toEqual(['1', '2', '3', '4']);
  });

  it('puts a chosen space in the window, even at the edge of its land', () => {
    const W = 364; const H = 286; const sq = W / 14;
    // r4-ring-0 sits at the top of Cheesecake's land, far from the land's middle.
    const at = { row: 2, col: 1 };
    const v = zoomView(4, W, H, at);
    const x = (at.col + 0.5) * sq * v.z + v.x;
    const y = (at.row - 0.5) * sq * v.z + v.y;
    // the whole square is on screen, a square's width clear of the edges
    expect(x).toBeGreaterThanOrEqual(sq * 2); expect(x).toBeLessThanOrEqual(W - sq * 2);
    expect(y).toBeGreaterThanOrEqual(sq * 2); expect(y).toBeLessThanOrEqual(H - sq * 2);
  });
});

describe('the menu’s two tabs (item 6)', () => {
  /** The table's open menu: a place at the top of its sheet. */
  function openMenuSlot(): HTMLElement {
    const el = document.createElement('div');
    el.className = 'menu-game';
    document.body.appendChild(el);
    return el;
  }
  afterEach(() => { document.querySelectorAll('.menu-game').forEach((el) => el.remove()); });

  it('puts the players in the menu, each piece with a Find button', () => {
    const slot = openMenuSlot();
    render(<SlScreen {...phoneProps({}, { menuSlot: slot })} />);
    const tabs = within(slot).getAllByRole('button').filter((b) => b.classList.contains('sl-tab'));
    expect(tabs.map((t) => t.textContent)).toEqual(['Players', 'How to play']);
    expect(tabs[0]!.getAttribute('aria-pressed')).toBe('true');
    const mine = within(slot).getByRole('region', { name: 'You, Arch Duchess of Milkshake' });
    expect(within(mine).getAllByRole('button', { name: /Find/ })).toHaveLength(3);
  });

  it('Find rings the piece on the board and zooms to its land; it sends nothing', () => {
    const slot = openMenuSlot();
    const props = phoneProps({}, { menuSlot: slot });
    const { container } = render(<SlScreen {...props} />);
    const mine = within(slot).getByRole('region', { name: 'You, Arch Duchess of Milkshake' });
    // The Knight stands in Fudge's land (region 2).
    fireEvent.click(within(mine).getByRole('button', { name: /Find: Your Knight/ }));
    expect(container.querySelectorAll('.sl-board-frame .sl-piece.focused')).toHaveLength(1);
    expect(container.querySelector('.sl-board-fit')!.getAttribute('data-zoom')).toBe('2');
    // Pressing Find again keeps it found; it is not a toggle.
    fireEvent.click(within(mine).getByRole('button', { name: /Find: Your Knight/ }));
    expect(container.querySelectorAll('.sl-board-frame .sl-piece.focused')).toHaveLength(1);
    expect(props.onMove).not.toHaveBeenCalled();
  });

  it('How to play: moving by color, the six colors, how to win, and the whole page', () => {
    const slot = openMenuSlot();
    render(<SlScreen {...phoneProps({}, { menuSlot: slot })} />);
    fireEvent.click(within(slot).getByRole('button', { name: 'How to play' }));
    expect(slot.querySelectorAll('.sl-guide-name')).toHaveLength(6);
    expect(within(slot).getByText(/first to 5 points wins/i)).toBeTruthy();
    expect(within(slot).queryByRole('region', { name: /^You,/ })).toBeNull();
    fireEvent.click(within(slot).getByRole('button', { name: 'The whole game on one page' }));
    expect(screen.getByRole('dialog', { name: 'How to play Sweetlands Imperium' })).toBeTruthy();
  });

  it('the score chips open the menu on the Players tab, whichever was last open', () => {
    const slot = openMenuSlot();
    const props = phoneProps({}, { menuSlot: slot });
    render(<SlScreen {...props} />);
    fireEvent.click(within(slot).getByRole('button', { name: 'How to play' }));
    fireEvent.click(screen.getByRole('button', { name: /^Scores/ }));
    expect(within(slot).getByRole('region', { name: 'You, Arch Duchess of Milkshake' })).toBeTruthy();
  });

  it('opens the whole page on top of the open menu: at the end of the table, after the menu sheet', () => {
    const shell = document.createElement('div');
    shell.className = 'table-shell';
    document.body.appendChild(shell);
    const slot = openMenuSlot();
    render(<SlScreen {...phoneProps({}, { menuSlot: slot })} />, { container: shell });
    // the table's menu sheet comes after the screen, as Table.tsx draws it
    shell.appendChild(slot);
    fireEvent.click(within(slot).getByRole('button', { name: 'How to play' }));
    fireEvent.click(within(slot).getByRole('button', { name: 'The whole game on one page' }));
    const page = screen.getByRole('dialog', { name: 'How to play Sweetlands Imperium' });
    expect(shell.lastElementChild!.contains(page)).toBe(true);
    shell.remove();
  });

  it('draws nothing in the menu while it is closed', () => {
    render(<SlScreen {...phoneProps()} />);
    expect(document.querySelector('.sl-tab')).toBeNull();
  });
});

describe('the turn panel and the hand on a phone (item 5)', () => {
  const ring = (region: number, ringIndex: number) => ({ zone: 'ring', region, ringIndex });
  const knightLanding = { piece: 'knight', from: ring(2, 3), to: ring(3, 0), path: [ring(2, 4), ring(2, 5), ring(3, 0)] };
  const leaderLanding = { piece: 'leader', from: ring(1, 2), to: { zone: 'castle' }, path: [{ zone: 'castle' }] };
  const PLAY: LegalMove[] = [
    { move_id: 'k-act', description: 'Play red: move knight around ring and take the red action.', move: { type: 'play_intel', cardId: 'c1', unit: 'knight', viaRoad: false, takeAction: true }, landing: knightLanding },
    { move_id: 'k-move', description: 'Play red: move knight around ring only (no action).', move: { type: 'play_intel', cardId: 'c1', unit: 'knight', viaRoad: false, takeAction: false }, landing: knightLanding },
    { move_id: 'l-move', description: 'Play red: move leader via road only (no action).', move: { type: 'play_intel', cardId: 'c1', unit: 'leader', viaRoad: true, takeAction: false }, landing: leaderLanding },
    { move_id: 'trade', description: 'Discard 4 Intel for red.', move: { type: 'discard_for_color', color: 'red', cardIds: ['c1', 'c2', 'c3', 'c4'] } },
    { move_id: 'pass', description: 'Pass your turn to gain 1 influence.', move: { type: 'pass' } },
  ] as LegalMove[];
  const panel = () => screen.getByRole('region', { name: 'What to do now' });

  it('puts the step row at the top of the panel, and takes it away while a card is picked', () => {
    render(<SlScreen {...phoneProps({ legalMoves: PLAY })} />);
    const steps = within(panel()).getByLabelText('Your turn has four steps');
    expect(steps.textContent).toContain('Step 3 of 4 · Play a card');
    expect(steps.querySelectorAll('.sl-step-dot')).toHaveLength(4);
    fireEvent.click(screen.getByRole('button', { name: /^Red card: Battle/ }));
    expect(within(panel()).queryByLabelText('Your turn has four steps')).toBeNull();
  });

  it('lays a card’s choices out as a grid, each named by the engine’s whole sentence, with Put back on the title row', () => {
    const props = phoneProps({ legalMoves: PLAY });
    render(<SlScreen {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /^Red card: Battle/ }));
    const grid = panel().querySelector('.sl-options.grid')!;
    const options = [...grid.querySelectorAll<HTMLButtonElement>('.sl-option')];
    expect(options).toHaveLength(2);
    expect(options[0]!.getAttribute('aria-label')).toBe('Option 1: Knight → the red space in Jellybean’s land. Play red: move knight around ring and take the red action.');
    expect(options[0]!.querySelector('.sl-option-where')!.textContent).toBe('red');
    expect(options[1]!.querySelector('.sl-option-where')!.textContent).toBe('castle');
    const title = panel().querySelector('.sl-panel-head')!;
    expect(within(title as HTMLElement).getByRole('button', { name: 'Put back' })).toBeTruthy();
    expect(props.onMove).not.toHaveBeenCalled();
  });

  it('zooms to where the chosen piece lands, to All for the castle, and back to All when the card is put back', () => {
    const { container } = render(<SlScreen {...phoneProps({ legalMoves: PLAY })} />);
    const win = container.querySelector('.sl-board-fit')!;
    fireEvent.click(screen.getByRole('button', { name: /^Red card: Battle/ }));
    expect(win.getAttribute('data-zoom')).toBe('all');
    fireEvent.click(panel().querySelectorAll<HTMLButtonElement>('.sl-option')[0]!);
    expect(win.getAttribute('data-zoom')).toBe('3');
    expect(within(panel()).getByRole('button', { name: 'Move and battle' })).toBeTruthy();
    fireEvent.click(within(panel()).getByRole('button', { name: /Pick a different piece/ }));
    fireEvent.click(panel().querySelectorAll<HTMLButtonElement>('.sl-option')[1]!);
    expect(win.getAttribute('data-zoom')).toBe('all');
    fireEvent.click(within(panel()).getByRole('button', { name: /Pick a different piece/ }));
    fireEvent.click(panel().querySelectorAll<HTMLButtonElement>('.sl-option')[0]!);
    expect(win.getAttribute('data-zoom')).toBe('3');
    fireEvent.click(within(panel()).getByRole('button', { name: /Pick a different piece/ }));
    fireEvent.click(within(panel()).getByRole('button', { name: 'Put back' }));
    expect(win.getAttribute('data-zoom')).toBe('all');
  });

  it('names each card with its line too, and moves the trade-in into the panel', () => {
    render(<SlScreen {...phoneProps({ legalMoves: PLAY })} />);
    expect(screen.getByRole('button', { name: 'Red card: Battle · Best with your Knight' })).toBeTruthy();
    const hand = screen.getByRole('region', { name: 'Your hand' });
    expect(within(hand).queryByRole('button', { name: /^Trade/ })).toBeNull();
    fireEvent.click(within(panel()).getByRole('button', { name: /^Trade 4 cards/ }));
    expect(screen.getByRole('dialog', { name: 'Trade 4 cards for one color' })).toBeTruthy();
  });

  it('a battle takes the place of the turn panel and the hand, never the board', () => {
    const view = { ...SL_SCREEN_VIEW, last_battle: { id: 1, round: 4, kind: 'knight', attacker: { player_id: 'p1', faces: [3, 0, 2, 1], total: 6 }, defender: { player_id: 'p2', foe: null, faces: [1, 0, 0], total: 1 }, winner: 'attacker' } };
    const { container, rerender } = render(<SlScreen {...phoneProps({ legalMoves: [] }, { yourTurn: false })} />);
    rerender(<SlScreen {...phoneProps({ view, legalMoves: [] }, { yourTurn: false })} />);
    const under = container.querySelector('.sl-under')!;
    expect(within(under as HTMLElement).getByRole('heading', { name: 'Battle!' })).toBeTruthy();
    expect(within(under as HTMLElement).queryByRole('region', { name: 'Your hand' })).toBeNull();
    expect(under.querySelectorAll('.sl-battle-side img')).toHaveLength(2);
    expect(container.querySelector('.sl-board-fit')).toBeTruthy();
    fireEvent.click(within(under as HTMLElement).getByRole('button', { name: 'Continue' }));
    expect(within(under as HTMLElement).getByRole('region', { name: 'Your hand' })).toBeTruthy();
  });
});

describe('the menu stops under the board (item 2)', () => {
  it('tells the table where the board ends, so the menu sheet can start there', () => {
    const spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const bottom = this.classList.contains('sl-board-fit') ? 412.5 : 0;
      return { top: 0, left: 0, right: 0, bottom, width: 0, height: bottom, x: 0, y: 0, toJSON() {} } as DOMRect;
    });
    const shell = document.createElement('div');
    shell.className = 'table-shell';
    document.body.appendChild(shell);
    render(<SlScreen {...phoneProps()} />, { container: shell });
    expect(shell.style.getPropertyValue('--sl-under-board')).toBe('413px');
    spy.mockRestore();
    shell.remove();
  });

  it('leaves the desktop table alone', () => {
    const shell = document.createElement('div');
    shell.className = 'table-shell';
    document.body.appendChild(shell);
    render(<SlScreen {...slProps()} />, { container: shell });
    expect(shell.style.getPropertyValue('--sl-under-board')).toBe('');
    shell.remove();
  });
});
