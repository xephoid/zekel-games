// Adventurer Olympics on a phone (docs/games/adventurer-olympics-phone-build.md
// in zekel-universe, boards Phone-*.dc.html). Only where things sit changes:
// these tests check the phone layout holds everything the desktop table held,
// and that no rule, move or button changed on the way.

import { describe, expect, it, afterEach, beforeAll, afterAll, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LegalMove } from '@zekel/wire-types';
import type { GameScreenProps, GlueInput } from '@zekel/glue-kit';
import { isSubmissionAllowed } from '@zekel/glue-kit';
import { adventurerOlympicsGlue as g } from '../index.js';
import { AoScreen } from '../AoScreen.js';
import { mapNodes, players } from '../read.js';

afterEach(cleanup);
const widthDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
const heightDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 390 });
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

function input(f: Fixture, extra: Partial<GlueInput> = {}): GlueInput {
  return { view: f.view, previous: null, legalMoves: f.legalMoves, playerId: f.viewer, reference: null, seq: 1, engineMove: null, actorPlayerId: null, memory: new Map(), ...extra };
}

export function draw(f: Fixture, extra: Partial<GameScreenProps> = {}, inputExtra: Partial<GlueInput> = {}) {
  const onMove = vi.fn(); const onDraw = vi.fn(); const onForm = vi.fn();
  const roll = f.legalMoves.some((m) => m.move['type'] === 'resolve_report');
  const inp = input(f, { phone: true, ...inputExtra });
  const utils = render(<AoScreen input={inp} yourTurn busy={false} interactive nameFor={(p) => p} onMove={onMove} onForm={onForm} onDraw={roll ? onDraw : undefined} phone {...extra} />);
  return { ...utils, onMove, onDraw, onForm };
}
void screen; void within; void fireEvent;

