export type CardType = 'RESOURCE' | 'TECHNIQUE' | 'MISSTEP';

export interface CardEffects {
  damage?: number;
  defense?: number;
  actions?: number;
  draw?: number;
  spirit?: number;
  channels?: number;
  refine?: number;
  add_misstep?: number;
  heal?: number;
}

export interface CardDef {
  id: string;
  name: string;
  type: CardType;
  cost: number;
  description: string;
  value?: number;       // spirit produced when played as a resource
  effects?: CardEffects;
  faction?: string | null;
}

export const FACTIONS = {
  MASTERS_CIRCLE: 'masters_circle',
  UNCOUNTED: 'uncounted',
  TITAN_ENTERTAINMENT: 'titan_entertainment',
  THE_AWAKENED: 'the_awakened',
} as const;

export type FactionId = (typeof FACTIONS)[keyof typeof FACTIONS];

// Ported from antigravity-fist-and-form/src/data/techniques.js
export const CARDS: CardDef[] = [
  // --- RESOURCES ---
  { id: 'focus', name: 'Focus', type: 'RESOURCE', cost: 0, value: 1, description: '1 Spirit. If your stamina < opponent, discard all Focus for redraw (max 3 reloads per turn).', faction: null },
  { id: 'momentum', name: 'Momentum', type: 'RESOURCE', cost: 3, value: 2, description: '2 Spirit.', faction: null },
  { id: 'mastery', name: 'Mastery', type: 'RESOURCE', cost: 6, value: 3, description: '3 Spirit.', faction: null },

  // --- MISSTEP ---
  { id: 'misstep', name: 'Misstep', type: 'MISSTEP', cost: 0, value: 0, description: 'Unplayable. Refine to remove.', faction: null },

  // --- STARTER TECHNIQUES ---
  { id: 'attack', name: 'Attack', type: 'TECHNIQUE', cost: 4, description: '+1 Damage.', faction: null, effects: { damage: 1 } },
  { id: 'block', name: 'Block', type: 'TECHNIQUE', cost: 3, description: '+1 Defense.', faction: null, effects: { defense: 1 } },
  { id: 'react', name: 'React', type: 'TECHNIQUE', cost: 3, description: '+2 Tech.', faction: null, effects: { actions: 2 } },
  { id: 'quicken', name: 'Quicken', type: 'TECHNIQUE', cost: 2, description: '+2 Draws.', faction: null, effects: { draw: 2 } },
  { id: 'center', name: 'Center', type: 'TECHNIQUE', cost: 2, description: '+2 Spirit.', faction: null, effects: { spirit: 2 } },
  { id: 'distract', name: 'Distract', type: 'TECHNIQUE', cost: 3, description: '+2 Missteps.', faction: null, effects: { add_misstep: 2 } },
  { id: 'assess', name: 'Assess', type: 'TECHNIQUE', cost: 2, description: '+2 Refine.', faction: null, effects: { refine: 2 } },

  // --- MASTERS' CIRCLE ---
  { id: 'defensive_kata', name: 'Defensive Kata', type: 'TECHNIQUE', cost: 4, description: '+2 Refine, +2 Defense.', faction: FACTIONS.MASTERS_CIRCLE, effects: { defense: 2, refine: 2 } },
  { id: 'perfect_form', name: 'Perfect Form', type: 'TECHNIQUE', cost: 5, description: '+1 Refine, +2 Draw, +1 Tech.', faction: FACTIONS.MASTERS_CIRCLE, effects: { refine: 1, draw: 2, actions: 1 } },
  { id: 'masters_riposte', name: "Master's Riposte", type: 'TECHNIQUE', cost: 5, description: '+1 Defense, +1 Damage.', faction: FACTIONS.MASTERS_CIRCLE, effects: { defense: 1, damage: 1 } },
  { id: 'flowing_counter', name: 'Flowing Counter', type: 'TECHNIQUE', cost: 5, description: '+2 Tech, +3 Defense.', faction: FACTIONS.MASTERS_CIRCLE, effects: { defense: 3, actions: 2 } },

  // --- UNCOUNTED ---
  { id: 'impose_pressure', name: 'Impose Pressure', type: 'TECHNIQUE', cost: 4, description: '+1 Draw, +2 Spirit, +1 Channel.', faction: FACTIONS.UNCOUNTED, effects: { draw: 1, spirit: 2, channels: 1 } },
  { id: 'leg_sweep', name: 'Leg Sweep', type: 'TECHNIQUE', cost: 5, description: '+2 Missteps, +1 Damage.', faction: FACTIONS.UNCOUNTED, effects: { damage: 1, add_misstep: 2 } },
  { id: 'overwhelming_assault', name: 'Overwhelming Assault', type: 'TECHNIQUE', cost: 8, description: '+2 Tech, +2 Damage.', faction: FACTIONS.UNCOUNTED, effects: { damage: 2, actions: 2 } },
  { id: 'ruthless_barrage', name: 'Ruthless Barrage', type: 'TECHNIQUE', cost: 5, description: '+1 Draw, +2 Tech, +3 Missteps.', faction: FACTIONS.UNCOUNTED, effects: { actions: 2, add_misstep: 3, draw: 1 } },

  // --- TITAN ENTERTAINMENT ---
  { id: 'showstopper', name: 'Showstopper', type: 'TECHNIQUE', cost: 5, description: '+2 Spirit, +1 Damage.', faction: FACTIONS.TITAN_ENTERTAINMENT, effects: { damage: 1, spirit: 2 } },
  { id: 'targeted_strike', name: 'Targeted Strike', type: 'TECHNIQUE', cost: 5, description: '+1 Refine, +1 Damage.', faction: FACTIONS.TITAN_ENTERTAINMENT, effects: { refine: 1, damage: 1 } },
  { id: 'grand_finale', name: 'Grand Finale', type: 'TECHNIQUE', cost: 10, description: '+5 Damage.', faction: FACTIONS.TITAN_ENTERTAINMENT, effects: { damage: 5 } },
  { id: 'devastating_blow', name: 'Devastating Blow', type: 'TECHNIQUE', cost: 8, description: '+1 Draw, +3 Damage.', faction: FACTIONS.TITAN_ENTERTAINMENT, effects: { draw: 1, damage: 3 } },

  // --- THE AWAKENED ---
  { id: 'energy_channeling', name: 'Energy Channeling', type: 'TECHNIQUE', cost: 4, description: '+2 Spirit, +1 Channel.', faction: FACTIONS.THE_AWAKENED, effects: { spirit: 2, channels: 1 } },
  { id: 'enlightened_flow', name: 'Enlightened Flow', type: 'TECHNIQUE', cost: 5, description: '+3 Tech, +2 Spirit.', faction: FACTIONS.THE_AWAKENED, effects: { actions: 3, spirit: 2 } },
  { id: 'inner_harmony', name: 'Inner Harmony', type: 'TECHNIQUE', cost: 6, description: '+2 Heal, +2 Refine.', faction: FACTIONS.THE_AWAKENED, effects: { heal: 2, refine: 2 } },
  { id: 'transcendent_strike', name: 'Transcendent Strike', type: 'TECHNIQUE', cost: 8, description: '+1 Draw, +3 Heal, +2 Damage.', faction: FACTIONS.THE_AWAKENED, effects: { damage: 2, heal: 3, draw: 1 } },

  // --- GENERAL ---
  { id: 'reading_the_opponent', name: 'Read Opponent', type: 'TECHNIQUE', cost: 4, description: '+1 Draw, +2 Tech.', faction: null, effects: { draw: 1, actions: 2 } },
  { id: 'deflecting_block', name: 'Deflecting Block', type: 'TECHNIQUE', cost: 3, description: '+1 Tech, +1 Defense.', faction: null, effects: { actions: 1, defense: 1 } },
  { id: 'smoke_bomb', name: 'Smoke Bomb', type: 'TECHNIQUE', cost: 3, description: '+2 Tech, +1 Misstep.', faction: null, effects: { actions: 2, add_misstep: 1 } },
  { id: 'combination_rush', name: 'Combination Rush', type: 'TECHNIQUE', cost: 3, description: '+2 Tech, +1 Channel.', faction: null, effects: { actions: 2, channels: 1 } },
  { id: 'thoughtful_composure', name: 'Thoughtful Composure', type: 'TECHNIQUE', cost: 4, description: '+2 Tech, +2 Refine.', faction: null, effects: { actions: 2, refine: 2 } },
  { id: 'mental_clarity', name: 'Mental Clarity', type: 'TECHNIQUE', cost: 3, description: '+3 Draw.', faction: null, effects: { draw: 3 } },
  { id: 'flying_kick', name: 'Flying Kick', type: 'TECHNIQUE', cost: 6, description: '+2 Damage.', faction: null, effects: { damage: 2 } },
];

