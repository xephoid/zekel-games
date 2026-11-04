import type { CardRank } from '../types.js';

// What the table prints on a card beyond its numbers: a name and one short
// line. Flavour, not rules: nothing here changes a roll, a price or a move.
// Published through getReferenceData so the web table and the voice table
// say the same thing (zekel-universe, docs/games/warble-way-galaxy-theme-build.md,
// appendix A). Keyed by the card id the deck uses ("AH", "10D").

export interface CardFlavour {
  /** The name on the card: a recruit's name, a job's title, a ruin's name, a hazard's name. */
  title: string;
  /** One line under the name: who a recruit is, a job's blurb, a ruin's hook. */
  line?: string;
}

// ♥ Recruits: name, and who they are.
export const HEART_FLAVOUR: Record<CardRank, CardFlavour> = {
  A: { title: 'C0FFEE', line: 'Hexapod pod pilot' },
  '2': { title: 'Flint', line: "Grull of Shale's brood" },
  '3': { title: 'Mica', line: "Grull of Pyrite's brood" },
  '4': { title: 'Kakaaw', line: 'Kralkin duelist' },
  '5': { title: 'Pii', line: 'Kralkin court envoy' },
  '6': { title: 'Gronk', line: 'Kralkin fleet gunner' },
  '7': { title: 'Aaliyah', line: 'Human, ex-TanakaRodriguez' },
  '8': { title: 'FACADE', line: 'Hexapod pod, hard to spot' },
  '9': { title: 'Muhammad', line: 'Human, ex-UHM trooper' },
  '10': { title: 'DEC0DE', line: 'Hexapod pod translator' },
  J: { title: 'Tweet', line: 'Kralkin station mechanic' },
  Q: { title: 'Obsidian', line: "Grull of Pumice's brood" },
  K: { title: 'Katie', line: 'Megaship stage star' },
};

// ♦ 2–9 pirates (one has a reputation), ♦ 10–A ruins: a name and a hook.
export const DIAMOND_FLAVOUR: Record<CardRank, CardFlavour> = {
  '2': { title: 'Pirates', line: 'The monster of the lanes' },
  '3': { title: 'Pirates' },
  '4': { title: 'Pirates' },
  '5': { title: 'Pirates' },
  '6': { title: 'Pirates' },
  '7': { title: 'Pirates' },
  '8': { title: 'Pirates' },
  '9': { title: 'Pirates' },
  '10': { title: 'The Picked Shell', line: 'Diggers stripped it bare years ago. Mostly.' },
  J: { title: 'Hollow Aerie', line: 'Kralkin perches, built for wings older than Arraak.' },
  Q: { title: 'Providence Zero', line: 'A Megaship hull, millions of years old. Humans left Earth 120 years ago.' },
  K: { title: 'The Hive Engine', line: 'Grull-carved halls full of machines no Grull could build.' },
  A: { title: 'The Quiet Spire', line: 'Its guns still work. Its makers do not.' },
};

// ♠ Hazards: a name each.
export const SPADE_FLAVOUR: Record<CardRank, CardFlavour> = {
  A: { title: 'Meteor shower' },
  '2': { title: 'Asteroid field' },
  '3': { title: 'Gravity snare' },
  '4': { title: 'Hull mites' },
  '5': { title: 'Mine field' },
  '6': { title: 'Wormhole' },
  '7': { title: 'Plasma bubbles' },
  '8': { title: 'Dark eclipse' },
  '9': { title: 'Planet breakup' },
  '10': { title: 'Ion bolt' },
  J: { title: 'Rogue moon' },
  Q: { title: 'Solar flare' },
  K: { title: 'Spore pods' },
};

