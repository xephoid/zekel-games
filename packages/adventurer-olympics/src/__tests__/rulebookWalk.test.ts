// Rulebook walk (post-port §2, 2026-09-29 rerun): one test per rule that had
// no test pointer in the traceability matrix. Section numbers are RULES.md's.
import { describe, expect, it } from 'vitest';
import type { PlayerConfig, SessionState } from '@zekel/game-kit';
import { adventurerOlympics as game } from '../index.js';
import type { AOState } from '../types.js';
import {
  applyDeclineArtifact, applyExplore, applyTakeArtifact, applyMove as walkMove, applyPlaceTile, applyTestRoll, applyTryAgain,
  applyTurnOrderTotal, effectiveStat, endTurn, explorableSlots, resolveIcon, tileHexes,
} from '../engine.js';
import { iconHexesForTile } from '../hexMap.js';
import { TILES } from '../data.js';

function allAI(n: number, seed = 5): SessionState<AOState> {
  let s = game.createSession(
    Array.from({ length: n }, (_, i) => ({ player_id: String.fromCharCode(97 + i), name: ['Alice', 'Bob', 'Chris', 'Dana'][i], kind: 'ai' })) as PlayerConfig[],
    { seed },
  );
  while (s.gameState.pending?.kind === 'setup_standee_colour') {
    const seat = s.gameState.pending.seat;
    s = game.applyMove(s, seat, game.getLegalMoves(s, seat)[0]!.move).newState;
  }
  return s;
}

/** Two AI seats, Alice to move, alone on a known one-tile map. */
function onTile(tileId: number, seed = 5): AOState {
  const g = allAI(2, seed).gameState;
  applyTurnOrderTotal(g, 'a', 12);
  applyTurnOrderTotal(g, 'b', 2);
  const t = { tileId, center: { q: 0, r: 0, key: '0,0' }, rotation: 0, isStarting: true, exploredBy: null };
  g.placedTiles = [t];
  g.iconHexes = iconHexesForTile(t, TILES.find((x) => x.id === tileId)!);
  g.hexes = Object.fromEntries(tileHexes('0,0').map((k) => [k, true]));
  g.tileStack = TILES.map((x) => x.id).filter((id) => id !== tileId);
  g.players.a.hexKey = '0,0';
  g.players.b.hexKey = '0,0';
  g.players.a.stepsLeft = 2;
  g.pending = { kind: 'move', seat: 'a' };
  g.activeSeat = 'a';
  return g;
}

describe('§2 setup', () => {
  for (const n of [2, 3, 4]) {
    it(`${n} players: players+1 quests, the starting tile, standees on its centre, starting stats, full artifact supply`, () => {
      const g = allAI(n).gameState;
      expect(Object.keys(g.inPlayQuests)).toHaveLength(n + 1);
      expect(g.questBoxRemaining).toBe(6 - (n + 1));
      expect(g.placedTiles).toHaveLength(1);
      expect(g.tileStack).toHaveLength(9);
      for (const pid of g.playerOrder) {
        expect(g.players[pid]!.hexKey).toBe(g.placedTiles[0]!.center.key);
        expect(g.players[pid]!.artifacts).toEqual([]);
        expect(['charisma', 'strength', 'movement'].map((k) => effectiveStat(g, pid, k as never))).toEqual([1, 1, 2]);
      }
      expect(g.players.a!.tokensSpent).toBe(0); // the starting tile has no token
    });
  }
});

describe('§3 winning', () => {
  it('a tie for the most quest points shares the victory', () => {
    const s = allAI(3);
    const g = s.gameState;
    g.players.a.questPoints = 2; g.players.b.questPoints = 2; g.players.c.questPoints = 1;
    g.gameOver = true;
    expect(game.isGameOver(s)?.winners.sort()).toEqual(['a', 'b']);
  });
});

