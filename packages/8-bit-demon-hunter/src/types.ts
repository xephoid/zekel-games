// 8-bit Demon Hunter — the text port's state. Canonical design: PORT-PLAN.md
// in this package; the original game's code (../8-bit-demon-hunter) is the
// rule where the plan is silent.
//
// Zone categorisation. Solo game, no physical components: every zone is
// server-tracked. HIDDEN from the player (and so from the narrating LLM):
// demonId, Person.isDemon / isMinion, a person's good clue until earned, and
// the riddle answers (data/riddles.ts). Everything else is public.

import type { EnemyType } from './data/enemies.js';
import type { TempleType } from './data/magicItems.js';
import type { Color, Occupation, Pet } from './data/registries.js';
import type { ResourceNodeKind, ResourceType } from './data/resources.js';
import type { StatId } from './data/progression.js';
import type { Persona } from './data/personas.js';

// ---------------------------------------------------------------------------
// World graph (PORT-PLAN §3)
// ---------------------------------------------------------------------------

export type MajorNodeKind = 'town' | 'clearing' | 'temple';

export interface MajorNode {
  id: string;
  kind: MajorNodeKind;
  name: string;
  /** Town nodes: the town it is the door of. */
  townId?: string;
  /** Temple nodes: which temple. */
  templeType?: TempleType;
  /** Graph distance from the starting town node (enemy placement, views). */
  hops: number;
}

export interface Edge {
  a: string;
  b: string;
  /** The Sky Temple's stone ring: impassable until bombed from the clearing side. */
  walled: boolean;
}

export interface WorldGraph {
  nodes: Record<string, MajorNode>;
  edges: Edge[];
  startNodeId: string;
}

/** One enemy, attached to a major node. Its own small node in the notes'
 *  terms: `id` is what moves target. */
export interface Enemy {
  id: string;
  type: EnemyType;
  at: string;
  hp: number;
  maxHp: number;
  /** Set once the player has hit it (a Lady Bandit stops trading; the notes'
   *  "if she hasn't been attacked"). */
  attacked: boolean;
}

export interface ResourceNode {
  id: string;
  kind: ResourceNodeKind;
  at: string;
  hp: number;
}

// ---------------------------------------------------------------------------
// People and the puzzle (ported from shared/src/data/GameData.ts)
// ---------------------------------------------------------------------------

export interface Item {
  id: string;
  name: string;
}

export type TaskType = 'KILL' | 'FIND_PERSON' | 'FIND_ITEM' | 'ESCORT';

export interface GameTask {
  id: string;
  type: TaskType;
  /** KILL: an EnemyType. FIND_PERSON: an occupation / pet / colour. FIND_ITEM:
   *  a TempleType (magic item). ESCORT: a town id. */
  targetId: string;
  targetName: string;
  amount: number;
  currentAmount: number;
  description: string;
  reward: 'ITEM' | 'CLUE';
  giverId: string;
  isCompleted: boolean;
}

export interface PersonAttributes {
  occupation: Occupation;
  pet: Pet;
  color: Color;
  /** An item id, or 'None' once the player took it. */
  item: string;
  townId: string;
}

export interface Clue {
  text: string;
  /** true = a constraint ("The demon is a Baker"), false = a negation. */
  isGood: boolean;
  /** Occupation-power clue (Tailor), shown apart in the clue book. */
  isSpecial?: boolean;
  relatedAttribute?: { key: keyof PersonAttributes; value: string };
}

export interface Person {
  id: string;
  name: string;
  gender: 'male' | 'female';
  attributes: PersonAttributes;
  /** HIDDEN. */
  isDemon: boolean;
  /** HIDDEN. */
  isMinion: boolean;
  /** `good` is HIDDEN until earned; `bad` (the rumour) is told on first talk. */
  clues: { good?: Clue; bad?: Clue };
  task: GameTask;
  hasMet: boolean;
  taskCompleted: boolean;
  /** A game tip (starting town) or a lore line (every other town): their story. */
  tip: string;
  /** How the GM voices them (seeded, independent of the mystery). */
  persona: Persona;
}

