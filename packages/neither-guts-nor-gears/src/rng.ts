// Seedable RNG (mulberry32) — same shape as the other game modules so the
// harness and tests behave identically across games.

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

/** Fisher–Yates shuffle, pure: new array + advanced seed. */
export function shuffle<T>(items: readonly T[], seed: number): { items: T[]; nextSeed: number } {
  const arr = [...items];
  let s = seed;
  for (let i = arr.length - 1; i > 0; i--) {
    const r = randomInt(s, i + 1);
    s = r.nextSeed;
    const tmp = arr[i]!;
    arr[i] = arr[r.value]!;
    arr[r.value] = tmp;
  }
  return { items: arr, nextSeed: s };
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 0x100000000) >>> 0;
}
