// @vitest-environment jsdom
//
// Sweetlands Imperium — viz test suite.

import { describe, expect, it } from 'vitest';
import { renderBoard } from '../viz/board.js';

class MockZekelCard extends HTMLElement {
  set data(_data: any) { this.innerHTML = _data?.label || 'Card'; }
}
class MockZekelGrid extends HTMLElement {
  set data(_data: any) {
    this.innerHTML = JSON.stringify(_data);
  }
}
class MockZekelTableau extends HTMLElement {
  set data(_data: any) { this.innerHTML = _data?.label || 'Tableau'; }
}
class MockZekelTrack extends HTMLElement {
  set data(_data: any) { this.innerHTML = 'Track'; }
}
class MockZekelBag extends HTMLElement {
  set data(_data: any) { this.innerHTML = 'Bag'; }
}
class MockZekelCardZone extends HTMLElement {
  set data(_data: any) { this.innerHTML = 'CardZone'; }
}
class MockZekelPool extends HTMLElement {
  set data(_data: any) { this.innerHTML = 'Pool'; }
}
class MockZekelMap extends HTMLElement {
  set data(_data: any) { this.innerHTML = 'Map'; }
}

if (!customElements.get('zekel-card')) customElements.define('zekel-card', MockZekelCard);
if (!customElements.get('zekel-grid')) customElements.define('zekel-grid', MockZekelGrid);
if (!customElements.get('zekel-tableau')) customElements.define('zekel-tableau', MockZekelTableau);
if (!customElements.get('zekel-track')) customElements.define('zekel-track', MockZekelTrack);
if (!customElements.get('zekel-bag')) customElements.define('zekel-bag', MockZekelBag);
if (!customElements.get('zekel-card-zone')) customElements.define('zekel-card-zone', MockZekelCardZone);
if (!customElements.get('zekel-pool')) customElements.define('zekel-pool', MockZekelPool);
if (!customElements.get('zekel-map')) customElements.define('zekel-map', MockZekelMap);

const baseSeat = (id: string) => ({
  player_id: id,
  kind: 'ai',
  faction: 'milkshake',
  faction_name: 'Arch Duchess of Milkshake',
  home_region: 1,
  points: 0,
  influence: 2,
  sugar_cubes: 3,
  intel_tokens: [] as string[],
  hand_count: 3,
  units: {
    leader: 'region 1 start',
    knight: 'region 1 start',
    ambassador: 'region 1 start',
  },
  unit_locations: {
    leader: { zone: 'start', region: 1 },
    knight: { zone: 'start', region: 1 },
    ambassador: { zone: 'start', region: 1 },
  },
  public_objectives_scored: [] as string[],
  secret_objectives_count: 1,
});

const state: Record<string, unknown> = {
  game_id: 'sweetlands-imperium',
  phase: 'play',
  round: 1,
  active_player_id: 'p1',
  first_player_id: 'p1',
  taxes: { 1: 0, 2: 0, 3: 0, 4: 0 },
  foe: { type: 'orc', defeated: false },
  castle_occupant_id: null,
  intel_deck_count: 80,
  intel_discard_count: 0,
  random_treat_placement: { 1: 'ice_cream', 2: 'chocolate_bar', 3: 'gummy_bear', 4: 'cupcake' },
  players: [baseSeat('p1'), { ...baseSeat('p2'), faction: 'fudge', faction_name: 'General Fudge', home_region: 2 }],
  your_hand: [
    { card_id: 'r1', kind: 'single', color: 'red' },
    { card_id: 't1', kind: 'treat', treat: 'ice_cream' },
  ],
  your_secret_objectives: ['defeat_knight'],
  your_turn_step: 'recall',
};

describe('Sweetlands Imperium viz', () => {
  it('renders the board without errors', () => {
    const container = document.createElement('div');
    let err: unknown;
    try {
      renderBoard(state, container, 'p1');
    } catch (e) {
      err = e;
    }
    if (err) console.error(err);
    expect(err).toBeUndefined();
    expect(container.innerHTML).toContain('Sweetlands Imperium');
    expect(container.innerHTML).toContain('Round 1');
  });

  it('renders units at their unit_locations', () => {
    const container = document.createElement('div');
    renderBoard(state, container, 'p1');
    expect(container.innerHTML).toContain('Leader');
    expect(container.innerHTML).toContain('Knight');
  });

  it('renders special locations', () => {
    const container = document.createElement('div');
    renderBoard(state, container, 'p1');
    expect(container.innerHTML).toContain('Milkshake');
    expect(container.innerHTML).toContain('cupcake');
  });

  it('places the castle info (foe, round, phase) on an actual castle cell, not a road', () => {
    const container = document.createElement('div');
    renderBoard(state, container, 'p1');
    const grids = JSON.parse(container.querySelector('zekel-grid')!.innerHTML);
    const castleCells = grids.cells.filter((c: any) => c.terrain === 'castle');
    expect(castleCells.length).toBeGreaterThan(0);
    const labeledCastle = castleCells.find((c: any) => c.pieces?.some((p: any) => p.label?.includes('Foe:')));
    expect(labeledCastle).toBeDefined();
    expect(labeledCastle.x).toBe(7);
    expect(labeledCastle.y).toBe(5);
  });

  it('does not overlap castle cells with roads or treats', () => {
    const container = document.createElement('div');
    renderBoard(state, container, 'p1');
    const grids = JSON.parse(container.querySelector('zekel-grid')!.innerHTML);
    const terrains = new Map<string, string>();
    for (const c of grids.cells) {
      terrains.set(`${c.x},${c.y}`, c.terrain);
    }
    const castleCoords = grids.cells.filter((c: any) => c.terrain === 'castle').map((c: any) => `${c.x},${c.y}`);
    for (const coord of castleCoords) {
      const t = terrains.get(coord);
      // The same key must only ever be castle (cellAt merges, but terrain is set last-wins).
      expect(t).toBe('castle');
    }
  });

  it('shows exactly one label per random treat slot and no duplicates', () => {
    const container = document.createElement('div');
    renderBoard(state, container, 'p1');
    const grids = JSON.parse(container.querySelector('zekel-grid')!.innerHTML);
    const treatCells = grids.cells.filter((c: any) => c.terrain === 'treat');
    const randomLabels: string[] = [];
    for (const c of treatCells) {
      for (const p of c.pieces ?? []) {
        if (p.label && !['Milkshake', 'Fudge', 'Jellybean', 'Cheesecake', '?'].includes(p.label)) {
          randomLabels.push(p.label);
        }
      }
    }
    expect(randomLabels.length).toBe(4);
    expect(new Set(randomLabels).size).toBe(4);
  });
});
