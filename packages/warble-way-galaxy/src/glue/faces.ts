// Warble Way Galaxy's portraits (docs/games/warble-way-galaxy-theme-build.md,
// item 3): the 17 clean-line tokens from the design canvas, served from
// /art/warble-way/portraits/ at 256 × 256, generated with Apache 2.0 models
// and recorded in ATTRIBUTIONS.md. The files are plain black line art on
// off-white; the hologram look (gold or red, scanlines, the glitch) is the
// theme's, applied when drawn (ww.css, holo.tsx).
//
// The engine names a race by its id (human, kralkin, hexapod, grull), which
// is the file's name. The red shirt and the twelve ruin attackers are named
// by the design: the engine gives an attacker only its numbers, so which
// token a ruin attacker shows is decided where the ruin is drawn (item 5).
// A name with no portrait here gets none, rather than a guess.

export const RACES = ['human', 'kralkin', 'hexapod', 'grull'] as const;
export const REDSHIRT = 'redshirt';
/** The twelve attackers, three per terrain as the design draws them. */
export const ATTACKERS = {
  rocky: ['gravel-crab', 'rock-mite', 'burrow-beetle'],
  alien: ['leviathan', 'hive-brute', 'spore-titan'],
  metal: ['sentry-drone', 'loader-mech', 'spider-bot'],
  starry: ['pirate-captain', 'pirate-boarder', 'pirate-gunner'],
} as const;

export type PortraitId = (typeof RACES)[number] | typeof REDSHIRT | (typeof ATTACKERS)[keyof typeof ATTACKERS][number];

export const PORTRAITS: readonly PortraitId[] = [...RACES, REDSHIRT, ...Object.values(ATTACKERS).flat()];
const KNOWN = new Set<string>(PORTRAITS);

/** The served file for a race, the red shirt or an attacker, by the engine's id or the printed name ("Hive Brute"). */
export function faceUrl(name: string): string | undefined {
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return KNOWN.has(id) ? `/art/warble-way/portraits/${id}.jpg` : undefined;
}
