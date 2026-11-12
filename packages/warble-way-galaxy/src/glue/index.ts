// Warble Way Galaxy glue: the character tableau, the crew row, the ship,
// items, the travel deck pile, the ruin grid, and the journey. Solo with no
// hidden zones (zekel src/games/warble-way-galaxy/views.ts). Every number
// shown comes from the view: crew capacity from ship.capacity, level
// progress from xp_to_next_level, the season finish lines from
// season_endings. Nothing here knows a threshold.

import type { CardData, GridData, TableauData } from '@zekel/primitives';
import type { GameReferenceResponse } from '@zekel/wire-types';
import type { FormField, GlueModule, GlueInput, LegalMove, MoveForm, SelectEvent, SetupAnswers, SetupField, SetupSeat, TablePlan, Zone } from '@zekel/glue-kit';
import { asArr, asNum, asStr, isObj, shapeHas, words } from '@zekel/glue-kit';
import { abilityWords, words as factWords } from './facts.js';
import { answerNumber, answerText } from '@zekel/glue-kit';
import { GLYPH, KIND, travelCard } from './cards.js';
import { faceUrl } from './faces.js';
import { WwScreen } from './WwScreen.js';
import './ww.css';

/** The twelve abilities as the reference data prints them: "SWA (Swashbuckling)". */
function abilityOptions(reference: GameReferenceResponse | null): Array<{ code: string; name: string; stat: string }> {
  const rd = reference?.referenceData;
  const stats = isObj(rd) && isObj(rd['stats']) ? rd['stats'] : {};
  const out: Array<{ code: string; name: string; stat: string }> = [];
  for (const [stat, list] of Object.entries(stats)) {
    for (const entry of asArr(list)) {
      const m = /^([A-Z]{3})\s*\((.+)\)$/.exec(asStr(entry));
      if (m) out.push({ code: m[1]!, name: m[2]!, stat });
    }
  }
  return out;
}

function raceOptions(reference: GameReferenceResponse | null): string[] {
  const rd = reference?.referenceData;
  return isObj(rd) ? asArr(rd['races']).map((r) => asStr(r)).filter(Boolean) : [];
}

function archetypeOptions(reference: GameReferenceResponse | null): Array<{ name: string; label: string }> {
  const rd = reference?.referenceData;
  return isObj(rd)
    ? asArr(rd['archetypes']).flatMap((a) => {
      if (!isObj(a) || typeof a['name'] !== 'string') return [];
      const scores = isObj(a['scores']) ? Object.entries(a['scores']).map(([k, v]) => `${abilityWords(reference, k)?.name ?? k} ${asNum(v)}`).join(' / ') : '';
      return [{ name: a['name'], label: `${a['name']} ${asStr(a['stars'])} ${asStr(a['difficulty'])} — ${scores}` }];
    })
    : [];
}

/** A Warble Way view: it has a phase and at least one of the captain's
 *  character, the ship or the travel deck (zekel views.ts getView). */
function isWarbleWayView(view: unknown): view is Record<string, unknown> {
  if (!shapeHas(view, 'phase')) return false;
  return 'travel_deck' in view || 'character' in view || 'ship' in view;
}

const PALETTE: Record<string, string> = {
  ship: '#4a6fa5',
  character: '#5fa873',
  crew: '#7a5fa8',
  danger: '#b4452f',
  credits: '#e6a23c',
  wall: '#2b2620',
  pit: '#8a8578',
  party: '#3E7C4F',
  attacker: '#b4452f',
  item: '#c9a227',
  // The travel cards' kinds (Cards.dc.html).
  recruit: '#4cc9b0',
  pirate: '#f07070',
  ruin: '#f2b544',
  hazard: '#ad90f7',
  job: '#6eaaff',
};

function crewCard(c: unknown, i: number): CardData {
  if (!isObj(c)) return { id: `ww:crew:${i}`, label: 'crew', colorKey: 'crew' };
  const anger = asNum(c['anger_tokens']);
  const art = faceUrl(asStr(c['race']));
  return {
    id: `ww:crew:${asStr(c['name'], String(i))}`,
    label: asStr(c['name'], 'crew'),
    subtitle: asStr(c['race']) || undefined,
    badges: anger > 0 ? [`anger ×${anger}`] : [],
    colorKey: 'crew',
    ...(art ? { artUrl: art } : {}),
  };
}

