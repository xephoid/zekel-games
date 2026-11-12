// Adventurer Olympics glue: the hex map of 7-hex tiles, the four decks and
// the tile stack, the rune supply and the quests, each seat's tableau, and
// this seat's companions, monsters and runes along the bench. The view is
// the engine's (zekel src/games/adventurer-olympics/views.ts); every rule
// comes from it: legal steps and slots from the legal moves, a tile's hexes
// and where its icons land from the view's placement options, stats from the
// view. Nothing here works out a rule. Plan: docs/implementation-plan.md §18;
// look: docs/design/adventurer-olympics/.
//
// Hex keys are the engine's axial "q,r" (its N is (1,-1)); the map primitive
// draws flat-topped axial hexes, so each key is redrawn at (q + r, -q).
// That is a change of drawing axes, not a rule.
//
// Exploring is put together on screen before it is sent: tap a glowing slot,
// turn the tile, press Place. Those taps change GlueInput.ui only; Place
// sends the one listed move for that slot and turn.

import type { CardData, TableauData } from '@zekel/primitives';
import type { GameReferenceResponse } from '@zekel/wire-types';
import type {
  FormField, GlueInput, GlueModule, LegalMove, MoveForm, PlanPrompt, PromptAction, SelectEvent,
  SetupAnswers, SetupField, SetupSeat, TablePlan, Zone,
} from '@zekel/glue-kit';
import { asArr, asNum, asStr, isObj, shapeHas } from '@zekel/glue-kit';
import { answerText } from '@zekel/glue-kit';
import { iconUrl } from './icons.js';
import './ao.css';
import { AoScreen } from './AoScreen.js';
import {
  ADVENTURERS, COLOURS, COMPANION_ART, DECKS, DUNGEON_CARD, GAME, ICON, LAND, MONSTER_ART, PALETTE, PLAYER_COLOUR, PlacementSlot, Player, RefCard, STAT_WORD, adventurerOf, bonusText, cardFor, colourKey, composing, find, hexOf, mapNodes, nameOrColour, pendingOf, placeMove, placementOf, players, questNames, refCards, runeCard, targetOf, tint, typeOf,
} from './read.js';

// ---- the prompt --------------------------------------------------------------

