import type { AbilityScores } from '../types.js';

// ---------------------------------------------------------------------------
// Amendment A21 "Archetype cards" (designer-approved 2026-07-09): character
// creation may skip the point math — pick a named pre-built 3/2/1 card with a
// printed difficulty rating. Ratings come from measured bot-medium win rates
// under A1–A20 (n=100 seeds per card; a human plays well above the bot):
// Easy ★ ≥50% · Moderate ★★ 20–49% · Hard ★★★ 10–19% · Brutal ★★★★ <10%.
// Two cards measured DEAD in every spread dressing and are SHELVED until they
// get their own space verb (the early-space wall, BALANCE.md): Ruin Delver
// (SWA3/DIP2/SNE1) and Star Performer (ACT3/PIL2/MEC1).
// ---------------------------------------------------------------------------

export interface ArchetypeCard {
  id: string;
  /** The printed card name — the form the player says and the resolver accepts. */
  name: string;
  scores: AbilityScores;
  difficulty: 'easy' | 'moderate' | 'hard' | 'brutal';
  stars: '★' | '★★' | '★★★' | '★★★★';
  /** One line of table talk: the playstyle and the ending the card tends to win. */
  identity: string;
}

export const ARCHETYPES: ArchetypeCard[] = [
  { id: 'void-runner', name: 'Void Runner', scores: { SNE: 3, MEC: 2, RES: 1 }, difficulty: 'easy', stars: '★',
    identity: 'slip past everything and keep the ship whole — tends to win Conquest' },
  { id: 'ghost-smuggler', name: 'Ghost Smuggler', scores: { SNE: 3, HAK: 2, SWA: 1 }, difficulty: 'easy', stars: '★',
    identity: 'stealth backed by system intrusion — tends to win Conquest' },
  { id: 'privateer', name: 'Privateer', scores: { PIL: 3, SWA: 2, MEC: 1 }, difficulty: 'moderate', stars: '★★',
    identity: 'a fighting captain who boards what she cannot outrun — tends to win Bounty' },
  { id: 'fleet-captain', name: 'Fleet Captain', scores: { LEA: 3, MEC: 2, RES: 1 }, difficulty: 'moderate', stars: '★★',
    identity: 'inspirational command and a growing crew — tends to win Legend' },
  { id: 'ace-pilot', name: 'Ace Pilot', scores: { PIL: 3, MEC: 2, RES: 1 }, difficulty: 'hard', stars: '★★★',
    identity: 'pure flying skill in long campaigns — tends to win Legend or Conquest' },
  { id: 'netdiver', name: 'Netdiver', scores: { HAK: 3, MEC: 2, RES: 1 }, difficulty: 'hard', stars: '★★★',
    identity: 'hacks credits straight out of pirate hulls — tends to win Fortune' },
  { id: 'field-scholar', name: 'Field Scholar', scores: { RES: 3, GUN: 2, PIL: 1 }, difficulty: 'brutal', stars: '★★★★',
    identity: 'a scholar-XP engine that shoots back — tends to win Legend' },
  { id: 'grease-monkey', name: 'Grease Monkey', scores: { MEC: 3, PIL: 2, RES: 1 }, difficulty: 'brutal', stars: '★★★★',
    identity: 'an engineer who redlines the engines mid-fight (A20) — tends to win Legend' },
  { id: 'dread-corsair', name: 'Dread Corsair', scores: { DEM: 3, PIL: 2, DIP: 1 }, difficulty: 'brutal', stars: '★★★★',
    identity: 'terror, tribute, and a name pirates whisper — tends to win Bounty' },
];

const DIFFICULTY_LABELS: Record<ArchetypeCard['difficulty'], string> = {
  easy: 'Easy',
  moderate: 'Moderate',
  hard: 'Hard',
  brutal: 'Brutal',
};

export function archetypeLabel(card: ArchetypeCard): string {
  const spread = Object.entries(card.scores).map(([a, v]) => `${a} +${v}`).join(' / ');
  return `${card.name} (${DIFFICULTY_LABELS[card.difficulty]} ${card.stars}) — ${spread}: ${card.identity}`;
}

const normalize = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Case/spacing/punctuation-tolerant printed-name lookup; null if unknown. */
export function resolveArchetype(name: string): ArchetypeCard | null {
  const wanted = normalize(name);
  if (!wanted) return null;
  return ARCHETYPES.find((c) => normalize(c.name) === wanted || normalize(c.id) === wanted) ?? null;
}

export function archetypeNameList(): string {
  return ARCHETYPES.map((c) => c.name).join(', ');
}
