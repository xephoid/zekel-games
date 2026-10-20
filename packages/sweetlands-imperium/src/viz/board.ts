// Sweetlands Imperium — viz glue module.
// Reads the player view (src/games/sweetlands-imperium/views.ts) and renders it
// with the zekel-* component library. No custom components.
//
// Board geometry is imported from data/board.ts, which is itself transcribed
// from DATA_TEMPLATE.md / the printed board. This keeps the viz and engine in
// lock-step so unit locations render at the same coordinates the engine uses.
// Coordinates are (row, col), row 0 top, col 0 left.
//
// Browser-side module, served at /web/games/sweetlands-imperium/viz/board.js.
// Type-only imports are erased at compile time; glue just createElement()s tags.

import type { GameBoardModule } from '@zekel/game-kit';
import type {
  GridData, TableauData, CardZoneData, TrackData,
} from '@zekel/game-kit';
import type { UnitLocation, RegionId, SpaceColor } from '../types.js';
import {
  buildRingSpaces, buildRoadSpaces, TREAT_LOCATIONS, START_TILES,
} from '../data/board.js';

// Theme colors — bright candy ROYGBP to match the printed board.
const THEME: Record<string, string> = {
  '--zekel-c-milkshake': '#f5a623',
  '--zekel-c-fudge': '#8b5a2b',
  '--zekel-c-jellybean': '#9013fe',
  '--zekel-c-cheesecake': '#f0f0f0',
  '--zekel-c-nomads': '#2c2c2c',
  // Base ROYGBP (used for pieces and generic references).
  '--zekel-c-red': '#ff0000',
  '--zekel-c-orange': '#ffa500',
  '--zekel-c-yellow': '#ffff00',
  '--zekel-c-green': '#00ff00',
  '--zekel-c-blue': '#00bfff',
  '--zekel-c-purple': '#bf00bf',
  // zekel-grid terrain keys: ring-<color> and road-<color>.
  '--zekel-c-ring-red': '#ff0000',
  '--zekel-c-ring-orange': '#ffa500',
  '--zekel-c-ring-yellow': '#ffff00',
  '--zekel-c-ring-green': '#00ff00',
  '--zekel-c-ring-blue': '#00bfff',
  '--zekel-c-ring-purple': '#bf00bf',
  '--zekel-c-road-red': '#ff0000',
  '--zekel-c-road-orange': '#ffa500',
  '--zekel-c-road-yellow': '#ffff00',
  '--zekel-c-road-green': '#00ff00',
  '--zekel-c-road-blue': '#00bfff',
  '--zekel-c-road-purple': '#bf00bf',
  '--zekel-c-castle': '#555555',
  '--zekel-c-treat': '#d8bfd8',
  '--zekel-c-start': '#f0e68c',
  '--zekel-c-board-bg': '#ffffff',
  '--zekel-c-grid-lines': '#000000',
};

export const notRendered = [
  'game_id',
  'your_turn_step',
  'first_player_id',
  // The dice of the most recent battle: the battle's outcome is already on the
  // board (who moved, who went home) and in the move's summary; the dice are
  // for a client that animates the roll.
  'last_battle',
] as const;

interface SeatView {
  player_id: string;
  kind: string;
  faction: string;
  faction_name: string;
  home_region: number | null;
  points: number;
  influence: number;
  sugar_cubes: number;
  intel_tokens: string[];
  hand_count: number;
  units: Record<string, string>;
  unit_locations: Record<string, UnitLocation>;
  public_objectives_scored: string[];
  secret_objectives_count: number;
  secret_objectives_scored?: string[];
}

// ---------------------------------------------------------------------------
// Canonical board geometry from DATA_TEMPLATE.md
// Coordinates are (row, col), row 0 top, col 0 left. Ring/road colors follow
// the ROYGBP order exactly as documented, so ringIndex lines up with the
// engine's location model.
// ---------------------------------------------------------------------------

