import { describe, it, expect } from 'vitest';
import { createInitialState, applyMove, autoReportMove } from '../engine.js';
import { getLegalMoves } from '../legalMoves.js';
import type { PlayerConfig } from '@zekel/game-kit';
import type { SweetlandsState, SweetlandsMove } from '../types.js';

const human = (id: string): PlayerConfig => ({ player_id: id, kind: 'human' });
const ai = (id: string): PlayerConfig => ({ player_id: id, kind: 'ai' });

/** Drive a human+AI session through setup into the play phase. */
function intoPlay(seed: number): SweetlandsState {
  let s = createInitialState([human('h'), ai('b')], { seed });
  expect(s.phase).toBe('setup_factions');
  s = applyMove(s, 'h', { type: 'assign_setup_choices', selections: { h: 'milkshake', b: 'fudge' } }).newState;
  s = applyMove(s, 'h', { type: 'choose_foe', foe: 'dragon' }).newState;
  // human keeps one of the two dealt secret objectives (AI auto-resolves)
  const secret = getLegalMoves(s, 'h').find((m) => m.move.type === 'choose_secret_objective')!.move;
  s = applyMove(s, 'h', secret).newState;
  expect(s.phase).toBe('setup_intel');
  // human reports their 3 starting Intel (synthesized from the server deck)
  s = applyMove(s, 'h', autoReportMove(s, 'h')!).newState;
  expect(s.phase).toBe('play');
  return s;
}

