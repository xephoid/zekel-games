import type { Person, LocationData, AffiliationId, BoroughId } from '../types.js';

export const PEOPLE: Person[] = [
  { id: 'eddie_the_doorman', name: 'Eddie the Doorman', affiliation: 'none', home_location: 'Xistential Club', cost: 0, ability: 'witness', is_witness: true },
  { id: 'marisol_the_janitor', name: 'Marisol the Janitor', affiliation: 'none', home_location: 'OmniSuperUltra Corporate Office #beebee', cost: 0, ability: 'witness', is_witness: true },
  { id: 'gus_the_noodle_guy', name: 'Gus the Noodle Guy', affiliation: 'none', home_location: 'Shizuoka Megamall', cost: 0, ability: 'witness', is_witness: true },
  { id: 'dot_the_birdwatcher', name: 'Dot the Birdwatcher', affiliation: 'none', home_location: 'Nature Reserve #42', cost: 0, ability: 'witness', is_witness: true },
  { id: 'felix_the_concierge', name: 'Felix the Concierge', affiliation: 'none', home_location: 'Platinum Extraluxx Apartments Unit 1337x', cost: 0, ability: 'witness', is_witness: true },
  { id: 'ma_kettle', name: 'Ma Kettle', affiliation: 'none', home_location: 'Trailer Towers', cost: 0, ability: 'witness', is_witness: true },
  { id: 'zero_kelvin', name: 'Zero Kelvin', affiliation: 'gang_1', home_location: 'The Back Alley', cost: 1, ability: 'draw_3', is_witness: false },
  { id: 'permafrost', name: 'Permafrost', affiliation: 'gang_1', home_location: 'Dark City Central Station', cost: 1, ability: 'draw_3', is_witness: false },
  { id: 'blackice', name: 'Blackice', affiliation: 'gang_1', home_location: 'Xistential Club', cost: 2, ability: 'hand_discard', is_witness: false },
  { id: 'sleet', name: 'Sleet', affiliation: 'gang_1', home_location: 'Shizuoka Megamall', cost: 2, ability: 'hand_discard', is_witness: false },
  { id: 'frostbyte', name: 'Frostbyte', affiliation: 'gang_1', home_location: 'The Back Alley', cost: 2, ability: 'hand_discard', is_witness: false },
  { id: 'hoarfrost', name: 'Hoarfrost', affiliation: 'gang_1', home_location: 'Dark City Central Station', cost: 2, ability: 'hand_discard', is_witness: false },
  { id: 'mother_carmine', name: 'Mother Carmine', affiliation: 'gang_2', home_location: 'Platinum Extraluxx Apartments Unit 1337x', cost: 2, ability: 'board_discard', is_witness: false },
  { id: 'rust', name: 'Rust', affiliation: 'gang_2', home_location: 'Suburb Tower #2013', cost: 2, ability: 'board_discard', is_witness: false },
  { id: 'little_garnet', name: 'Little Garnet', affiliation: 'gang_2', home_location: 'Nature Reserve #42', cost: 2, ability: 'board_discard', is_witness: false },
  { id: 'manticore', name: 'Manticore', affiliation: 'gang_3', home_location: "Dirty Mel's", cost: 2, ability: 'board_discard', is_witness: false },
  { id: 'basilisk', name: 'Basilisk', affiliation: 'gang_3', home_location: 'Resident Block #8008315', cost: 2, ability: 'board_discard', is_witness: false },
  { id: 'wyrm', name: 'Wyrm', affiliation: 'gang_3', home_location: 'Shipyard', cost: 2, ability: 'board_discard', is_witness: false },
  { id: 'deckard_voss', name: 'Deckard Voss', affiliation: 'corp_1', home_location: 'Dark City Central Station', cost: 2, ability: 'reveal_informant', is_witness: false },
  { id: 'priya_nakamura_smith', name: 'Priya Nakamura-Smith', affiliation: 'corp_1', home_location: 'OmniSuperUltra Corporate Office #beebee', cost: 2, ability: 'reveal_informant', is_witness: false },
  { id: 'bradford_chase_xvi', name: 'Bradford Chase XVI', affiliation: 'corp_1', home_location: 'Platinum Extraluxx Apartments Unit 1337x', cost: 2, ability: 'reveal_informant', is_witness: false },
  { id: 'kenji_watanabe', name: 'Kenji Watanabe', affiliation: 'corp_2', home_location: 'OmniSuperUltra Corporate Office #beebee', cost: 1, ability: 'discard_retrieval', is_witness: false },
  { id: 'yumi_sato', name: 'Yumi Sato', affiliation: 'corp_2', home_location: 'Shizuoka Megamall', cost: 1, ability: 'discard_retrieval', is_witness: false },
  { id: 'hana_mori', name: 'Hana Mori', affiliation: 'corp_2', home_location: 'Suburb Tower #2013', cost: 1, ability: 'discard_retrieval', is_witness: false },
  // v2.0-EXPERIMENT (2026-08-12; third ability design — the played-ability
  // versions both measured negative at their ceiling, see PORT-NOTES §18):
  // the 7th witness. His ability is a TRIGGERED RIDER: when Anansi is played
  // as EVIDENCE, remove ONE informant — facedown by position (returned to the
  // POI deck UNSEEN) or revealed by name. Playing him as a person is a plain
  // witness no-op (the rider only rides the Evidence commit).
  { id: 'anansi_the_spider', name: 'Anansi the Spider', affiliation: 'none', home_location: 'Little Ghana', cost: 2, ability: 'remove_informant', is_witness: true },
];

