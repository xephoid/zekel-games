// The NGnG screen drawn from views the engine actually produced: every
// captured decision renders for the seat that owes it and for a seat that
// watches, and nothing is ever sent without a press.

import { describe, expect, it, vi } from 'vitest';
import { render, cleanup, fireEvent, within } from '@testing-library/react';
import type { GameReferenceResponse, LegalMove } from '@zekel/wire-types';
import type { GlueInput } from '@zekel/glue-kit';
import { NggScreen } from '../table/NggScreen.js';
import { initials } from '../table/factions.js';
import nggGlue from '../table/index.js';
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

const FIXTURES = Object.entries(import.meta.glob<Fixture>('./fixtures/ngg/*.json', { eager: true, import: 'default' }))
  .map(([path, f]) => ({ name: path.replace(/^.*\//, '').replace(/\.json$/, ''), f }));

function inputFor(view: unknown, playerId: string, legalMoves: LegalMove[]): GlueInput {
  return {
    view, previous: null, legalMoves, playerId, reference: REFERENCE as GameReferenceResponse, seq: 1,
    engineMove: null, actorPlayerId: null, memory: new Map(),
  };
}

describe('NGnG screen', () => {
  for (const { name, f } of FIXTURES) {
    it(`${name}: draws for the deciding seat and a watcher, and sends nothing on its own`, () => {
      const onMove = vi.fn();
      const onForm = vi.fn();
      const common = { busy: false, interactive: true, onMove, onForm, nameFor: (pid: string) => pid };
      const a = render(<NggScreen input={inputFor(f.view, f.viewer, f.legalMoves)} yourTurn {...common} />);
      expect(a.container.querySelector('.ngg-root')).not.toBeNull();
      cleanup();
      const b = render(<NggScreen input={inputFor(f.watcherView, f.watcher, f.watcherLegalMoves)} yourTurn={false} {...common} />);
      expect(b.container.querySelector('.ngg-root')).not.toBeNull();
      // A watcher never has a live control for the decision.
      expect(b.container.querySelectorAll('button.ngg-option:not(:disabled)')).toHaveLength(0);
      cleanup();
      expect(onMove).not.toHaveBeenCalled();
      expect(onForm).not.toHaveBeenCalled();
    });
  }

  it('prints a shut option with the engine\'s own reason', () => {
    const f = FIXTURES.find((x) => x.name === 'pending-treaty_break_decision-blocked')!.f;
    const pending = (f.view as { pending: { options: Array<{ blocked_reason?: string }> } }).pending;
    const reason = pending.options.find((o) => o.blocked_reason)!.blocked_reason!;
    const r = render(<NggScreen input={inputFor(f.view, f.viewer, f.legalMoves)} yourTurn busy={false} interactive onMove={vi.fn()} onForm={vi.fn()} nameFor={(p) => p} />);
    expect(r.container.textContent).toContain(reason);
    cleanup();
  });
  it("gives the whole page the seat's own faction theme, and a watcher the plain one", () => {
    const f = FIXTURES[0]!.f;
    expect(nggGlue.themeFor!(inputFor(f.view, f.viewer, f.legalMoves))).toMatch(/^ngg-theme ngg-theme-(wizard|robot)$/);
    expect(nggGlue.themeFor!(inputFor(null, 'nobody', []))).toBeNull();
  });

  it("places the table's move list in the column and the faction strip in the bench", () => {
    const f = FIXTURES[0]!.f;
    const bench = document.createElement('div');
    document.body.appendChild(bench);
    const r = render(<NggScreen input={inputFor(f.view, f.viewer, f.legalMoves)} yourTurn busy={false} interactive onMove={vi.fn()} onForm={vi.fn()} nameFor={(p) => p}
      menu={<div data-testid="menu">Moves</div>} benchSlot={bench} />);
    expect(r.container.querySelector('.ngg-column .ngg-menu [data-testid="menu"]')).not.toBeNull();
    expect(bench.querySelector('.ngg-strip')).not.toBeNull();
    expect(r.container.querySelector('.ngg-strip')).toBeNull();
    cleanup();
    bench.remove();
  });

  it('zooms the map by three stops, and pans only when zoomed in', () => {
    const f = FIXTURES[0]!.f;
    const r = render(<NggScreen input={inputFor(f.view, f.viewer, f.legalMoves)} yourTurn busy={false} interactive onMove={vi.fn()} onForm={vi.fn()} nameFor={(p) => p} />);
    const stop = (name: string) => r.getByRole('button', { name });
    expect(stop('Whole map').getAttribute('aria-pressed')).toBe('true');
    expect(r.container.querySelector('.ngg-map-scroll.panned')).toBeNull();
    fireEvent.click(stop('Hex'));
    expect(stop('Hex').getAttribute('aria-pressed')).toBe('true');
    expect(r.container.querySelector('.ngg-map-scroll.panned')).not.toBeNull();
    fireEvent.keyDown(r.container.querySelector('.ngg-map-scroll')!, { key: '0' });
    expect(stop('Whole map').getAttribute('aria-pressed')).toBe('true');
    cleanup();
  });
  it('opens any seat\'s board from the seats, with a rival\'s hand face down', () => {
    const f = FIXTURES.find((x) => x.name === 'action-build-robot-mid')!.f;
    const view = structuredClone(f.view) as { players: Array<Record<string, unknown>>; your_hand?: unknown };
    // A list of owned collectors, as a newer engine publishes it.
    const rival = view.players.find((p) => p['player_id'] !== f.viewer)!;
    rival['collectors'] = [
      { collector: 'surf-1', type: 'Surf', placed_at: null },
      { collector: 'surf-2', type: 'Surf', placed_at: null },
      { collector: 'surf-3', type: 'Surf', placed_at: '3,5' },
    ];
    const r = render(<NggScreen input={inputFor(view, f.viewer, f.legalMoves)} yourTurn busy={false} interactive onMove={vi.fn()} onForm={vi.fn()} nameFor={(p) => p} />);
    const open = [...r.container.querySelectorAll<HTMLButtonElement>('button.ngg-seat')].find((b) => !b.classList.contains('you'))!;
    fireEvent.click(open);
    const sheet = r.getByRole('dialog', { name: /faction board$/ });
    expect(sheet.getAttribute('aria-label')).not.toBe('Your faction board');
    const surf = [...sheet.querySelectorAll('.ngg-fb-unit')].find((u) => u.textContent?.includes('Surf'))!;
    expect(surf.querySelector('.ngg-fb-count')!.textContent).toBe('×3');
    expect(surf.textContent).toContain('1 on the map');
    // Only card backs: a rival's hand is never named.
    expect(sheet.querySelectorAll('.ngg-fb-card')).toHaveLength(0);
    cleanup();
  });

  it('names a piece on hover and opens its details on a press where the hex is not part of the decision', () => {
    const f = FIXTURES.find((x) => x.name === 'action-build-robot-mid')!.f;
    const onMove = vi.fn();
    const r = render(<NggScreen input={inputFor(f.watcherView, f.watcher, f.watcherLegalMoves)} yourTurn={false} busy={false} interactive onMove={onMove} onForm={vi.fn()} nameFor={(p) => p} />);
    const piece = r.container.querySelector<HTMLButtonElement>('button.ngg-piece-btn')!;
    expect(piece.querySelector('[title]')!.getAttribute('title')).toMatch(/ · /);
    fireEvent.click(piece);
    expect(r.getByRole('dialog', { name: /^Pieces at / })).toBeTruthy();
    fireEvent.click(r.getByRole('button', { name: 'Close' }));
    expect(r.queryByRole('dialog', { name: /^Pieces at / })).toBeNull();
    expect(onMove).not.toHaveBeenCalled();
    cleanup();
  });
  it("shows a map unit's DEF now, from the engine, beside the printed DEF when research changed it", () => {
    const f = FIXTURES.find((x) => x.name === 'map-metal-platforms')!.f;
    const ref = (REFERENCE as { referenceData: { robot_units: Array<{ name: string; def: number | null }> } }).referenceData;
    const printed = ref.robot_units.find((u) => u.name === 'Spinner Platform')!.def!;
    const r = render(<NggScreen input={inputFor(f.view, f.viewer, f.legalMoves)} yourTurn={false} busy={false} interactive onMove={vi.fn()} onForm={vi.fn()} nameFor={(p) => p} />);
    const piece = [...r.container.querySelectorAll<HTMLButtonElement>('button.ngg-piece-btn')].find((b) => b.querySelector('[title]')?.getAttribute('title')?.startsWith('Spinner Platform'))!;
    expect(piece.querySelector('[title]')!.getAttribute('title')).toContain(`DEF ${printed + 1} (printed ${printed})`);
    fireEvent.click(piece);
    expect(r.getByRole('dialog', { name: /^Pieces at / }).textContent).toContain(`printed ${printed}, raised by research`);
    cleanup();
  });
  it("shows a seat its own planned cards and a rival's only as a face-down count", () => {
    const f = FIXTURES.find((x) => x.name === 'phase-planning')!.f;
    const view = f.view as { players: Array<Record<string, unknown>>; your_action_cards_played?: unknown };
    expect(Array.isArray(view.your_action_cards_played)).toBe(true);
    expect(view.players.every((p) => !('action_cards_played_this_round' in p))).toBe(true);
    const r = render(<NggScreen input={inputFor(f.view, f.viewer, f.legalMoves)} yourTurn busy={false} interactive onMove={vi.fn()} onForm={vi.fn()} nameFor={(p) => p} />);
    const rival = [...r.container.querySelectorAll<HTMLButtonElement>('button.ngg-seat')].find((b) => !b.classList.contains('you'))!;
    fireEvent.click(rival);
    const sheet = r.getByRole('dialog', { name: /faction board$/ });
    expect(sheet.textContent).toContain('face down');
    expect(sheet.textContent).not.toContain('on the stack');
    cleanup();
  });
  it('draws the culture race to the target and milestones for this many players', () => {
    for (const name of ['phase-planning', 'phase-planning-multi']) {
      const f = FIXTURES.find((x) => x.name === name)!.f;
      const players = (f.view as { players: Array<{ culture_target?: number }> }).players;
      const target = players[0]!.culture_target!;
      // The target scales with the number of players, as the engine publishes it.
      const byCount = (REFERENCE as { referenceData: { victory: { culture_target_by_player_count: Record<string, number> } } }).referenceData.victory.culture_target_by_player_count;
      expect(target).toBe(byCount[String(players.length)]);
      const r = render(<NggScreen input={inputFor(f.view, f.viewer, f.legalMoves)} yourTurn busy={false} interactive onMove={vi.fn()} onForm={vi.fn()} nameFor={(p) => p} />);
      const marks = [...r.container.querySelectorAll('.ngg-race-axis span')].map((s) => Number(s.textContent));
      expect(marks[marks.length - 1]).toBe(target);
      const ref = (REFERENCE as { referenceData: { victory: { milestones_by_player_count: Record<string, number[]> } } }).referenceData.victory;
      expect(marks.slice(0, -1)).toEqual(ref.milestones_by_player_count[String(players.length)]);
      expect(r.container.textContent).toContain(`${target} wins`);
      cleanup();
    }
  });
  it('tracks Economic progress for every seat: collectors owned against the count the spend takes', () => {
    const f = FIXTURES.find((x) => x.name === 'action-build-robot-mid')!.f;
    // The count scales with the map: the catalogue gives it by layout.
    const byLayout = (REFERENCE as { referenceData: { victory: { economic_collectors_by_layout: Record<string, number> } } }).referenceData.victory.economic_collectors_by_layout;
    const need = byLayout[(f.view as { layout: string }).layout];
    expect(need).toBeGreaterThan(0);
    const r = render(<NggScreen input={inputFor(f.view, f.viewer, f.legalMoves)} yourTurn busy={false} interactive onMove={vi.fn()} onForm={vi.fn()} nameFor={(p) => p} />);
    const players = (f.view as { players: Array<{ player_id: string; collectors?: unknown[] }> }).players;
    const rows = [...r.container.querySelectorAll('button.ngg-seat')];
    expect(rows).toHaveLength(players.length);
    players.forEach((p, i) => {
      const econ = [...rows[i]!.querySelectorAll('.ngg-stat')].find((s) => s.textContent?.endsWith('ECON'))!;
      expect(econ.textContent).toBe(`${p.collectors ? p.collectors.length : '—'}/${need}ECON`);
    });
    cleanup();
  });
  it("shows on the faction board what a battle card costs and what unlocks it, from the engine's catalogue", () => {
    const f = FIXTURES.find((x) => x.name === 'phase-planning')!.f;
    const r = render(<NggScreen input={inputFor(f.view, f.viewer, f.legalMoves)} yourTurn busy={false} interactive onMove={vi.fn()} onForm={vi.fn()} nameFor={(p) => p} />);
    fireEvent.click(r.container.querySelector<HTMLButtonElement>('button.ngg-seat.you')!);
    const price = r.getByRole('dialog', { name: 'Your faction board' }).querySelector('.ngg-fb-card-cost')!;
    const purchase = (REFERENCE as { referenceData: { battle_card_purchase: { cost: Record<string, number>; either: string[]; unlocked_by: Record<string, string> } } }).referenceData.battle_card_purchase;
    const species = (f.view as { players: Array<{ player_id: string; species: string }> }).players.find((p) => p.player_id === f.viewer)!.species;
    expect(price.textContent).toContain('Buy one on a Research action');
    // Whether this seat can buy one, from the engine's own list.
    const me = (f.view as { players: Array<{ player_id: string; locked: { battle_cards: string | null } }> }).players.find((p) => p.player_id === f.viewer)!;
    if (me.locked.battle_cards) expect(price.textContent).toMatch(new RegExp(`Locked · needs an? ${purchase.unlocked_by[species]}`));
    else expect(price.textContent).toContain('Unlocked');
    // One chip per fixed resource, then one per either-or resource.
    expect(price.querySelectorAll('.ngg-res')).toHaveLength(Object.keys(purchase.cost).length + purchase.either.length);
    expect(price.textContent).toContain('+ either');
    cleanup();
  });
  it("marks on the faction board what the seat has and has not unlocked, from the engine's own list", () => {
    const f = FIXTURES.find((x) => x.name === 'phase-planning')!.f;
    const view = structuredClone(f.view) as { players: Array<Record<string, unknown>> };
    const me = view.players.find((p) => p['player_id'] === f.viewer)!;
    const species = me['species'] as string;
    const units = (REFERENCE as unknown as { referenceData: Record<string, Array<{ name: string }>> }).referenceData[`${species}_units`]!;
    const [lockedUnit, openUnit] = [units[units.length - 1]!.name, units[0]!.name];
    me['locked'] = { units: { [lockedUnit]: 'needs a Temple' }, research: {}, treaties: 'needs an Embassy', battle_cards: null };
    const r = render(<NggScreen input={inputFor(view, f.viewer, f.legalMoves)} yourTurn busy={false} interactive onMove={vi.fn()} onForm={vi.fn()} nameFor={(p) => p} />);
    fireEvent.click(r.container.querySelector<HTMLButtonElement>('button.ngg-seat.you')!);
    const board = r.getByRole('dialog', { name: 'Your faction board' });
    const card = (name: string) => [...board.querySelectorAll('.ngg-fb-unit')].find((u) => u.querySelector('b')?.textContent === name)!;
    expect(card(lockedUnit).classList.contains('locked')).toBe(true);
    expect(card(lockedUnit).textContent).toContain('Locked · needs a Temple');
    expect(card(openUnit).textContent).toContain('Unlocked');
    expect(board.querySelector('.ngg-fb-treaty-lock')!.textContent).toContain('Locked · needs an Embassy');
    expect(board.querySelector('.ngg-fb-card-cost')!.textContent).toContain('Unlocked');
    cleanup();
  });

  it('opens a board item for everything the catalogue says about it', () => {
    const f = FIXTURES.find((x) => x.name === 'phase-planning')!.f;
    const r = render(<NggScreen input={inputFor(f.view, f.viewer, f.legalMoves)} yourTurn busy={false} interactive onMove={vi.fn()} onForm={vi.fn()} nameFor={(p) => p} />);
    fireEvent.click(r.container.querySelector<HTMLButtonElement>('button.ngg-seat.you')!);
    const board = r.getByRole('dialog', { name: 'Your faction board' });
    const unit = board.querySelector<HTMLElement>('.ngg-fb-unit')!;
    const name = unit.querySelector('b')!.textContent!;
    fireEvent.click(unit);
    const detail = r.getByRole('dialog', { name });
    expect(detail.textContent).toContain('Cost');
    expect(detail.textContent).toContain('Owned');
    fireEvent.click(within(detail).getByRole('button', { name: 'Close' }));
    expect(r.queryByRole('dialog', { name })).toBeNull();
    // Buildings, technologies and heroes open the same way, by keyboard too.
    const building = board.querySelector<HTMLElement>('.ngg-fb-list li.pressable')!;
    fireEvent.keyDown(building, { key: 'Enter' });
    expect(r.getByRole('dialog', { name: building.querySelector('b')!.textContent! }).textContent).toContain('Cost');
    cleanup();
  });
  it('opens a list of every treaty, who with whom, from the Treaties link under Seats', () => {
    const f = FIXTURES.find((x) => x.name === 'phase-planning')!.f;
    const view = structuredClone(f.view) as { treaties: unknown[]; players: Array<{ player_id: string }> };
    const [a, b] = view.players.map((p) => p.player_id);
    view.treaties = [{ treaty: 'Peace', partners: [a, b], culture_income: 2 }];
    const r = render(<NggScreen input={inputFor(view, f.viewer, f.legalMoves)} yourTurn busy={false} interactive onMove={vi.fn()} onForm={vi.fn()} nameFor={(p) => p} />);
    fireEvent.click(r.getByRole('button', { name: 'Treaties (1)' }));
    const sheet = r.getByRole('dialog', { name: 'Treaties' });
    expect(sheet.textContent).toContain('Peace');
    expect(sheet.textContent).toContain('+2 culture each a round');
    expect(sheet.querySelectorAll('.ngg-chip')).toHaveLength(2);
    cleanup();
  });

  it('marks a seat holding an unrevealed spy, without naming the hero', () => {
    const f = FIXTURES.find((x) => x.name === 'phase-planning')!.f;
    const view = structuredClone(f.view) as { players: Array<Record<string, unknown>> };
    const rival = view.players.find((p) => p['player_id'] !== f.viewer)!;
    rival['unrevealed_spies'] = 1;
    const r = render(<NggScreen input={inputFor(view, f.viewer, f.legalMoves)} yourTurn busy={false} interactive onMove={vi.fn()} onForm={vi.fn()} nameFor={(p) => p} />);
    const row = [...r.container.querySelectorAll('button.ngg-seat')].find((b) => !b.classList.contains('you'))!;
    const mark = row.querySelector('.ngg-spy-mark')!;
    expect(mark.getAttribute('title')).toMatch(/unrevealed .* spy — which hero carries it is secret/);
    expect(r.container.querySelector('button.ngg-seat.you .ngg-spy-mark')).toBeNull();
    cleanup();
  });
  it('lists every hero from the Heroes link, who holds each, and what is still in the pool', () => {
    const f = FIXTURES.find((x) => x.name === 'action-build-robot-mid')!.f;
    const r = render(<NggScreen input={inputFor(f.view, f.viewer, f.legalMoves)} yourTurn busy={false} interactive onMove={vi.fn()} onForm={vi.fn()} nameFor={(p) => p} />);
    fireEvent.click(r.getByRole('button', { name: 'Heroes' }));
    const sheet = r.getByRole('dialog', { name: 'Heroes' });
    const all = (REFERENCE as unknown as { referenceData: { heroes: Array<{ name: string }> } }).referenceData.heroes;
    const rows = [...sheet.querySelectorAll('.ngg-hero-list li')];
    expect(rows).toHaveLength(all.length);
    const view = f.view as { hero_pool_count: number; players: Array<{ faction: string; heroes: Array<{ hero: string }> }> };
    for (const p of view.players) for (const h of p.heroes) {
      const row = rows.find((li) => li.querySelector('b')?.textContent?.replace(' ★', '') === h.hero)!;
      expect(row.textContent).toContain(p.faction);
    }
    expect(rows.filter((li) => li.textContent?.includes('In the pool'))).toHaveLength(view.hero_pool_count);
    // Every hero shows its battle stats.
    for (const li of rows) expect(li.querySelector('.ngg-hero-stats')?.textContent, li.textContent ?? '').toMatch(/^Init \d+ DMG \d+ DEF \d+$/);
    cleanup();
  });
  it('shows each seat its Leader kills in Seats', () => {
    const f = FIXTURES.find((x) => x.name === 'phase-planning')!.f;
    const r = render(<NggScreen input={inputFor(f.view, f.viewer, f.legalMoves)} yourTurn busy={false} interactive onMove={vi.fn()} onForm={vi.fn()} nameFor={(p) => p} />);
    const players = (f.view as { players: Array<{ leader_kills: number; military_kills_needed: number }> }).players;
    const rows = [...r.container.querySelectorAll('button.ngg-seat')];
    players.forEach((p, i) => {
      const kills = [...rows[i]!.querySelectorAll('.ngg-stat')].find((st) => st.textContent?.endsWith('KILLS'))!;
      expect(kills.textContent).toBe(`${p.leader_kills}/${p.military_kills_needed}KILLS`);
    });
    cleanup();
  });

  it('tells the game-over window the stat of the victory that won', () => {
    const f = FIXTURES.find((x) => x.name === 'phase-game_over')!.f;
    for (const [kind, label] of [['Military', 'Leader kills'], ['Technological', 'Technology'], ['Cultural', 'Culture'], ['Economic', 'Collectors']] as const) {
      const view = structuredClone(f.view) as { result: Record<string, unknown>; players: Array<{ player_id: string }> };
      view.result = { ...view.result, kinds: [kind] };
      const stat = nggGlue.endStat!(inputFor(view, f.viewer, []))!;
      expect(stat.label).toBe(label);
      expect(Object.keys(stat.values).sort()).toEqual(view.players.map((p) => p.player_id).sort());
    }
  });

  it("a collection request shows who asks, by their faction's mark and colour", () => {
    const f = FIXTURES.find((x) => x.name === 'pending-access_request-queue')!.f;
    const r = render(<NggScreen input={inputFor(f.view, f.viewer, f.legalMoves)} yourTurn busy={false} interactive onMove={vi.fn()} onForm={vi.fn()} nameFor={(p) => p} />);
    const band = r.container.querySelector('.ngg-interrupt .ngg-seat-band') as HTMLElement;
    expect(band).not.toBeNull();
    expect(band.querySelector('.ngg-chip')).not.toBeNull();
    expect(band.style.borderColor).not.toBe('');
    cleanup();
  });

  it("Dowser's free collector: the robot picks its type, and only the pick is sent", () => {
    const f = FIXTURES.find((x) => x.name === 'pending-dowser_collector')!.f;
    const onMove = vi.fn();
    const r = render(<NggScreen input={inputFor(f.view, f.viewer, f.legalMoves)} yourTurn busy={false} interactive onMove={onMove} onForm={vi.fn()} nameFor={(p) => p} />);
    const names = f.legalMoves.map((m) => String(m.move['collector']));
    expect(names.length).toBeGreaterThan(1);
    const take = r.getByRole('button', { name: 'Choose a collector' }) as HTMLButtonElement;
    expect(take.disabled).toBe(true);
    fireEvent.click(r.getByText(names[1]!));
    expect(onMove).not.toHaveBeenCalled();
    // Four free collectors (#117): the engine says how many picks are left.
    expect(r.container.textContent).toContain(`${(f.view as { pending: { context: { remaining: number } } }).pending.context.remaining} left to pick`);
    fireEvent.click(r.getByRole('button', { name: `Take the ${names[1]}` }));
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove.mock.calls[0]![0].move).toEqual(f.legalMoves[1]!.move);
    cleanup();
  });

  it('two collectors sharing a tile (Collector Optimizations) are both drawn', () => {
    const { f } = FIXTURES.find((x) => (x.f.view as { players: Array<{ committed_collectors: unknown[] }> }).players.some((p) => p.committed_collectors.length >= 2))!;
    const view = structuredClone(f.view) as { players: Array<{ committed_collectors: Array<{ collector: string; coord: string }> }> };
    const seat = view.players.find((p) => p.committed_collectors.length >= 2)!;
    seat.committed_collectors[1]!.coord = seat.committed_collectors[0]!.coord;
    const r = render(<NggScreen input={inputFor(view, f.viewer, [])} yourTurn={false} busy={false} interactive onMove={vi.fn()} onForm={vi.fn()} nameFor={(p) => p} />);
    const shared = [...r.container.querySelectorAll('.ngg-tile-collectors')].find((el) => el.querySelectorAll('[data-flip-id^="ngg-collector:"]').length === 2);
    expect(shared).toBeTruthy();
    cleanup();
  });

  it("the Build list prices the paired Core as the engine says: free with Core Integration", () => {
    const f = FIXTURES.find((x) => x.name === 'action-build-robot-mid')!.f;
    const draw = (paired: Record<string, number>) => {
      const view = structuredClone(f.view) as { players: Array<{ player_id: string; paired_core_cost?: Record<string, number> }> };
      view.players.find((p) => p.player_id === f.viewer)!.paired_core_cost = paired;
      return render(<NggScreen input={inputFor(view, f.viewer, f.legalMoves)} yourTurn busy={false} interactive onMove={vi.fn()} onForm={vi.fn()} nameFor={(p) => p} />);
    };
    const priced = draw({ water: 1 });
    expect(priced.queryAllByText('+ Core, free')).toHaveLength(0);
    expect(priced.container.querySelectorAll('.ngg-eco-core').length).toBeGreaterThan(0);
    cleanup();
    const free = draw({});
    expect(free.getAllByText('+ Core, free').length).toBeGreaterThan(0);
    cleanup();
  });

  it('Self Destruct: offered by name with the engine damage and a warning, sent only on press', () => {
    const f = FIXTURES.find((x) => x.name === 'battle-activations-self_destruct')!.f;
    const onMove = vi.fn();
    const r = render(<NggScreen input={inputFor(f.view, f.viewer, f.legalMoves)} yourTurn busy={false} interactive onMove={onMove} onForm={vi.fn()} nameFor={(p) => p} />);
    const listed = f.legalMoves.find((m) => (m.move['action'] as { kind?: string } | undefined)?.kind === 'self_destruct')!;
    expect(listed).toBeTruthy();
    const row = r.getByText('Self Destruct').closest('.ngg-option') as HTMLElement;
    expect(row.textContent).toContain('HITS EVERY SIDE');
    expect(row.textContent).toMatch(/\d+ DMG/);
    fireEvent.click(row);
    expect(onMove).not.toHaveBeenCalled();
    fireEvent.click(r.getByRole('button', { name: 'Self Destruct' }));
    expect(onMove.mock.calls[0]![0].move).toEqual(listed.move);
    cleanup();
  });

  it('a defense against a Self Destruct says what hit it', () => {
    const f = FIXTURES.find((x) => x.name === 'pending-battle_defense-self_destruct')!.f;
    const r = render(<NggScreen input={inputFor(f.view, f.viewer, f.legalMoves)} yourTurn busy={false} interactive onMove={vi.fn()} onForm={vi.fn()} nameFor={(p) => p} />);
    expect(r.container.textContent).toMatch(/Self Destruct · .* blows itself up, hitting every side/);
    expect(r.container.textContent).toMatch(/'s blast hits /);
    cleanup();
  });

  it("the faction board gives each unit the engine's limit on this map, not the printed one", () => {
    const f = FIXTURES.find((x) => x.name === 'action-build-robot-mid')!.f;
    const view = f.view as { players: Array<{ player_id: string; unit_limits: Record<string, number> }> };
    const limits = view.players.find((p) => p.player_id === f.viewer)!.unit_limits;
    expect(limits['Water collector']).not.toBe(3);
    const r = render(<NggScreen input={inputFor(f.view, f.viewer, [])} yourTurn={false} busy={false} interactive onMove={vi.fn()} onForm={vi.fn()} nameFor={(p) => p} />);
    fireEvent.click(r.getByRole('button', { name: 'Open board' }));
    expect(r.container.textContent).toContain(`up to ${limits['Water collector']}`);
    expect(r.container.textContent).toContain(`up to ${limits['Core']}`);
    cleanup();
  });

  it("a second Build in the same round starts with nothing chosen, not the last Build's pick", () => {
    const f = FIXTURES.find((x) => x.name === 'action-build-robot-mid')!.f;
    const memory = new Map<string, unknown>();
    const draw = (view: unknown) => render(<NggScreen input={{ ...inputFor(view, f.viewer, f.legalMoves), memory }} yourTurn busy={false} interactive onMove={vi.fn()} onForm={vi.fn()} nameFor={(p) => p} />);
    const first = draw(f.view);
    const open = [...first.container.querySelectorAll('.ngg-column .ngg-option')].find((el) => !el.classList.contains('shut')) as HTMLElement;
    fireEvent.click(open);
    expect(first.container.querySelector('.ngg-column .ngg-option.selected')).not.toBeNull();
    cleanup();
    // The same Build again (nothing on the stack changed): the pick is kept.
    const again = draw(f.view);
    expect(again.container.querySelector('.ngg-column .ngg-option.selected')).not.toBeNull();
    cleanup();
    // Another Build card of the round: a different number of cards on the stack.
    const next = structuredClone(f.view) as { action_stack: unknown[] };
    next.action_stack = [...next.action_stack, { position: 99, owner: f.viewer, card_kind: null }];
    const second = draw(next);
    expect(second.container.querySelector('.ngg-column .ngg-option.selected')).toBeNull();
    cleanup();
  });

  it('the faction board links to its species tech tree, built from the catalogue', () => {
    const ref = (REFERENCE as { referenceData: Record<string, unknown> }).referenceData as {
      robot_units: Array<{ name: string; requiresBuilding: string | null }>; robot_buildings: Array<{ name: string; isBase: boolean }>;
      battle_card_purchase: { unlocked_by: Record<string, string> }; treaty_unlocked_by: Record<string, string>;
    };
    const f = FIXTURES.find((x) => x.name === 'action-build-robot-mid')!.f;
    const r = render(<NggScreen input={inputFor(f.view, f.viewer, [])} yourTurn={false} busy={false} interactive onMove={vi.fn()} onForm={vi.fn()} nameFor={(p) => p} />);
    fireEvent.click(r.getByRole('button', { name: 'Open board' }));
    fireEvent.click(r.getByRole('button', { name: 'Tech tree' }));
    const tree = r.getByRole('dialog', { name: 'The robot tree' });
    // The base at the root; every other building has a row.
    const base = ref.robot_buildings.find((b) => b.isBase)!;
    expect(tree.querySelector('.ngg-tree-root')!.textContent).toContain(base.name);
    const rows = [...tree.querySelectorAll('.ngg-tree-row')];
    const rowOf = (name: string) => rows.find((row) => row.querySelector('.ngg-tree-building')?.textContent?.includes(name));
    for (const b of ref.robot_buildings.filter((x) => !x.isBase)) expect(rowOf(b.name)).toBeTruthy();
    // A unit sits in the row of the building it requires.
    const needy = ref.robot_units.find((u) => u.requiresBuilding)!;
    expect(rowOf(needy.requiresBuilding!)!.textContent).toContain(needy.name);
    // Treaties and battle cards sit under the buildings the catalogue names.
    expect(rowOf(ref.treaty_unlocked_by['robot']!)!.textContent).toContain('Treaties');
    expect(rowOf(ref.battle_card_purchase.unlocked_by['robot']!)!.textContent).toContain('Battle strategy cards');
    // What the seat has is ticked.
    expect(tree.querySelectorAll('.ngg-tree-tile.have').length).toBeGreaterThan(0);
    fireEvent.click(within(tree).getByRole('button', { name: 'Close the tech tree' }));
    expect(r.queryByRole('dialog', { name: 'The robot tree' })).toBeNull();
    cleanup();
  });

  it('the battle strategy card type is ticked from the seat, and counted toward the target (#129)', () => {
    const f = FIXTURES.find((x) => x.name === 'action-build-multi')!.f;
    const r = render(<NggScreen input={inputFor(f.view, f.viewer, [])} yourTurn={false} busy={false} interactive onMove={vi.fn()} onForm={vi.fn()} nameFor={(p) => p} />);
    fireEvent.click(r.getByRole('button', { name: 'Open board' }));
    fireEvent.click(r.getByRole('button', { name: 'Tech tree' }));
    const tree = r.getByRole('dialog', { name: 'The robot tree' });
    const tile = [...tree.querySelectorAll('.ngg-tree-tile')].find((t) => t.textContent?.includes('Battle strategy cards'))!;
    expect(tile.classList.contains('have')).toBe(true);
    // Buildings + units + research + the battle card type = the target.
    const nums = [...tree.querySelectorAll('.ngg-tree-counts b')].map((b) => Number(b.textContent));
    const target = nums.pop()!;
    expect(nums.reduce((a, b) => a + b, 0)).toBe(target);
    cleanup();
  });

  it("an opponent's board opens their species' tree", () => {
    const { f } = FIXTURES.find((x) => {
      const v = x.f.view as { players: Array<{ player_id: string; species?: string }> };
      const me = v.players.find((p) => p.player_id === x.f.viewer);
      return !!me?.species && v.players.some((p) => p.player_id !== x.f.viewer && p.species && p.species !== me.species);
    })!;
    const v = f.view as { players: Array<{ player_id: string; species: string }> };
    const them = v.players.find((p) => p.player_id !== f.viewer && p.species !== v.players.find((q) => q.player_id === f.viewer)!.species)!;
    const r = render(<NggScreen input={inputFor(f.view, f.viewer, [])} yourTurn={false} busy={false} interactive onMove={vi.fn()} onForm={vi.fn()} nameFor={(p) => p} />);
    const seatRow = [...r.container.querySelectorAll('.ngg-seat-row, .ngg-seats li, [data-seat]')].find((el) => el.textContent?.includes(them.player_id) || el.querySelector(`[data-flip-id="ngg-supply:${them.player_id}"]`));
    expect(seatRow).toBeTruthy();
    fireEvent.click((seatRow!.querySelector('button') ?? seatRow) as HTMLElement);
    fireEvent.click(r.getByRole('button', { name: 'Tech tree' }));
    expect(r.getByRole('dialog', { name: `The ${them.species} tree` })).toBeTruthy();
    cleanup();
  });

  it('every hero has its own initials, the same on the map as in the Heroes list', () => {
    const names = (REFERENCE as { referenceData: { heroes: Array<{ name: string }> } }).referenceData.heroes.map((h) => h.name);
    const pairs = names.map(initials);
    expect(new Set(pairs).size).toBe(names.length);
    expect(initials('Envoy Sable Marrow')).toBe('SM');
    expect(initials('Dr. Elayn Smyth')).toBe('ES');
  });

  it("a seat's supply is marked once: the viewer's on their strip, every other seat's in Seats", () => {
    const { f } = FIXTURES.find((x) => x.name === 'action-build-robot-mid')!;
    const r = render(<NggScreen input={inputFor(f.view, f.viewer, [])} yourTurn={false} busy={false} interactive onMove={vi.fn()} onForm={vi.fn()} nameFor={(p) => p} />);
    const ids = [...r.container.querySelectorAll('[data-flip-id^="ngg-supply:"]')].map((el) => (el as HTMLElement).dataset.flipId);
    expect(ids.length).toBe(new Set(ids).size);
    expect(ids).toContain(`ngg-supply:${f.viewer}`);
    cleanup();
  });

  it("a collector's flip id names its owner, since two seats can each own a surf-1", () => {
    const { f } = FIXTURES.find((x) => (x.f.view as { players: Array<{ committed_collectors: unknown[] }> }).players.some((p) => p.committed_collectors.length > 0))!;
    const r = render(<NggScreen input={inputFor(f.view, f.viewer, [])} yourTurn={false} busy={false} interactive onMove={vi.fn()} onForm={vi.fn()} nameFor={(p) => p} />);
    const ids = [...r.container.querySelectorAll('[data-flip-id^="ngg-collector:"]')].map((el) => (el as HTMLElement).dataset.flipId!);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(id.split(':')).toHaveLength(3);
    cleanup();
  });

  it("a Haste wizard's bank shows on the faction strip, and only when it holds something", () => {
    const { f } = FIXTURES.find((x) => (x.f.view as { players: Array<{ player_id: string; species?: string }> }).players.some((p) => p.player_id === x.f.viewer && p.species === 'wizard'))!;
    const draw = (bank: Record<string, number>) => {
      const view = structuredClone(f.view) as { players: Array<{ player_id: string; bank?: Record<string, number> }> };
      view.players.find((p) => p.player_id === f.viewer)!.bank = bank;
      return render(<NggScreen input={inputFor(view, f.viewer, [])} yourTurn={false} busy={false} interactive onMove={vi.fn()} onForm={vi.fn()} nameFor={(p) => p} />);
    };
    expect(draw({}).queryByText('BANK')).toBeNull();
    cleanup();
    expect(draw({ ore: 1 }).getAllByText('BANK').length).toBeGreaterThan(0);
    cleanup();
  });
});