const CARD_INDEX = new Map<string, CardDef>(CARDS.map((c) => [c.id, c]));

export function getCard(id: string): CardDef {
  const c = CARD_INDEX.get(id);
  if (!c) throw new Error(`Unknown card id: ${id}`);
  return c;
}

export function tryGetCard(id: string): CardDef | undefined {
  return CARD_INDEX.get(id);
}

// Constants from antigravity-fist-and-form/src/data/index.js
export const STARTING_DECK = [
  'focus', 'focus', 'focus', 'focus', 'focus', 'focus', 'focus',
  'misstep', 'misstep', 'misstep',
];

export const MAX_MISSTEPS = 10;

// A player may Focus-reload (discard all Focus, redraw the same count) at most
// this many times per turn. Without the cap a behind-on-stamina player could
// reload endlessly — the deck is Focus-heavy, so a reload usually redraws
// Focus, keeping the move available (the AI harness surfaced this as an
// infinite loop). Enforced in the engine + legalMoves for AI and human alike.
export const FOCUS_RELOADS_PER_TURN = 3;

// Default loadout = the seven canonical "starter cards" (per the game designer).
// They span every effect category: damage, defense, refine, spirit, missteps, draw, actions.
export const DEFAULT_LOADOUT = [
  'attack',    // +1 damage
  'block',     // +1 defense
  'assess',    // +2 refine
  'center',    // +2 spirit
  'distract',  // +2 missteps to opponent
  'quicken',   // +2 draws
  'react',     // +2 tech (actions)
];