describe('§5 / §5.1 moving', () => {
  it('stepping onto an uncompleted icon ends the turn even with steps left', () => {
    const g = onTile(5); // Tile 5: one Little Monster at SW
    const icon = g.iconHexes[0]!;
    g.decks.little = ['little-6', ...g.decks.little.filter((c) => c !== 'little-6')]; // number 2
    walkMove(g, 'a', [icon.key]);
    applyTestRoll(g, 'a', 1); // fail
    expect(g.pending?.seat).toBe('b');
  });

  it('you cannot walk through an uncompleted icon; a completed one is plain ground', () => {
    const g = onTile(5);
    const icon = g.iconHexes[0]!;
    // A two-step path whose first step is the icon hex is refused.
    const beyond = tileHexes('0,0').find((k) => k !== icon.key && k !== '0,0')!;
    expect(() => walkMove(g, 'a', [icon.key, beyond])).toThrow(/cannot pass through/);
    icon.completed = true; icon.completedBy = 'b';
    walkMove(g, 'a', [icon.key]);
    expect(g.pending).toEqual({ kind: 'move', seat: 'a' });
    expect(g.players.a.stepsLeft).toBe(1);
  });

  it('you may take up to your Movement in steps, and companions raise it', () => {
    const g = onTile(5);
    g.players.a.companions = ['companion-6']; // +3 Movement
    g.pending = null;
    endTurn(g, 'b'); // b is last in order: a new round starts with a turn-order roll
    applyTurnOrderTotal(g, 'a', 12);
    applyTurnOrderTotal(g, 'b', 2);
    expect(g.players.a.stepsLeft).toBe(5);
  });
});

describe('§5.2 trying again', () => {
  it('staying on a failed icon triggers it again with a fresh card from the top', () => {
    const g = onTile(1);
    const city = g.iconHexes.find((h) => h.kind === 'city')!;
    walkMove(g, 'a', [city.key]);
    const first = g.pending!.payload!.cardId;
    applyTestRoll(g, 'a', 1); // fail — the card goes under the deck
    expect(g.decks.companion.at(-1)).toBe(first);
    // Bob passes; Alice's next turn starts on the failed City.
    g.pending = { kind: 'move', seat: 'b' };
    endTurn(g, 'b');
    applyTurnOrderTotal(g, 'a', 12);
    applyTurnOrderTotal(g, 'b', 2);
    expect(g.pending).toMatchObject({ kind: 'try_again', seat: 'a' });
    applyTryAgain(g, 'a');
    expect(g.pending!.payload!.cardId).not.toBe(first);
    expect(g.pending!.payload!.cardId).toBe(g.decks.companion[0]);
  });
});

describe('§5.3 exploring', () => {
  it('needs a step left and a tile in the stack; placing marks the centre and ends the turn', () => {
    const g = onTile(5);
    const outer = tileHexes('0,0').find((k) => k !== '0,0' && !g.iconHexes.some((h) => h.key === k))!;
    walkMove(g, 'a', [outer]);
    g.players.a.stepsLeft = 0;
    expect(() => applyExplore(g, 'a')).toThrow(/at least one step/);
    g.players.a.stepsLeft = 1;
    const stack = g.tileStack;
    g.tileStack = [];
    expect(() => applyExplore(g, 'a')).toThrow(/stack is empty/);
    g.tileStack = stack;
    applyExplore(g, 'a');
    applyPlaceTile(g, 'a', explorableSlots(g, 'a')[0]!, 0);
    expect(g.players.a.exploredTileIds).toHaveLength(1);
    expect(g.players.a.tokensSpent).toBe(1);
    expect(g.players.a.stepsLeft).toBe(0);
    expect(g.pending?.seat).toBe('b');
  });
});

