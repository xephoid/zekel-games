// Spoken move text for Fractured Fist (docs/spoken-narration.md).
//
// Every applyMove summary is the one string a player HEARS for that move —
// zekel Live reads it aloud as-is, and chat clients relay it verbatim. So each
// one must read naturally when spoken and carry everything needed to copy the
// move onto the physical table: the seat's display name (never a raw seat id),
// card names exactly as printed, no internal ids, no engine terms, no
// abbreviations. The AI's `narration` is the same string (index.ts getAIMove),
// so the two can never disagree.

import type { NameOf } from '@zekel/game-kit';

export { seatNamer, type NameOf } from '@zekel/game-kit';

/** Fallback for callers with no seat list (engine unit tests, MCTS rollouts). */
export const idAsName: NameOf = (id) => id;

/** Upper-cases the first letter, for a name that starts a sentence ("The AI"). */
export function cap(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

/** "the AI" → "the AI's", "Zeke" → "Zeke's", "Ross" → "Ross's". */
export function possessive(name: string): string {
  return `${name}'s`;
}

/** "1 card", "2 cards". */
export function count(n: number, singular: string, plural = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

/** "a", "a and b", "a, b, and c". */
export function listJoin(parts: string[]): string {
  if (parts.length <= 1) return parts.join('');
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
}
