// Cybernoir 2127 glue: a map of the city's locations in three boroughs, two
// very different tableaux (Detective case board, Hacker contacts), the
// evidence row, the jail track and the clue tokens. View shape per the
// engine (zekel src/games/cybernoir-2127/views.ts). The locations and their
// boroughs come from the engine's reference data; the map lays each borough
// out as a band and spreads its locations across it.

import type { CardData, MapNode, TableauData } from '@zekel/primitives';
import type { GameReferenceResponse } from '@zekel/wire-types';
import type { FormField, GlueModule, GlueInput, LegalMove, MoveForm, PlanPrompt, PromptAction, SelectEvent, SetupField, TablePlan, Zone, SetupAnswers, SetupSeat } from '@zekel/glue-kit';
import { asArr, asNum, asStr, isObj, shapeHas, words } from '@zekel/glue-kit';
import { BOROUGH_COLUMNS, LINE_CODES, LINES, STATIONS, columnOf, pct } from './metro.js';
import { faceUrl, markUrl } from './faces.js';
import './cn.css';

/**
 * The game's own colours, from the rain and neon theme
 * (docs/design/cybernoir-rain-neon/, docs/games/cybernoir-2127-theme-build.md).
 * Affiliation is the code that matters: it is the field a Motive set is built
 * from and what a big hand folds on, so every person and every location wears
 * their faction's colour rather than the seat that happens to hold them. The
 * faction colours are also the subway lines on the map.
 */
const PALETTE: Record<string, string> = {
  // The six factions, keyed by the engine's own ids; line codes in brackets.
  none: '#A7ADB8', // No affiliation (CIV)
  corp_1: '#4D7CFF', // OmniSuperUltra Corp (OSU)
  corp_2: '#1ED19A', // Shizuoka Inc (SHZ)
  gang_1: '#5FE3FF', // Iceden Collective (ICE)
  gang_2: '#FF3B5C', // Crimson Clan (CRM)
  gang_3: '#B26BFF', // Chimera (CHM)
  // The two seats: stamp red and glacier ice.
  detective: '#E23B45',
  hacker: '#5FE3FF',
  // States and the case file's three kinds of Evidence.
  played: '#E23B45',
  safehouse: '#5FE3FF',
  out_of_reach: '#8a8578',
  evidence: '#3E7C4F',
  witness: '#A7ADB8',
  motive: '#E23B45',
  weapon: '#c9a227',
  not: '#E8ECF2',
};

interface Loc { name: string; borough: string; population?: number; affiliation?: string }

function locations(reference: GameReferenceResponse | null, view: Record<string, unknown>): Loc[] {
  const rd = reference?.referenceData;
  const out: Loc[] = [];
  if (isObj(rd) && Array.isArray(rd['locations'])) {
    for (const l of rd['locations']) {
      if (isObj(l) && typeof l['name'] === 'string') {
        out.push({
          name: l['name'],
          borough: asStr(l['borough'], 'city'),
          population: typeof l['population'] === 'number' ? l['population'] : undefined,
          affiliation: asStr(l['affiliation']) || undefined,
        });
      } else if (typeof l === 'string') {
        out.push({ name: l, borough: 'city' });
      }
    }
  }
  if (out.length > 0) return out;
  // Without reference data, at least show what the view names.
  const names = new Set<string>();
  for (const b of asArr(view['board'])) names.add(asStr(b));
  const det = isObj(view['detective']) ? view['detective'] : {};
  for (const d of asArr(det['location_discard'])) names.add(asStr(d));
  for (const h of asArr(view['location_hand'])) names.add(asStr(h));
  return [...names].filter(Boolean).map((name) => ({ name, borough: 'city' }));
}

/** One of the game's people, as the engine's reference data prints them. */
interface Person { name: string; affiliation?: string; home?: string; cost?: number; ability?: string; isWitness: boolean }

/** What each ability does, in the engine's own words. Before the engine
 *  published these, a card said "Hand Discard", which is an id in title case
 *  and does not tell you enough to choose. */
function abilityLines(reference: GameReferenceResponse | null): Map<string, { name: string; text: string }> {
  const rd = reference?.referenceData;
  const out = new Map<string, { name: string; text: string }>();
  if (!isObj(rd) || !Array.isArray(rd['abilities'])) return out;
  for (const a of rd['abilities']) {
    if (isObj(a) && typeof a['id'] === 'string') {
      out.set(a['id'], { name: asStr(a['name'], a['id']), text: asStr(a['text']) });
    }
  }
  return out;
}

function peopleByName(reference: GameReferenceResponse | null): Map<string, Person> {
  const rd = reference?.referenceData;
  const out = new Map<string, Person>();
  if (!isObj(rd) || !Array.isArray(rd['people'])) return out;
  for (const p of rd['people']) {
    if (!isObj(p) || typeof p['name'] !== 'string') continue;
    out.set(p['name'], {
      name: p['name'],
      affiliation: asStr(p['affiliation']) || undefined,
      home: asStr(p['home_location']) || undefined,
      cost: typeof p['cost'] === 'number' ? p['cost'] : undefined,
      ability: asStr(p['ability']) || undefined,
      isWitness: p['is_witness'] === true,
    });
  }
  return out;
}

/**
 * A Contact as a card that carries its own decision: what it costs against
 * three action points, the field a Motive set is built from, and what playing
 * it does. The ability is the engine's own id put into words — the engine
 * publishes no sentence for it, and Universe does not write one.
 */
function contactCard(
  id: string, label: string, people: Map<string, Person>, n: Names,
  abilities?: Map<string, { name: string; text: string }>,
): CardData {
  const p = people.get(label);
  // The portrait, when there is one for this name; the theme draws it as a
  // street-camera grab.
  const art = faceUrl(label);
  if (!p) return { id, label, colorKey: 'none', ...(art ? { artUrl: art } : {}) };
  const ability = p.ability ? abilities?.get(p.ability) : undefined;
  const badges = [
    ...(p.affiliation && p.affiliation !== 'none' ? [n.affiliation(p.affiliation)] : []),
    ...(p.isWitness ? ['Witness'] : []),
  ];
  // A person's card: the portrait across the top, the cost as pips (FREE for
  // nothing), the faction's mark in the corner, a Witness's eye.
  const mark = markUrl(p.isWitness ? 'witness' : p.affiliation ?? '');
  return {
    id, label, colorKey: p.affiliation || 'none',
    layout: 'portrait', costStyle: 'pips',
    ...(art ? { artUrl: art } : {}),
    ...(mark ? { emblemUrl: mark } : {}),
    // A big hand folds by faction: the field a Motive set is built from.
    ...(p.affiliation ? { groupKey: p.affiliation } : {}),
    ...(p.cost === undefined ? {} : { cost: p.cost }),
    // What playing it does, in the engine's words; its id in words only when
    // the engine has not published a line for it.
    ...(p.ability && p.ability !== 'witness'
      ? { subtitle: ability?.text || words(p.ability) }
      : {}),
    ...(badges.length > 0 ? { badges } : {}),
  };
}

/** A Location as a card: its three printed facts, and who lives there —
 *  residents are what playing it puts in the Detective's reach. */
/**
 * A Location as a station sign: its line's bullet, its name and borough on a
 * light plate, then its population bar and faction, then the faces of the
 * people who live there ("nobody home" when no one does).
 */
function locationCard(id: string, label: string, locs: Loc[], reference: GameReferenceResponse | null, n: Names): CardData {
  const l = locs.find((x) => x.name === label);
  if (!l) return { id, label, colorKey: 'none' };
  const who = residentsOf(reference, l.name);
  const affiliation = l.affiliation || 'none';
  return {
    id, label, colorKey: affiliation,
    layout: 'sign',
    ...(LINE_CODES[affiliation] ? { code: LINE_CODES[affiliation] } : {}),
    // A big hand of Locations folds by borough.
    groupKey: l.borough,
    subtitle: n.borough(l.borough),
    ...(typeof l.population === 'number' ? { meter: { value: Math.max(0, Math.min(3, l.population)), max: 3 } } : {}),
    badges: [affiliation === 'none' ? 'No faction' : n.affiliation(affiliation)],
    ...(who.length === 0 ? { note: 'nobody home' } : {}),
    ...(who.length > 0 ? { faces: who.map((w) => ({ label: w, ...(faceUrl(w, 'square') ? { artUrl: faceUrl(w, 'square') } : {}) })) } : {}),
  };
}

/**
 * Every id a card of this name could have had in a hand. A hand card's id
 * carries its place (the engine's moves name a hand card by index), so when
 * a card leaves, the ones after it get new ids; naming every place lets the
 * motion system find where each card, or the mark it leaves, was a moment
 * ago, and fly it from there instead of dropping it in place.
 */
const HAND_SPAN = 24;
function handOrigins(name: string, also: string[] = []): string {
  return [...Array.from({ length: HAND_SPAN }, (_, j) => `cn:hand:${j}:${name}`), ...also].join('|');
}

/** The locations a move names, however it names them. */
function namedLocations(m: LegalMove): string[] {
  const out: string[] = [];
  for (const key of ['location_name', 'target_location', 'new_location_name']) {
    const v = asStr(m.move[key]);
    if (v) out.push(v);
  }
  for (const v of asArr(m.move['discard_locations'])) {
    const name = asStr(v);
    if (name) out.push(name);
  }
  return out;
}