describe('§6.3 / §6.4 artifacts', () => {
  it('declining "Any artifact" puts it under the Dungeon deck and draws another', () => {
    const g = onTile(1);
    g.decks.dungeon = ['any_artifact', 'little_monster', ...g.decks.dungeon.slice(2)];
    resolveIcon(g, 'a', g.iconHexes.find((h) => h.kind === 'dungeon')!);
    expect(g.pending?.kind).toBe('take_artifact');
    applyDeclineArtifact(g, 'a');
    expect(g.decks.dungeon.at(-1)).toBe('any_artifact');
    expect(g.pending).toMatchObject({ kind: 'roll', payload: { test: 'little', dungeon: true } });
  });

  it('"Any artifact" gives nothing when you already hold all four suits', () => {
    const g = onTile(1);
    g.players.a.artifacts = ['hearts', 'spades', 'diamonds', 'clubs'];
    g.decks.dungeon = ['any_artifact', 'little_monster', ...g.decks.dungeon.slice(2)];
    resolveIcon(g, 'a', g.iconHexes.find((h) => h.kind === 'dungeon')!);
    expect(g.pending).toMatchObject({ kind: 'roll', payload: { test: 'little', dungeon: true } });
  });

  it('stepping on an artifact you already hold: you keep it and the hex is completed', () => {
    const g = onTile(3); // Tile 3 NE = Hearts
    g.players.a.artifacts = ['hearts'];
    const hearts = g.iconHexes.find((h) => h.kind === 'hearts')!;
    resolveIcon(g, 'a', hearts);
    expect(g.players.a.artifacts).toEqual(['hearts']);
    expect(hearts.completedBy).toBe('a');
  });
});

describe('§8 quests', () => {
  it('Explore 3 tiles is claimed on the third tile; Most dungeons waits for the end', () => {
    const g = onTile(5);
    g.inPlayQuests = { explore_3_tiles: 'unclaimed', most_dungeons: 'unclaimed' };
    g.players.a.exploredTileIds = [7, 8];
    const outer = tileHexes('0,0').find((k) => k !== '0,0' && !g.iconHexes.some((h) => h.key === k))!;
    walkMove(g, 'a', [outer]);
    applyExplore(g, 'a');
    applyPlaceTile(g, 'a', explorableSlots(g, 'a')[0]!, 0);
    expect(g.inPlayQuests.explore_3_tiles).toBe('a');
    expect(g.players.a.questPoints).toBe(1);

    const d = onTile(1);
    d.inPlayQuests = { most_dungeons: 'unclaimed' };
    d.players.a.dungeonsCompleted = 1;
    d.iconHexes.push({ ...d.iconHexes.find((h) => h.kind === 'dungeon')!, key: '9,9', completed: true, completedBy: 'a' });
    d.decks.dungeon = ['any_artifact', ...d.decks.dungeon.slice(1)];
    resolveIcon(d, 'a', d.iconHexes.find((h) => h.kind === 'dungeon' && !h.completed)!);
    applyTakeArtifact(d, 'a', 'hearts', 'supply');
    expect(d.players.a.dungeonsCompleted).toBe(2);
    // Rules change 2026-09-30: no longer claimed on the second dungeon.
    expect(d.inPlayQuests.most_dungeons).toBe('unclaimed');
    expect(d.players.a.questPoints).toBe(0);
  });

  it('end-of-game quests go to strictly the most; a tie scores for no one', () => {
    const g = allAI(3).gameState;
    g.inPlayQuests = { most_little_monsters: 'unclaimed', most_big_monsters: 'unclaimed', most_artifacts: 'unclaimed', most_dungeons: 'unclaimed', most_companions: 'unclaimed' };
    g.players.a.littleMonsters = ['little-1', 'little-2']; g.players.b.littleMonsters = ['little-3'];
    g.players.b.dungeonsCompleted = 3; g.players.c.dungeonsCompleted = 1;
    g.players.a.companions = ['companion-1']; g.players.c.companions = ['companion-2'];
    g.players.a.bigMonsters = ['big-1']; g.players.b.bigMonsters = ['big-2'];
    g.players.c.artifacts = ['star'];
    // Run the last turn of the extra round.
    g.endingPhase = 2;
    for (const [i, pid] of g.playerOrder.entries()) g.players[pid]!.initiative = i + 1;
    endTurn(g, 'c');
    expect(g.gameOver).toBe(true);
    expect(g.inPlayQuests).toEqual({ most_little_monsters: 'a', most_big_monsters: 'unclaimed', most_artifacts: 'c', most_dungeons: 'b', most_companions: 'unclaimed' });
  });
});