describe('the screen on a phone: the frame', () => {
  it('marks itself as the phone layout, and draws no side column and no numbered menu', () => {
    const { container } = draw(fx('move'), { menu: <div className="test-menu">1. Step</div> });
    expect(container.querySelector('.ao-screen.phone')).not.toBeNull();
    expect(container.querySelector('.ao-side, .ao-side-inline')).toBeNull();
    expect(container.querySelector('.test-menu')).toBeNull();
  });

  it('the "You" row: your adventurer, your three stats, coins left and quest points, read from the view, as one button', () => {
    const f = fx('move');
    const me = f.view.players.find((p: any) => p.player_id === f.viewer);
    const { container } = draw(f);
    const row = screen.getByRole('button', { name: /^Your adventurer, companions and quests/ });
    for (const [name, k] of [['Charisma', 'charisma'], ['Strength', 'strength'], ['Movement', 'movement']] as const) {
      expect(within(row).getByTitle(name).textContent).toBe(String(me.stats[k]));
    }
    expect(within(row).getByTitle('Coins left').textContent).toBe(String(me.tokensLeft));
    expect(within(row).getByTitle('Quest points').textContent).toBe(String(me.questPoints));
    // Your board's holdings are not drawn under the map on a phone; they are in the sheet.
    expect(container.querySelector('.ao-board, .ao-holdings')).toBeNull();
  });

  it('the action row: step pips, Explore and End turn send their listed moves; the hint is your board\'s hint', () => {
    const f = fx('move-can-explore');
    const { onMove, container } = draw(f);
    const row = container.querySelector<HTMLElement>('.ao-actions')!;
    expect(row).not.toBeNull();
    expect(row.querySelectorAll('.ao-pips i').length).toBe(f.view.players.find((p: any) => p.player_id === f.viewer).stats.movement);
    fireEvent.click(within(row).getByRole('button', { name: 'Explore' }));
    fireEvent.click(within(row).getByRole('button', { name: 'End turn' }));
    expect(onMove.mock.calls.map((c) => c[0].move)).toEqual([{ type: 'explore' }, { type: 'stop' }]);
    expect(container.querySelector('.ao-phone-hint')!.textContent).toBe('You are next to an empty slot. Explore now, or keep walking. Exploring ends your turn.');
  });

  it('Explore stays visible when it is greyed out, with the reason as its title', () => {
    const f = fx('move');
    draw(f, {}, { unavailable: [{ moveType: 'explore', reason: 'No empty slot touches your hex' } as any] });
    const b = screen.getByRole('button', { name: 'Explore' }) as HTMLButtonElement;
    expect(b.disabled).toBe(true);
    expect(b.title).toBe('No empty slot touches your hex');
  });

  it('after a failed test: "Stay and try again" is not hidden, and "Do nothing this turn" takes End turn\'s place', () => {
    const f = fx('try_again');
    const { onMove } = draw(f);
    expect(screen.queryByRole('button', { name: 'End turn' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Stay and try again' }));
    fireEvent.click(screen.getByRole('button', { name: 'Do nothing this turn' }));
    expect(onMove.mock.calls.map((c) => c[0].move.type)).toEqual(['try_again', 'stop']);
  });

  it('the deck strip keeps the decks (cards still fly from them) and shows only the runes still free', () => {
    const f = fx('move-late-multi');
    const { container } = draw(f);
    const strip = container.querySelector<HTMLElement>('.ao-strip')!;
    for (const d of ['companion', 'dungeon', 'little', 'big', 'tile']) expect(strip.querySelector(`[data-flip-id="ao:deck:${d}"]`), d).not.toBeNull();
    expect(strip.querySelector('.ao-runes .label')!.textContent).toBe('Free');
    expect(strip.querySelectorAll('.ao-rune-chip')).toHaveLength(f.view.artifactSupply.length);
    expect(strip.querySelector('.ao-rune-chip .who')).toBeNull();
  });

  it('keeps the desktop layout when not on a phone', () => {
    const { container } = draw(fx('move'), { phone: false, menu: <div className="test-menu">1. Step</div> }, { phone: false });
    expect(container.querySelector('.ao-screen')).not.toBeNull();
    expect(container.querySelector('.ao-screen.phone')).toBeNull();
    expect(container.querySelector('.ao-side-inline')).not.toBeNull();
    expect(container.querySelector('.test-menu')).not.toBeNull();
  });
});

describe('the glue on a phone', () => {
  it('says it has a phone layout', () => {
    expect(g.phone).toBe(true);
  });

  it('gives the round in a few letters for the phone top bar', () => {
    const f = fx('move');
    const plan = g.plan(input(f, { phone: true }))!;
    expect(plan.statusShort).toBe(`R${f.view.round}`);
    expect(plan.status).toMatch(/^Round \d+/);
  });

  it('places its own caption, and asks for the last move in the phone menu too (Phone-Menu)', () => {
    expect(g.placesCaption).toBe(true);
    expect((g as { captionInPhoneMenu?: boolean }).captionInPhoneMenu).toBe(true);
  });

  it('says just "Your turn" on a phone; the steps are the pips in the action row', () => {
    const f = fx('move');
    expect(g.yourTurnLabel!(input(f, { phone: true }))).toBe('Your turn');
    expect(g.yourTurnLabel!(input(f))).toMatch(/^Your turn · \d+ steps? left$/);
  });
});

describe('the adventurer sheet (Phone-Sheet)', () => {
  // A late view: several companions, monsters and quests to show.
  const pickLate = () => FIXTURES.find((f) => f.key === 'move-late-multi') ?? fx('move-late');

  it('the "You" row opens it; opening sends nothing; Close shuts it', () => {
    const f = pickLate();
    const { onMove, onDraw } = draw(f);
    expect(screen.queryByRole('dialog', { name: 'Your adventurer' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Your adventurer, companions and quests/ }));
    const sheet = screen.getByRole('dialog', { name: 'Your adventurer' });
    expect(within(sheet).getAllByRole('tab').map((t) => t.textContent)).toEqual(['You', 'Everyone', 'Quests']);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog', { name: 'Your adventurer' })).toBeNull();
    expect(onMove).not.toHaveBeenCalled(); expect(onDraw).not.toHaveBeenCalled();
  });

  it('You: your stats, this turn, your companions, monsters, runes, coins, tiles and dungeons, as your board has them', () => {
    const f = pickLate();
    const me = f.view.players.find((p: any) => p.player_id === f.viewer);
    draw(f);
    fireEvent.click(screen.getByRole('button', { name: /^Your adventurer, companions and quests/ }));
    const sheet = screen.getByRole('dialog', { name: 'Your adventurer' });
    expect(within(sheet).getByRole('tab', { name: 'You' }).getAttribute('aria-selected')).toBe('true');
    expect(sheet.querySelectorAll('.ao-stat')).toHaveLength(3);
    expect(within(sheet).getByText(`Companions ${me.companions.length}`)).toBeTruthy();
    expect(within(sheet).getByText('Monsters beaten')).toBeTruthy();
    expect(within(sheet).getByText(`Runes ${me.artifacts.length}`)).toBeTruthy();
    expect(within(sheet).getByText(`Coins left ${me.tokensLeft} of ${f.view.referenceData.tokensPerColour}`)).toBeTruthy();
    expect(sheet.textContent).toContain(`Tiles explored ${me.exploredTiles.length}`);
    expect(sheet.textContent).toContain(`Dungeons done ${me.dungeonsCompleted}`);
    expect(within(sheet).getByText('This turn')).toBeTruthy();
    // No rule restated in the sheet: "This turn" says what your board's hint says, read from the view.
    expect(sheet.textContent).not.toMatch(/Walk up to|Step onto an open icon|explore from an edge hex/);
    expect(sheet.querySelector('.ao-this-turn .hint')!.textContent).toBe(document.querySelector('.ao-phone-hint')!.textContent);
    // Each kept card is in the sheet once.
    for (const c of [...me.companions, ...me.littleMonsters, ...me.bigMonsters].slice(-1)) {
      expect(sheet.querySelector(`[data-flip-id$="${c}"]`), c).not.toBeNull();
    }
  });

  it('Everyone: turn order and every other seat; Quests: every quest in play', () => {
    const f = pickLate();
    draw(f);
    fireEvent.click(screen.getByRole('button', { name: /^Your adventurer, companions and quests/ }));
    const sheet = screen.getByRole('dialog', { name: 'Your adventurer' });
    fireEvent.click(within(sheet).getByRole('tab', { name: 'Everyone' }));
    expect(within(sheet).getByRole('tab', { name: 'Everyone' }).getAttribute('aria-selected')).toBe('true');
    expect(sheet.querySelector('.ao-order-strip')!.querySelectorAll('.chip')).toHaveLength(f.view.players.length);
    expect(sheet.querySelectorAll('.ao-seat')).toHaveLength(f.view.players.length - 1);
    fireEvent.click(within(sheet).getByRole('tab', { name: 'Quests' }));
    const quests = Array.isArray(f.view.quests) && f.view.quests.length ? f.view.quests.length : Object.keys(f.view.inPlayQuests).length;
    expect(quests).toBeGreaterThan(0);
    expect(sheet.querySelectorAll('.ao-quest')).toHaveLength(quests);
  });

  it('the tabs work from the keyboard: one tab stop, arrows, Home and End; each tab controls a panel that is there', () => {
    draw(pickLate());
    fireEvent.click(screen.getByRole('button', { name: /^Your adventurer, companions and quests/ }));
    const sheet = screen.getByRole('dialog', { name: 'Your adventurer' });
    const tabs = within(sheet).getAllByRole('tab');
    const selected = () => tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true');
    expect(tabs.map((t) => t.tabIndex)).toEqual([0, -1, -1]);
    for (const t of tabs) {
      const panel = document.getElementById(t.getAttribute('aria-controls')!);
      expect(panel, t.textContent!).not.toBeNull();
      expect(panel!.getAttribute('role')).toBe('tabpanel');
      expect(panel!.getAttribute('aria-labelledby')).toBe(t.id);
    }
    tabs[0]!.focus();
    fireEvent.keyDown(tabs[0]!, { key: 'ArrowRight' });
    expect(selected()).toBe(1); expect(document.activeElement).toBe(tabs[1]);
    expect(tabs.map((t) => t.tabIndex)).toEqual([-1, 0, -1]);
    expect(document.getElementById(tabs[1]!.getAttribute('aria-controls')!)!.hidden).toBe(false);
    expect(document.getElementById(tabs[0]!.getAttribute('aria-controls')!)!.hidden).toBe(true);
    fireEvent.keyDown(tabs[1]!, { key: 'End' });
    expect(selected()).toBe(2); expect(document.activeElement).toBe(tabs[2]);
    fireEvent.keyDown(tabs[2]!, { key: 'ArrowRight' });
    expect(selected()).toBe(0);
    fireEvent.keyDown(tabs[0]!, { key: 'ArrowLeft' });
    expect(selected()).toBe(2);
    fireEvent.keyDown(tabs[2]!, { key: 'Home' });
    expect(selected()).toBe(0); expect(document.activeElement).toBe(tabs[0]);
  });

  it('while the sheet is open, no flip id is drawn twice (the row\'s pile steps aside for the sheet)', () => {
    const f = pickLate();
    const { container } = draw(f);
    const ids = () => [...document.querySelectorAll('[data-flip-id]')].map((e) => e.getAttribute('data-flip-id'));
    const dup = (xs: (string | null)[]) => xs.filter((x, i) => xs.indexOf(x) !== i);
    expect(dup(ids())).toEqual([]);
    const me = f.view.players.find((p: any) => p.player_id === f.viewer);
    const kept = [...me.companions, ...me.littleMonsters, ...me.bigMonsters, ...me.artifacts];
    expect(kept.length).toBeGreaterThan(0);
    expect(container.querySelectorAll('.ao-you-catch [data-flip-id]')).toHaveLength(kept.length);
    fireEvent.click(screen.getByRole('button', { name: /^Your adventurer, companions and quests/ }));
    expect(dup(ids())).toEqual([]);
    expect(container.querySelector('.ao-you-catch')).toBeNull();
  });
});

describe('the map on a phone (Phone-Table)', () => {
  it('the legend is behind a Key button that opens and closes it; zoom stays', () => {
    const { container } = draw(fx('move'));
    expect(container.querySelector('.ao-legend')).toBeNull();
    const key = screen.getByRole('button', { name: 'Key' });
    expect(key.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(key);
    expect(container.querySelector('.ao-legend')).not.toBeNull();
    expect(key.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(key);
    expect(container.querySelector('.ao-legend')).toBeNull();
    for (const name of ['Zoom in', 'Zoom out', 'Fit']) expect(screen.getByRole('button', { name })).toBeTruthy();
  });

  it('draws a hex at the boards\' size, radius 28 (48 px tall), so a hex you step onto is a touch target', () => {
    const { container } = draw(fx('move'));
    const hex = container.querySelector<HTMLElement>('.zk-hex.zk-lit:not(.ghost)')!;
    expect(parseFloat(hex.style.width)).toBeCloseTo(56);
    expect(parseFloat(hex.style.height)).toBeGreaterThanOrEqual(44);
  });

  it('on a desktop the legend is always there and there is no Key button', () => {
    const { container } = draw(fx('move'), { phone: false }, { phone: false });
    expect(container.querySelector('.ao-legend')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Key' })).toBeNull();
  });
});

describe('the panels become bottom sheets on a phone (Phone-Test, Phone-Explore)', () => {
  const sheetOf = (c: HTMLElement) => c.querySelector<HTMLElement>('.ao-phone-sheet');

  it('a test: a sheet below the map, the beats strip on Draw, the dock gives way, the tester\'s hex picked out', () => {
    const f = fx('draw-companion');
    const { container, onDraw, onMove } = draw(f);
    const sheet = sheetOf(container)!;
    expect(sheet).not.toBeNull();
    expect(container.querySelector('.ao-map .ao-panels')).toBeNull();
    const test = within(sheet).getByRole('region', { name: 'The test' });
    const beats = within(test).getByRole('list', { name: 'The steps of a test' });
    expect(within(beats).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Step', 'Draw', 'Roll', 'Result']);
    expect(within(beats).getByText('Draw').closest('li')!.getAttribute('aria-current')).toBe('step');
    expect(container.querySelector('.ao-dock')).toBeNull();
    // The map is still there above the sheet, the tester's hex picked out.
    const me = f.view.players.find((p: any) => p.player_id === f.viewer);
    expect(container.querySelector('.ao-map .zk-hexmap')).not.toBeNull();
    const node = mapNodes(f.view, input(f), players(f.view)).find((n) => n.id === `ao:hex:${me.hex}`)!;
    const picked = [...container.querySelectorAll('.zk-hex.selected')];
    expect(picked).toHaveLength(1);
    expect(picked[0]!.getAttribute('aria-label')!.startsWith(node.label)).toBe(true);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Draw a card' }));
    expect(onDraw).toHaveBeenCalledTimes(1); expect(onMove).not.toHaveBeenCalled();
  });

  it('the roll: the beat moves on to Roll, and Roll is still a press', () => {
    const f = fx('roll-test');
    const { container, onDraw, onMove } = draw(f);
    const beats = within(sheetOf(container)!).getByRole('list', { name: 'The steps of a test' });
    expect(within(beats).getByText('Roll').closest('li')!.getAttribute('aria-current')).toBe('step');
    fireEvent.click(within(sheetOf(container)!).getByRole('button', { name: /^Roll \d (die|dice)$/ }));
    expect(onDraw).toHaveBeenCalledTimes(1); expect(onMove).not.toHaveBeenCalled();
  });

  it('just after the roll: how it went shows over the map, the dock is back, and a kept card is caught by the "You" row', () => {
    const f = fx('after-roll-test');
    const me = f.view.players.find((p: any) => p.player_id === f.viewer);
    const kept = [...me.companions, ...me.littleMonsters, ...me.bigMonsters];
    const cardId = kept[0] ?? 'little-1';
    const previous = { ...f.view, pending: { kind: 'roll', seat: f.viewer, payload: { rollKind: 'test', test: 'recruit', cardId } } };
    const { container } = draw(f, {}, { previous });
    const result = container.querySelector<HTMLElement>('.ao-map .ao-panel.result')!;
    expect(result).not.toBeNull();
    expect(result.querySelectorAll('.ao-die').length).toBe(f.view.lastRoll.dice.length);
    expect(sheetOf(container)).toBeNull();
    expect(container.querySelector('.ao-dock')).not.toBeNull();
    if (kept.includes(cardId)) {
      // The card's one flip id is in the row, not on the result's copy.
      expect(container.querySelectorAll(`[data-flip-id$="${cardId}"]`)).toHaveLength(1);
      expect(container.querySelector(`.ao-you-catch [data-flip-id$="${cardId}"]`)).not.toBeNull();
    }
  });

  it('someone else\'s kept card has no pile on a phone, so the result\'s copy keeps its flip id', () => {
    const f = fx('after-roll-test');
    const other = f.view.players.find((p: any) => p.player_id !== f.viewer && p.companions.length === 0)!;
    const tester = f.view.players.find((p: any) => p.companions.length > 0)!;
    const cardId = tester.companions[0];
    const previous = { ...f.view, pending: { kind: 'roll', seat: tester.player_id, payload: { rollKind: 'test', test: 'recruit', cardId } } };
    const { container } = draw(f, { yourTurn: false }, { previous, playerId: other.player_id });
    const result = container.querySelector<HTMLElement>('.ao-map .ao-panel.result')!;
    expect(result.textContent).toContain('keeps');
    expect(result.querySelector(`[data-flip-id$="${cardId}"]`)).not.toBeNull();
    expect(container.querySelectorAll(`[data-flip-id$="${cardId}"]`)).toHaveLength(1);
  });

  it('a Dungeon\'s second fight already up: someone else\'s kept card still lands on the result over the map', () => {
    // A view where a draw is up and some seat holds a card it could just have kept.
    const keptBy = (p: any) => [...p.companions, ...p.littleMonsters, ...p.bigMonsters];
    const f = FIXTURES.find((x) => x.view.pending?.kind === 'draw' && x.view.pending.payload?.deck !== 'tile' && x.view.lastRoll
      && x.view.players.some((p: any) => keptBy(p).length > 0))!;
    expect(f).toBeTruthy();
    const tester = f.view.players.find((p: any) => keptBy(p).length > 0)!;
    const cardId = keptBy(tester).at(-1);
    const viewer = f.view.players.find((p: any) => p.player_id !== tester.player_id)!;
    const previous = { ...f.view, pending: { kind: 'roll', seat: tester.player_id, payload: { rollKind: 'test', test: 'little', cardId, dungeon: true } } };
    const { container } = draw(f, { yourTurn: false }, { previous, playerId: viewer.player_id });
    expect(container.querySelector('.ao-phone-sheet .ao-test')).not.toBeNull();
    const result = container.querySelector<HTMLElement>('.ao-map .ao-panel.result')!;
    expect(result).not.toBeNull();
    expect(result.querySelector(`[data-flip-id$="${cardId}"]`)).not.toBeNull();
    expect(container.querySelectorAll(`[data-flip-id$="${cardId}"]`)).toHaveLength(1);
  });

  it('with Everyone or Quests showing, your kept cards land on the You tab; back on You, in your holdings', () => {
    const f = FIXTURES.find((x) => x.key === 'move-late-multi') ?? fx('move-late');
    const me = f.view.players.find((p: any) => p.player_id === f.viewer);
    const kept = [...me.companions, ...me.littleMonsters, ...me.bigMonsters, ...me.artifacts];
    expect(kept.length).toBeGreaterThan(0);
    draw(f);
    fireEvent.click(screen.getByRole('button', { name: /^Your adventurer, companions and quests/ }));
    const sheet = screen.getByRole('dialog', { name: 'Your adventurer' });
    const ids = () => [...document.querySelectorAll('[data-flip-id]')].map((e) => e.getAttribute('data-flip-id'));
    const dup = () => { const xs = ids(); return xs.filter((x, i) => xs.indexOf(x) !== i); };
    for (const name of ['Everyone', 'Quests']) {
      fireEvent.click(within(sheet).getByRole('tab', { name }));
      const youTab = within(sheet).getByRole('tab', { name: 'You' });
      expect(youTab.querySelectorAll('.ao-you-catch [data-flip-id]'), name).toHaveLength(kept.length);
      expect(sheet.querySelector('#ao-tabpanel-you [data-flip-id]'), name).toBeNull();
      expect(dup(), name).toEqual([]);
    }
    fireEvent.click(within(sheet).getByRole('tab', { name: 'You' }));
    expect(sheet.querySelector('[role="tab"] .ao-you-catch')).toBeNull();
    expect(sheet.querySelector('#ao-tabpanel-you [data-flip-id]')).not.toBeNull();
    expect(dup()).toEqual([]);
  });

  it('while a panel is up, the top of the sheet opens the adventurer sheet and holds your pile; opening sends nothing', () => {
    const ups = ['take_artifact', 'draw-companion', 'roll-test', 'explore_place-ordinary', 'roll-turn_order'];
    for (const key of ups) {
      const f = fx(key);
      const me = f.view.players.find((p: any) => p.player_id === f.viewer);
      const kept = [...me.companions, ...me.littleMonsters, ...me.bigMonsters, ...me.artifacts];
      const { container, onMove, onDraw, onForm } = draw(f);
      const sheet = sheetOf(container)!;
      expect(sheet, key).not.toBeNull();
      const opener = within(sheet).getByRole('button', { name: /^Your adventurer, companions and quests/ });
      expect(opener.querySelectorAll('.ao-you-catch [data-flip-id]'), key).toHaveLength(kept.length);
      fireEvent.click(opener);
      const dialog = screen.getByRole('dialog', { name: 'Your adventurer' });
      fireEvent.click(within(dialog).getByRole('tab', { name: 'Quests' }));
      expect(document.getElementById('ao-tabpanel-quests')!.hidden, key).toBe(false);
      // The pile steps aside for the open sheet: no flip id drawn twice.
      const ids = [...document.querySelectorAll('[data-flip-id]')].map((e) => e.getAttribute('data-flip-id'));
      expect(ids.filter((x, i) => ids.indexOf(x) !== i), key).toEqual([]);
      expect(onMove).not.toHaveBeenCalled(); expect(onDraw).not.toHaveBeenCalled(); expect(onForm).not.toHaveBeenCalled();
      cleanup();
    }
  });

  it('exploring: a short sheet with the tile, Turn left, Turn right and Place tile; the slots stay on the map', () => {
    const f = fx('explore_place-ordinary');
    const { container, onMove } = draw(f);
    const sheet = sheetOf(container)!;
    expect(within(sheet).getByRole('region', { name: 'Exploring' })).toBeTruthy();
    expect(container.querySelector('.ao-dock')).toBeNull();
    const slot = container.querySelector<HTMLElement>('.ao-map .zk-hex.ghost.zk-lit')!;
    expect(slot).not.toBeNull();
    fireEvent.click(slot);
    expect(onMove).not.toHaveBeenCalled();
    fireEvent.click(within(sheet).getByRole('button', { name: /Turn left/ }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Place tile' }));
    expect(onMove).toHaveBeenCalledTimes(1);
    const sent = onMove.mock.calls[0]![0].move;
    expect(sent).toMatchObject({ type: 'explore', rotation: 1 });
    expect(isSubmissionAllowed('tap', sent, f.legalMoves)).toBe(true);
  });

  it('"Any rune", the roll for turn order and setup use the same bottom sheet', () => {
    for (const key of ['take_artifact', 'roll-turn_order', 'setup_standee_colour']) {
      const { container } = draw(fx(key));
      const sheet = sheetOf(container);
      expect(sheet, key).not.toBeNull();
      expect(sheet!.querySelector('.ao-panel'), key).not.toBeNull();
      expect(container.querySelector('.ao-map .ao-centre, .ao-map .ao-panels'), key).toBeNull();
      cleanup();
    }
  });

  it('the caption sits over the top of the map while others play, and gives way on your turn', () => {
    const caption = <div className="test-caption">Purple draws the Goat.</div>;
    const watching = draw(fx('move-late-multi'), { caption, yourTurn: false });
    expect(watching.container.querySelector('.ao-map > .ao-phone-caption .test-caption')).not.toBeNull();
    cleanup();
    const mine = draw(fx('move'), { caption });
    expect(mine.container.querySelector('.test-caption')).toBeNull();
  });
});

describe('agency on a phone', () => {
  it('draws every captured view, and drawing sends nothing', () => {
    for (const f of FIXTURES) {
      const { onMove, onDraw, onForm, container } = draw(f);
      expect(container.querySelector('.ao-screen.phone'), f.key).not.toBeNull();
      expect(onMove).not.toHaveBeenCalled(); expect(onDraw).not.toHaveBeenCalled(); expect(onForm).not.toHaveBeenCalled();
      cleanup();
    }
  });

  it('a watcher with no seat can still open the players and the quests, and opening sends nothing', () => {
    const f = fx('move-late-multi');
    const { container, onMove, onDraw, onForm } = draw(f, { interactive: false, yourTurn: false }, { view: f.watcherView, legalMoves: [], playerId: null });
    expect(screen.queryByRole('button', { name: /^Your adventurer/ })).toBeNull();
    fireEvent.click(within(container.querySelector<HTMLElement>('.ao-dock')!).getByRole('button', { name: /Players and quests/ }));
    const sheet = screen.getByRole('dialog', { name: 'Players and quests' });
    expect(within(sheet).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Everyone', 'Quests']);
    expect(within(sheet).getByRole('tab', { name: 'Everyone' }).getAttribute('aria-selected')).toBe('true');
    expect(sheet.querySelector('.ao-order-strip')!.querySelectorAll('.chip')).toHaveLength(f.watcherView.players.length);
    expect(sheet.querySelectorAll('.ao-seat')).toHaveLength(f.watcherView.players.length);
    fireEvent.click(within(sheet).getByRole('tab', { name: 'Quests' }));
    expect(document.getElementById('ao-tabpanel-quests')!.hidden).toBe(false);
    expect(sheet.querySelectorAll('.ao-quest').length).toBeGreaterThan(0);
    expect(onMove).not.toHaveBeenCalled(); expect(onDraw).not.toHaveBeenCalled(); expect(onForm).not.toHaveBeenCalled();
  });

  it('a watcher with no seat can open them while a test is up too', () => {
    const f = fx('draw-companion-multi');
    const { container } = draw(f, { interactive: false, yourTurn: false }, { view: f.watcherView, legalMoves: [], playerId: null });
    const sheet = container.querySelector<HTMLElement>('.ao-phone-sheet')!;
    expect(sheet).not.toBeNull();
    fireEvent.click(within(sheet).getByRole('button', { name: /Players and quests/ }));
    expect(screen.getByRole('dialog', { name: 'Players and quests' })).toBeTruthy();
  });

  it('a watcher sees the phone table and can press nothing that moves', () => {
    const f = fx('move-late-multi');
    const { container, onMove, onDraw } = draw(f, { interactive: false, yourTurn: false });
    for (const el of container.querySelectorAll<HTMLElement>('.zk-hex')) fireEvent.click(el);
    for (const b of container.querySelectorAll<HTMLButtonElement>('.ao-actions button')) expect(b.disabled).toBe(true);
    expect(onMove).not.toHaveBeenCalled(); expect(onDraw).not.toHaveBeenCalled();
  });
});
