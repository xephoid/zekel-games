// The 144 letter tiles (rules.md, appendix). The same counts as a
// Bananagrams set, so a table usually has them already.

export const TILE_COUNTS: Readonly<Record<string, number>> = {
  A: 13, B: 3, C: 3, D: 6, E: 18, F: 3, G: 4, H: 3, I: 12, J: 2, K: 2, L: 5, M: 3,
  N: 8, O: 11, P: 3, Q: 2, R: 9, S: 6, T: 9, U: 6, V: 3, W: 3, X: 2, Y: 3, Z: 2,
};

export const TILE_TOTAL = 144;

export const LETTERS: readonly string[] = Object.keys(TILE_COUNTS);

/** A fresh pool: every tile face up in the middle of the table. */
export function freshPool(): Record<string, number> {
  return { ...TILE_COUNTS };
}
