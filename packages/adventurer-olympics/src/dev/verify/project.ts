// Glue: Adventurer Olympics engine state -> the common comparison shape. This
// file may know the engine's types; it is a field-by-field copy with no
// interpretation (the rules side does the rulebook reasoning).
//
// Every field below is server-known. Set-valued zones (held cards, artifacts,
// claimed quests) are SORTED so diffs never depend on push order. Deck ORDER is
// kept as-is: "the bottom of the deck" is the fact some rules check.

import type { AOState } from '../../types.js';
import type { VerifyEvent } from '@zekel/dev/verify/exec/types';

export interface AOVerifyPlayer {
  kind: string;
  table: string | null;
  hex: string;
  stepsLeft: number;
  initiative: number;
  companions: string[];
  littleMonsters: string[];
  bigMonsters: string[];
  artifacts: string[];
  questPoints: number;
  claimedQuests: string[];
  exploredTiles: number;
  dungeonsCompleted: number;
  tokensSpent: number;
}

export interface AOVerifyIcon {
  key: string;
  kind: string;
  completed: boolean;
  completedBy: string | null;
}

export interface AOVerifyState {
  playerOrder: string[];
  round: number;
  activeSeat: string;
  endingPhase: number;
  gameOver: boolean;
  serverOwnsDecks: boolean;
  pendingKind: string | null;
  pendingSeat: string | null;
  pendingPayload: Record<string, unknown>;
  players: Record<string, AOVerifyPlayer>;
  /** Placed tile centres (key -> tile id). */
  tiles: Record<string, number>;
  tileStack: number[];
  /** Every hex on the map. */
  hexes: string[];
  icons: AOVerifyIcon[];
  decks: { companion: string[]; little: string[]; big: string[]; dungeon: string[] };
  inPlayQuests: Record<string, string>;
  baseTotals: Record<string, number>;
  turnOrder: Record<string, number>;
  dungeonResolving: { iconKey: string; kind: string } | null;
}

export function projectAdventurerOlympics(g: AOState): AOVerifyState {
  const players: Record<string, AOVerifyPlayer> = {};
  for (const pid of g.playerOrder) {
    const p = g.players[pid]!;
    players[pid] = {
      kind: p.kind,
      table: p.table ?? null,
      hex: p.hexKey,
      stepsLeft: p.stepsLeft,
      initiative: p.initiative,
      companions: [...p.companions].sort(),
      littleMonsters: [...p.littleMonsters].sort(),
      bigMonsters: [...p.bigMonsters].sort(),
      artifacts: [...p.artifacts].sort(),
      questPoints: p.questPoints,
      claimedQuests: [...p.claimedQuests].sort(),
      exploredTiles: p.exploredTileIds.length,
      dungeonsCompleted: p.dungeonsCompleted,
      tokensSpent: p.tokensSpent,
    };
  }
  return {
    playerOrder: [...g.playerOrder],
    round: g.round,
    activeSeat: g.activeSeat,
    endingPhase: g.endingPhase,
    gameOver: g.gameOver,
    serverOwnsDecks: g.serverOwnsDecks,
    pendingKind: g.pending?.kind ?? null,
    pendingSeat: g.pending?.seat ?? null,
    pendingPayload: { ...(g.pending?.payload ?? {}) },
    players,
    tiles: Object.fromEntries(g.placedTiles.map((t) => [t.center.key, t.tileId])),
    tileStack: [...g.tileStack],
    hexes: Object.keys(g.hexes).sort(),
    icons: g.iconHexes.map((h) => ({ key: h.key, kind: h.kind as string, completed: h.completed, completedBy: h.completedBy })),
    decks: {
      companion: [...g.decks.companion],
      little: [...g.decks.little],
      big: [...g.decks.big],
      dungeon: [...g.decks.dungeon],
    },
    inPlayQuests: { ...g.inPlayQuests },
    baseTotals: { ...g.baseTotals },
    turnOrder: { ...g.turnOrder },
    dungeonResolving: g.dungeonResolving ? { ...g.dungeonResolving } : null,
  };
}

export function toEvent(_g: AOState, playerId: string, move: Record<string, unknown>, moveIndex: number): VerifyEvent {
  return { moveIndex, actor: playerId, moveType: String(move.type), move };
}
