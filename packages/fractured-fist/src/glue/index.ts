// Fractured Fist glue, after docs/design/fractured-fist-arcade/ and
// docs/games/fractured-fist-arcade-build.md. The table draws its own screen
// (ff/FfScreen.tsx): both fighters' plates at the top, facing each other,
// their played row, the strike gutter, your played row, the action bar, and
// your hand under the play column; the supply list, the last move and the
// log fill the side column. Reading the view is ff/read.ts; the strike is a
// moment. The owner chose a game-drawn screen over a new TablePlan field on
// 2026-09-29.

import type { GameReferenceResponse } from '@zekel/wire-types';
import type {
  GlueModule, GlueInput, LegalMove, MomentInput, SelectEvent, SetupField, TablePlan, Zone, SetupSeat,
} from '@zekel/glue-kit';
import { asArr, asNum, asStr, isObj, shapeHas, words } from '@zekel/glue-kit';
import { PALETTE, EFFECT_ORDER, EFFECT_WORDS, artUrlFor, cardDefs, colorKeyFor, effectChips, fightOf, litPartsFor, moveForTap, starterLoadout, type CardDef } from './read.js';
import { FfScreen } from './FfScreen.js';
import { StrikeOverlay, type StrikeMoment } from './StrikeMoment.js';
import './ff.css';

/** A card's colored corner and the color of the cost on it, from the palette. */
function cornerFor(def: CardDef): { color: string; ink: string } | undefined {
  const key = colorKeyFor(def);
  const color = key ? PALETTE[key] : undefined;
  return color ? { color, ink: PALETTE[`ink-${key}`] ?? '#111111' } : undefined;
}