function prompt(view: Record<string, unknown>, input: GlueInput, me: Player | undefined): PlanPrompt | undefined {
  const p = pendingOf(view);
  if (!p || p.seat !== input.playerId || !me) return undefined;
  const pay = p.payload;
  const actions: PromptAction[] = [];
  const add = (id: string, label: string, m: LegalMove | null, primary = false) => { if (m) actions.push({ id, label, move: m, primary }); };
  switch (p.kind) {
    case 'setup_standee_colour': {
      const moves = input.legalMoves.filter((m) => typeOf(m) === 'setup_standee');
      if (moves.length) actions.push({ id: 'setup', label: 'Choose', moves, primary: true });
      return { title: 'Pick your adventurer and colour', sub: 'Any adventurer can take any colour. Your coins are your colour.', actions };
    }
    case 'roll':
      if (pay['rollKind'] === 'turn_order') {
        return { title: 'Roll for turn order', sub: 'Everyone rolls 2 dice. Highest goes first; a tie rolls again.', actions };
      }
      return {
        title: `Beat ${asNum(pay['number'])}`,
        sub: `Roll ${asNum(pay['diceCount'])} ${asNum(pay['diceCount']) === 1 ? 'die' : 'dice'}, one for each point of your ${pay['test'] === 'recruit' ? 'Charisma' : 'Strength'}. Equal or higher wins.`,
        actions,
      };
    case 'draw': {
      const deck = asStr(pay['deck']);
      if (deck === 'tile') {
        return pay['context'] === 'forced'
          ? { title: 'Every icon is done: explore first', sub: 'Turn over the top tile, then place it in any empty slot touching the map. Then take your turn.', actions }
          : { title: 'Map card: explore anywhere', sub: 'Turn over the top tile and place it in any empty slot touching the map.', actions };
      }
      const titles: Record<string, string> = { companion: 'City · make a friend', little: 'Little Monster · fight!', big: 'Big Monster · fight!', dungeon: 'Dungeon' };
      const subs: Record<string, string> = {
        companion: 'Draw the top Companion card, then roll your Charisma in dice.',
        little: 'Draw the top Little Monster card, then roll your Strength in dice.',
        big: 'Draw the top Big Monster card, then roll your Strength in dice.',
        dungeon: 'Draw a Dungeon card and do what it says.',
      };
      return { title: pay['dungeon'] ? 'Dungeon · the card asks for a test' : titles[deck] ?? 'Draw', sub: subs[deck], actions };
    }
    case 'move': {
      add('explore', 'Explore · turn over a tile', find(input, (m) => typeOf(m) === 'explore' && m.move['slot'] === undefined));
      add('stop', 'End turn', find(input, (m) => typeOf(m) === 'stop'), true);
      return {
        title: `Your turn · ${me.stepsLeft} step${me.stepsLeft === 1 ? '' : 's'} left`,
        sub: 'Tap a glowing hex to step. An icon starts the moment you step on it, and ends your turn.',
        actions,
      };
    }
    case 'try_again': {
      add('stay', 'Stay and try again', find(input, (m) => typeOf(m) === 'try_again'), true);
      add('explore', 'Explore instead', find(input, (m) => typeOf(m) === 'explore' && m.move['slot'] === undefined));
      add('stop', 'Do nothing this turn', find(input, (m) => typeOf(m) === 'stop'));
      return { title: 'You failed here last turn', sub: 'Stay and try again with a fresh card, walk away (tap a glowing hex), or explore.', actions };
    }
    case 'explore_place': {
      const place = placementOf(view);
      const pick = composing(input);
      if (!pick) {
        return {
          title: `Place Tile ${place?.tileId ?? asNum(pay['tileId'])}`,
          sub: pay['context'] === 'ordinary' ? 'Tap a glowing slot next to you.' : 'Tap any glowing slot touching the map.',
          actions,
        };
      }
      actions.push({ id: 'left', label: 'Turn left', ui: { rotation: (pick.rotation + 1) % 6 } });
      actions.push({ id: 'right', label: 'Turn right', ui: { rotation: (pick.rotation + 5) % 6 } });
      add('place', 'Place tile', placeMove(input, pick.slot, pick.rotation), true);
      return { title: `Turn Tile ${place?.tileId ?? asNum(pay['tileId'])}, then place it`, sub: 'Turn it any of 6 ways, or tap another slot. Your coin goes on its centre.', actions };
    }
    case 'take_artifact': {
      for (const m of input.legalMoves) {
        if (typeOf(m) === 'take_artifact') {
          const a = asStr(m.move['artifact']);
          const from = asStr(m.move['from']);
          const holder = players(view).find((pl) => pl.id === from);
          actions.push({ id: `take:${a}:${from}`, label: `${ICON[a]?.name ?? a} · ${from === 'supply' ? 'supply' : `from ${holder?.name || from}`}`, move: m });
        }
      }
      add('decline', 'No thanks, draw again', find(input, (m) => typeOf(m) === 'decline_artifact'));
      return { title: 'Any rune', sub: 'Take one suit rune from the supply or another player, or say no and draw another Dungeon card.', actions };
    }
    default:
      return undefined;
  }
}

// ---- the plan ----------------------------------------------------------------

