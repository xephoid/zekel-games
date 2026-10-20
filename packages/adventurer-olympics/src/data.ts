// Adventurer Olympics — game data, transcribed verbatim from
// src/games/adventurer-olympics/RULES.md (commit 79106ad, 2026-09-27; the
// draft rulebook PDF plus the designer's 2026-09-27 rulings, where the doc
// wins). This is the build's transcription anchor (PORT-PLAN.md §7 M0); the
// integrity test in __tests__/data.test.ts asserts the counts and histograms
// below against the pinned rules text, never against this file's self-belief.
//
// All card/tile NAMES are placeholders for now (RULES.md §11: "All names and
// symbols on cards and tiles are placeholders for now."). Numbers and bonuses
// are the operative data.

export type StatKey = 'charisma' | 'strength' | 'movement';

export interface CompanionCard {
  id: string;          // 'companion-1' .. 'companion-16'
  number: number;      // number to beat (top right)
  bonus: Partial<Record<StatKey, number>>; // stat bonuses on recruit
}

export interface MonsterCard {
  id: string;          // 'little-1'.. / 'big-1'..
  number: number;      // number to beat
}

export type DungeonCardKind =
  | 'little_monster'
  | 'big_monster'
  | 'double_little_monsters'
  | 'companion'
  | 'any_artifact'
  | 'map';

export type ArtifactId = 'hearts' | 'spades' | 'diamonds' | 'clubs' | 'star';

export type IconKind =
  | 'city'
  | 'dungeon'
  | 'little_monster'
  | 'big_monster'
  | 'artifact';

export type HexName = 'C' | 'N' | 'NE' | 'SE' | 'S' | 'SW' | 'NW';

export interface TileDef {
  id: number;                    // 1..10 (printed tile number)
  icons: Partial<Record<HexName, IconKind | ArtifactId>>;
}

export type QuestKind =
  | 'explore_3_tiles'
  | 'most_dungeons'
  | 'most_companions'
  | 'most_little_monsters'
  | 'most_big_monsters'
  | 'most_artifacts';

export interface QuestDef {
  kind: QuestKind;
  name: string;
  endGame: boolean; // true = scored at end of game; false = claimed instantly
  /** Instant quests: how many it takes to claim it (RULES.md §8). */
  target?: number;
}

/** Quest cards printed before the 2026-09-30 rules change: the old card
 *  names, still accepted when a player reports a drawn quest card. */
export const OLD_QUEST_NAMES: Record<string, QuestKind> = {
  'complete 2 dungeons': 'most_dungeons',
  'recruit 2 companions': 'most_companions',
};

// ---------------------------------------------------------------------------
// Deck sizes (PORT-PLAN §2 — the build's conservation anchors)
// ---------------------------------------------------------------------------
export const COMPANION_DECK_SIZE = 16;
export const LITTLE_MONSTER_DECK_SIZE = 12;
export const BIG_MONSTER_DECK_SIZE = 12;
export const DUNGEON_DECK_SIZE = 24;
export const QUEST_DECK_SIZE = 6;
export const ARTIFACT_COUNT = 5;
export const MAP_TILE_COUNT = 10;

/** Player tokens of each colour in the box (RULES.md §1: 10 per colour). What
 *  happens when a player runs out is an open designer question (§12). */
export const TOKENS_PER_COLOUR = 10;

// ---------------------------------------------------------------------------
// Companion cards (16) — RULES.md §10. Histogram: 2×8, 4×4, 6×4 (sums to 16).
// ---------------------------------------------------------------------------
export const COMPANION_CARDS: CompanionCard[] = [
  { id: 'companion-1', number: 2, bonus: { strength: 1 } },
  { id: 'companion-2', number: 2, bonus: { strength: 1 } },
  { id: 'companion-3', number: 2, bonus: { charisma: 1 } },
  { id: 'companion-4', number: 2, bonus: { strength: 1, charisma: 1 } },
  { id: 'companion-5', number: 6, bonus: { charisma: 3, movement: 3 } },
  { id: 'companion-6', number: 4, bonus: { movement: 3 } },
  { id: 'companion-7', number: 2, bonus: { strength: 1, movement: 1 } },
  { id: 'companion-8', number: 6, bonus: { movement: 4 } },
  { id: 'companion-9', number: 4, bonus: { charisma: 3 } },
  { id: 'companion-10', number: 2, bonus: { movement: 1 } },
  { id: 'companion-11', number: 2, bonus: { movement: 1 } },
  { id: 'companion-12', number: 2, bonus: { charisma: 1 } },
  { id: 'companion-13', number: 4, bonus: { strength: 3 } },
  { id: 'companion-14', number: 4, bonus: { strength: 2, movement: 2 } },
  { id: 'companion-15', number: 6, bonus: { strength: 4 } },
  { id: 'companion-16', number: 6, bonus: { charisma: 4 } },
];