const REGION_TREAT: Record<RegionId, string> = {
  1: 'Milkshake', 2: 'Fudge', 3: 'Jellybean', 4: 'Cheesecake',
};

// Castle is the central 2x2 node (designer-confirmed; DATA_TEMPLATE.md XX cells).
const CASTLE_CELLS: Array<[number, number]> = [[5, 7], [5, 8], [6, 7], [6, 8]];

interface BoardCell {
  x: number;
  y: number;
  color?: SpaceColor;
  region?: RegionId;
  kind: 'ring' | 'road' | 'start' | 'treat-regional' | 'treat-random' | 'castle' | 'empty';
  ringIndex?: number;
  roadIndex?: number;
  label?: string;
}

// Region lookup for road cells: the road token itself is color+dir, so infer
// the region from a neighboring non-road cell sharing the same region number.
function buildCells(): BoardCell[] {
  const cells: BoardCell[] = [];
  for (const s of buildRingSpaces()) {
    cells.push({ x: s.coord[1], y: s.coord[0], region: s.region, kind: 'ring', color: s.color, ringIndex: s.ringIndex });
  }
  for (const s of buildRoadSpaces()) {
    cells.push({ x: s.coord[1], y: s.coord[0], region: s.region, kind: 'road', color: s.color, roadIndex: s.roadIndex });
  }
  for (const region of [1, 2, 3, 4] as RegionId[]) {
    const [sr, sc] = START_TILES[region];
    cells.push({ x: sc, y: sr, region, kind: 'start', label: `Start ${region}` });
  }
  for (const t of TREAT_LOCATIONS) {
    if (t.kind === 'regional') {
      cells.push({ x: t.coord[1], y: t.coord[0], region: t.region, kind: 'treat-regional', label: REGION_TREAT[t.region] });
    } else {
      cells.push({ x: t.coord[1], y: t.coord[0], region: t.region, kind: 'treat-random', label: '?' });
    }
  }
  for (const [row, col] of CASTLE_CELLS) {
    cells.push({ x: col, y: row, kind: 'castle', label: 'Castle' });
  }
  return cells;
}

function terrainFor(cell: BoardCell): string {
  if (cell.kind === 'castle') return 'castle';
  if (cell.kind === 'treat-regional' || cell.kind === 'treat-random') return 'treat';
  if (cell.kind === 'start') return 'start';
  if (cell.kind === 'road') return `road-${cell.color ?? 'neutral'}`;
  return `ring-${cell.color ?? 'neutral'}`;
}

function locationKey(loc: UnitLocation): string | null {
  switch (loc.zone) {
    case 'offboard': return null;
    case 'start': return `start:${loc.region}`;
    case 'ring': return `ring:${loc.region}:${loc.ringIndex}`;
    case 'road': return `road:${loc.region}:${loc.roadIndex}`;
    case 'castle': return 'castle';
    case 'treat': return `treat:${loc.region}:${loc.slotKind}`;
    default: return null;
  }
}