// ♣ Jobs: a title and a blurb. J–A are ruin expeditions.
export const CLUB_FLAVOUR: Record<CardRank, CardFlavour> = {
  '2': { title: 'Channel clash', line: 'Two Kralkin relays claim one channel. Broker a deal, or slip into their code.' },
  '3': { title: 'Gone quiet', line: 'A Grull survey crew went silent. Rally a search, or cut through what found them.' },
  '4': { title: 'Inspection day', line: 'The tractor beam is broken and the inspector is early. Stall, or fix it fast.' },
  '5': { title: 'Night shift', line: "An FFFFFF observatory's crew walked out. Run the night shift, or finish the study." },
  '6': { title: 'Trigger-happy', line: 'An old UHM defense sat shoots at anything. Hack its targeting, or shoot back.' },
  '7': { title: 'Runaway rover', line: "800800's prototype rover fell off a moon cliff. Find where, or fly in after it." },
  '8': { title: 'Ring run', line: "Aarak wants spores from a gas giant's rings. Thread the ice, or grow them in a lab." },
  '9': { title: 'Hot cargo', line: 'Ruin tech in a crate, humming louder by the hour. Shield it, or bluff past customs.' },
  '10': { title: 'Gala escort', line: 'Bring a Grull envoy to a Kralkin gala. Keep the peace, or keep the guards in line.' },
  J: { title: "Digger's tip", line: 'A drunk digger sold you coordinates to a shallow ruin. Probably real.' },
  Q: { title: 'Salvage rights', line: 'WinchesterZhang wants ancient guns out before its rivals get there.' },
  K: { title: 'The deep dig', line: 'Three maps down, something still keeps the lights on. No one has said what.' },
  A: { title: 'Kralkin-built?', line: 'Kralkin-built ruins, older than Kralkin flight. The court wants answers.' },
};

/** Every card of the 52 by its id (rank then suit letter: "AH", "10D", "KC"). */
export const CARD_FLAVOUR: Record<string, CardFlavour> = Object.fromEntries([
  ...Object.entries(HEART_FLAVOUR).map(([r, f]) => [`${r}H`, f]),
  ...Object.entries(DIAMOND_FLAVOUR).map(([r, f]) => [`${r}D`, f]),
  ...Object.entries(SPADE_FLAVOUR).map(([r, f]) => [`${r}S`, f]),
  ...Object.entries(CLUB_FLAVOUR).map(([r, f]) => [`${r}C`, f]),
]);

// The habitat pages (WR §16): what each mission, shop item and cantina
// being is called. The item's printed label ("Weapon +1 GUN") stays its
// `name`, since moves name items by it; this is the name on the shelf.
export const MISSION_TITLES: Record<string, string> = {
  'h1-m1': 'Hydroponics Mold', 'h1-m2': 'Scrapyard Squabble', 'h1-m3': 'The Leaky Recycler', 'h1-m4': 'Dustbowl Ruin',
  'h1-m5': 'Cantina Bouncer', 'h1-m6': 'Scrap Convoy Escort', 'h1-m7': 'The Fake Inspector',
  'h2-m1': 'The Belt Run', 'h2-m2': "Bounty on Krazz's Crew", 'h2-m3': 'Into the Royal Aviary', 'h2-m4': 'Crack the Court Ledger',
  'h2-m5': 'Lead the Wing Drill', 'h2-m6': 'The Feathered Vault',
  'h3-m1': 'Spore Census', 'h3-m2': 'Six Minds, One Deal', 'h3-m3': 'Walker Overhaul', 'h3-m4': 'The FFFFFF Leak',
  'h3-m5': 'Hold the Airlock', 'h3-m6': 'The Gold Run',
};

export const ITEM_TITLES: Record<string, string> = {
  'h1-s1': 'Sustenance Cube', 'h1-s2': 'WinchesterZhang Plinker', 'h1-s3': 'Salvaged Riot Plate', 'h1-s4': 'Patched Thruster', 'h1-s5': 'Bolt-on Bunk Pod',
  'h2-s1': 'Roost Module', 'h2-s2': 'Talon-grip Stabilizers', 'h2-s3': 'Imperial Targeting Array', 'h2-s4': 'Updraft Engine', 'h2-s5': 'Raptor Rifle', 'h2-s6': 'Quiet-Feather Cloak',
  'h3-s1': 'Aarak Adrenal Spray', 'h3-s2': 'Aarak Focus Tabs', 'h3-s3': 'Ruin-forged Plate', 'h3-s4': 'Ruin Lance', 'h3-s5': 'Hex-weave Hull Plating', 'h3-s6': 'Pod Habitat Ring',
};

export const BEING_NAMES: Record<string, string> = {
  'h1-c1': 'Wang', 'h1-c2': 'Chirp', 'h1-c3': '7EE700', 'h1-c4': 'Slate', 'h1-c5': 'Michael',
  'h2-c1': 'Arrak', 'h2-c2': 'Basalt', 'h2-c3': 'Zhang', 'h2-c4': 'Trill', 'h2-c5': 'Kraa',
  'h3-c1': 'Galena', 'h3-c2': 'Coo', 'h3-c3': 'ACCE55', 'h3-c4': 'Diego', 'h3-c5': '5EA1ED', 'h3-c6': 'Priya',
};