export const LOCATIONS: LocationData[] = [
  { id: 'omnisuperultra_corporate_office', name: 'OmniSuperUltra Corporate Office #beebee', borough: 'downtown', population: 3, residents: ['marisol_the_janitor', 'kenji_watanabe', 'priya_nakamura_smith'], affiliation: 'corp_1' },
  { id: 'shizuoka_megamall', name: 'Shizuoka Megamall', borough: 'downtown', population: 3, residents: ['sleet', 'gus_the_noodle_guy', 'yumi_sato'], affiliation: 'corp_2' },
  { id: 'dark_city_central_station', name: 'Dark City Central Station', borough: 'downtown', population: 3, residents: ['permafrost', 'hoarfrost', 'deckard_voss'], affiliation: 'none' },
  { id: 'the_back_alley', name: 'The Back Alley', borough: 'downtown', population: 2, residents: ['zero_kelvin', 'frostbyte'], affiliation: 'gang_1' },
  { id: 'xistential_club', name: 'Xistential Club', borough: 'downtown', population: 2, residents: ['eddie_the_doorman', 'blackice'], affiliation: 'gang_2' },
  { id: 'sewers', name: 'Sewers', borough: 'downtown', population: 0, residents: [], affiliation: 'gang_3' },
  { id: 'platinum_extraluxx_apartments', name: 'Platinum Extraluxx Apartments Unit 1337x', borough: 'the_hive', population: 3, residents: ['felix_the_concierge', 'mother_carmine', 'bradford_chase_xvi'], affiliation: 'corp_1' },
  { id: 'suburb_tower_2013', name: 'Suburb Tower #2013', borough: 'the_hive', population: 2, residents: ['hana_mori', 'rust'], affiliation: 'corp_2' },
  { id: 'nature_reserve_42', name: 'Nature Reserve #42', borough: 'the_hive', population: 2, residents: ['dot_the_birdwatcher', 'little_garnet'], affiliation: 'gang_2' },
  { id: 'resident_block_8008315', name: 'Resident Block #8008315', borough: 'the_hive', population: 1, residents: ['basilisk'], affiliation: 'gang_3' },
  { id: 'dirty_mels', name: "Dirty Mel's", borough: 'the_hive', population: 1, residents: ['manticore'], affiliation: 'gang_1' },
  { id: 'garbage_dump', name: 'Garbage Dump', borough: 'the_hive', population: 0, residents: [], affiliation: 'none' },
  { id: 'shipyard', name: 'Shipyard', borough: 'boonies', population: 1, residents: ['wyrm'], affiliation: 'corp_1' },
  { id: 'trailer_towers', name: 'Trailer Towers', borough: 'boonies', population: 1, residents: ['ma_kettle'], affiliation: 'none' },
  { id: 'warehouse', name: 'Warehouse', borough: 'boonies', population: 0, residents: [], affiliation: 'corp_2' },
  { id: 'the_junction', name: 'The Junction', borough: 'boonies', population: 0, residents: [], affiliation: 'gang_1' },
  { id: 'tower_furnace', name: 'Tower Furnace', borough: 'boonies', population: 0, residents: [], affiliation: 'gang_2' },
  { id: 'junktown', name: 'Junktown', borough: 'boonies', population: 0, residents: [], affiliation: 'gang_3' },
  // v2.0-EXPERIMENT: 19th Location. Deliberately an attribute TWIN of Trailer
  // Towers (boonies / pop 1 / none) — clues alone can never separate them, so
  // the hideout is matched by CARD (hideout_location_id), not by attributes.
  { id: 'little_ghana', name: 'Little Ghana', borough: 'boonies', population: 1, residents: ['anansi_the_spider'], affiliation: 'none' },
];

