// The NGnG screen on a phone (the Phone-* boards), drawn from views the
// engine actually produced: the same decisions as the desktop table, laid out
// in one column with the map always in view. Nothing here checks a pixel;
// it checks that nothing is lost, nothing private leaks, and nothing is sent
// without a press.

import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, within } from '@testing-library/react';
import type { GameReferenceResponse, LegalMove } from '@zekel/wire-types';
import type { GlueInput } from '@zekel/glue-kit';
import { NggScreen } from '../table/NggScreen.js';
import nggGlue from '../table/index.js';
import { readView } from '../table/read.js';
import REFERENCE from './fixtures/ngg-reference.json';

interface Fixture {
  key: string;
  viewer: string;
  view: unknown;
  legalMoves: LegalMove[];
  watcher: string;
  watcherView: unknown;
  watcherLegalMoves: LegalMove[];
}
interface RawPlayer { player_id: string; faction?: string; culture: number; battle_hand_count?: number }
interface RawView { players: RawPlayer[]; your_battle_hand?: Array<{ card?: string; label?: string }>; round: number }

const FIXTURES = Object.entries(import.meta.glob<Fixture>('./fixtures/ngg/*.json', { eager: true, import: 'default' }))
  .map(([path, f]) => ({ name: path.replace(/^.*\//, '').replace(/\.json$/, ''), f }));
const fixture = (name: string) => FIXTURES.find((x) => x.name === name)!.f;

function inputFor(view: unknown, playerId: string, legalMoves: LegalMove[], phone = true): GlueInput {
  return {
    view, previous: null, legalMoves, playerId, reference: REFERENCE as GameReferenceResponse, seq: 1,
    engineMove: null, actorPlayerId: null, memory: new Map(), phone,
  };
}

function draw(f: Fixture, opts: { phone?: boolean; watcher?: boolean } = {}) {
  const phone = opts.phone ?? true;
  const onMove = vi.fn();
  const onForm = vi.fn();
  const input = opts.watcher ? inputFor(f.watcherView, f.watcher, f.watcherLegalMoves, phone) : inputFor(f.view, f.viewer, f.legalMoves, phone);
  const r = render(<NggScreen input={input} yourTurn={!opts.watcher} busy={false} interactive onMove={onMove} onForm={onForm} nameFor={(p) => p} phone={phone} />);
  return { ...r, onMove, onForm };
}

afterEach(cleanup);

describe('NGnG on a phone', () => {
  for (const { name, f } of FIXTURES) {
    it(`${name}: draws in one column for the deciding seat and a watcher, and sends nothing on its own`, () => {
      const a = draw(f);
      const root = a.container.querySelector('.ngg-root.phone');
      expect(root).not.toBeNull();
      // The map and the seats row are always there; the desktop's side column and strip are not.
      expect(root!.querySelector('.ngg-map-box.phone')).not.toBeNull();
      expect(root!.querySelector('.ngg-peek')).not.toBeNull();
      expect(root!.querySelector('.ngg-column')).toBeNull();
      expect(root!.querySelector('.ngg-strip')).toBeNull();
      expect(a.onMove).not.toHaveBeenCalled();
      expect(a.onForm).not.toHaveBeenCalled();
      cleanup();
      const b = draw(f, { watcher: true });
      expect(b.container.querySelector('.ngg-root.phone')).not.toBeNull();
      // A watcher never has a live control for the decision.
      expect(b.container.querySelectorAll('button.ngg-option:not(:disabled)')).toHaveLength(0);
      expect(b.onMove).not.toHaveBeenCalled();
      expect(b.onForm).not.toHaveBeenCalled();
    });
  }

  it('draws the same decision as the desktop table: every option and button, by its words', () => {
    for (const { f } of FIXTURES) {
      const desk = draw(f, { phone: false });
      const words = (root: Element) => [...root.querySelectorAll('.ngg-option-title, .ngg-btn.primary')].map((e) => e.textContent).sort();
      // The desktop's column also holds Seats; the decision's own options and buttons are what must match.
      const want = words(desk.container.querySelector('.ngg-column')!);
      cleanup();
      const phone = draw(f);
      const got = words(phone.container.querySelector('.ngg-root.phone')!);
      for (const w of want) expect(got).toContain(w);
      cleanup();
    }
  });

  it('the desktop table is unchanged: no phone parts without the phone flag', () => {
    const r = draw(fixture('phase-planning'), { phone: false });
    expect(r.container.querySelector('.ngg-root.phone')).toBeNull();
    expect(r.container.querySelector('.ngg-peek')).toBeNull();
    expect(r.container.querySelector('.ngg-column')).not.toBeNull();
  });

  it('the seats row prints every seat\'s culture, the viewer first, and opens the seats sheet', () => {
    const f = fixture('phase-planning-multi');
    const view = f.view as RawView;
    const r = draw(f);
    const peek = r.container.querySelector('.ngg-peek')!;
    const shown = [...peek.querySelectorAll('.ngg-peek-seat b')].map((b) => b.textContent);
    const mine = view.players.find((p) => p.player_id === f.viewer)!;
    expect(shown).toHaveLength(view.players.length);
    expect(shown[0]).toBe(String(mine.culture));
    expect(peek.querySelector('.ngg-peek-seat')!.className).toContain('you');
    expect(r.container.querySelector('.ngg-phone-seats')).toBeNull();
    fireEvent.click(peek);
    const sheet = r.container.querySelector('.ngg-phone-seats')!;
    expect(sheet.getAttribute('role')).toBe('dialog');
    expect(sheet.querySelectorAll('.ngg-phone-seat')).toHaveLength(view.players.length);
    expect(sheet.querySelectorAll('.ngg-rail-mark')).toHaveLength(view.players.length);
    // Heroes and Treaties are still one press away, as in the desktop's Seats panel.
    fireEvent.click(within(sheet as HTMLElement).getByText(/^Treaties/));
    expect(r.container.querySelector('.ngg-treaties-sheet')).not.toBeNull();
    fireEvent.click(r.container.querySelector('.ngg-treaties-sheet .close')!);
    fireEvent.click(within(sheet as HTMLElement).getByText('Heroes'));
    expect(r.container.querySelector('.ngg-heroes-sheet')).not.toBeNull();
    fireEvent.click(r.container.querySelector('.ngg-heroes-sheet .close')!);
    fireEvent.click(sheet.querySelector('.ngg-phone-close')!);
    expect(r.container.querySelector('.ngg-phone-seats')).toBeNull();
    expect(r.onMove).not.toHaveBeenCalled();
  });

  it('a seat opens its faction board as a panel in four tabs, and each tab draws its part', () => {
    const f = fixture('phase-planning-multi');
    const r = draw(f);
    fireEvent.click(r.container.querySelector('.ngg-peek')!);
    fireEvent.click(r.container.querySelector('.ngg-phone-seat.you')!);
    const panel = r.container.querySelector('.ngg-phone-faction') as HTMLElement;
    expect(panel.getAttribute('aria-label')).toBe('Your faction board');
    const tabs = [...panel.querySelectorAll('[role="tab"]')];
    expect(tabs.map((t) => t.textContent)).toEqual(['Board', 'Cards', 'Research', 'Treaties']);
    const titles = () => [...panel.querySelectorAll('.ngg-panel-title')].map((t) => t.textContent);
    expect(tabs[0]!.getAttribute('aria-selected')).toBe('true');
    expect(titles()).toEqual(expect.arrayContaining(['Buildings', 'Units', 'Heroes']));
    expect(titles()).not.toContain('Battle cards');
    fireEvent.click(tabs[1]!);
    expect(titles()).toEqual(['Battle cards', 'Action cards']);
    fireEvent.click(tabs[2]!);
    expect(titles()).toEqual(['Technology', 'Research']);
    expect(within(panel).getByText('Open the tech tree')).not.toBeNull();
    fireEvent.click(tabs[3]!);
    expect(titles()).toEqual(['Treaties']);
    fireEvent.click(within(panel).getByLabelText('Close the faction board'));
    expect(r.container.querySelector('.ngg-phone-faction')).toBeNull();
    expect(r.onMove).not.toHaveBeenCalled();
  });

  it('the four tabs together hold every part the desktop faction board has', () => {
    const f = fixture('phase-planning-multi');
    const desk = draw(f, { phone: false });
    fireEvent.click(desk.container.querySelector('button.ngg-seat.you')!);
    const want = [...desk.container.querySelectorAll('.ngg-board-sheet .ngg-panel-title')].map((t) => t.textContent);
    expect(want.length).toBeGreaterThan(5);
    cleanup();
    const r = draw(f);
    fireEvent.click(r.container.querySelector('.ngg-peek')!);
    fireEvent.click(r.container.querySelector('.ngg-phone-seat.you')!);
    const got = new Set<string | null>();
    for (const tab of r.container.querySelectorAll('.ngg-phone-faction [role="tab"]')) {
      fireEvent.click(tab);
      for (const t of r.container.querySelectorAll('.ngg-phone-faction .ngg-panel-title')) got.add(t.textContent);
    }
    for (const w of want) expect(got).toContain(w);
  });

  it('another seat\'s card and board never print what that seat holds', () => {
    // A seat that holds battle cards, seen by another seat.
    const found = FIXTURES.map(({ f }) => f).find((f) => ((f.view as RawView).your_battle_hand ?? []).length > 0 && f.watcher !== f.viewer);
    expect(found).toBeDefined();
    const f = found!;
    const names = ((f.view as RawView).your_battle_hand ?? []).map((c) => c.card ?? c.label ?? '').filter(Boolean);
    expect(names.length).toBeGreaterThan(0);
    const holderFaction = (f.watcherView as RawView).players.find((p) => p.player_id === f.viewer)?.faction ?? f.viewer;
    const r = draw(f, { watcher: true });
    fireEvent.click(r.container.querySelector('.ngg-peek')!);
    const sheet = r.container.querySelector('.ngg-phone-seats') as HTMLElement;
    const card = within(sheet).getByLabelText(`Open ${holderFaction}'s faction board`);
    expect(card.querySelector('.ngg-phone-seat-cards')!.textContent).toMatch(/face down$/);
    fireEvent.click(card);
    fireEvent.click(within(r.container.querySelector('.ngg-phone-faction') as HTMLElement).getByText('Cards'));
    const hand = r.container.querySelector('.ngg-phone-faction .ngg-fb-hand')!;
    expect(hand.querySelectorAll('.ngg-card-back').length).toBeGreaterThan(0);
    expect(hand.querySelector('.ngg-fb-card')).toBeNull();
  });

  it('a tile reads out on a press: its code, and what stands on it', () => {
    const f = fixture('phase-planning');
    const r = draw(f);
    const tile = readView(f.view)!.tiles[0]!;
    const hex = r.container.querySelector(`button.ngg-hex.readable[aria-label^="Read tile ${tile.label}"]`)!;
    expect(hex).not.toBeNull();
    fireEvent.click(hex);
    const readout = r.container.querySelector('.ngg-tile-readout')!;
    expect(readout.getAttribute('aria-label')).toBe(`Tile ${tile.label}`);
    expect(readout.querySelector('.ngg-float-title')!.textContent).toBe(tile.label);
    fireEvent.click(hex);
    expect(r.container.querySelector('.ngg-tile-readout')).toBeNull();
    expect(r.onMove).not.toHaveBeenCalled();
  });

  it('the map has the two zoom buttons, and no desktop zoom bar', () => {
    const r = draw(fixture('phase-planning'));
    expect(within(r.container).getByLabelText('Zoom in')).not.toBeNull();
    expect(within(r.container).getByLabelText('Zoom out')).not.toBeNull();
    expect(within(r.container).queryByText('Whole map')).toBeNull();
  });

  it('a lit tile is still pressed to choose it, not to read it', () => {
    const f = fixture('pending-choose_starting_location');
    const r = draw(f);
    const lit = r.container.querySelectorAll('button.ngg-hex.lit');
    expect(lit.length).toBeGreaterThan(0);
    for (const h of lit) expect(h.className).not.toContain('readable');
  });

  it('the decision sheet folds and unfolds, and keeps its options', () => {
    const r = draw(fixture('pending-treaty_response'));
    const handle = r.container.querySelector('.ngg-phone-handle');
    // An out-of-turn answer is drawn above everything; any other decision is in the sheet.
    if (!handle) { expect(r.container.querySelector('.ngg-interrupt')).not.toBeNull(); return; }
    fireEvent.click(handle);
    expect(r.container.querySelector('.ngg-phone-sheet.folded')).not.toBeNull();
    fireEvent.click(handle);
    expect(r.container.querySelector('.ngg-phone-sheet.folded')).toBeNull();
  });

  it('the glue asks for the phone frame and gives the top bar short words', () => {
    expect(nggGlue.phone).toBe(true);
    const f = fixture('action-build');
    const plan = nggGlue.plan!(inputFor(f.view, f.viewer, f.legalMoves)) as { statusShort?: string; titleShort?: string; status?: string };
    expect(plan.statusShort).toBe(`R${(f.view as RawView).round} · Build`);
    expect(plan.titleShort).toBe('NGnG');
    expect(plan.status).toContain('Round');
    // The turn pill's words change only on a phone.
    expect(nggGlue.yourTurnLabel!(inputFor(f.view, f.viewer, f.legalMoves, false))).toBeNull();
  });
});