/** The people a move names, however it names them. */
function namedPeople(m: LegalMove): string[] {
  const out: string[] = [];
  for (const key of ['person_name', 'target_person']) {
    const v = asStr(m.move[key]);
    if (v) out.push(v);
  }
  for (const v of asArr(m.move['people'])) {
    const name = asStr(v);
    if (name) out.push(name);
  }
  return out;
}

export function personId(name: string): string {
  return `cn:person:${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
}

/**
 * Who the Detective can reach: everyone living at a Location they have
 * played. Twelve of their legal moves target a person, and people were drawn
 * nowhere, so those moves had nothing to touch.
 *
 * A person already spoken for is drawn unlit, with where they are — a public
 * fact, or one this seat is entitled to. Why that puts them out of reach is a
 * rule, and the engine says it by not listing the move.
 */
function whoYouCanReach(
  view: Record<string, unknown>,
  reference: GameReferenceResponse | null,
  people: Map<string, Person>,
  n: Names,
  abilities: Map<string, { name: string; text: string }>,
): Zone {
  const played = asArr(view['board']).map((b) => asStr(b));
  const here: string[] = [];
  for (const loc of played) for (const who of residentsOf(reference, loc)) if (!here.includes(who)) here.push(who);

  const where = new Map<string, string>();
  const jail = isObj(view['jail']) ? view['jail'] : {};
  for (const [key, label] of [['slot_1_booked', 'booked'], ['slot_2_processing', 'processing'], ['slot_3_release_pending_then_freed', 'release pending']] as const) {
    for (const who of asArr(jail[key])) where.set(asStr(who), `in jail · ${label}`);
  }
  const evidence = isObj(view['evidence']) ? view['evidence'] : {};
  for (const key of Object.keys(evidence)) {
    if (key === 'weapon') continue;
    for (const who of asArr(evidence[key])) where.set(asStr(who), 'played as Evidence');
  }
  for (const inf of asArr(view['informants'])) {
    const o = isObj(inf) ? inf : {};
    where.set(asStr(o['person']), o['revealed'] ? 'your informant, revealed' : 'your informant');
  }

  return {
    kind: 'card-zone', id: 'cn:reach',
    data: {
      label: here.length > 0 ? `Who you can reach (${here.length})` : 'Who you can reach',
      // One row per person: their face, name, and what they do (or where they
      // are, when spoken for), as in the table board's list.
      mode: 'list',
      cards: here.map((who) => {
        // Not the Contact's play cost: that is what the HACKER pays for them.
        // What reaching them costs the Detective is in the engine's own words,
        // on the moves the tap offers.
        const { cost: _hackersPrice, ...card } = contactCard(personId(who), who, people, n, abilities);
        const at = where.get(who);
        return { ...card, ...(at ? { colorKey: 'out_of_reach', subtitle: at } : {}) };
      }),
    },
  };
}

/**
 * Which Locations the engine says cannot be the hideout, and why. The seat's
 * own list when it has one: the Detective's includes the cards only they have
 * held, and the Hacker's view does not carry that list at all.
 *
 * Universe crosses nothing off itself. Whether a played card is out depends on
 * whether the safehouse card left the deck, which is a rule, and the engine
 * answers it.
 */
function ruledOutReasons(view: Record<string, unknown>): Map<string, string> {
  const out = new Map<string, string>();
  const lists = [view['locations_ruled_out'], view['your_locations_ruled_out']];
  for (const list of lists) {
    for (const r of asArr(list)) {
      if (!isObj(r)) continue;
      const where = asStr(r['location_name']);
      const why = asStr(r['reason']);
      if (where && why && !out.has(where)) out.set(where, why);
    }
  }
  return out;
}

/** The people the engine's reference data puts at a location, by printed name. */
function residentsOf(reference: GameReferenceResponse | null, locName: string): string[] {
  const rd = reference?.referenceData;
  if (!isObj(rd) || !Array.isArray(rd['people'])) return [];
  return rd['people'].filter(isObj)
    .filter((p) => asStr(p['home_location']) === locName)
    .map((p) => asStr(p['name']))
    .filter(Boolean);
}

/**
 * The printed names behind the engine's ids. `gang_1` is Iceden Collective,
 * not "Gang 1" — that is one of its aliases, and title-casing the id only
 * looked right by accident. Every name on the table comes from the game's own
 * reference data; an id the data does not carry is shown in words rather than
 * raw, and never guessed at.
 */
interface Names { affiliation(id: string): string; borough(id: string): string }

function names(reference: GameReferenceResponse | null): Names {
  const rd = reference?.referenceData;
  const table = (key: string): Map<string, string> => {
    const out = new Map<string, string>();
    const rows = isObj(rd) && Array.isArray(rd[key]) ? rd[key] : [];
    for (const r of rows) {
      if (isObj(r) && typeof r['id'] === 'string' && typeof r['name'] === 'string') out.set(r['id'], r['name']);
    }
    return out;
  };
  const affiliations = table('affiliations');
  const boroughs = table('boroughs');
  return {
    affiliation: (id) => affiliations.get(id) ?? words(id),
    borough: (id) => boroughs.get(id) ?? words(id),
  };
}

/** How many people live at a location, in words. */
function residentCount(population: number | undefined): string {
  return typeof population === 'number' ? `${population} resident${population === 1 ? '' : 's'}` : '';
}

/**
 * The turn's verbs, in the order the printed turn sheet has them. A verb is
 * drawn only when the engine lists a move behind it, and a verb that several
 * moves stand behind asks which, in the engine's own words.
 *
 * The label is the verb; the engine's own sentence is the button's title and
 * the chooser's row, so the two-hundred-character paragraph about burning the
 * safehouse never becomes a button label. Where the engine states a cost it
 * states it in that sentence — "Play Blackice (2 AP)" — and a verb with one
 * move behind it carries that sentence as its note. A cost per verb would
 * need the engine to publish one; it does not, and Universe will not invent
 * one.
 */
const VERBS: Array<{ id: string; label: string; types: string[]; primary?: boolean }> = [
  // The Detective's turn.
  { id: 'play-location', label: 'Play a Location', types: ['play_location'], primary: true },
  { id: 'upkeep', label: 'Pay upkeep', types: ['upkeep_choice'], primary: true },
  { id: 'arrest', label: 'Arrest', types: ['arrest'] },
  { id: 'recruit', label: 'Recruit an informant', types: ['recruit_informant'] },
  { id: 'buy-clue', label: 'Buy a clue', types: ['buy_clue'] },
  { id: 'draw-location', label: 'Draw a Location', types: ['draw_extra_location'] },
  { id: 'guess', label: 'Guess the hideout', types: ['guess_location', 'final_guess'] },
  // The Hacker's turn.
  { id: 'evidence', label: 'Play Evidence', types: ['play_evidence'], primary: true },
  { id: 'person', label: 'Play a person', types: ['play_person'] },
  { id: 'win-back', label: 'Win back a Contact', types: ['win_back'] },
  { id: 'draw-contact', label: 'Draw a Contact', types: ['draw_contact'] },
  { id: 'jailbreak', label: 'Jailbreak', types: ['jailbreak'] },
  { id: 'reveal', label: 'Reveal an informant', types: ['reveal_informant'] },
  { id: 'overclock', label: 'Overclock', types: ['overclock'] },
  { id: 'burn', label: 'Burn the safehouse', types: ['burn_safehouse'] },
  // Both.
  { id: 'end-turn', label: 'End turn', types: ['pass_turn'] },
];

/**
 * A moment that stops the turn and asks one question: the Detective deciding
 * whether to block, and the Hacker choosing which clue that block buys. Both
 * doors are drawn with what each costs, in the engine's own words, with
 * nothing preselected and no clock. Declining is a button like any other and
 * says nothing afterwards.
 */
function interruptPrompt(pending: string, legalMoves: LegalMove[]): PlanPrompt | null {
  const decide = legalMoves.filter((m) => m.move['type'] === 'block_decide');
  if (decide.length > 0) {
    return {
      title: 'Block this play?',
      sub: 'Revealing an informant stops the card and buys you a clue; the informant stays face up from then on. Letting it through costs you nothing and tells them nothing.',
      urgent: true,
      actions: decide.map((m) => ({
        id: `cn:block:${m.move['block'] === true ? 'yes' : 'no'}`,
        label: m.move['block'] === true ? 'Block it' : 'Let it through',
        title: m.description,
        ...(m.move['block'] === true ? { primary: true } : {}),
        move: m,
      })),
    };
  }
  const clue = legalMoves.filter((m) => m.move['type'] === 'clue_reveal');
  if (clue.length > 0) {
    return {
      title: 'Which clue do you give?',
      sub: 'The block bought them one true fact about where you are hiding. You choose which, and it stays on the table for the rest of the game.',
      urgent: true,
      actions: clue.map((m) => ({
        id: `cn:clue:${asStr(m.move['category'])}`,
        label: words(asStr(m.move['category'])),
        title: m.description,
        move: m,
      })),
    };
  }
  // A pending step this glue has no words for keeps the numbered list.
  void pending;
  return null;
}

/**
 * The verbs the engine is offering this seat right now.
 *
 * A move type no verb above claims still gets a button, labelled with the
 * engine's own word for it. The turn's follow-up questions — which Location
 * to discard, which informant to flip, what to take back — are move types of
 * their own, and without this the bar was empty at exactly the moment the
 * engine was waiting on an answer.
 */
function verbActions(legalMoves: LegalMove[]): PromptAction[] {
  const out: PromptAction[] = [];
  const claimed = new Set<string>();
  for (const v of VERBS) {
    const moves = legalMoves.filter((m) => v.types.includes(asStr(m.move['type'])));
    if (moves.length === 0) continue;
    for (const t of v.types) claimed.add(t);
    const only = moves.length === 1 ? moves[0]! : null;
    // The price beside the button, in the engine's words. When several moves
    // sit behind a verb and share a price, it is still the verb's price.
    const prices = [...new Set(moves.map((m) => asStr(m.cost)).filter(Boolean))];
    const price = prices.length === 1 ? prices[0]! : undefined;
    out.push({
      id: `cn:verb:${v.id}`,
      label: v.label,
      note: price ?? (only ? undefined : `${moves.length} to choose from`),
      title: only ? only.description : undefined,
      ...(v.primary ? { primary: true } : {}),
      moves,
    });
  }
  const leftover = [...new Set(legalMoves.map((m) => asStr(m.move['type'])).filter((t) => t && !claimed.has(t)))];
  for (const t of leftover) {
    const moves = legalMoves.filter((m) => asStr(m.move['type']) === t);
    const only = moves.length === 1 ? moves[0]! : null;
    out.push({
      id: `cn:verb:${t}`,
      label: words(t.replace(/_choice$/, '')),
      note: only ? undefined : `${moves.length} to choose from`,
      title: only ? only.description : undefined,
      primary: true,
      moves,
    });
  }
  return out;
}

/** The three facts a clue can name, in the order the printed case board has. */
const CLUE_CATEGORIES: Array<{ key: string; label: string }> = [
  { key: 'borough', label: 'Borough' },
  { key: 'population', label: 'Population' },
  { key: 'affiliation', label: 'Affiliation' },
];

/**
 * A clue token's value in the game's own words. The engine publishes a
 * truthful value as the bare fact and a ruled-out one as a token id like
 * `affiliation_gang_1`, so the id is split on its category and the rest read
 * through the same printed names the map uses.
 */
function clueValue(category: string, value: unknown, n: Names): string {
  if (category === 'borough') return n.borough(asStr(value));
  if (category === 'affiliation') return n.affiliation(asStr(value));
  // Population is the bare number: the slot it sits in already says what it
  // counts, and a NOT token reads "Population 0".
  return typeof value === 'number' ? String(value) : asStr(value);
}

/** A negative token id (`population_0`) as its category, printed value, and
 *  the engine's own id for that value (`gang_1`), which keys its colour. */
function negativeClue(tokenId: string, n: Names): { key: string; category: string; value: string; raw: string } | null {
  const cat = CLUE_CATEGORIES.find((c) => tokenId.startsWith(`${c.key}_`));
  if (!cat) return null;
  const raw = tokenId.slice(cat.key.length + 1);
  return { key: cat.key, category: cat.label, value: clueValue(cat.key, raw, n), raw };
}

/**
 * The case file: the thirteen cards that win the game, in the shape the
 * printed sheet has them — the Weapon, a row of Witnesses, and a row per
 * Motive set. Empty slots are drawn as outlines so the shape of the win is
 * visible from turn one.
 *
 * The row sizes come from the engine's `reference_data.evidence`, never from
 * a count here: how many cards win is a rule. An engine that does not publish
 * the shape gets the played cards and no outlines.
 */
function evidenceCase(
  view: Record<string, unknown>,
  reference: GameReferenceResponse | null,
  role: string,
  people: Map<string, Person>,
  n: Names,
): Zone {
  const evidence = isObj(view['evidence']) ? view['evidence'] : {};
  /**
   * Evidence is face up for good, and what is printed on it is the
   * Detective's to read: where each person lives is what narrows the
   * nineteen locations down, and their faction is what a Motive set is made
   * of. The ability is not shown — a card played as Evidence never used one.
   */
  const card = (id: string, label: string, fallbackColor: string): CardData => {
    const p = people.get(label);
    if (!p) return { id, label, colorKey: fallbackColor };
    const badges = [
      ...(p.affiliation && p.affiliation !== 'none' ? [n.affiliation(p.affiliation)] : []),
      ...(p.isWitness ? ['Witness'] : []),
    ];
    const art = faceUrl(label);
    return {
      id, label,
      colorKey: p.affiliation || 'none',
      layout: 'portrait',
      ...(art ? { artUrl: art } : {}),
      arriveFrom: handOrigins(label),
      ...(p.home ? { subtitle: `at ${p.home}` } : {}),
      ...(p.cost === undefined ? {} : { cost: p.cost }),
      ...(badges.length > 0 ? { badges } : {}),
    };
  };
  const rd = reference?.referenceData;
  const shape = isObj(rd) && isObj(rd['evidence']) ? rd['evidence'] : null;
  const size = (key: string): number | undefined => {
    const v = shape?.[key];
    return typeof v === 'number' ? v : undefined;
  };
  const motiveSets = size('motive_sets');
  const setSize = size('motive_set_size');

  const rows: Zone[] = [];
  const row = (id: string, label: string, cards: CardData[], slots: number | undefined): void => {
    rows.push({
      kind: 'card-zone', id,
      data: {
        label, mode: 'row', size: 'small', cards,
        empty: slots === undefined ? undefined : Math.max(0, slots - cards.length),
      },
      arriveFrom: role === 'hacker' ? 'cn:hand' : undefined,
    });
  };

  row('cn:case:weapon', 'Weapon',
    evidence['weapon'] ? [{ id: 'cn:ev:weapon', label: 'The Weapon', colorKey: 'weapon' }] : [],
    size('weapon'));

  row('cn:case:witnesses', 'Witnesses',
    asArr(evidence['witnesses']).map((w) => card(`cn:ev:witness:${asStr(w)}`, asStr(w), 'witness')),
    size('witnesses'));

  // The motive rows the engine names, in order. `motive_set_4` is in the view
  // for old sessions and is drawn only if something is actually in it.
  const motiveKeys = Object.keys(evidence).filter((k) => k.startsWith('motive_set_')).sort();
  motiveKeys.forEach((key, i) => {
    const cards = asArr(evidence[key]).map((m) => card(`cn:ev:${key}:${asStr(m)}`, asStr(m), 'motive'));
    const expected = motiveSets === undefined || i < motiveSets;
    if (!expected && cards.length === 0) return;
    row(`cn:case:${key}`, `Motive ${ORDINALS[i] ? words(ORDINALS[i]) : String(i + 1)}`, cards, expected ? setSize : undefined);
  });

  const played = rows.reduce((n, z) => n + ((z.data as { cards?: unknown[] }).cards?.length ?? 0), 0);
  const total = size('total');
  return {
    kind: 'tableau', id: 'cn:case',
    data: {
      label: role === 'hacker' ? 'Your case' : "The Hacker's case",
      owner: role === 'hacker' ? 'hacker' : 'evidence',
      stats: [{ label: 'Evidence', value: played, ...(total === undefined ? {} : { max: total }) }],
    },
    children: rows,
  };
}

/** One line of a location's three printed facts, for a hint under its name. */
function locLine(l: Loc, n: Names): string {
  return [
    n.borough(l.borough),
    residentCount(l.population),
    l.affiliation && l.affiliation !== 'none' ? n.affiliation(l.affiliation) : 'no affiliation',
  ].filter(Boolean).join(' · ');
}

/**
 * The setup move the Hacker completes with a location name, when the engine
 * lists it. An AI Hacker's template carries no `location_name` at all (the
 * engine picks that one secretly), so it never matches here.
 */
function hideoutTemplate(legalMoves: LegalMove[]): LegalMove | null {
  return legalMoves.find((m) => m.move['type'] === 'report_hideout' && m.move['location_name'] === '') ?? null;
}

/**
 * Moves that are once per game, or that spend a whole turn's action points:
 * they get a second press, naming what they cost in the engine's own words.
 *
 * The same tap on the map means different things as a turn goes on — play a
 * Location early, guess the hideout later — and the second one spent four
 * action points and the one mid-game guess without asking. A tap should never
 * be the last word on something you only get to do once.
 */
const WEIGHTY: Array<{ type: string; title: string; confirm: string }> = [
  { type: 'guess_location', title: 'Guess the hideout?', confirm: 'Guess it' },
  { type: 'final_guess', title: 'Make your final guess?', confirm: 'Name it' },
  { type: 'burn_safehouse', title: 'Burn the safehouse?', confirm: 'Burn it' },
  { type: 'draw_extra_location', title: 'Draw an extra Location?', confirm: 'Draw it' },
  { type: 'overclock', title: 'Overclock?', confirm: 'Overclock' },
];

/**
 * A question at a time, instead of every combination at once.
 *
 * Jailbreak lists one move per person per clue token: thirty near-identical
 * rows, labelled with raw ids. The moves differ in two independent fields, so
 * the sheet asks about each in turn and narrows the listed moves as it goes.
 * Nothing is chosen for the player: each step starts empty, and what is sent
 * is the move the engine listed for those answers.
 */
function guidedForm(
  template: LegalMove,
  moves: LegalMove[],
  title: string,
  submitLabel: string,
  steps: Array<{ key: string; label: string; name: (value: string) => string }>,
): MoveForm {
  const matching = (answers: Record<string, unknown>, upTo: number): LegalMove[] =>
    moves.filter((m) => steps.slice(0, upTo).every((st) => {
      const a = answers[st.key];
      return a === undefined || a === '' || asStr(m.move[st.key]) === a;
    }));
  const optionsFor = (answers: Record<string, unknown>, i: number): string[] =>
    [...new Set(matching(answers, i).map((m) => asStr(m.move[steps[i]!.key])).filter(Boolean))];
  const fieldsAt = (answers: Record<string, unknown>): FormField[] =>
    steps.map((st, i) => ({
      kind: 'choice' as const,
      key: st.key,
      label: st.label,
      options: optionsFor(answers, i).map((v) => ({ value: v, label: st.name(v) })),
    }));
  const chosen = (answers: Record<string, unknown>): LegalMove | null => {
    const exact = matching(answers, steps.length).filter((m) =>
      steps.every((st) => asStr(m.move[st.key]) === answers[st.key]));
    return exact.length === 1 ? exact[0]! : null;
  };
  return {
    title,
    help: template.cost ? `${template.cost}.` : undefined,
    fields: fieldsAt({}),
    // Each step offers only what the answers before it leave standing.
    fieldsFor: (answers) => fieldsAt(answers),
    template,
    editableKeys: steps.map((st) => st.key),
    submitLabel,
    summarize(answers) {
      const picked = steps
        .filter((st) => typeof answers[st.key] === 'string' && answers[st.key] !== '')
        .map((st) => `${st.label}: ${st.name(asStr(answers[st.key]))}`);
      if (picked.length === 0) return null;
      const one = chosen(answers);
      return picked.join(' · ') + (one?.cost ? ` · ${one.cost}` : '');
    },
    build(answers) {
      return chosen(answers)?.move ?? null;
    },
  };
}

/** Where a tap on the map during setup is kept until the sheet names it back. */
const TAPPED_HIDEOUT = 'cn:tapped-hideout';

export function locId(name: string): string {
  return `cn:loc:${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
}

const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth'];

/** The engine's location names for one list of ruled-out reasons. */
function ruledOutNames(list: unknown): Set<string> {
  return new Set(asArr(list).filter(isObj).map((r) => asStr(r['location_name'])).filter(Boolean));
}

/**
 * The city as a subway map (docs/games/cybernoir-2127-theme-build.md, item 2):
 * three borough columns, each faction a line through its own locations, and
 * every location a station with its name and a 0–3 population bar. Null when
 * a location has no place on the map, so the table falls back to the bands.
 *
 * A station's state comes only from the seat's own view:
 * - played (public, on the board): a red diamond in place of the ring;
 * - ruled out by a clue (public, the engine's `locations_ruled_out`): faded;
 * - crossed off (the Detective's own `your_locations_ruled_out`, which the
 *   engine sends to no one else): a dashed ring and a struck name;
 * - the safehouse (the Hacker's own `hideout`): an ice diamond round it;
 * - anything else is still possible, and its ring glows.
 */
function stationMap(
  locs: Loc[], view: Record<string, unknown>, role: string, hideout: string, played: Set<string>, n: Names,
  phone = false, reference: GameReferenceResponse | null = null,
): Zone | null {
  if (locs.length === 0 || !locs.every((l) => STATIONS[l.name] && columnOf(l.borough))) return null;
  const publicOut = ruledOutNames(view['locations_ruled_out']);
  const ownOut = role === 'detective' ? ruledOutNames(view['your_locations_ruled_out']) : new Set<string>();
  const reasons = ruledOutReasons(view);
  const boroughs = [...new Set(locs.map((l) => l.borough))];
  const affiliations = [...new Set(locs.map((l) => l.affiliation || 'none'))];

  const nodes: MapNode[] = locs.map((l) => {
    const st = STATIONS[l.name]!;
    const isPlayed = played.has(l.name);
    const isOut = !isPlayed && publicOut.has(l.name);
    const isCrossed = !isPlayed && !isOut && ownOut.has(l.name);
    const isHideout = role === 'hacker' && hideout === l.name;
    return {
      id: locId(l.name),
      label: st.short,
      area: l.borough,
      ...pct(st.x, st.y),
      labelSide: st.side,
      colorKey: l.affiliation || 'none',
      meter: { value: Math.max(0, Math.min(3, l.population ?? 0)), max: 3 },
      // The diamond flies from the card the Detective played and lands on the
      // station; a seat that never held the card sees it drop.
      ...(isPlayed ? { mark: 'diamond' as const, markColorKey: 'played', markFrom: handOrigins(l.name) } : isHideout ? { mark: 'frame' as const, markColorKey: 'safehouse' } : {}),
      dim: isOut,
      crossed: isCrossed,
      glow: !isPlayed && !isOut && !isCrossed,
      // The phone's list says each station's state in a word (build item 8).
      ...(phone ? {
        note: isPlayed ? 'Canvassed' : isOut ? 'Ruled out' : isCrossed ? 'Seen in hand' : isHideout ? 'Your hideout' : 'Still possible',
        ...(LINE_CODES[l.affiliation || 'none'] ? { code: LINE_CODES[l.affiliation || 'none'] } : {}),
        faces: residentsOf(reference, l.name).map((w) => ({ label: w, ...(faceUrl(w, 'square') ? { artUrl: faceUrl(w, 'square') } : {}) })),
      } : {}),
      describedAs: [
        l.name,
        n.borough(l.borough),
        residentCount(l.population),
        l.affiliation && l.affiliation !== 'none' ? n.affiliation(l.affiliation) : 'no faction',
        isPlayed ? 'played' : '',
        isOut || isCrossed ? `ruled out: ${reasons.get(l.name) ?? 'by a clue'}` : '',
        isHideout ? 'your safehouse' : '',
      ].filter(Boolean).join(', '),
      badges: [
        ...(isPlayed ? ['played'] : []),
        ...(isOut || isCrossed ? ['ruled out'] : []),
        ...(isHideout ? ['safehouse'] : []),
        residentCount(l.population),
      ].filter(Boolean),
    };
  });

  const out = reasons.size;
  // On a phone the list opens on the borough with the most places still
  // possible, where the search is.
  const first = phone
    ? [...boroughs].sort((a, b) => nodes.filter((x) => x.area === b && x.glow).length - nodes.filter((x) => x.area === a && x.glow).length)[0]
    : undefined;
  return {
    kind: 'map', id: 'cn:map',
    data: {
      label: `The city · ${locs.length} locations · ${locs.length - out} still standing`,
      ...(phone ? { aspect: 50, listView: { first } } : { fill: { minHeight: 300 } }),
      nodeShape: 'station', nodes,
      inspectable: true,
      areas: boroughs.map((b) => ({
        key: b,
        label: n.borough(b),
        note: BOROUGH_COLUMNS[b]!.tagline,
        y: 0, height: 100,
        ...columnOf(b)!,
      })),
      lines: affiliations.filter((a) => LINES[a]).map((a) => ({
        key: a, colorKey: a, label: a === 'none' ? 'No faction' : n.affiliation(a),
        points: LINES[a]!.map(([x, y]) => pct(x, y)),
      })),
      legend: [
        ...affiliations.map((a) => ({ colorKey: a, label: a === 'none' ? 'No faction' : n.affiliation(a) })),
        { colorKey: 'none', label: 'Still possible', shape: 'glow' as const },
        { colorKey: 'played', label: 'Played', shape: 'diamond' as const },
        { colorKey: 'none', label: 'Ruled out by a clue', shape: 'faded' as const },
        ...(role === 'detective' ? [{ colorKey: 'none', label: 'Crossed off (you have seen it)', shape: 'crossed' as const }] : []),
        ...(role === 'hacker' ? [{ colorKey: 'safehouse', label: 'Your safehouse', shape: 'frame' as const }] : []),
      ],
      legendNote: 'Each line is a faction and shows who owns a place. Nobody travels on them.',
    },
  };
}

/**
 * The informants facing the Hacker, as the Hacker may know them: the face-down
 * ones only by how many there are, each a dead camera feed ("NO SIGNAL"), and
 * the revealed ones by name, with their portrait and a BLOWN stamp. Card ids
 * follow the engine's own way of naming a target: a face-down informant by its
 * position among the face-down ones (1, 2, ...), a revealed one by name, so a
 * move that targets one lights that card.
 */
function informantsFacing(
  view: Record<string, unknown>, mine: boolean, people: Map<string, Person>, n: Names,
  abilities: Map<string, { name: string; text: string }>,
): Zone {
  const down = Math.max(0, asNum(view['informants_facedown_count']));
  const revealed = asArr(view['informants_revealed'])
    .map((r) => asStr(isObj(r) ? r['person'] : r)).filter(Boolean);
  const cards: CardData[] = [
    ...Array.from({ length: down }, (_, i): CardData => ({
      id: `cn:informant:${i + 1}`, label: `Face-down informant ${i + 1}`, face: 'down', backLabel: 'No signal',
    })),
    ...revealed.map((who): CardData => ({
      ...contactCard(`cn:informant:${who}`, who, people, n, abilities), stamp: 'Blown',
      arriveFrom: Array.from({ length: 8 }, (_, k) => `cn:informant:${k + 1}`).join('|'),
    })),
  ];
  return {
    kind: 'card-zone', id: 'cn:informants-facing',
    data: { label: `Informants facing ${mine ? 'you' : 'the Hacker'} (${down + revealed.length})`, mode: 'row', size: 'small', cards },
  };
}

/**
 * The phone (build item 8): there is no side column, so every zone goes in
 * one column, in the order the phone boards read: the city, the clues and
 * the holding cells, then your informants or the ones facing you, your hand,
 * who you can reach, the case, the discards, and both seats' counts. The
 * deck piles go (the top bar says how many Locations are left). The hand is
 * a row you swipe, and every card can be tapped to open it up close.
 */
function phoneColumn(role: string, board: Zone[], bench: Zone[], side: Zone[], caseFile: Zone): { board: Zone[]; bench: Zone[]; side: Zone[] } {
  const byId = new Map([...board, ...bench, ...side, caseFile].map((z) => [z.id, z] as const));
  const order = role === 'detective'
    ? ['cn:map', 'cn:clues', 'cn:not-clues', 'cn:jail', 'cn:hand', 'cn:informants', 'cn:reach', 'cn:case', 'cn:location-discard', 'cn:hacker', 'cn:detective']
    : ['cn:map', 'cn:clues', 'cn:not-clues', 'cn:jail', 'cn:informants-facing', 'cn:hand', 'cn:case', 'cn:contacts-discard', 'cn:detective', 'cn:hacker'];
  const look = (z: Zone): Zone => {
    if (z.kind === 'card-zone') return { ...z, data: { ...z.data, inspectable: true, ...(z.id === 'cn:hand' ? { mode: 'row' as const } : {}) } };
    if (z.kind === 'tableau' && z.children) return { ...z, children: z.children.map(look) };
    return z;
  };
  const column = order.map((id) => byId.get(id)).filter((z): z is Zone => !!z).map((z) => {
    const zone = look(z);
    // The clues, the NOT tokens and the jail share a strip.
    return ['cn:clues', 'cn:not-clues', 'cn:jail'].includes(zone.id) ? { ...zone, span: 'row' } as Zone : zone;
  });
  return { board: column, bench: [], side: [] };
}

export const cybernoirGlue: GlueModule = {
  phone: true,
  gameId: 'cybernoir-2127',
  title: 'Cybernoir 2127',
  captionInSide: true,

  /** The rain and neon theme (docs/design/cybernoir-rain-neon), once the view
   *  is this game's: the seat's own look from the role the engine puts in
   *  that seat's view, and the plain city for a watcher. */
  themeFor(input: GlueInput): string | null {
    const { view } = input;
    if (!shapeHas(view, 'phase', 'board', 'detective', 'hacker')) return null;
    const role = asStr(view['role'], '');
    return role === 'detective' || role === 'hacker' ? `cn-theme cn-theme-${role}` : 'cn-theme';
  },

  plan(input: GlueInput): TablePlan | null {
    const { view } = input;
    if (!shapeHas(view, 'phase', 'board', 'detective', 'hacker')) return null;
    const role = asStr(view['role'], '');
    const played = new Set(asArr(view['board']).map((b) => asStr(b)));
    // The Hacker's own view names their hideout beside the three printed
    // facts. An older view gave only the facts, which mark no single node
    // (Trailer Towers and Little Ghana share all three), and a session from
    // before the engine stored the location id names nothing; either way the
    // mark stays off rather than landing on a guess.
    const hideoutRaw = view['hideout'];
    const hideoutDesc = isObj(hideoutRaw) ? hideoutRaw : null;
    const hideout = hideoutDesc ? asStr(hideoutDesc['location_name'], '') : asStr(hideoutRaw, '');

    const name = names(input.reference);
    const people = peopleByName(input.reference);
    const abilities = abilityLines(input.reference);
    // The city is a map: nineteen named regions grouped in three borough
    // areas, no edges and no routes (cybernoir-2127.md, and the component
    // sheet, which says so in as many words). A region is a place rather
    // than a space, so it is drawn as a pill wide enough to hold its name.
    //
    // Each of the three facts a clue can name is said once and in the place
    // that fits it: the borough is the band the region stands in, the faction
    // is the region's colour, and how many people live there is its one
    // badge. They used to be three text badges each, which is what made the
    // map unreadable.
    const locs = locations(input.reference, view);
    const crossedOff = ruledOutReasons(view);
    const boroughs = [...new Set(locs.map((l) => l.borough))];
    const bandHeight = 100 / Math.max(1, boroughs.length);
    const nodes: MapNode[] = [];
    boroughs.forEach((b, bi) => {
      const inBand = locs.filter((l) => l.borough === b);
      const yTop = bi * bandHeight;
      // A borough is one row of places, the way the design draws it: the band
      // says where you are and the row holds everything in it. Folding each
      // band into two rows doubled the board's height for no gain, and the
      // bottom borough ended up behind the action bar.
      inBand.forEach((l, i) => {
        const cols = inBand.length;
        const isPlayed = played.has(l.name);
        const isHideout = role === 'hacker' && hideout === l.name;
        nodes.push({
          id: locId(l.name),
          label: l.name,
          area: b,
          x: cols <= 1 ? 50 : 8 + (i / (cols - 1)) * 84,
          y: yTop + bandHeight * 0.62,
          // A played Location keeps its faction: the colour is what it IS,
          // and being played is what happened to it. It used to go grey, and
          // the Detective lost the one fact they are reasoning from.
          colorKey: l.affiliation || 'none',
          dim: isPlayed || crossedOff.has(l.name),
          // Colour and position carry the faction and the borough, which a
          // reader cannot hear. Say all of it.
          describedAs: [
            l.name,
            name.borough(l.borough),
            residentCount(l.population),
            l.affiliation && l.affiliation !== 'none' ? name.affiliation(l.affiliation) : 'no faction',
            isPlayed ? 'played' : '',
            crossedOff.has(l.name) ? `ruled out: ${crossedOff.get(l.name)}` : '',
            isHideout ? 'your safehouse' : '',
          ].filter(Boolean).join(', '),
          badges: [
            ...(isPlayed ? ['played'] : []),
            ...(!isPlayed && crossedOff.has(l.name) ? ['ruled out'] : []),
            ...(isHideout ? ['safehouse'] : []),
            residentCount(l.population),
          ].filter(Boolean),
          pieces: isHideout ? [{ label: 'safehouse', colorKey: 'safehouse' }] : [],
        });
      });
    });

    // The rain and neon theme draws the city as a subway map when it knows
    // where every location stands; a location it has no place for keeps the
    // whole city in the plain bands above, rather than guessing a spot.
    const board: Zone[] = [
      stationMap(locs, view, role, hideout, played, name, !!input.phone, input.reference) ?? {
        kind: 'map', id: 'cn:map',
        data: {
          label: `The city · ${locs.length} locations · ${locs.length - crossedOff.size} still standing`,
          // The board takes the height the table has left rather than making
          // its own out of its width. Below the floor the three bands would
          // run into each other, so the board scrolls instead.
          fill: { minHeight: 236 }, nodeShape: 'pill', nodes,
          // Every location can be looked at, whether or not a move is behind
          // it, and the colours say what they mean.
          inspectable: true,
          legend: [...new Set(locs.map((l) => l.affiliation || 'none'))]
            .map((a) => ({ colorKey: a, label: a === 'none' ? 'No faction' : name.affiliation(a) })),
          areas: boroughs.map((b, bi) => ({
            key: b,
            label: name.borough(b),
            note: `${locs.filter((l) => l.borough === b).length} locations`,
            y: bi * bandHeight,
            height: bandHeight,
          })),
        },
      },
    ];

    // Jail: three named slots with whoever sits in them.
    // The clue rail: what the Detective knows. Three truthful slots, one per
    // category, each holding its revealed value or drawn empty, and the ruled
    // out tokens beside them. Public, and the same for both seats — the
    // deduction the whole game turns on, which the table used to say nothing
    // about beyond "NOT ×4".
    const revealed = isObj(view['truthful_clues']) ? view['truthful_clues'] : {};
    const values = isObj(view['truthful_values']) ? view['truthful_values'] : {};
    board.push({
      kind: 'track', id: 'cn:clues', span: 'row',
      data: {
        label: 'What the Detective knows',
        // Fare tokens: a round slot per category, dashed with "?" until the
        // Hacker reveals it.
        spaceShape: 'token',
        spaces: CLUE_CATEGORIES.map((c) => ({
          index: c.label,
          label: revealed[c.key] ? clueValue(c.key, values[c.key], name) : undefined,
          filled: !!revealed[c.key],
        })),
      },
    });

    const ruledOut = asArr(view['negative_clues'])
      .map((t) => negativeClue(asStr(t), name))
      .filter((x): x is NonNullable<ReturnType<typeof negativeClue>> => x !== null);
    board.push({
      kind: 'pool', id: 'cn:not-clues', span: 'row',
      data: {
        label: ruledOut.length > 0 ? `Ruled out (${ruledOut.length})` : 'Ruled out — nothing yet',
        // Each NOT is its own fare token: the value inside, the category over
        // it, a red NOT sash across it. An affiliation NOT wears that
        // faction's line colour, so "NOT Chimera" reads as the purple line.
        // The values of the three categories never overlap (numbers, borough
        // names, faction names), so the value alone names the token.
        itemShape: 'token',
        items: ruledOut.map((r) => ({
          label: r.value, caption: r.category, sash: 'NOT', count: 1,
          colorKey: r.key === 'affiliation' ? r.raw : 'not',
        })),
      },
    });

    const jail = isObj(view['jail']) ? view['jail'] : {};
    const slots: Array<[string, string]> = [
      ['slot_1_booked', 'Booked'], ['slot_2_processing', 'Processing'], ['slot_3_release_pending_then_freed', 'Release pending'],
    ];


    // Three slots in a line with arrows between them, each holding a stack of
    // face-up cards. Who is in them is the whole point, so they are named.
    const jailed = slots.reduce((n, [key]) => n + asArr(jail[key]).length, 0);
    // The holding cells sit in the side column with the case, as on the table
    // boards; each person shows their face beside their name.
    const jailZone: Zone = {
      kind: 'track', id: 'cn:jail',
      data: {
        label: jailed > 0 ? `Jail · ${jailed} held` : 'Jail · nobody held',
        pieceShape: 'named', arrows: true,
        spaces: slots.map(([key, label]) => ({
          index: label,
          filled: asArr(jail[key]).length > 0,
          pieces: asArr(jail[key]).map((who) => ({
            label: asStr(who),
            colorKey: people.get(asStr(who))?.affiliation || 'none',
            ...(faceUrl(asStr(who), 'square') ? { artUrl: faceUrl(asStr(who), 'square') } : {}),
          })),
        })),
      },
    };

    const caseFile = evidenceCase(view, input.reference, role, people, name);

    const det = isObj(view['detective']) ? view['detective'] : {};
    const hak = isObj(view['hacker']) ? view['hacker'] : {};
    const activeRole = asStr(view['activePlayerId']);
    const detStats: NonNullable<TableauData['stats']> = [
      { label: 'Action points', value: asNum(det['ap']) },
      { label: 'Location deck', value: asNum(det['location_deck_size']) },
      { label: 'Location hand', value: asNum(det['location_hand_size']) },
      { label: 'Person deck', value: asNum(det['poi_deck_size']) },
      { label: 'Mid-game guess', value: det['mid_game_guess_spent'] ? 'spent' : 'available' },
      // No Overclock row: Overclock is the Hacker's, and the Detective's panel
      // used to carry one anyway. The engine publishes `overclock_used` on
      // both seats, and the Detective's is structurally always false, so the
      // row read "available" for an ability the Detective can never use — the
      // opponent's own marker, misfiled. Each panel carries its own markers,
      // the way the mid-game guess and the burned safehouse already do.
    ];
    const hakStats: NonNullable<TableauData['stats']> = [
      { label: 'Action points', value: asNum(hak['ap']) },
      // Named when the engine names it; otherwise the facts the Hacker does have.
      ...(role === 'hacker' && (hideout || hideoutDesc)
        ? [{ label: 'Safehouse', value: hideout
          || [name.borough(asStr(hideoutDesc!['borough'])), asStr(hideoutDesc!['affiliation']) && asStr(hideoutDesc!['affiliation']) !== 'none' ? name.affiliation(asStr(hideoutDesc!['affiliation'])) : ''].filter(Boolean).join(' · ')
          || 'hidden' }]
        : []),
      // Block risk is the Hacker's central risk, and their view carries the
      // count (never the names). It said nothing about it before.
      { label: role === 'hacker' ? 'Informants facing you' : 'Informants face down', value: asNum(view['informants_facedown_count']) },
      { label: 'Contacts deck', value: asNum(hak['contacts_deck_size']) },
      { label: 'Hand', value: asNum(hak['hand_size']) },
      { label: 'Safehouse burned', value: view['safehouse_burned'] ? 'yes' : 'no' },
      { label: 'Overclock', value: hak['overclock_used'] ? 'used' : 'available' },
    ];
    const detTz: Zone = { kind: 'tableau', id: 'cn:detective', data: { label: `Detective${role === 'detective' ? ' (you)' : ''}`, owner: 'detective', active: /det/i.test(activeRole), stats: detStats } };
    const hakTz: Zone = { kind: 'tableau', id: 'cn:hacker', data: { label: `Hacker${role === 'hacker' ? ' (you)' : ''}`, owner: 'hacker', active: /hak|hack/i.test(activeRole), stats: hakStats } };

    const bench: Zone[] = [];
    const side: Zone[] = [];
    // The table boards' layout (docs/design/cybernoir-rain-neon/Table-*.dc.html):
    // the map and clue row, then the hand along the bottom; the side column
    // holds the case, who you can reach or who is facing you, the holding
    // cells, the other seat's summary, your own counts and the deck.
    if (role === 'detective') {
      const hand = view['location_hand'];
      if (Array.isArray(hand)) {
        bench.push({
          kind: 'card-zone', id: 'cn:hand', arriveFrom: 'cn:location-deck',
          data: {
            label: 'Your location hand', mode: 'fan',
            groupNames: Object.fromEntries(boroughs.map((b) => [b, name.borough(b)])),
            // A card the engine says the Detective has ruled out, in their
            // own list only, is stamped NOT IT in their own hand.
            cards: hand.map((h, i) => ({
              ...locationCard(`cn:hand:${i}:${asStr(h)}`, asStr(h), locs, input.reference, name),
              arriveFrom: handOrigins(asStr(h), ['cn:location-deck']),
              ...(ruledOutNames(view['your_locations_ruled_out']).has(asStr(h)) ? { stamp: 'Not it' } : {}),
            })),
          },
        });
      }
      const informants = asArr(view['informants']);
      bench.push({
        kind: 'card-zone', id: 'cn:informants',
        data: {
          label: 'Informants', mode: 'row',
          // Face up for their owner, who pays to hold them and is the one
          // person entitled to know. The line underneath says whether the
          // Hacker has seen it — the card is not public either way.
          cards: informants.map((inf, i) => {
            const o = isObj(inf) ? inf : {};
            const revealed = !!o['revealed'];
            return {
              ...contactCard(`cn:informant:${ORDINALS[i] ?? String(i)}`, asStr(o['person']), people, name, abilities),
              arriveFrom: personId(asStr(o['person'])),
              subtitle: revealed ? 'revealed to the Hacker' : 'face down to the Hacker',
              ...(revealed ? { stamp: 'Blown' } : {}),
            };
          }),
        },
      });
      side.push(whoYouCanReach(view, input.reference, people, name, abilities));
      side.push(jailZone);
      // Discards are face up by the rules and the engine publishes both. They
      // are what a Detective crosses off, and they were nowhere on screen.
      const locDiscard = asArr(det['location_discard']).map((d) => asStr(d)).filter(Boolean);
      if (locDiscard.length > 0) {
        side.push({
          kind: 'card-zone', id: 'cn:location-discard',
          data: {
            label: `Locations discarded (${locDiscard.length})`, mode: 'row', size: 'small',
            cards: locDiscard.map((l, i) => ({ ...locationCard(`cn:discard:loc:${i}:${l}`, l, locs, input.reference, name), arriveFrom: handOrigins(l) })),
          },
        });
      }
      side.push(hakTz, detTz);
      side.push({ kind: 'card-zone', id: 'cn:location-deck', data: { label: 'Location deck', mode: 'pile', countOnly: asNum(det['location_deck_size']) } });
    } else {
      side.push(informantsFacing(view, role === 'hacker', people, name, abilities));
      side.push(jailZone);
      side.push(detTz, hakTz);
      const hand = view['hand'];
      if (Array.isArray(hand)) {
        bench.push({
          kind: 'card-zone', id: 'cn:hand', arriveFrom: 'cn:contacts-deck',
          data: {
            label: 'Your contacts', mode: 'fan',
            groupNames: Object.fromEntries([...new Set([...people.values()].map((p) => p.affiliation).filter(Boolean))]
              .map((a) => [a as string, name.affiliation(a as string)])),
            // From its old place in the hand, from the discard (taken back),
            // or from the deck.
            cards: hand.map((h, i) => ({
              ...contactCard(`cn:hand:${i}:${asStr(h)}`, asStr(h), people, name, abilities),
              arriveFrom: [handOrigins(asStr(h)), ...Array.from({ length: HAND_SPAN }, (_, j) => `cn:discard:contact:${j}:${asStr(h)}`), 'cn:contacts-deck'].join('|'),
            })),
          },
        });
      }
      side.push({ kind: 'card-zone', id: 'cn:contacts-deck', data: { label: 'Contacts deck', mode: 'pile', countOnly: asNum(hak['contacts_deck_size']) } });
    }

    // A moment that stops the turn and asks one question comes before the
    // turn's own verbs.
    const interrupt = interruptPrompt(asStr(view['pending']), input.legalMoves);
    // Setup is the Hacker's one secret decision: they name the hideout and
    // hide there all game. The map is how they say it; the Detective waits.
    const choosing = asStr(view['phase']) === 'setup' ? hideoutTemplate(input.legalMoves) : null;
    let prompt: PlanPrompt | undefined;
    if (choosing) {
      prompt = {
        title: 'Choose your hideout',
        sub: `Tap a location on the map — ${locs.length} to choose from. You hide there all game, the people who live there start in your hand, and the Detective wins by naming it.`,
        actions: [],
      };
    } else if (asStr(view['phase']) === 'setup') {
      prompt = { title: 'The Hacker is choosing a hideout', sub: 'The city opens once they have hidden.', actions: [] };
    } else if (interrupt) {
      prompt = interrupt;
    } else {
      // The turn's verbs. The numbered list stays, one tap away, and is no
      // longer the only way to act.
      const actions = verbActions(input.legalMoves);
      if (actions.length > 0) {
        const ap = asNum((role === 'detective' ? det : hak)['ap']);
        prompt = {
          title: role === 'detective' ? "Detective's turn" : "Hacker's turn",
          sub: `${ap} action point${ap === 1 ? '' : 's'} left. Unspent points are lost at the end of the turn.`,
          actions,
        };
      }
    }

    // The Hacker's discard is face up and public, and neither seat could see
    // it. What has been spent is half of what either of them is reasoning
    // from.
    const contactDiscard = asArr(view['contacts_discard']).map((d) => asStr(d)).filter(Boolean);
    if (contactDiscard.length > 0) {
      side.push({
        kind: 'card-zone', id: 'cn:contacts-discard',
        data: {
          label: `Contacts discarded (${contactDiscard.length})`, mode: 'row', size: 'small',
          cards: contactDiscard.map((c, i) => ({ ...contactCard(`cn:discard:contact:${i}:${c}`, c, people, name, abilities), arriveFrom: handOrigins(c) })),
        },
      });
    }

    const deckLeft = asNum(det['location_deck_size']);
    const status = `Turn ${asNum(view['turn'], 1)} · ${words(asStr(view['phase']))} · Case clock: ${deckLeft} Location${deckLeft === 1 ? '' : 's'} left in the deck`;
    const statusShort = `T${asNum(view['turn'], 1)} · ${deckLeft} left`;
    if (input.phone) {
      return { ...phoneColumn(role, board, bench, side, caseFile), palette: PALETTE, title: 'Cybernoir 2127', status, statusShort, prompt };
    }
    return { board, bench, side, points: caseFile, palette: PALETTE, title: 'Cybernoir 2127', status, statusShort, prompt };
  },

  litParts(input: GlueInput): string[] {
    // Setup: every location in the city is a place the Hacker may hide.
    if (hideoutTemplate(input.legalMoves)) {
      return locations(input.reference, isObj(input.view) ? input.view : {}).map((l) => locId(l.name));
    }
    const lit: string[] = [];
    const hand = shapeHas(input.view, 'role') ? asArr(input.view['location_hand'] ?? input.view['hand']) : [];
    // A card in hand is named, not indexed — by a person for the Hacker, by a
    // location for the Detective. Every move that names one lights the card
    // holding it, so a playable card can be tapped where it is rather than
    // only wherever else it happens to appear.
    const inHand = (what: string): string | null => {
      const i = hand.findIndex((h) => asStr(h) === what);
      return i < 0 ? null : `cn:hand:${i}:${what}`;
    };
    for (const m of input.legalMoves) {
      const t = asStr(m.move['type']);
      for (const what of [...namedPeople(m), ...namedLocations(m)]) {
        const card = inHand(what);
        if (card) lit.push(card);
      }
      for (const loc of namedLocations(m)) lit.push(locId(loc));
      if (typeof m.move['hand_index'] === 'number') lit.push(`cn:hand:${m.move['hand_index']}:${asStr(hand[m.move['hand_index']])}`);
      const inf = asStr(m.move['target_informant']);
      if ((t === 'reveal_informant' || t === 'informant_removal_choice') && inf) lit.push(`cn:informant:${inf}`);
      const person = asStr(m.move['target_person']);
      if (person) lit.push(personId(person));
    }
    return [...new Set(lit)];
  },

  moveForSelect(sel: SelectEvent, input: GlueInput): LegalMove | null {
    const choosing = hideoutTemplate(input.legalMoves);
    if (choosing) {
      const l = locations(input.reference, isObj(input.view) ? input.view : {}).find((x) => locId(x.name) === sel.id);
      if (!l) return null;
      // The tap is the answer; the sheet names it back and the player presses
      // Hide here. Nothing is sent until they do.
      input.memory.set(TAPPED_HIDEOUT, l.name);
      return choosing;
    }
    const hand = shapeHas(input.view, 'role') ? asArr(input.view['location_hand'] ?? input.view['hand']) : [];
    return (
      input.legalMoves.find((m) => {
        const loc = asStr(m.move['location_name'] ?? m.move['target_location'] ?? m.move['new_location_name']);
        if (loc && locId(loc) === sel.id) return true;
        const h = /^cn:hand:(\d+):/.exec(sel.id);
        if (h && m.move['hand_index'] === Number(h[1]) && asStr(hand[Number(h[1])]) === sel.id.slice(h[0].length)) return true;
        const inf = /^cn:informant:(.+)$/.exec(sel.id);
        if (inf && m.move['target_informant'] === inf[1]) return true;
        return false;
      }) ?? null
    );
  },

  /**
   * Upkeep: each informant, kept or released, with nothing preselected. The
   * engine lists every combination as its own move, so the form finds the one
   * the answers make and sends that — and shows the engine's own sentence for
   * it, which is where the cost is stated. Universe does not add up what
   * holding them costs: that is a rule.
   */
  formFor(move: LegalMove, input: GlueInput): MoveForm | null {
    if (move.move['type'] === 'upkeep_choice') {
      const view = isObj(input.view) ? input.view : {};
      const informants = asArr(view['informants']).map((inf) => asStr(isObj(inf) ? inf['person'] : inf)).filter(Boolean);
      if (informants.length === 0) return null;
      const listed = input.legalMoves.filter((m) => m.move['type'] === 'upkeep_choice');
      const madeBy = (answers: Record<string, unknown>): { keep: string[]; release: string[] } | null => {
        const keep: string[] = [];
        const release: string[] = [];
        for (const who of informants) {
          const a = answers[`inf.${who}`];
          if (a === 'keep') keep.push(who);
          else if (a === 'release') release.push(who);
          else return null;
        }
        return { keep, release };
      };
      const same = (a: string[], b: unknown): boolean => {
        const other = asArr(b).map((x) => asStr(x));
        return a.length === other.length && a.every((x) => other.includes(x));
      };
      return {
        title: 'Pay upkeep',
        help: 'Every informant you keep costs you, and a released one goes back into the deck. Say what happens to each.',
        fields: informants.map((who) => ({
          kind: 'choice' as const, key: `inf.${who}`, label: who,
          options: [{ value: 'keep', label: 'Keep' }, { value: 'release', label: 'Release' }],
        })),
        template: move,
        editableKeys: ['keep', 'release'],
        submitLabel: 'Pay upkeep',
        // What this answer costs, from the engine's own move for it — never
        // added up here. "1 AP for each informant you keep" is a rule.
        summarize(answers) {
          const made = madeBy(answers);
          if (!made) return null;
          const exact = listed.find((m) => same(made.keep, m.move['keep']) && same(made.release, m.move['release']));
          return exact ? (exact.cost ? `${exact.description} · ${exact.cost}` : exact.description ?? null) : null;
        },
        build(answers) {
          const made = madeBy(answers);
          if (!made) return null;
          // Only ever a move the engine listed. With more informants than the
          // engine enumerates, it lists one blank to fill in instead.
          const exact = listed.find((m) => same(made.keep, m.move['keep']) && same(made.release, m.move['release']));
          if (exact) return exact.move;
          const blank = listed.find((m) => asArr(m.move['keep']).length === 0 && asArr(m.move['release']).length === 0);
          return blank ? { ...blank.move, keep: made.keep, release: made.release } : null;
        },
      };
    }

    // Thirty near-identical rows, labelled with raw ids, is not a choice:
    // ask who, then ask which clue that leaves.
    if (move.move['type'] === 'jailbreak') {
      const all = input.legalMoves.filter((m) => m.move['type'] === 'jailbreak');
      if (all.length > 1) {
        const n = names(input.reference);
        return guidedForm(move, all, 'Free someone from jail', 'Free them', [
          { key: 'freed_person', label: 'Who do you free?', name: (v) => v },
          {
            key: 'negative_clue_token',
            label: 'Which clue do you give?',
            name: (v) => {
              const c = negativeClue(v, n);
              return c ? `${c.category} — not ${c.value}` : words(v);
            },
          },
        ]);
      }
    }

    // A set is chosen as a set: the eligible cards, pick the size the engine
    // is asking for, and what goes out is the combination it listed.
    for (const [type, key, title, submit, label] of [
      ['play_evidence', 'people', 'Play Evidence', 'Play them', 'The cards'],
      ['buy_clue', 'discard_locations', 'Buy a clue', 'Buy it', 'Discard which three'],
    ] as const) {
      if (move.move['type'] !== type) continue;
      const all = input.legalMoves.filter((m) => m.move['type'] === type && Array.isArray(m.move[key]));
      const size = asArr(move.move[key]).length;
      if (all.length <= 1 || size < 2) continue;
      const pool = [...new Set(all.flatMap((m) => asArr(m.move[key]).map((x) => asStr(x))).filter(Boolean))];
      const same = (a: string[], b: unknown) => {
        const other = asArr(b).map((x) => asStr(x));
        return a.length === other.length && a.every((x) => other.includes(x));
      };
      const matched = (answers: Record<string, unknown>) => {
        const picked = Array.isArray(answers[key]) ? (answers[key] as string[]) : [];
        return picked.length !== size ? null : all.find((m) => same(picked, m.move[key])) ?? null;
      };
      return {
        title,
        help: move.cost ? `${move.cost}.` : undefined,
        fields: [{ kind: 'multi', key, label, pick: size, options: pool.map((v) => ({ value: v, label: v })) }],
        template: move,
        editableKeys: [key],
        submitLabel: submit,
        summarize(answers) {
          const picked = Array.isArray(answers[key]) ? (answers[key] as string[]) : [];
          if (picked.length === 0) return null;
          const one = matched(answers);
          if (!one) return `${picked.join(', ')} — ${size - picked.length} more to choose`;
          return one.description ?? picked.join(', ');
        },
        build: (answers) => matched(answers)?.move ?? null,
      };
    }

    // A move you only get to make once waits for a second press, with the
    // engine's own sentence for what it costs.
    const weighty = WEIGHTY.find((w) => w.type === move.move['type']);
    if (weighty) {
      // When the move names a place, decide with that place's facts in front
      // of you: once a guess is on offer every location has a move behind it,
      // so this is the only way left to look at one.
      const about = namedLocations(move)[0];
      const facts = about
        ? cybernoirGlue.detailFor?.({ component: 'map', id: locId(about), label: about }, input)?.lines ?? []
        : [];
      return {
        title: weighty.title,
        help: [
          [move.cost, move.description].filter(Boolean).join(' — '),
          ...(facts.length > 0 ? [`${about}: ${facts.join(' · ')}`] : []),
        ].join(' — '),
        fields: [],
        template: move,
        editableKeys: [],
        submitLabel: weighty.confirm,
        build: () => ({ ...move.move }),
      };
    }

    // The hideout. The engine lists it as a blank to fill in, so it goes
    // through a sheet either way: a tap on the map gets that location named
    // back before it is sent, and the numbered menu gets the whole city as a
    // list. The tap is read once — a later press with no fresh tap asks the
    // whole question again rather than leaning on an old one.
    if (move.move['type'] !== 'report_hideout' || move.move['location_name'] !== '') return null;
    const locs = locations(input.reference, isObj(input.view) ? input.view : {});
    if (locs.length === 0) return null;
    const name = names(input.reference);
    const tapped = asStr(input.memory.get(TAPPED_HIDEOUT));
    input.memory.delete(TAPPED_HIDEOUT);
    const one = locs.find((l) => l.name === tapped);
    if (one) {
      const who = residentsOf(input.reference, one.name);
      return {
        title: `Hide in ${one.name}?`,
        help: `${locLine(one, name)}. ${who.length > 0
          ? `${who.join(', ')} live here and start in your hand.`
          : 'Nobody lives here, so you start on three drawn Contacts.'}`,
        fields: [],
        template: move,
        editableKeys: ['location_name'],
        submitLabel: 'Hide here',
        build: () => ({ ...move.move, location_name: one.name }),
      };
    }
    return {
      title: 'Choose your hideout',
      help: 'You hide here all game and never move unless you burn the safehouse. The Detective wins by naming it.',
      fields: [{
        kind: 'choice', key: 'location_name', label: 'Location',
        options: locs.map((l) => ({ value: l.name, label: l.name, hint: locLine(l, name) })),
      }],
      template: move,
      editableKeys: ['location_name'],
      submitLabel: 'Hide here',
      build(answers) {
        const v = answers['location_name'];
        if (typeof v !== 'string' || !locs.some((l) => l.name === v)) return null;
        return { ...move.move, location_name: v };
      },
    };
  },

  movesForSelect(sel: SelectEvent, input: GlueInput): LegalMove[] {
    const person = input.legalMoves.filter((m) => namedPeople(m).some((who) => personId(who) === sel.id));
    if (person.length > 0) return person;
    const inHand = /^cn:hand:\d+:(.+)$/.exec(sel.id);
    if (inHand) {
      const named = input.legalMoves.filter((m) =>
        namedPeople(m).includes(inHand[1]!) || namedLocations(m).includes(inHand[1]!));
      if (named.length > 0) return named;
    }
    const one = cybernoirGlue.moveForSelect(sel, input);
    return one ? [one] : [];
  },

  /** What a location is, for a tap with no move behind it. Everything here is
   *  printed on the card, or on the table in front of both seats. */
  detailFor(sel: SelectEvent, input: GlueInput): { title: string; lines: string[] } | null {
    const view = isObj(input.view) ? input.view : {};
    const locs = locations(input.reference, view);
    const l = locs.find((x) => locId(x.name) === sel.id);
    if (!l) return null;
    const n = names(input.reference);
    const who = residentsOf(input.reference, l.name);
    const played = asArr(view['board']).map((b) => asStr(b)).includes(l.name);
    const discarded = asArr(isObj(view['detective']) ? view['detective']['location_discard'] : []).map((d) => asStr(d)).includes(l.name);
    const why = ruledOutReasons(view).get(l.name);
    const isHideout = asStr(view['role']) === 'hacker'
      && asStr(isObj(view['hideout']) ? view['hideout']['location_name'] : view['hideout']) === l.name;
    return {
      title: l.name,
      lines: [
        `Borough: ${n.borough(l.borough)}`,
        `Lives here: ${who.length > 0 ? who.join(', ') : 'nobody'}`,
        `Faction: ${l.affiliation && l.affiliation !== 'none' ? n.affiliation(l.affiliation) : 'none'}`,
        ...(played ? ['Played by the Detective.'] : []),
        ...(discarded ? ['In the Detective’s discard pile.'] : []),
        // Why it is out, in the engine's words. Universe rules nothing out.
        ...(why ? [`Ruled out — ${why}.`] : []),
        ...(isHideout ? ['This is your safehouse.'] : []),
      ],
    };
  },

  resolveReportMove(legalMoves: LegalMove[]): LegalMove | null {
    return legalMoves.find((m) => m.move['type'] === 'resolve_report') ?? null;
  },

  /**
   * Two setup choices, both session options the engine takes: which role
   * the host plays (the engine's `detective` option names the Detective's
   * player id; the other seat is the Hacker), and the one rules variant
   * (when Overclock grants the Detective two Location draws).
   */
  setupFields(reference: GameReferenceResponse, _seats?: SetupSeat[]): SetupField[] {
    const schema = reference.optionsSchema;
    const props = isObj(schema) && isObj(schema['properties']) ? schema['properties'] : {};
    const fields: SetupField[] = [];
    if (isObj(props['detective'])) {
      fields.push({
        kind: 'choice', key: 'role', label: 'Your role',
        help: 'The Detective goes first and hunts the leads; the Hacker hides the truth. The other seat takes the other role.',
        options: [
          { value: 'detective', label: 'Detective', hint: 'Chase leads across the city and name the hideout.' },
          { value: 'hacker', label: 'Hacker', hint: 'Keep your hideout hidden and clear your name.' },
        ],
      });
    }
    const timing = isObj(props['overclock_draw_timing']) ? props['overclock_draw_timing'] : null;
    const values = timing && Array.isArray(timing['enum']) ? timing['enum'].map((v) => String(v)) : [];
    if (values.length > 0) {
      fields.push({
        kind: 'choice', key: 'overclock_draw_timing', label: 'Overclock: when the Detective draws the two Locations',
        help: typeof timing?.['description'] === 'string' ? timing['description'] : undefined,
        options: values.map((v) => ({ value: v, label: words(v) })),
      });
    }
    return fields;
  },

  setupOptions(answers: SetupAnswers, seats: SetupSeat[]): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    const role = answers['role'];
    const host = seats.find((s) => s.host);
    const other = seats.find((s) => !s.host);
    if ((role === 'detective' || role === 'hacker') && host && other) {
      // Universe names seats p1..pN by position; the Detective is the host's
      // seat or the other one.
      out['detective'] = `p${(role === 'detective' ? host : other).position + 1}`;
    }
    const v = answers['overclock_draw_timing'];
    if (typeof v === 'string' && v) out['overclock_draw_timing'] = v;
    return out;
  },

};

export default cybernoirGlue;