// ---------------------------------------------------------------------------
// Little Monster cards (12) — RULES.md §10: four each of 2, 3 and 4.
// ---------------------------------------------------------------------------
export const LITTLE_MONSTER_NUMBERS: number[] = [4, 3, 4, 3, 3, 2, 2, 2, 2, 4, 3, 4];
export const LITTLE_MONSTER_CARDS: MonsterCard[] = LITTLE_MONSTER_NUMBERS.map(
  (number, i) => ({ id: `little-${i + 1}`, number }),
);

// ---------------------------------------------------------------------------
// Big Monster cards (12) — RULES.md §10: four each of 5, 6 and 7.
// ---------------------------------------------------------------------------
export const BIG_MONSTER_NUMBERS: number[] = [5, 5, 7, 7, 7, 6, 5, 7, 6, 6, 6, 5];
export const BIG_MONSTER_CARDS: MonsterCard[] = BIG_MONSTER_NUMBERS.map(
  (number, i) => ({ id: `big-${i + 1}`, number }),
);

// ---------------------------------------------------------------------------
// Dungeon cards (24) — RULES.md §10: 6/2/3/6/4/3 by kind.
// ---------------------------------------------------------------------------
export const DUNGEON_COMPOSITION: Record<DungeonCardKind, number> = {
  little_monster: 6,
  double_little_monsters: 2,
  big_monster: 3,
  companion: 6,
  any_artifact: 4,
  map: 3,
};
export const DUNGEON_KINDS = Object.keys(DUNGEON_COMPOSITION) as DungeonCardKind[];

export const DUNGEON_KIND_NAMES: Record<DungeonCardKind, string> = {
  little_monster: 'Little Monster',
  big_monster: 'Big Monster',
  double_little_monsters: '2x Little Monsters',
  companion: 'Companion',
  any_artifact: 'Any artifact',
  map: 'Map',
};

// ---------------------------------------------------------------------------
// Artifacts (5) — RULES.md §10.
// ---------------------------------------------------------------------------
export const ARTIFACTS: ArtifactId[] = ['hearts', 'spades', 'diamonds', 'clubs', 'star'];
// The four suit artifacts are the ones an "Any artifact" card may take.
export const SUIT_ARTIFACTS: ArtifactId[] = ['hearts', 'spades', 'diamonds', 'clubs'];
export const ARTIFACT_NAMES: Record<ArtifactId, string> = {
  hearts: 'Hearts',
  spades: 'Spades',
  diamonds: 'Diamonds',
  clubs: 'Clubs',
  star: 'Star',
};
// Tile 6's SW hex carries the Star (designer addition, 2026-09-27).
export const STAR_TILE = 6;
export const STAR_HEX: HexName = 'SW';

// ---------------------------------------------------------------------------
// Quest cards (6) — RULES.md §10.
// ---------------------------------------------------------------------------
export const QUESTS: QuestDef[] = [
  { kind: 'explore_3_tiles', name: 'Explore 3 tiles', endGame: false, target: 3 },
  { kind: 'most_dungeons', name: 'Most dungeons', endGame: true },
  { kind: 'most_companions', name: 'Most companions', endGame: true },
  { kind: 'most_little_monsters', name: 'Most Little Monsters', endGame: true },
  { kind: 'most_big_monsters', name: 'Most Big Monsters', endGame: true },
  { kind: 'most_artifacts', name: 'Most artifacts', endGame: true },
];

// ---------------------------------------------------------------------------
// Map tiles (10) — RULES.md §11. Hex names C/N/NE/SE/S/SW/NW are the tile's
// PRINTED orientation; the explorer turns it any way when placing it. No tile
// has an icon on its centre hex. Tile 2 NW=Clubs (PDF said Spade; doc wins),
// Tile 6 SW=Star. Icon totals: 10 little / 3 big / 3 city / 5 dungeon /
// 5 artifact = 26.
// ---------------------------------------------------------------------------
export const TILES: TileDef[] = [
  { id: 1, icons: { SW: 'city', NE: 'dungeon' } },
  { id: 2, icons: { NW: 'clubs', N: 'dungeon', S: 'little_monster' } },
  { id: 3, icons: { NW: 'big_monster', NE: 'hearts', SW: 'city' } },
  { id: 4, icons: { SW: 'little_monster', NE: 'big_monster' } },
  { id: 5, icons: { SW: 'little_monster' } },
  { id: 6, icons: { N: 'little_monster', S: 'big_monster', SW: 'star' } },
  { id: 7, icons: { NW: 'dungeon', S: 'diamonds', NE: 'little_monster', SE: 'little_monster' } },
  { id: 8, icons: { NW: 'little_monster', N: 'spades', NE: 'dungeon' } },
  { id: 9, icons: { N: 'little_monster', S: 'city' } },
  { id: 10, icons: { SW: 'little_monster', NE: 'little_monster', SE: 'dungeon' } },
];

// ---------------------------------------------------------------------------
// Starting stats (RULES.md §2).
// ---------------------------------------------------------------------------
export const STARTING_STATS: Record<StatKey, number> = {
  charisma: 1,
  strength: 1,
  movement: 2,
};