describe('human report-draw flow (mid-game)', () => {
  it('turn-start gain opens a report pending that blocks play until reported', () => {
    let s = intoPlay(7);
    expect(s.activePlayerId).toBe('h');
    s = applyMove(s, 'h', { type: 'recall', units: [] }).newState;
    // a report is now pending; the ONLY legal move is the report
    expect(s.pending?.kind).toBe('report_intel');
    const legal = getLegalMoves(s, 'h');
    expect(legal).toHaveLength(1);
    expect(legal[0]!.move.type).toBe('report_intel_draw');
    // playing before reporting is rejected
    expect(() => applyMove(s, 'h', { type: 'pass' })).toThrow(/report/i);
    // report it; play opens up
    s = applyMove(s, 'h', autoReportMove(s, 'h')!).newState;
    expect(s.pending).toBeNull();
    expect(s.players[0]!.turn.step).toBe('play');
    expect(getLegalMoves(s, 'h').some((m) => m.move.type === 'play_intel')).toBe(true);
  });

  it('accepts a reported treat by its PRINTED name, any case/spacing', () => {
    // The human reads "Chocolate Bar" off the card; the internal id is
    // 'chocolate_bar'. Reporting the printed name (any case/spacing) must
    // reconcile against the tracked deck — never force the underscore id.
    for (const spoken of ['chocolate_bar', 'chocolate bar', 'Chocolate Bar', 'CHOCOLATE-BAR', 'chocolate bar treat', 'the Chocolate Bar card']) {
      let s = intoPlay(7);
      s = applyMove(s, 'h', { type: 'recall', units: [] }).newState;
      expect(s.pending?.kind).toBe('report_intel');
      // force the pending to a single card and seed the deck with the treat
      if (s.pending?.kind === 'report_intel') s.pending.count = 1;
      s.intelDeck.unshift({ cardId: 'treat-chocolate_bar', kind: 'treat', treat: 'chocolate_bar' });
      const before = s.players[0]!.hand.length;
      s = applyMove(s, 'h', { type: 'report_intel_draw', cards: [{ kind: 'treat', treat: spoken }] } as SweetlandsMove).newState;
      expect(s.pending).toBeNull();
      expect(s.players[0]!.hand.length).toBe(before + 1);
      expect(s.players[0]!.hand.some((c) => c.kind === 'treat' && c.treat === 'chocolate_bar')).toBe(true);
    }
  });

  it('accepts a reported card with kind OMITTED (infers from fields)', () => {
    // The model's most natural output for "a red card" is {color:'red'} with no
    // kind; for a treat, {treat:'...'}. Reconcile must infer the kind rather than
    // reject. (Mirrors the live desync transcript that produced {color:'red'}.)
    let s = intoPlay(7);
    s = applyMove(s, 'h', { type: 'recall', units: [] }).newState;
    expect(s.pending?.kind).toBe('report_intel');
    if (s.pending?.kind === 'report_intel') s.pending.count = 1;
    s.intelDeck.unshift({ cardId: 'single-green-9', kind: 'single', color: 'green' });
    s = applyMove(s, 'h', { type: 'report_intel_draw', cards: [{ color: 'green' }] } as SweetlandsMove).newState;
    expect(s.pending).toBeNull();
    expect(s.players[0]!.hand.some((c) => c.kind === 'single' && c.color === 'green')).toBe(true);
  });

  it('the report template shows the per-card object shape (not an empty array)', () => {
    let s = intoPlay(7);
    s = applyMove(s, 'h', { type: 'recall', units: [] }).newState;
    const tmpl = getLegalMoves(s, 'h')[0]!;
    expect(tmpl.move.type).toBe('report_intel_draw');
    if (tmpl.move.type === 'report_intel_draw') {
      // skeleton seeds one example card object per drawn card, with a `kind` field
      expect(tmpl.move.cards.length).toBeGreaterThanOrEqual(1);
      expect(tmpl.move.cards[0]).toHaveProperty('kind');
      expect(tmpl.move.cards[0]).toHaveProperty('color');
    }
    // instruction spells out all three card shapes so the model can construct them
    expect(tmpl.description).toMatch(/kind.*single/);
    expect(tmpl.description).toMatch(/treat/);
  });

  it('collapses identical cards to one play option (no duplicate descriptions)', () => {
    let s = intoPlay(7);
    s = applyMove(s, 'h', { type: 'recall', units: [] }).newState;
    s = applyMove(s, 'h', autoReportMove(s, 'h')!).newState; // resolve turn-start gain
    // give the human TWO identical yellow singles
    s.players[0]!.hand = [
      { cardId: 'single-yellow-1', kind: 'single', color: 'yellow' },
      { cardId: 'single-yellow-2', kind: 'single', color: 'yellow' },
    ];
    const plays = getLegalMoves(s, 'h').filter((m) => m.move.type === 'play_intel');
    expect(plays.length).toBeGreaterThan(0);
    // no two legal moves share a description — the model can never be asked "which copy?"
    const descs = plays.map((m) => m.description);
    expect(new Set(descs).size).toBe(descs.length);
    // exactly one cardId is referenced (one representative copy)
    const ids = new Set(plays.map((m) => (m.move as { cardId?: string }).cardId));
    expect(ids.size).toBe(1);
  });

  it('caps a turn-start gain to the drawable pool (no unsatisfiable report)', () => {
    // A human who has hoarded most of the deck gains more Intel than remains
    // drawable. The report pending must cap to deck+discard — never demand cards
    // that do not exist (which would deadlock the report forever).
    let s = intoPlay(7);
    // move everything drawable into the human's hand: empty deck AND discard
    s.players[0]!.hand.push(...s.intelDeck, ...s.intelDiscard);
    s.intelDeck = [];
    s.intelDiscard = [];
    s = applyMove(s, 'h', { type: 'recall', units: [] }).newState;
    // nothing drawable → no report pending, turn proceeds straight to play
    expect(s.pending).toBeNull();
    expect(s.players[0]!.turn.step).toBe('play');

    // partial pool: exactly 1 drawable card but the gain wants more
    let s2 = intoPlay(7);
    const keep = s2.intelDeck[0]!;
    s2.players[0]!.hand.push(...s2.intelDeck.slice(1), ...s2.intelDiscard);
    s2.intelDeck = [keep];
    s2.intelDiscard = [];
    s2 = applyMove(s2, 'h', { type: 'recall', units: [] }).newState;
    if (s2.pending?.kind === 'report_intel') expect(s2.pending.count).toBeLessThanOrEqual(1);
  });

  it('a human Blue collect opens a report pending before the influence step', () => {
    let s = intoPlay(7);
    s = applyMove(s, 'h', { type: 'recall', units: [] }).newState;
    s = applyMove(s, 'h', autoReportMove(s, 'h')!).newState; // resolve turn-start gain
    // give the human a known Blue card and play it with the collect action
    s.players[0]!.hand.push({ cardId: 'blue-test', kind: 'single', color: 'blue' });
    s = applyMove(s, 'h', { type: 'play_intel', cardId: 'blue-test', unit: 'ambassador', takeAction: true } as SweetlandsMove).newState;
    expect(s.pending?.kind).toBe('report_intel');
    if (s.pending?.kind === 'report_intel') expect(s.pending.reason).toBe('collect');
    // still on the play step until the report resolves
    expect(s.players[0]!.turn.step).toBe('play');
    s = applyMove(s, 'h', autoReportMove(s, 'h')!).newState;
    expect(s.pending).toBeNull();
    expect(s.players[0]!.turn.step).toBe('influence');
  });

  it('get_legal_moves prompts the human to declare battleTotal for a Purple castle entry by the knight', () => {
    let s = intoPlay(7);
    s = applyMove(s, 'h', { type: 'recall', units: [] }).newState;
    s = applyMove(s, 'h', autoReportMove(s, 'h')!).newState;
    s.players[0]!.hand = [{ cardId: 'purple-test', kind: 'single', color: 'purple' }];
    // Knight at the road's final purple entrance: Purple play will enter the
    // castle and fight the undefeated foe.
    s.players[0]!.units.knight = { zone: 'road', region: 1, roadIndex: 5 };
    const purpleMoves = getLegalMoves(s, 'h').filter((m) => m.move.type === 'play_intel' && (m.move as any).cardId === 'purple-test' && (m.move as any).takeAction && (m.move as any).unit === 'knight');
    expect(purpleMoves.length).toBeGreaterThan(0);
    for (const m of purpleMoves) {
      expect((m.move as any).battleTotal).toBe(0);
      expect(m.description).toMatch(/battleTotal/);
    }
  });

  it('a human Purple castle entry battles the foe and requires battleTotal', () => {
    let s = intoPlay(7);
    s = applyMove(s, 'h', { type: 'recall', units: [] }).newState;
    s = applyMove(s, 'h', autoReportMove(s, 'h')!).newState;
    s.foe = { type: 'dragon', defeated: false };
    s.players[0]!.hand = [{ cardId: 'purple-test', kind: 'single', color: 'purple' }];
    s.players[0]!.units.knight = { zone: 'road', region: 1, roadIndex: 5 };
    s.players[0]!.sugarCubes = 6;
    // Without battleTotal the human move is incomplete.
    expect(() => applyMove(s, 'h', { type: 'play_intel', cardId: 'purple-test', unit: 'knight', takeAction: true } as SweetlandsMove)).toThrow(/battleTotal/);
    // With a declared total the server rolls the foe and resolves; knight enters castle.
    const r = applyMove(s, 'h', { type: 'play_intel', cardId: 'purple-test', unit: 'knight', takeAction: true, battleTotal: 18 } as SweetlandsMove);
    expect(r.newState.foe?.defeated).toBe(true);
    expect(r.newState.players[0]!.publicObjectivesScored).toContain('defeat_foe');
    expect(r.newState.players[0]!.units.knight).toEqual({ zone: 'castle' });
  });

  it('a human Red attack on the foe works only when the knight is already in the castle', () => {
    let s = intoPlay(7);
    s = applyMove(s, 'h', { type: 'recall', units: [] }).newState;
    s = applyMove(s, 'h', autoReportMove(s, 'h')!).newState;
    s.foe = { type: 'dragon', defeated: false };
    // Knight on the road: Red does NOT carry it into the castle or fight the foe.
    s.players[0]!.hand = [{ cardId: 'red-test', kind: 'single', color: 'red' }];
    s.players[0]!.units.knight = { zone: 'road', region: 1, roadIndex: 4 };
    const roadResult = applyMove(s, 'h', { type: 'play_intel', cardId: 'red-test', unit: 'knight', takeAction: true, battleTotal: 18 } as SweetlandsMove);
    expect(roadResult.newState.foe?.defeated).toBe(false);
    expect(roadResult.newState.players[0]!.units.knight).toEqual({ zone: 'road', region: 1, roadIndex: 4 });

    // Knight already in castle: Red attacks the foe.
    s.players[0]!.units.knight = { zone: 'castle' };
    s.players[0]!.sugarCubes = 6;
    const castleResult = applyMove(s, 'h', { type: 'play_intel', cardId: 'red-test', unit: 'knight', takeAction: true, battleTotal: 18 } as SweetlandsMove);
    expect(castleResult.newState.foe?.defeated).toBe(true);
  });

  it('rejects an impossible declared battleTotal from a human', () => {
    let s = intoPlay(7);
    s = applyMove(s, 'h', { type: 'recall', units: [] }).newState;
    s = applyMove(s, 'h', autoReportMove(s, 'h')!).newState;
    s.foe = { type: 'dragon', defeated: false };
    s.players[0]!.hand = [{ cardId: 'purple-test', kind: 'single', color: 'purple' }];
    s.players[0]!.units.knight = { zone: 'road', region: 1, roadIndex: 5 };
    s.players[0]!.sugarCubes = 1;
    expect(() => applyMove(s, 'h', { type: 'play_intel', cardId: 'purple-test', unit: 'knight', takeAction: true, battleTotal: 5 } as SweetlandsMove)).toThrow(/Invalid battleTotal/);
  });
});