/** Parse the ruin board_rows ("row 3: # . . S …") into grid cells. */
function ruinGrid(ruin: Record<string, unknown>): Zone | null {
  const rows = asArr(ruin['board_rows']);
  if (rows.length === 0) return null;
  const cells: GridData['cells'] = [];
  let maxX = 0;
  rows.forEach((r, y) => {
    const glyphs = asStr(r).replace(/^row \d+:\s*/, '').trim().split(/\s+/);
    maxX = Math.max(maxX, glyphs.length - 1);
    glyphs.forEach((g, x) => {
      if (g === '.' || g === '') return;
      if (g === '#') cells.push({ x, y, terrain: 'wall' });
      else if (g === '~') cells.push({ x, y, terrain: 'pit' });
      else if (/^\d$/.test(g)) cells.push({ x, y, pieces: [{ label: g, colorKey: 'party' }] });
      else if (/^[a-z]$/i.test(g)) cells.push({ x, y, pieces: [{ label: g, colorKey: 'attacker' }] });
      else cells.push({ x, y, pieces: [{ label: g, colorKey: 'item' }] });
    });
  });
  return {
    kind: 'grid', id: 'ww:ruin',
    data: {
      label: `Ruin ${asStr(ruin['map'])} · round ${asNum(ruin['round'], 1)}`,
      extent: { minX: 0, minY: 0, maxX, maxY: rows.length - 1 },
      cells,
    },
  };
}