// Always-available resources in supply
export const SUPPLY_RESOURCES = ['focus', 'momentum', 'mastery'];

export const RESOURCE_SUPPLY_COUNT = 20;
export const TECHNIQUE_SUPPLY_COUNT = 5;

// Printed-name resolution (CLAUDE.md "accept the human-facing label"): a move's
// card_id may be the internal id OR the name printed on the card, ignoring
// case, spacing and punctuation — "Devastating Blow", "devastating-blow",
// "Master's Riposte" and "masters_riposte" all resolve. Older printings'
// names are accepted too: the React app's "jab" (now Attack) and the rules
// document's "Reading the Opponent" (now printed "Read Opponent").
const normalizeCardKey = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

const CARD_ALIASES: Record<string, string> = {
  jab: 'attack',
  readingtheopponent: 'reading_the_opponent',
};

const CARD_KEY_INDEX = new Map<string, string>();
for (const c of CARDS) {
  CARD_KEY_INDEX.set(normalizeCardKey(c.id), c.id);
  CARD_KEY_INDEX.set(normalizeCardKey(c.name), c.id);
}
for (const [alias, id] of Object.entries(CARD_ALIASES)) CARD_KEY_INDEX.set(alias, id);

/** The card id for an id or printed name, or undefined when nothing matches. */
export function resolveCardId(idOrName: string): string | undefined {
  if (typeof idOrName !== 'string') return undefined;
  return CARD_KEY_INDEX.get(normalizeCardKey(idOrName));
}
