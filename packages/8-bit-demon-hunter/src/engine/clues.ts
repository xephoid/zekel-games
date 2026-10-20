// Keeping clues truthful when the demon moves town (the design rule "if the
// player escorts the demon to another location the clue information must
// update"; the original's code never got round to it). Only location clues
// are touched; the rest of the mystery stays as dealt.

import type { Clue, DemonHunterState } from '../types.js';
import { allPeople } from './helpers.js';

export function relocateDemonClues(state: DemonHunterState, fromTownId: string, toTownId: string): void {
  if (fromTownId === toTownId) return;
  const nameOf = (id: string): string => state.towns.find((t) => t.id === id)?.name ?? 'Unknown Town';
  const rewrites = new Map<string, Clue>();
  const fix = (clue: Clue | undefined): void => {
    if (!clue || clue.relatedAttribute?.key !== 'townId') return;
    const before = clue.text;
    if (clue.isGood) {
      // "The demon is in <old>" → new town.
      clue.relatedAttribute = { key: 'townId', value: toTownId };
      clue.text = `The demon is in ${nameOf(toTownId)}`;
    } else if (clue.relatedAttribute.value === toTownId) {
      // An honest "The demon is not in <new>" is now false: point it at the old town instead.
      clue.relatedAttribute = { key: 'townId', value: fromTownId };
      clue.text = `The demon is not in ${nameOf(fromTownId)}`;
    } else if (clue.relatedAttribute.value === fromTownId) {
      // A liar's "The demon is not in <old>" is now true: keep it a lie.
      clue.relatedAttribute = { key: 'townId', value: toTownId };
      clue.text = `The demon is not in ${nameOf(toTownId)}`;
    }
    if (clue.text !== before) rewrites.set(before, { ...clue });
  };
  for (const p of allPeople(state)) {
    fix(p.clues.good);
    fix(p.clues.bad);
  }
  // The clue book follows.
  state.player.knownClues = state.player.knownClues.map((c) => rewrites.get(c.text) ?? c);
}