function plan(input: GlueInput): TablePlan | null {
  const { view } = input;
  if (!shapeHas(view, 'map', 'players', 'decks') || !isObj(view['map'])) return null;
  const all = players(view);
  if (all.length === 0) return null;
  const me = all.find((p) => p.id === input.playerId);
  const decks = isObj(view['decks']) ? view['decks'] : {};
  const pend = pendingOf(view);
  const quests = questNames(view);

  const board: Zone[] = [
    { kind: 'map', id: 'ao:map', data: { hex: { orientation: 'flat' }, fill: { minHeight: 240 }, nodes: mapNodes(view, input, all) } },
  ];
  for (const d of DECKS) {
    board.push({ kind: 'card-zone', id: `ao:deck:${d.key}`, span: 'row', data: { label: d.label, mode: 'pile', size: 'small', countOnly: asNum(decks[d.key]) } });
  }
  board.push({ kind: 'card-zone', id: 'ao:deck:tile', span: 'row', data: { label: 'Map tiles', mode: 'pile', size: 'small', countOnly: asNum(decks['tileStack']) } });

  // The card being tested and the Dungeon card it came from, flown from their decks.
  const drawn: CardData[] = [];
  const res = isObj(view['dungeonResolving']) ? view['dungeonResolving'] : null;
  if (res) drawn.push({ id: `ao:dungeon-card:${asStr(res['kind'])}`, label: DUNGEON_CARD[asStr(res['kind'])] ?? asStr(res['kind']), subtitle: 'Dungeon card', colorKey: 'dungeon', artUrl: iconUrl('dungeon', { wobble: false }) });
  if (pend?.kind === 'roll' && pend.payload['rollKind'] === 'test' && pend.payload['cardId']) drawn.push(cardFor(view, asStr(pend.payload['cardId'])));
  const drawnFrom = pend?.payload['test'] === 'recruit' ? 'ao:deck:companion' : pend?.payload['test'] === 'big' ? 'ao:deck:big' : pend?.payload['test'] === 'little' ? 'ao:deck:little' : 'ao:deck:dungeon';
  board.push({ kind: 'card-zone', id: 'ao:drawn', span: 'row', arriveFrom: drawnFrom, data: { label: 'Drawn', mode: 'row', cards: drawn, empty: drawn.length ? 0 : 1 } });


  // ---- seats ----
  const active = asStr(view['activeSeat']);
  const tableau = (p: Player): TableauData => ({
    label: `${p.id === input.playerId ? 'You' : p.name} · ${adventurerOf(all, p.id)}`,
    owner: colourKey(p.colour), active: p.id === active, activeLabel: p.id === input.playerId ? 'your turn' : undefined,
    artUrl: iconUrl(adventurerOf(all, p.id).toLowerCase(), { tint: tint(p.colour), wobble: false }),
    stats: [
      ...(p.stats ? [
        { label: 'Charisma', value: p.stats.charisma },
        { label: 'Strength', value: p.stats.strength },
        { label: 'Movement', value: p.stats.movement },
      ] : []),
      { label: 'Quest points', value: p.questPoints },
      ...(p.id === input.playerId ? [] : [
        { label: 'Companions', value: p.companions.length },
        { label: 'Monsters', value: `${p.little.length} little, ${p.big.length} big` },
        { label: 'Runes', value: p.artifacts.map((a) => ICON[a]?.name ?? a).join(', ') || 'none' },
      ]),
      { label: 'Tiles explored', value: p.exploredTiles.length },
      { label: 'Dungeons done', value: p.dungeonsCompleted },
    ],
  });
  const side: Zone[] = [];
  const bench: Zone[] = [];
  const order = [...all].sort((a, b) => (a.initiative || 99) - (b.initiative || 99));
  for (const p of order) {
    if (p.id === input.playerId) continue;
    side.push({ kind: 'tableau', id: `ao:seat:${p.id}`, data: tableau(p) });
  }
  // The runes still in the supply (the rest are on the seats' tableaux).
  const supply = asArr(view['artifactSupply']).map((x) => asStr(x));
  side.push({ kind: 'card-zone', id: 'ao:supply', data: { label: 'Rune supply', mode: 'row', size: 'small', cards: supply.map((a) => runeCard(a)), empty: supply.length ? 0 : 1 } });
  // The quests in play: who claimed each, or the counts for an end-of-game one.
  const inPlay = isObj(view['inPlayQuests']) ? view['inPlayQuests'] : {};
  const count: Record<string, (p: Player) => number> = {
    most_little_monsters: (p) => p.little.length, most_big_monsters: (p) => p.big.length, most_artifacts: (p) => p.artifacts.length,
  };
  side.push({
    kind: 'card-zone', id: 'ao:quests',
    data: {
      label: 'Quests in play', mode: 'list',
      cards: Object.entries(inPlay).map(([kind, who]) => {
        const q = quests[kind];
        const holder = all.find((p) => p.id === who);
        const counts = count[kind];
        return {
          id: `ao:quest:${kind}`, label: q?.name ?? kind, colorKey: 'quest', artUrl: iconUrl('quest', { wobble: false }),
          subtitle: holder ? `Claimed by ${holder.name || holder.id}` : q?.endGame ? 'End of game · a tie scores nothing' : 'First to do it',
          ...(counts ? { counts: all.map((p) => ({ label: p.name || p.id, value: counts(p), own: p.id === input.playerId })) } : {}),
        };
      }),
    },
  });

  if (me) {
    bench.push({ kind: 'tableau', id: `ao:seat:${me.id}`, data: tableau(me) });
    bench.push({ kind: 'card-zone', id: 'ao:mine:companions', arriveFrom: 'ao:drawn', data: { label: 'Companions', mode: 'row', cards: me.companions.map((c) => cardFor(view, c)), empty: me.companions.length ? 0 : 1 } });
    bench.push({ kind: 'card-zone', id: 'ao:mine:monsters', arriveFrom: 'ao:drawn', data: { label: 'Monsters beaten', mode: 'row', cards: [...me.little, ...me.big].map((c) => cardFor(view, c)), empty: me.little.length + me.big.length ? 0 : 1 } });
    bench.push({ kind: 'card-zone', id: 'ao:mine:runes', arriveFrom: 'ao:supply', data: { label: 'Runes', mode: 'row', size: 'small', cards: me.artifacts.map((a) => runeCard(a)), empty: me.artifacts.length ? 0 : 1 } });
  }

  // Quest points, one space per quest in play.
  const top = Object.keys(inPlay).length;
  const points: Zone = {
    kind: 'track', id: 'ao:points',
    data: {
      label: 'Quest points',
      spaces: Array.from({ length: top + 1 }, (_, i) => ({
        index: i, label: String(i),
        pieces: all.filter((p) => p.questPoints === i).map((p) => ({ label: `qp:${p.id}`, colorKey: colourKey(p.colour) })),
      })),
    },
  };

  const ending = asNum(view['endingPhase']);
  const status = `Round ${asNum(view['round'], 1)}${ending === 1 ? ' · the last tile is placed' : ending === 2 ? ' · the final round' : ''}`;
  // The game draws its own screen (AoScreen), which puts turn order, the seats
  // and the quests in the side column itself; the table draws a plan's side
  // zones and points track even beside a screen, so the plan gives none.
  void side; void points;
  return { board, bench, side: [], palette: PALETTE, title: 'Adventurer Olympics', titleArt: iconUrl('quest', { wobble: false }), status, prompt: prompt(view, input, me) };
}

