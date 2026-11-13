// Reads what the rulebook page draws from the game's reference data
// (getReferenceData in the rules half): the rulebook's words and examples,
// and the card list every card face is drawn from. Nothing here works out a
// rule; it only checks the shapes and names the fields.

import type { GameReferenceResponse } from '@zekel/wire-types';
import { isObj } from '@zekel/glue-kit';
import { cardDefs, type CardDef } from '../read.js';

export interface Counters {
  actions?: number; damage?: number; defense?: number; spirit?: number; channels?: number; refine?: number;
  missteps?: number; stamina?: number;
}
export interface ExampleStep { move: string; card?: string; text: string; after: Counters }
export interface Example { title: string; hand: string[]; start: Counters; steps: ExampleStep[]; close: string }
export interface Side { name: string; damage: number; defense: number; stamina: number; after: number }

export interface RulebookText {
  title: string;
  intro: string;
  facts: string[];
  win: { title: string; text: string; tie: string };
  components: { intro: string; items: Array<{ card: string | null; name: string; count: number; text: string }>; note: string };
  setup: { steps: string[]; deck: string[]; deck_caption: string; loadout: string[]; loadout_caption: string };
  round: { intro: string; turn: Array<{ name: string; text: string }>; strike: { name: string; text: string }; note: string };
  technique: { intro: string; example: Example };
  effects: { intro: string; list: Array<{ key: string; word: string; text: string }> };
  channel: { intro: string; worth: Array<{ card: string; spirit: number }>; example: Example };
  refine: { intro: string; missteps: string; example: Example };
  reload: { title: string; text: string };
  cleanup: { intro: string; steps: string[] };
  strike: { intro: string; example: { title: string; you: Side; them: Side; steps: string[] }; end: string };
  cards: { intro: string; groups: Array<{ id: string; title: string; text: string; cards: string[]; school?: string }> };
}

export interface RulebookData {
  text: RulebookText;
  /** Every card, by engine id, as the reference data gives it. */
  cards: Map<string, CardDef>;
}

/** The rulebook page's data, or null when the reference has no rulebook. */
export function readRulebook(reference: GameReferenceResponse | null): RulebookData | null {
  const rd = reference?.referenceData;
  if (!isObj(rd) || !isObj(rd['rulebook'])) return null;
  const text = rd['rulebook'] as unknown as RulebookText;
  if (typeof text.title !== 'string' || !isObj(text.cards) || !Array.isArray(text.cards.groups)) return null;
  return { text, cards: cardDefs(reference) };
}