export const warbleWayGlue: GlueModule = {
  gameId: 'warble-way-galaxy',
  title: 'Warble Way Galaxy',
  /** The hologram logbook table (docs/design/warble-way-galaxy) draws its
   *  own screen, one part per board, and has a phone layout. The plan's
   *  zones stay the engine debug client's shape. */
  Screen: WwScreen,
  phone: true,
  // The last move's sentence sits on the board, beside the dice it rolled,
  // not at the foot of the side column where a result is easy to miss.
  placesCaption: true,

  /** The hologram logbook theme (docs/design/warble-way-galaxy): the table's
   *  own look, for the captain's seat and for a watcher, once the view is
   *  this game's. */
  themeFor(input: GlueInput): string | null {
    return isWarbleWayView(input.view) ? 'ww-theme' : null;
  },

  plan(input: GlueInput): TablePlan | null {
    const { view } = input;
    if (!isWarbleWayView(view)) return null;

    const char = isObj(view['character']) ? view['character'] : null;
    const ship = isObj(view['ship']) ? view['ship'] : null;
    const travel = isObj(view['travel_deck']) ? view['travel_deck'] : null;
    const journey = isObj(view['journey']) ? view['journey'] : null;
    const ruin = isObj(view['ruin']) ? view['ruin'] : null;
    const endings = isObj(view['season_endings']) ? view['season_endings'] : {};

    const bench: Zone[] = [];
    const side: Zone[] = [];
    const board: Zone[] = [];

    if (char) {
      const abilities = isObj(char['abilities']) ? char['abilities'] : {};
      const xp = asNum(char['xp']);
      const toNext = asNum(char['xp_to_next_level']);
      const face = faceUrl(asStr(char['race']));
      const stats: NonNullable<TableauData['stats']> = [
        { label: 'Level', value: asNum(char['level'], 1) },
        { label: 'XP to next level', value: xp, max: toNext > 0 ? xp + toNext : undefined },
        { label: 'Credits', value: asNum(char['credits']) },
        { label: 'Dread', value: asNum(char['dread']) },
        { label: 'Wounded', value: char['wounded'] ? 'yes' : 'no' },
        ...Object.entries(abilities).map(([k, v]) => ({
          label: isObj(v) ? asStr(v['name'], k.toUpperCase()) : k.toUpperCase(),
          value: isObj(v) ? asNum(v['effective'], asNum(v['natural'])) : asNum(v),
        })),
      ];
      side.push({
        kind: 'tableau', id: 'ww:character',
        data: { label: asStr(char['name'], 'You'), owner: 'character', active: true, stats, ...(face ? { artUrl: face } : {}) },
      });
      // The finish lines, as the engine spells them out.
      const endingStats = Object.entries(endings).map(([k, v]) => ({ label: words(k), value: asStr(v, String(v)) }));
      if (endingStats.length > 0) {
        side.push({ kind: 'tableau', id: 'ww:season', data: { label: 'Season', stats: endingStats } });
      }
    }
    const crew = asArr(view['crew']);
    const capacity = ship ? asNum(ship['capacity']) : 0;
    if (crew.length > 0 || asNum(view['unnamed_crew']) > 0) {
      const extra = asNum(view['unnamed_crew']);
      bench.push({
        kind: 'card-zone', id: 'ww:crew',
        data: {
          label: `Crew${capacity ? ` (${crew.length}/${capacity})` : ` (${crew.length})`}${extra ? ` +${extra} unnamed` : ''}`,
          mode: 'row', cards: crew.map(crewCard),
        },
      });
    }
    const items = asArr(view['items']);
    if (items.length > 0) {
      bench.push({
        kind: 'card-zone', id: 'ww:items',
        data: {
          label: 'Items', mode: 'fan',
          cards: items.map((it, i) => {
            const o = isObj(it) ? it : {};
            return {
              id: asStr(o['id'], `ww:item:${i}`),
              label: asStr(o['name'], 'item'),
              subtitle: asStr(o['type']) || undefined,
              badges: o['consumed'] ? ['used'] : [],
              colorKey: 'item',
            };
          }),
        },
      });
    }
    if (ship) {
      side.push({
        kind: 'tableau', id: 'ww:ship',
        data: {
          label: `Ship: ${asStr(ship['name'], 'ship')}`, owner: 'ship',
          stats: [
            { label: 'Damage', value: asStr(ship['damage'], String(ship['damage'] ?? '')) },
            ...(capacity ? [{ label: 'Capacity', value: capacity }] : []),
          ],
        },
      });
    }
    if (travel) {
      const discard = asArr(travel['discard']).map((x) => asStr(x));
      board.push({
        kind: 'card-zone', id: 'ww:travel-draw',
        data: { label: 'Travel deck', mode: 'pile', countOnly: asNum(travel['cards_in_draw_pile']) },
      });
      board.push({
        kind: 'card-zone', id: 'ww:travel-discard', arriveFrom: 'ww:travel-draw',
        data: {
          label: 'Discard', mode: 'pile',
          // Each discard shows its name and kind when the reference carries them (item 4).
          cards: discard.map((c, i) => {
            const face = travelCard(c, input.reference);
            return face
              ? { id: `ww:travel:${i}:${c}`, label: face.title, subtitle: `${GLYPH[face.suit]} ${face.rank} · ${KIND[face.kind].word}`, colorKey: face.kind }
              : { id: `ww:travel:${i}:${c}`, label: c, colorKey: 'ship' };
          }),
        },
      });
    }
    if (journey && asArr(journey['legs']).length > 0) {
      const legs = asArr(journey['legs']);
      board.push({
        kind: 'track', id: 'ww:journey',
        data: {
          label: 'Journey',
          spaces: legs.map((l, i) => {
            const o = isObj(l) ? l : {};
            return { index: i + 1, label: `${asNum(o['cards_remaining'])}`, filled: asStr(o['position']) === 'current' };
          }),
        },
      });
    }
    if (ruin) {
      const g = ruinGrid(ruin);
      if (g) board.push(g);
    }
    const habitat = isObj(view['habitat']) ? view['habitat'] : null;
    if (habitat) {
      board.push({
        kind: 'tableau', id: 'ww:habitat',
        data: {
          label: `Habitat ${asNum(habitat['number'], 1)}: ${asStr(habitat['name'])}`,
          stats: [
            { label: 'Shop', value: asArr(habitat['shop']).length },
            { label: 'Cantina', value: asArr(habitat['cantina']).length },
            { label: 'Missions', value: asArr(habitat['missions']).length },
          ],
        },
      });
    }
    const status = `${words(asStr(view['phase']))}${isObj(view['pending']) ? ` · ${words(asStr((view['pending'] as Record<string, unknown>)['kind']))}` : ''}`;
    // The table draws a plan's side zones even beside a screen, and the
    // screen draws its own sheet, ship and crew: the side rides with the board.
    return { board: [...board, ...side], bench, side: [], palette: PALETTE, title: 'Warble Way Galaxy', status };
  },

  litParts(input: GlueInput): string[] {
    const lit: string[] = [];
    for (const m of input.legalMoves) {
      const t = asStr(m.move['type']);
      const itemId = m.move['item_id'];
      if ((t === 'use_item' || t === 'equip') && typeof itemId === 'string') lit.push(itemId);
      const cell = m.move['to_cell'] ?? m.move['cell'];
      if (typeof cell === 'string') {
        const [x, y] = cell.split(',').map((n) => Number(n.trim()));
        if (Number.isFinite(x) && Number.isFinite(y)) lit.push(`ww:ruin:${x},${y}`);
      }
    }
    return [...new Set(lit)];
  },

  moveForSelect(sel: SelectEvent, input: GlueInput): LegalMove | null {
    const cell = /^ww:ruin:(\d+),(\d+)$/.exec(sel.id);
    return (
      input.legalMoves.find((m) => sel.id === (m.move['item_id'] as string)) ??
      (cell ? input.legalMoves.find((m) => {
        const c = asStr(m.move['to_cell'] ?? m.move['cell']).replace(/\s+/g, '');
        return c === `${cell[1]},${cell[2]}`;
      }) : undefined) ??
      null
    );
  },

  resolveReportMove(legalMoves: LegalMove[]): LegalMove | null {
    return legalMoves.find((m) => m.move['type'] === 'resolve_report') ?? null;
  },

  /** Character creation on the setup screen: the same questions as the
   *  table's form, answered before the season starts. */
  setupFields(reference: GameReferenceResponse, _seats?: SetupSeat[]): SetupField[] {
    const races = raceOptions(reference);
    const abilities = abilityOptions(reference);
    const archetypes = archetypeOptions(reference);
    const ct = factWords(reference, 'creation_text');
    if (races.length === 0 || abilities.length === 0) return [];
    const fields: SetupField[] = [
      { kind: 'text', key: 'character_name', label: 'Your character\'s name', maxLength: 40 },
      { kind: 'choice', key: 'race', label: 'Race', ...(ct['race'] ? { help: ct['race'] } : {}), options: races.map((r) => ({ value: r, label: words(r) })) },
      { kind: 'text', key: 'ship_name', label: 'Your ship\'s name', maxLength: 40 },
      {
        kind: 'choice', key: 'method', label: 'Ability scores',
        help: ct['scores'] ?? 'One score 3, one 2, one 1; or spread 6 points with none above 3; or an archetype card.',
        options: [{ value: 'recommended', label: 'One 3, one 2, one 1' }, { value: 'distribute', label: 'Spread 6 points' }, ...(archetypes.length ? [{ value: 'archetype', label: 'An archetype card' }] : [])],
      },
    ];
    // Each ability says what it does, in the engine's words, where its score
    // is chosen. A box left empty is an ability left at nothing.
    for (const a of abilities) {
      const w = abilityWords(reference, a.code);
      const help = w?.basic ? `${w.basic}${w.advanced ? ` At a natural 3, ${w.advanced.name}: ${w.advanced.what}` : ''}` : undefined;
      fields.push({ kind: 'number', key: `score.${a.code}`, label: `${a.name} (${a.code}, ${words(a.stat)})`, ...(help ? { help } : {}), min: 0, max: 3, optional: true });
    }
    if (archetypes.length) fields.push({ kind: 'choice', key: 'archetype_name', label: 'Archetype card', ...(ct['archetype'] ? { help: ct['archetype'] } : {}), options: archetypes.map((a) => ({ value: a.name, label: a.label })) });
    fields.push({ kind: 'choice', key: 'disposition', label: 'Disposition', help: ct['disposition'] ?? 'A roleplay hint, never a rule.', options: [
      { value: 'none', label: 'No hint' }, { value: 'brash', label: 'Brash' }, { value: 'risk_averse', label: 'Risk-averse' },
    ] });
    return fields;
  },

  setupMoves(answers: SetupAnswers, _seats: SetupSeat[], reference: GameReferenceResponse): Array<Record<string, unknown>> {
    const text = (k: string) => (typeof answers[k] === 'string' ? (answers[k] as string).trim() : '');
    const name = text('character_name'); const race = text('race'); const ship = text('ship_name');
    const method = text('method'); const disposition = text('disposition');
    if (!name || !race || !ship || !method) return [];
    const base: Record<string, unknown> = { type: 'create_character', character_name: name, race, ship_name: ship, method, ...(disposition && disposition !== 'none' ? { disposition } : {}) };
    if (method === 'archetype') {
      const card = text('archetype_name');
      return card ? [{ ...base, archetype_name: card }] : [];
    }
    const scores: Record<string, number> = {};
    for (const a of abilityOptions(reference)) {
      const v = Number(answers[`score.${a.code}`]);
      if (Number.isFinite(v) && v > 0) scores[a.code] = v;
    }
    return Object.keys(scores).length ? [{ ...base, scores }] : [];
  },

  /** Character creation: the engine lists two skeletons ("FILL IN the
   *  values the player chose"); each becomes a form with nothing filled in. */
  formFor(move: LegalMove, input: GlueInput): MoveForm | null {
    // The ruin's two templates (the screen fills them from taps; the menu
    // asks the same questions in words).
    if (move.move['type'] === 'move_being') {
      return {
        title: `Move ${asStr(move.move['being'])}`, help: move.description, template: move, editableKeys: ['to'], submitLabel: 'Move',
        fields: [{ kind: 'text', key: 'to', label: 'Destination square (row and column, like r5c3)', maxLength: 6 }],
        build(answers) { const to = (answerText(answers, 'to') ?? '').trim().toLowerCase(); return /^r\d+c\d+$/.test(to) ? { ...move.move, to } : null; },
      };
    }
    if (move.move['type'] === 'setup_encounter') {
      const view = isObj(input.view) ? input.view : {};
      const crew = asArr(view['crew']).filter(isObj).map((c) => asStr(c['name'])).filter(Boolean);
      const starts = (/start[_ ]location \(([^)]+)\)/.exec(move.description ?? '')?.[1] ?? '').split(/\s+or\s+/).map((x) => x.trim()).filter(Boolean);
      const spots = (/exactly 3 of: ([^)—]+)/.exec(move.description ?? '')?.[1] ?? '').split(',').map((x) => x.trim()).filter(Boolean);
      return {
        title: 'Set up the ruin', help: move.description, template: move, submitLabel: 'Enter',
        editableKeys: ['crew_names', 'include_character', 'start_location', 'threat_level', 'attacker_placements'],
        fields: [
          { kind: 'choice', key: 'include_character', label: 'Does the captain go in?', options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No, stays aboard' }] },
          ...(crew.length ? [{ kind: 'multi' as const, key: 'crew_names', label: 'Crew who go in', options: crew.map((c) => ({ value: c, label: c })), pick: crew.length }] : []),
          { kind: 'choice', key: 'start_location', label: 'Start spot', options: starts.map((x) => ({ value: x, label: x })) },
          { kind: 'choice', key: 'threat_level', label: 'Threat level', options: [1, 2, 3].map((n) => ({ value: String(n), label: `Threat ${n}` })) },
          { kind: 'multi', key: 'attacker_placements', label: 'Three attacker spots', options: spots.map((x) => ({ value: x, label: x })), pick: 3 },
        ],
        build(answers) {
          const inc = answerText(answers, 'include_character');
          const names = Array.isArray(answers['crew_names']) ? (answers['crew_names'] as unknown[]).map((x) => asStr(x)).filter(Boolean) : [];
          const start = answerText(answers, 'start_location');
          const threat = answerNumber(answers, 'threat_level');
          const placed = Array.isArray(answers['attacker_placements']) ? (answers['attacker_placements'] as unknown[]).map((x) => asStr(x)).filter(Boolean) : [];
          if (!inc || !start || threat === null || placed.length !== 3 || (inc === 'no' && names.length === 0)) return null;
          return { ...move.move, include_character: inc === 'yes', crew_names: names, start_location: start, threat_level: threat, attacker_placements: placed };
        },
      };
    }
    if (move.move['type'] !== 'create_character') return null;
    const method = asStr(move.move['method']);
    const races = raceOptions(input.reference);
    const abilities = abilityOptions(input.reference);
    const archetypes = archetypeOptions(input.reference);
    const common: FormField[] = [
      { kind: 'text', key: 'character_name', label: 'Character name', maxLength: 40 },
      { kind: 'choice', key: 'race', label: 'Race', options: races.map((r) => ({ value: r, label: words(r) })) },
      { kind: 'text', key: 'ship_name', label: 'Ship name', maxLength: 40 },
      { kind: 'choice', key: 'disposition', label: 'Disposition (a roleplay hint, never a rule)', options: [
        { value: 'none', label: 'No hint' }, { value: 'brash', label: 'Brash' }, { value: 'risk_averse', label: 'Risk-averse' },
      ] },
    ];
    if (method === 'archetype') {
      return {
        title: 'Create your character from an archetype card',
        help: move.description,
        fields: [...common, { kind: 'choice', key: 'archetype_name', label: 'Archetype card', options: archetypes.map((a) => ({ value: a.name, label: a.label })) }],
        template: move,
        editableKeys: ['character_name', 'race', 'ship_name', 'archetype_name', 'disposition'],
        submitLabel: 'Begin the season',
        build(answers) {
          const name = answerText(answers, 'character_name');
          const race = answerText(answers, 'race');
          const ship = answerText(answers, 'ship_name');
          const card = answerText(answers, 'archetype_name');
          const disposition = answerText(answers, 'disposition');
          if (!name || !race || !ship || !card || !disposition) return null;
          return { ...move.move, character_name: name, race, ship_name: ship, archetype_name: card, ...(disposition !== 'none' ? { disposition } : {}) };
        },
      };
    }
    const scoreFields: FormField[] = abilities.map((a) => ({
      kind: 'number', key: `score.${a.code}`, label: `${a.name} (${a.code}, ${words(a.stat)})`, min: 0, max: 3,
    }));
    return {
      title: 'Create your character',
      help: move.description,
      fields: [...common, ...scoreFields],
      template: move,
      editableKeys: ['character_name', 'race', 'ship_name', 'scores', 'disposition'],
      submitLabel: 'Begin the season',
      build(answers) {
        const name = answerText(answers, 'character_name');
        const race = answerText(answers, 'race');
        const ship = answerText(answers, 'ship_name');
        const disposition = answerText(answers, 'disposition');
        if (!name || !race || !ship || !disposition) return null;
        const scores: Record<string, number> = {};
        for (const a of abilities) {
          const v = answerNumber(answers, `score.${a.code}`);
          if (v !== null && v > 0) scores[a.code] = v;
        }
        if (Object.keys(scores).length === 0) return null;
        return { ...move.move, character_name: name, race, ship_name: ship, scores, ...(disposition !== 'none' ? { disposition } : {}) };
      },
    };
  },

  diceFor(event) {
    // An engine that reads the last roll back in its view has the screen
    // draw the dice, in their pairs, beside the result; the table's own row
    // of dice is for an engine that does not.
    if (isObj(event.view) && 'last_roll' in event.view) return null;
    const m = event.engineMove;
    const dice = m && Array.isArray(m['dice']) ? m['dice'] : null;
    if (dice) return dice.map((d) => asNum(d)).filter((n) => n > 0);
    const found = /rolled?\s+(\d(?:\s*[,+]\s*\d)*)/i.exec(event.summary);
    if (!found) return null;
    return found[1]!.split(/[,+]/).map((s) => Number(s.trim())).filter((n) => n >= 1 && n <= 6);
  },
};

export default warbleWayGlue;

// The theme's icons, holograms, faces and travel cards on their own, for a
// page that shows them (Zekel Universe's /dev/ww). Universe may load only
// this entry of a game, so they go out through it.
export * as warbleWayGallery from './gallery.js';