// Real faction names are the printed/display names (rules v1.9 cleanup —
// the "Gang 1"/"Corp 2" placeholders survive only as accepted aliases so
// older clients/session logs still resolve). `category` backs the Motive
// rule's "at most one gang per set" — surfaced via getReferenceData so no
// model has to guess which factions count as gangs.
export const AFFILIATIONS: { id: AffiliationId; name: string; full_name: string; category: 'civilian' | 'corp' | 'gang'; aliases: string[] }[] = [
  { id: 'none', name: 'None', full_name: 'None', category: 'civilian', aliases: [] },
  { id: 'corp_1', name: 'OmniSuperUltra Corp', full_name: 'OmniSuperUltra Corp', category: 'corp', aliases: ['Corp 1', 'Omni'] },
  { id: 'corp_2', name: 'Shizuoka Inc', full_name: 'Shizuoka Inc', category: 'corp', aliases: ['Corp 2', 'Shizuoka'] },
  { id: 'gang_1', name: 'Iceden Collective', full_name: 'Iceden Collective', category: 'gang', aliases: ['Gang 1', 'Iceden'] },
  { id: 'gang_2', name: 'Crimson Clan', full_name: 'Crimson Clan', category: 'gang', aliases: ['Gang 2', 'Crimson'] },
  { id: 'gang_3', name: 'Chimera', full_name: 'Chimera', category: 'gang', aliases: ['Gang 3'] },
];

/** v2.0: does this location share all three attributes with another?
 *  (Little Ghana / Trailer Towers.) Twins are clue-immune — only card
 *  elimination separates them — so pick policies favor them. */
export function isTwinLocation(id: string): boolean {
  const l = LOCATIONS.find(x => x.id === id);
  if (!l) return false;
  return LOCATIONS.some(o => o.id !== l.id && o.borough === l.borough && o.population === l.population && o.affiliation === l.affiliation);
}

/** Printed/display name for an affiliation id. */
export function affiliationName(id: string): string {
  return AFFILIATIONS.find(a => a.id === id)?.name ?? id;
}

export const BOROUGHS: { id: BoroughId; name: string }[] = [
  { id: 'downtown', name: 'Downtown' },
  { id: 'the_hive', name: 'The Hive' },
  { id: 'boonies', name: 'Boonies' },
];

/**
 * The shape of the Hacker's win: the Evidence zone's rows and how many cards
 * each holds (rules v1.9). One statement of it, so the engine stops spelling
 * "13" and "witnesses >= 3 && motive_1 >= 3 && ..." out by hand, and a client
 * can draw the case file's slots from turn one without counting them itself.
 */
export const EVIDENCE_SHAPE = {
  weapon: 1,
  witnesses: 3,
  motive_sets: 3,
  motive_set_size: 3,
} as const;

/** How many Evidence cards win the game. Derived, never typed out. */
export const EVIDENCE_TOTAL =
  EVIDENCE_SHAPE.weapon + EVIDENCE_SHAPE.witnesses + EVIDENCE_SHAPE.motive_sets * EVIDENCE_SHAPE.motive_set_size;

/**
 * One line per ability, so a client can say what playing a card does instead
 * of showing the ability's id. The wording is the rules text's own (see
 * rulesSections 'play-a-person' and 'informants'); this restates it in a
 * structured field, kept short on purpose, and nothing here decides anything.
 */
export const ABILITIES: { id: string; name: string; text: string }[] = [
  { id: 'witness', name: 'Witness', text: 'No ability of its own. Witnesses are played as Evidence, three at once.' },
  { id: 'draw_3', name: 'Draw three', text: 'Draw three Contacts.' },
  { id: 'hand_discard', name: 'Blind discard', text: 'The Detective discards a Location from their hand, pulled blindly from it.' },
  { id: 'board_discard', name: 'Board discard', text: 'Discard one Location the Detective has already played from the board.' },
  { id: 'reveal_informant', name: 'Reveal an informant', text: "Turn one of the Detective's face-down informants face up." },
  { id: 'discard_retrieval', name: 'Retrieve a Contact', text: 'Take one card back from your own discard pile.' },
  { id: 'remove_informant', name: 'Remove an informant', text: 'Played as Evidence: remove one informant of your choice, face-down by position or revealed by name.' },
];