function keyForCell(cell: BoardCell): string | null {
  switch (cell.kind) {
    case 'castle': return 'castle';
    case 'start': return `start:${cell.region}`;
    case 'treat-regional': return `treat:${cell.region}:regional`;
    case 'treat-random': return `treat:${cell.region}:random`;
    case 'road': return `road:${cell.region}:${cell.roadIndex}`;
    case 'ring': return `ring:${cell.region}:${cell.ringIndex}`;
    default: return null;
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

export const renderBoard: GameBoardModule['renderBoard'] = (view, container, viewerId) => {
  container.innerHTML = '';
  for (const [k, v] of Object.entries(THEME)) container.style.setProperty(k, v);
  container.style.display = 'flex';
  container.style.flexDirection = 'column';
  container.style.gap = '12px';
  container.style.backgroundColor = THEME['--zekel-c-board-bg']!;
  container.style.padding = '12px';

  const phase = view.phase as string;
  const round = view.round as number;
  const activeId = view.active_player_id as string | null;
  const foe = view.foe as { type: string; defeated: boolean } | null;
  const taxes = view.taxes as Record<number, number>;
  const castleOccupantId = view.castle_occupant_id as string | null;
  const randomTreatPlacement = view.random_treat_placement as Record<number, string>;
  const intelDeckCount = view.intel_deck_count as number;
  const intelDiscardCount = view.intel_discard_count as number;
  const players = view.players as SeatView[];
  const yourHand = view.your_hand as Array<{ card_id: string; kind: string; color?: string; treat?: string }> | undefined;
  const yourSecretObjectives = view.your_secret_objectives as string[] | undefined;

  // --- Main board as a zekel-grid ---
  const boardCells = buildCells();
  const cellMap = new Map<string, GridData['cells'][number]>();
  const cellAt = (x: number, y: number) => {
    const key = `${x},${y}`;
    let c = cellMap.get(key);
    if (!c) {
      c = { x, y };
      cellMap.set(key, c);
    }
    return c;
  };

  for (const cell of boardCells) {
    const g = cellAt(cell.x, cell.y);
    g.terrain = terrainFor(cell);
    if (cell.label) {
      (g.pieces ??= []).push({ label: cell.label, colorKey: g.terrain });
    }
  }

  // Annotate random treat slots with the actual tile name.
  for (const cell of boardCells) {
    if (cell.kind !== 'treat-random' || !cell.region) continue;
    const tile = randomTreatPlacement[cell.region];
    if (!tile) continue;
    const g = cellAt(cell.x, cell.y);
    if (g.pieces) g.pieces = g.pieces.filter((p) => p.label !== '?');
    (g.pieces ??= []).push({ label: tile.replace(/_/g, ' '), colorKey: 'treat' });
  }

  // Place units on the board.
  const locationCell = new Map<string, GridData['cells'][number]>();
  for (const cell of boardCells) {
    const key = keyForCell(cell);
    if (key) locationCell.set(key, cellAt(cell.x, cell.y));
  }

  for (const seat of players) {
    const factionKey = seat.faction;
    for (const [unit, loc] of Object.entries(seat.unit_locations)) {
      const key = locationKey(loc);
      if (!key) continue;
      const cell = locationCell.get(key);
      if (!cell) continue;
      (cell.pieces ??= []).push({
        label: `${unit.slice(0, 1).toUpperCase()}${unit.slice(1)}`,
        colorKey: factionKey,
        badges: [`${seat.faction_name}`],
      });
    }
  }

  // Board info overlay on the castle node.
  const [castleRow, castleCol] = CASTLE_CELLS[0]!;
  const castle = cellAt(castleCol, castleRow);
  castle.pieces = [
    { label: `Foe: ${foe ? `${foe.type} ${foe.defeated ? '(defeated)' : ''}` : 'none'}`, colorKey: 'castle' },
    ...(castleOccupantId ? [{ label: `Castle: ${castleOccupantId}`, colorKey: castleOccupantId }] : []),
    { label: `Round ${round}`, colorKey: 'purple' },
    { label: `Phase: ${phase}`, colorKey: 'blue' },
  ];

  const grid = document.createElement('zekel-grid') as HTMLElement & { data: GridData };
  grid.data = {
    label: `Sweetlands Imperium — Round ${round}`,
    extent: { minX: 0, minY: 0, maxX: 13, maxY: 11 },
    cells: [...cellMap.values()],
    coordinates: true,
  };
  container.appendChild(grid);

  // --- Shared displays ---
  const shared = document.createElement('div');
  shared.style.display = 'flex';
  shared.style.flexWrap = 'wrap';
  shared.style.gap = '12px';
  shared.style.alignItems = 'flex-start';

  const taxTrack = document.createElement('zekel-track') as HTMLElement & { data: TrackData };
  taxTrack.data = {
    label: 'Region Taxes',
    spaces: ([1, 2, 3, 4] as RegionId[]).flatMap((r) => [
      { index: `${r}-0`, label: `R${r} 0`, filled: (taxes[r] ?? 0) === 0 },
      { index: `${r}-1`, label: `R${r} 1`, filled: (taxes[r] ?? 0) >= 1 },
      { index: `${r}-2`, label: `R${r} 2`, filled: (taxes[r] ?? 0) >= 2 },
      { index: `${r}-3`, label: `R${r} 3`, filled: (taxes[r] ?? 0) >= 3 },
    ]),
  };
  shared.appendChild(taxTrack);

  const deckZone = document.createElement('zekel-card-zone') as HTMLElement & { data: CardZoneData };
  deckZone.data = { label: 'Intel Deck', mode: 'pile', countOnly: intelDeckCount };
  shared.appendChild(deckZone);

  const discardZone = document.createElement('zekel-card-zone') as HTMLElement & { data: CardZoneData };
  discardZone.data = { label: 'Intel Discard', mode: 'pile', countOnly: intelDiscardCount };
  shared.appendChild(discardZone);

  container.appendChild(shared);

  // --- Per-seat tableaux ---
  const seatsContainer = document.createElement('div');
  seatsContainer.style.display = 'flex';
  seatsContainer.style.flexWrap = 'wrap';
  seatsContainer.style.gap = '12px';

  const ordered = [...players].sort((a, b) => (a.player_id === viewerId ? -1 : b.player_id === viewerId ? 1 : 0));

  for (const seat of ordered) {
    const isOwner = seat.player_id === viewerId;
    const tableau = document.createElement('zekel-tableau') as HTMLElement & { data: TableauData };
    tableau.data = {
      label: `${seat.faction_name} — ${seat.player_id}`,
      owner: seat.faction,
      active: activeId === seat.player_id,
      stats: [
        { label: 'Points', value: seat.points, max: 5 },
        { label: 'Influence', value: seat.influence, max: 5 },
        { label: 'Sugar cubes', value: seat.sugar_cubes },
        { label: 'Hand', value: seat.hand_count },
        { label: 'Public scored', value: seat.public_objectives_scored.length },
        { label: 'Secret kept', value: seat.secret_objectives_count },
        ...(seat.home_region !== null ? [{ label: 'Home region', value: seat.home_region }] : []),
      ],
    };

    const tokenZone = document.createElement('zekel-card-zone') as HTMLElement & { data: CardZoneData };
    tokenZone.data = {
      label: 'Intel tokens',
      mode: 'row',
      cards: seat.intel_tokens.map((color) => ({
        label: color,
        colorKey: color,
      })),
    };
    tableau.appendChild(tokenZone);

    if (isOwner && yourSecretObjectives && yourSecretObjectives.length > 0) {
      const secretZone = document.createElement('zekel-card-zone') as HTMLElement & { data: CardZoneData };
      secretZone.data = {
        label: 'Your secret objectives',
        mode: 'row',
        cards: yourSecretObjectives.map((id) => ({ label: id, colorKey: 'treat' })),
      };
      tableau.appendChild(secretZone);
    }

    if (isOwner && yourHand && yourHand.length > 0) {
      const handZone = document.createElement('zekel-card-zone') as HTMLElement & { data: CardZoneData };
      handZone.data = {
        label: 'Your hand',
        mode: 'fan',
        cards: yourHand.map((c) => ({
          label: c.kind === 'treat' ? c.treat! : `${c.color}${c.kind === 'double' ? ' (double)' : ''}`,
          colorKey: c.kind === 'treat' ? 'treat' : c.color,
          id: c.card_id,
        })),
      };
      tableau.appendChild(handZone);
    }

    seatsContainer.appendChild(tableau);
  }
  container.appendChild(seatsContainer);
};