export interface Town {
  id: string;
  name: string;
  /** The town's door node in the graph. */
  nodeId: string;
  people: Person[];
  /** Inn price multiplier per resource, 1..6. */
  prices: Record<ResourceType, number>;
  /** Inn stock per resource. */
  stock: Record<ResourceType, number>;
}

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------

export interface PlayerState {
  at: string;
  inside: null | 'town' | 'temple';
  level: number;
  xp: number;
  strength: number;
  agility: number;
  range: number;
  hp: number;
  maxHp: number;
  /** A Blacksmith's free stat pick is owed. (Earned levels are not stored:
   *  the original compares xp with the curve, see canLevelUp.) */
  freeStatPicks: number;
  shuckles: number;
  resources: Record<ResourceType, number>;
  bombs: number;
  lockpicks: number;
  magicItems: TempleType[];
  flying: boolean;
  /** Aura of Protection is up outdoors: the next move ignores blockers. */
  auraUp: boolean;
  knownClues: Clue[];
  /** Every task the player has accepted (giver ids); progress lives on each
   *  giver's `task`. All of them are active at once; overlapping ones
   *  progress and complete together (ruling 2026-10-21). */
  activeTasks: string[];
  /** People being escorted. */
  followers: string[];
  suspects: string[];
  searchedHouses: string[];
  locksmithCharges: number;
  bindings: string[];
  visitedTowns: string[];
  lastTown: string;
  worldCleared: boolean;
  /** The player has talked to a Lady Bandit and heard her offer (ruling
   *  2026-10-21: the black market is a secret to discover; nothing states it
   *  before then, and buying is only offered once it is known). */
  blackMarketKnown: boolean;
  /** Times the player has died (scoreboard; the harness bot gives up after three). */
  deaths: number;
}

export type Stat = StatId;

// ---------------------------------------------------------------------------
// Combat / temple / arena
// ---------------------------------------------------------------------------

export interface Combat {
  enemyId: string;
  round: number;
  /** The enemy has been hit at least once this combat (snake flee check). */
  enemyDamaged: boolean;
  /** Set once the start-of-combat range attack has been resolved. */
  openingDone: boolean;
  /** Whose action is owed. */
  turn: 'player' | 'enemy';
}

export interface TempleRun {
  temple: TempleType;
  mode: 'choice' | 'gauntlet' | 'riddle';
  /** Gauntlet: enemies still to fight. */
  remaining: number;
}

/** An open conversation (PORT-PLAN §6): what the person just said decides
 *  which replies are legal. */
export interface DialogueState {
  personId: string;
  stage: 'found' | 'reward' | 'offer' | 'closing';
}

export interface ArenaState {
  demonEnemyId: string;
  phase2Done: boolean;
  /** Phase 2 minions still to fight before the demon resumes. */
  minionQueue: string[];
}

// ---------------------------------------------------------------------------
// Session state
// ---------------------------------------------------------------------------

export type Phase = 'playing' | 'dead' | 'arena' | 'won' | 'lost';

export interface DemonHunterOptions {
  seed?: number;
  /** Number of clearings, 5..8 (default: drawn from the seed). */
  clearings?: number;
}

export interface DemonHunterState {
  seed: number;
  /** Moves applied so far (scoreboard; the harness bot gives up after many). */
  turn: number;
  phase: Phase;
  graph: WorldGraph;
  towns: Town[];
  /** HIDDEN. */
  demonId: string;
  items: Item[];
  enemies: Record<string, Enemy>;
  resources: Record<string, ResourceNode>;
  /** The overworld as generated: leaving a town or temple restores enemies,
   *  plants and trees to this (the original reloaded its stored overworld). */
  initialEnemies: Record<string, Enemy>;
  initialResources: Record<string, ResourceNode>;
  player: PlayerState;
  combat: Combat | null;
  temple: TempleRun | null;
  arena: ArenaState | null;
  dialogue: DialogueState | null;
  innOpen: boolean;
  result: { winner: 'player' | 'demon'; summary: string } | null;
}
