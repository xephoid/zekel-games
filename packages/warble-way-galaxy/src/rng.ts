// Seedable RNG (mulberry32) so harness/bot games are deterministic and
// testable (the same mulberry32 helper as @zekel/game-kit's rng). In REAL play the human rolls
// physical dice and draws their own deck — this RNG exists only for the
// solvability bot's faithful simulation (seeded 3d6, real shuffled 52-card
// deck drawn by position; simulation-fidelity rule, no shortcuts).

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

/** One physical d6. */
export function rollD6(seed: number): { value: number; nextSeed: number } {
  const r = randomInt(seed, 6);
  return { value: r.value + 1, nextSeed: r.nextSeed };
}

/** N physical d6, in rolled order (the bot reports these like a human would). */
export function rollDice(seed: number, count: number): { dice: number[]; nextSeed: number } {
  const dice: number[] = [];
  let s = seed;
  for (let i = 0; i < count; i++) {
    const r = rollD6(s);
    dice.push(r.value);
    s = r.nextSeed;
  }
  return { dice, nextSeed: s };
}

/** Fisher–Yates shuffle, pure: returns new array + new seed. */
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

export function randomSeed(): number {
  return Math.floor(Math.random() * 0x100000000) >>> 0;
}
