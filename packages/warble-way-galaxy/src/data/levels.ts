// Leveling — WR §15. Printed table: level 1→6, 2→12, 3→24, 4→48; past the
// table the doubling continues (ruling #14). On level-up: +1 to an ability the
// character already has ≥1 in, then subtract the min XP from current XP.

export const PRINTED_LEVEL_TABLE: Record<number, number> = {
  1: 6,
  2: 12,
  3: 24,
  4: 48,
};

export function minXpForLevel(level: number): number {
  if (level < 1) throw new Error(`Level must be >= 1, got ${level}`);
  const printed = PRINTED_LEVEL_TABLE[level];
  if (printed !== undefined) return printed;
  // Doubling continues beyond the printed table (ruling #14): 96, 192, ...
  return 48 * 2 ** (level - 4);
}