export function getAbility(id: string): { id: string; name: string; text: string } | undefined {
  return ABILITIES.find(a => a.id === id);
}

/** A borough's printed name, for a sentence that names one. */
export function boroughName(id: string): string {
  return BOROUGHS.find(b => b.id === id)?.name ?? id;
}

export const CLUE_TOKENS: { id: string; type: string; value: string | number }[] = [
  { id: 'borough_downtown', type: 'borough', value: 'downtown' },
  { id: 'borough_the_hive', type: 'borough', value: 'the_hive' },
  { id: 'borough_boonies', type: 'borough', value: 'boonies' },
  { id: 'population_0', type: 'population', value: 0 },
  { id: 'population_1', type: 'population', value: 1 },
  { id: 'population_2', type: 'population', value: 2 },
  { id: 'population_3', type: 'population', value: 3 },
  { id: 'affiliation_none', type: 'affiliation', value: 'none' },
  { id: 'affiliation_corp_1', type: 'affiliation', value: 'corp_1' },
  { id: 'affiliation_corp_2', type: 'affiliation', value: 'corp_2' },
  { id: 'affiliation_gang_1', type: 'affiliation', value: 'gang_1' },
  { id: 'affiliation_gang_2', type: 'affiliation', value: 'gang_2' },
  { id: 'affiliation_gang_3', type: 'affiliation', value: 'gang_3' },
];

export const WEAPON_ID = '__weapon__';

export function getPerson(id: string): Person | undefined {
  return PEOPLE.find(p => p.id === id);
}

export function getPersonByName(name: string): Person | undefined {
  return PEOPLE.find(p => p.name.toLowerCase() === name.toLowerCase());
}

export function resolvePerson(name: string): string {
  const byId = getPerson(name);
  if (byId) return byId.id;
  const p = getPersonByName(name);
  if (!p) throw new Error(`Unknown person: ${name}`);
  return p.id;
}

export function getLocation(id: string): LocationData | undefined {
  return LOCATIONS.find(l => l.id === id);
}

export function getLocationByName(name: string): LocationData | undefined {
  return LOCATIONS.find(l => l.name.toLowerCase() === name.toLowerCase());
}

/** The 18 (borough, population, affiliation) triples are unique (rulebook §8.2
 *  balance check), so hideout attributes identify exactly one Location card. */
export function findLocationByAttributes(h: { borough: BoroughId; population: number; affiliation: AffiliationId } | null): LocationData | undefined {
  if (!h) return undefined;
  return LOCATIONS.find(l => l.borough === h.borough && l.population === h.population && l.affiliation === h.affiliation);
}

export function resolveLocation(name: string): string {
  const byId = getLocation(name);
  if (byId) return byId.id;
  const l = getLocationByName(name);
  if (!l) throw new Error(`Unknown location: ${name}`);
  return l.id;
}

export function resolveAffiliation(name: string): AffiliationId {
  const q = name.toLowerCase();
  const a = AFFILIATIONS.find(a =>
    a.name.toLowerCase() === q || a.full_name.toLowerCase() === q || a.id === name ||
    a.aliases.some(al => al.toLowerCase() === q));
  if (!a) throw new Error(`Unknown affiliation: ${name}`);
  return a.id;
}

export function resolveBorough(name: string): BoroughId {
  const b = BOROUGHS.find(b => b.name.toLowerCase() === name.toLowerCase() || b.id === name);
  if (!b) throw new Error(`Unknown borough: ${name}`);
  return b.id as BoroughId;
}

export function resolveClueToken(tokenId: string): string {
  const t = CLUE_TOKENS.find(t => t.id === tokenId || String(t.value).toLowerCase() === tokenId.toLowerCase());
  if (!t) throw new Error(`Unknown clue token: ${tokenId}`);
  return t.id;
}

export function getPeopleForLocation(locationId: string): Person[] {
  const loc = getLocation(locationId);
  if (!loc) return [];
  return loc.residents.map(id => getPerson(id)).filter(Boolean) as Person[];
}

export function getWeaponCard(): { id: string; name: string } {
  return { id: WEAPON_ID, name: 'The Weapon' };
}