// ---- the glue -------------------------------------------------------------------

export const adventurerOlympicsGlue: GlueModule = {
  gameId: GAME,
  title: 'Adventurer Olympics',

  plan,

  themeFor: () => 'ao-theme',

  // The table is drawn by the game (plan §18, "becomes a game-drawn screen");
  // plan() still gives the title and the status line.
  Screen: AoScreen,
  placesCaption: true,

  /** "Your turn · 3 steps left" while you move, as the canvas's top bar says. */
  yourTurnLabel(input: GlueInput): string | null {
    const view = isObj(input.view) ? input.view : null;
    const p = view ? pendingOf(view) : null;
    if (!view || !p || p.seat !== input.playerId) return null;
    const me = players(view).find((x) => x.id === input.playerId);
    if ((p.kind === 'move' || p.kind === 'try_again') && me) return `Your turn · ${me.stepsLeft} step${me.stepsLeft === 1 ? '' : 's'} left`;
    return 'Your turn';
  },

  litParts(input: GlueInput): string[] {
    const lit: string[] = [];
    for (const m of input.legalMoves) {
      const to = targetOf(m);
      if (to) lit.push(`ao:hex:${to}`);
    }
    const view = isObj(input.view) ? input.view : null;
    const place = view && pendingOf(view)?.kind === 'explore_place' ? placementOf(view) : null;
    if (place) for (const s of place.slots) for (const h of s.hexes) lit.push(`ao:slot:${s.slot}:${h}`);
    return [...new Set(lit)];
  },

  uiForSelect(sel: SelectEvent, input: GlueInput): Record<string, unknown> | null {
    const m = /^ao:slot:(.+):(-?\d+,-?\d+)$/.exec(sel.id);
    if (!m) return null;
    const slot = m[1]!;
    const view = isObj(input.view) ? input.view : null;
    const place = view ? placementOf(view) : null;
    if (!place?.slots.some((s) => s.slot === slot)) return null;
    // A new slot starts the tile the way it is printed; the player turns it.
    return composing(input)?.slot === slot ? null : { slot, rotation: 0 };
  },

  moveForSelect(sel: SelectEvent, input: GlueInput): LegalMove | null {
    const all = adventurerOlympicsGlue.movesForSelect!(sel, input);
    return all.length === 1 ? all[0]! : null;
  },

  movesForSelect(sel: SelectEvent, input: GlueInput): LegalMove[] {
    const hex = /^ao:hex:(-?\d+,-?\d+)$/.exec(sel.id);
    if (hex) return input.legalMoves.filter((m) => targetOf(m) === hex[1]);
    return [];
  },

  detailFor(sel: SelectEvent, input: GlueInput): { title: string; lines: string[] } | null {
    const view = isObj(input.view) ? input.view : null;
    if (!view) return null;
    const card = /^ao:card:(.+)$/.exec(sel.id);
    if (card) {
      const c = cardFor(view, card[1]!);
      return { title: c.label, lines: [c.subtitle ?? '', c.cost !== undefined ? `Number to beat: ${c.cost}` : ''].filter(Boolean) };
    }
    return null;
  },

  formFor(move: LegalMove, input: GlueInput): MoveForm | null {
    if (typeOf(move) !== 'setup_standee') return null;
    // The colours still free are the listed moves; the adventurer is the player's to name.
    const colours = input.legalMoves.filter((m) => typeOf(m) === 'setup_standee').map((m) => asStr(m.move['colour'])).filter(Boolean);
    const fields: FormField[] = [
      { kind: 'choice', key: 'standee', label: 'Your adventurer', options: ADVENTURERS.map((a) => ({ value: a, label: a })) },
      { kind: 'choice', key: 'colour', label: 'Your colour', options: colours.map((c) => ({ value: c, label: c })) },
    ];
    return {
      title: 'Pick your adventurer and colour',
      help: 'Any adventurer can take any colour. Your coins are your colour.',
      fields,
      template: move,
      editableKeys: ['standee', 'colour'],
      submitLabel: 'Take my seat',
      build(answers) {
        const standee = answerText(answers, 'standee');
        const colour = answerText(answers, 'colour');
        if (!standee || !colour) return null;
        return { ...move.move, standee, colour };
      },
    };
  },

  resolveReportMove(legalMoves: LegalMove[]): LegalMove | null {
    return legalMoves.find((m) => typeOf(m) === 'resolve_report') ?? null;
  },

  /**
   * Against the AI the host picks their adventurer and colour here; the AI
   * seats take colours nobody chose (the engine asks humans first). With a
   * friend at the table every person picks their own at the table.
   */
  setupFields(_reference: GameReferenceResponse, seats?: SetupSeat[]): SetupField[] {
    if (!seats || seats.some((s) => s.kind === 'human' && !s.host)) return [];
    return [
      { kind: 'choice', key: 'standee', label: 'Your adventurer', help: 'Fighter, Ranger, Wizard or Rogue. Only the picture differs.', options: ADVENTURERS.map((a) => ({ value: a, label: a })) },
      { kind: 'choice', key: 'colour', label: 'Your colour', help: 'Your coins and the base you stand on.', options: COLOURS.map((c) => ({ value: c, label: c })) },
    ];
  },

  setupMoves(answers: SetupAnswers): Array<Record<string, unknown>> {
    const standee = answers['standee'];
    const colour = answers['colour'];
    return typeof standee === 'string' && standee && typeof colour === 'string' && colour
      ? [{ type: 'setup_standee', standee, colour }]
      : [];
  },

  // The screen draws the dice in its test panel, from the view's last roll.

  endStat(input: GlueInput) {
    if (!isObj(input.view)) return null;
    const all = players(input.view);
    return { label: 'Quest points', values: Object.fromEntries(all.map((p) => [p.id, String(p.questPoints)])) };
  },
};

export default adventurerOlympicsGlue;
