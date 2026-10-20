// Seedable RNG (mulberry32) — deterministic & testable. Mirrors the other game
// modules' rng helpers so the harness/tests behave identically across games.

export function nextSeed(seed: number): number {
  let t = (seed + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (t ^ (t >>> 14)) >>> 0;
}

export function randomFloat(seed: number): { value: number; nextSeed: number } {
  const s = nextSeed(seed);
  return { value: s / 0x100000000, nextSeed: s };
}

export function randomInt(seed: number, maxExclusive: number): { value: number; nextSeed: number } {
  const r = randomFloat(seed);
  return { value: Math.floor(r.value * maxExclusive), nextSeed: r.nextSeed };
}

/** Fisher–Yates shuffle, pure: returns a new array + the advanced seed. */
export function shuffle<T>(items: readonly T[], seed: number): { items: T[]; nextSeed: number } {
  const arr = [...items];
  let s = seed;
  for (let i = arr.length - 1; i > 0; i--) {
    const r = randomInt(s, i + 1);
    s = r.nextSeed;
    const j = r.value;
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return { items: arr, nextSeed: s };
}

/** Roll `n` six-sided dice; returns the faces + advanced seed. */
export function rollDice(n: number, seed: number): { faces: number[]; nextSeed: number } {
  const faces: number[] = [];
  let s = seed;
  for (let i = 0; i < n; i++) {
    const r = randomInt(s, 6);
    s = r.nextSeed;
    faces.push(r.value + 1);
  }
  return { faces, nextSeed: s };
}

/** Sugar cubes are CUSTOM dice: 3 blank faces (0 pips), plus 1, 2, and 3 pips.
 *  Battles roll one such die per sugar cube. Returns the total pips + new seed. */
export const SUGAR_DIE_FACES = [0, 0, 0, 1, 2, 3] as const;

export function rollSugarDice(n: number, seed: number): { faces: number[]; total: number; nextSeed: number } {
  const faces: number[] = [];
  let s = seed;
  for (let i = 0; i < n; i++) {
    const r = randomInt(s, 6);
    s = r.nextSeed;
    faces.push(SUGAR_DIE_FACES[r.value]!);
  }
  return { faces, total: faces.reduce((a, b) => a + b, 0), nextSeed: s };
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 0x100000000) >>> 0;
}