export const fracturedFistGlue: GlueModule = {
  gameId: 'fractured-fist',
  title: 'Fractured Fist',
  Screen: FfScreen,
  /** The phone boards (docs/design/fractured-fist-arcade, Phone-*): the
   *  table stacked, the side column in sheets, a card up close on a tap. */
  phone: true,

  /** The arcade theme (docs/design/fractured-fist-arcade): the table's own
   *  look, for every seat and for a watcher, once the view is this game's. */
  themeFor(input: GlueInput): string | null {
    return shapeHas(input.view, 'players', 'phase', 'player_order') ? 'ff-theme' : null;
  },

  plan(input: GlueInput): TablePlan | null {
    const f = fightOf(input);
    if (!f) return null;
    // The screen draws the table from the same reading. The plan's zones
    // say where each thing is (their row and yours on the board, your hand
    // on the bench); the side is left empty because the table draws a
    // plan's side zones even beside a screen, and the screen puts the
    // supply there itself.
    const board: Zone[] = [f.right.zones.played, f.left.zones.played];
    const bench: Zone[] = f.me ? [f.me.zones.hand, f.me.zones.deck, f.me.zones.discard] : [];
    const status = `Round ${f.round} · ${f.over ? 'over' : `${words(f.phase)} step`}`;
    return { board, bench, side: [], palette: PALETTE, title: 'Fractured Fist', status, statusShort: `R${f.round}`, steps: f.steps, prompt: f.prompt };
  },

  litParts(input: GlueInput): string[] {
    return litPartsFor(input);
  },

  moveForSelect(sel: SelectEvent, input: GlueInput): LegalMove | null {
    return moveForTap(sel, input);
  },

  resolveReportMove(legalMoves: LegalMove[]): LegalMove | null {
    return legalMoves.find((m) => m.move['type'] === 'resolve_report') ?? null;
  },

  /**
   * The strike: the round ended between the view on screen and the one
   * arriving. What each player queued and what stood in the way come from
   * the view before; what got through is the stamina the engine took off.
   */
  Moment: StrikeOverlay,
  momentFor(input: MomentInput): StrikeMoment | null {
    const { before, after } = input;
    if (!shapeHas(before, 'players', 'round', 'player_order') || !shapeHas(after, 'players', 'round')) return null;
    const struck = asNum(after['round']) > asNum(before['round']) || (asStr(after['phase']) === 'game_over' && asStr(before['phase']) !== 'game_over');
    if (!struck) return null;
    const order = asArr(before['player_order']).map((x) => asStr(x));
    const bp = isObj(before['players']) ? before['players'] : {};
    const ap = isObj(after['players']) ? after['players'] : {};
    const lanes = order.map((pid) => {
      const target = order.find((x) => x !== pid) ?? pid;
      const a = isObj(bp[pid]) ? (bp[pid] as Record<string, unknown>) : {};
      const tBefore = isObj(bp[target]) ? (bp[target] as Record<string, unknown>) : {};
      const tAfter = isObj(ap[target]) ? (ap[target] as Record<string, unknown>) : {};
      const wasAt = asNum(tBefore['stamina']);
      const nowAt = asNum(tAfter['stamina'], wasAt);
      return {
        attacker: pid, target,
        hit: asNum(a['damage_queued']), shield: asNum(tBefore['defense_queued']),
        through: Math.max(0, wasAt - nowAt),
        before: wasAt, after: nowAt, max: asNum(tBefore['max_stamina']),
      };
    });
    return {
      kind: 'strike', key: `strike:${asNum(before['round'])}`,
      title: `Round ${asNum(before['round'])} · strike`,
      lanes, over: asStr(after['phase']) === 'game_over',
    };
  },

  setupFields(reference: GameReferenceResponse, _seats?: SetupSeat[]): SetupField[] {
    // The loadout is a printed-rules decision: the seven techniques in play.
    // The engine's options schema names the option; its reference data
    // lists every technique, its school, its effects and the default seven.
    // The player picks; nothing is preselected, the default is a button.
    const schema = reference.optionsSchema;
    const props = isObj(schema) && isObj(schema['properties']) ? schema['properties'] : {};
    if (!('loadout' in props)) return [];
    const defs = cardDefs(reference);
    const techniques = [...defs.values()].filter((c) => c.type === 'TECHNIQUE');
    if (techniques.length === 0) return [];
    const loadoutSchema = isObj(props['loadout']) ? props['loadout'] : {};
    const help = asStr(loadoutSchema['description']).split('.').slice(0, 1).join('.') || undefined;
    const starter = starterLoadout(reference).filter((id) => defs.has(id));
    const factions = [...new Set(techniques.map((c) => c.faction ?? ''))];
    const groups = factions.map((f) => ({
      key: f || 'none',
      label: f ? words(f) : 'No school',
      note: f ? undefined : 'open to anyone',
      // A school goes by its own color (the cost number's on the printed card).
      color: f ? PALETTE[`ink-${f.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`] : PALETTE['technique'],
    }));
    return [{
      key: 'loadout',
      label: 'Choose the 7 techniques in play',
      help,
      kind: 'multi',
      pick: 7,
      noun: 'technique',
      groups,
      preset: starter.length ? { label: 'Use the default seven', values: starter } : undefined,
      options: techniques.map((c) => ({
        value: c.id,
        label: c.name,
        group: c.faction ?? 'none',
        badge: String(c.cost),
        chips: effectChips(c),
        tag: starter.includes(c.id) ? 'default seven' : undefined,
        art: artUrlFor(c.id),
        corner: cornerFor(c),
        hint: `cost ${c.cost}${c.description ? ` · ${c.description}` : ''}${c.faction ? ` · ${words(c.faction)}` : ''}`,
      })),
      summarize: (values) => {
        const picked = values.map((v) => defs.get(v)).filter((d): d is CardDef => !!d);
        const sum: Record<string, number> = {};
        for (const d of picked) for (const [k, v] of Object.entries(d.effects)) sum[k] = (sum[k] ?? 0) + v;
        const chips = EFFECT_ORDER.filter((k) => sum[k]).map((k) => `${EFFECT_WORDS[k]} ${sum[k]}`);
        const costs = picked.map((d) => d.cost);
        const note = costs.length ? `Cheapest ${Math.min(...costs)} spirit, dearest ${Math.max(...costs)}.` : undefined;
        return { chips, note };
      },
    }];
  },
};

export default fracturedFistGlue;

// The rulebook page (rulebook/). For the rulebook alone, without react-dom,
// import `@zekel/fractured-fist/glue/rulebook` instead.
export { FfRulebook, type FfRulebookProps, readRulebook, type RulebookData } from './rulebook/index.js';
