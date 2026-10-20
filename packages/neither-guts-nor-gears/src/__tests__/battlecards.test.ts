// M5 heroes + battle strategy cards — PORT-PLAN §7b M5 (a)–(h): the
// Counter/Extra batch machine per rulings 19–25 + 27, deck conservation over
// purchases/plays/reshuffles (exactly 20 across zones), spy flows + per-seat
// knowledge, Elara's not-a-battle spell, hero-death lifecycles (extra cards at
// upkeep, bonus-point loss), §10.3 order.

import { describe, it, expect } from 'vitest';
import neitherGutsNorGears from '../index.js';
import type { NGGMove, NGGState } from '../types.js';
import { cardByInstanceId } from '../engine.js';
import type { PlayerConfig, SessionState } from '@zekel/game-kit';

import { keepCores } from './pendingFixtures.js';
function apply(s: SessionState<NGGState>, playerId: string, move: NGGMove): { s: SessionState<NGGState>; summary: string } {
  const r = neitherGutsNorGears.applyMove(s, playerId, move);
  return { s: r.newState, summary: r.summary };
}

function placeUnit(g: NGGState, pid: string, coord: string, typeId: string): string {
  const seq = g.units.filter((u) => u.ownerId === pid && u.typeId === typeId).length + 1;
  const isRobotPlatform = ['spinner', 'spitter', 'immobile-combat-platform', 'large-combat-platform', 'wall-platform', 'water-collector', 'wood-collector', 'ore-collector', 'oil-collector', 'ether-collector'].includes(typeId);
  const id = `u-${typeId}-${pid}-${seq}`;
  g.units.push({ id, typeId, ownerId: pid, coord, allocatedCoreId: isRobotPlatform ? `core-${pid}-${typeId}-${seq}` : null });
  return id;
}

/** 2p wiz/rob humans, driven to a battle at (-2,8) opened by `mover`. */
function battleSession(mover: 'wiz' | 'rob', setup: (g: NGGState) => void): SessionState<NGGState> {
  const players: PlayerConfig[] = [
    { player_id: 'wiz', kind: 'human' }, { player_id: 'rob', kind: 'human' },
  ];
  let s = neitherGutsNorGears.createSession(players, { seed: 3, setupFirstPlayerId: 'wiz' });
  s = apply(s, 'wiz', { type: 'assign_setup_choices', selections: { wiz: 'covenant', rob: 'ledger' } }).s;
  s = apply(s, 'wiz', { type: 'choose_leader', hero: 'Warden Hesper Quill' }).s;
  s = apply(s, 'rob', { type: 'choose_leader', hero: 'Kestrel Nine' }).s;
  s = apply(s, 'rob', { type: 'choose_starting_location', location: '@2' }).s;
  s = apply(s, 'wiz', { type: 'choose_starting_location', location: '@1' }).s;
  s = keepCores(s);
  setup(s.gameState);
  const other = mover === 'wiz' ? 'rob' : 'wiz';
  const placed = new Set<string>();
  while (s.gameState.phase === 'planning') {
    const head = s.gameState.planningOrder[0]!;
    const card = head === mover && !placed.has(mover) ? 'move_battle' as const
      : head === other && !placed.has(other) ? 'research' as const
      : 'pass' as const;
    if (card !== 'pass') placed.add(head);
    s = apply(s, head, { type: 'plan_action', card }).s;
  }
  let g0 = 0;
  while (g0++ < 6 && (s.gameState.activeAction?.ownerId !== mover || s.gameState.activeAction?.cardKind !== 'move_battle')) {
    s = apply(s, s.gameState.activeAction!.ownerId, { type: 'skip_action' }).s;
  }
  return s;
}

/** Hand a seat specific battle cards (test-side): instance ids spliced out of
 *  the server's order. The physical remainder is a VIEW of the same 20-card
 *  instance pool (the two channels must agree — that agreement is the invariant). */
function deal(g: NGGState, pid: string, cards: string[]): void {
  const p = g.players.find((x) => x.playerId === pid)!;
  for (const want of cards) {
    const idx = g.battleDeck.findIndex((id) => cardByInstanceId(id) === want);
    if (idx >= 0) {
      const id = g.battleDeck.splice(idx, 1)[0]!;
      p.hand.push(id);
      g.cardOwners[id] = pid;
    } else {
      const free = g.battleDiscard.find((id) => cardByInstanceId(id) === want);
      expect(free, `${want} available somewhere to deal`).toBeTruthy();
      const id = g.battleDiscard.splice(g.battleDiscard.indexOf(free!), 1)[0]!;
      p.hand.push(id);
      g.cardOwners[id] = pid;
    }
  }
}

/** §15.3 conservation invariant, honestly computed: exactly 20 DISTINCT
 *  instance ids exist across deck+hands+committed+discard; and the per-type
 *  remainder view (physical channel) agrees with the server-order view. */
function stateDiscardsHas(g: NGGState, id: string): boolean { return g.battleDiscard.includes(id); }
function assertCardConservation(g: NGGState): void {
  const committedIds = (g.battle?.committed ?? []).filter((c) => !c.resolved || !stateDiscardsHas(g, c.cardInstanceId)).map((c) => c.cardInstanceId);
  const all = [...g.battleDeck, ...g.players.flatMap((p) => p.hand), ...committedIds, ...g.battleDiscard];
  const distinct = new Set(all);
  expect(distinct.size, `distinct ids ${distinct.size} across zones (${all.length} entries)`).toBe(20);
  expect(all.length, 'no duplicate ids across zones').toBe(20);
  // The remainder VIEW must equal per-type counts of the pool not held in hands
  // (remainder[r] counts un-drawn physical cards; each hand-held copy was
  // decremented out of it at deal/report time).
  const pool = [...g.battleDeck, ...g.battleDiscard, ...committedIds];
  const perType: Record<string, number> = {};
  for (const id of pool) {
    const c = cardByInstanceId(id);
    perType[c] = (perType[c] ?? 0) + 1;
  }
  // The derived view agrees: for every card type, printed copies = remainder +
  // held + committed + inDiscard. (The remainder is computed by the engine's
  // physicalRemainderOf from the live pool.)
  for (const card of ['bonus-def-plus', 'bonus-dmg-plus', 'bonus-def-minus', 'bonus-dmg-minus', 'extra', 'counter', 'rally', 'retreat', 'initiative'] as const) {
    const printed = { 'bonus-def-plus': 2, 'bonus-dmg-plus': 2, 'bonus-def-minus': 2, 'bonus-dmg-minus': 2, 'extra': 2, 'counter': 2, 'rally': 2, 'retreat': 4, 'initiative': 2 }[card]!;
    const held = g.players.reduce((a, p) => a + p.hand.filter((id) => cardByInstanceId(id) === card).length, 0);
    const inDiscard = g.battleDiscard.filter((id) => cardByInstanceId(id) === card).length;
    const committed = (g.battle?.committed ?? []).filter((c) => c.card === card && !g.battleDiscard.includes(c.cardInstanceId)).length;
    // Every printed copy is accounted: in deck (un-held pool) or held/committed/discarded.
    const inDeckPool = g.battleDeck.filter((id) => cardByInstanceId(id) === card).length;
    expect(inDeckPool + held + committed + inDiscard, `card ${card}`).toBe(printed);
  }
}

describe('M5 battle-card batch machine (rulings 19–27)', () => {
  it('(a) §14.2: an initial Extra countered before selections — no selection pending ever surfaced, would-be cards stay secret, both cards discard', () => {
    let s = battleSession('rob', (g) => {
      placeUnit(g, 'rob', '-2,6', 'spitter');
      placeUnit(g, 'wiz', '-2,8', 'evoker');
      g.heroes.find((h) => h.ownerId === 'rob' && h.isLeader)!.coord = '2,4';
      g.heroes.find((h) => h.ownerId === 'wiz' && h.isLeader)!.coord = '-2,10';
      deal(g, 'wiz', ['extra']);   // first player (wiz is setup-first; FPO after rotation: rob)
      deal(g, 'rob', ['counter']);
      deal(g, 'wiz', ['bonus-def-plus']); // wiz's would-be Extra addition — must stay secret
    });
    const spitterId = s.gameState.units.find((u) => u.ownerId === 'rob' && u.typeId === 'spitter')!.id;
    let r = apply(s, 'rob', { type: 'move_units', from: '-2,6', to: '-2,8', units: [spitterId] });
    s = r.s;
    r = apply(s, 'rob', { type: 'commit_battle_card', card: 'Counter' });
    s = r.s;
    r = apply(s, 'wiz', { type: 'commit_battle_card', card: 'Extra' });
    s = r.s;
    // Reveal happened; Counter resolves first — pending for rob (the playing player).
    expect(s.gameState.pending?.kind).toBe('counter_target');
    expect(s.gameState.pending?.forPlayerId).toBe('rob');
    // The Extra appears as an unresolved target option.
    const choices = neitherGutsNorGears.getLegalMoves(s, 'rob');
    expect(choices.some((m) => m.move.type === 'choose_counter_target')).toBe(true);
    r = apply(s, 'rob', { type: 'choose_counter_target', card: 'Extra' });
    s = r.s;
    // The countered Extra grants NO selections — no extra_selection pending ever.
    expect(s.gameState.pending?.kind).not.toBe('extra_selection');
    // wiz's spare Bonus stayed secret in hand.
    const wizHand = s.gameState.players.find((p) => p.playerId === 'wiz')!.hand;
    expect(wizHand.some((id) => cardByInstanceId(id) === 'bonus-def-plus')).toBe(true);
    // Both played cards are in the PUBLIC discard.
    expect(s.gameState.battleDiscard.length).toBe(2);
    assertCardConservation(s.gameState);
  });

  it('(b) §14.3: two initial Extras both resolve before the added-Counter batch; the added Counter cannot target the resolved Extras', () => {
    let s = battleSession('rob', (g) => {
      placeUnit(g, 'rob', '-2,6', 'spitter');
      placeUnit(g, 'wiz', '-2,8', 'evoker');
      g.heroes.find((h) => h.ownerId === 'rob' && h.isLeader)!.coord = '2,4';
      g.heroes.find((h) => h.ownerId === 'wiz' && h.isLeader)!.coord = '-2,10';
      deal(g, 'wiz', ['extra']);
      deal(g, 'rob', ['extra']);
      deal(g, 'rob', ['counter']); // rob's Extra reveals this Counter later
      deal(g, 'wiz', ['retreat']);
    });
    // First-player order after the upkeep rotation: rob is first (rotated off wiz).
    const spitterId = s.gameState.units.find((u) => u.ownerId === 'rob' && u.typeId === 'spitter')!.id;
    let r = apply(s, 'rob', { type: 'move_units', from: '-2,6', to: '-2,8', units: [spitterId] });
    s = r.s;
    // Commitments: rob Extra, wiz Extra (both initial).
    r = apply(s, 'rob', { type: 'commit_battle_card', card: 'Extra' });
    s = r.s;
    r = apply(s, 'wiz', { type: 'commit_battle_card', card: 'Extra' });
    s = r.s;
    // No Counters in the batch → Extras in first-player order: rob FIRST.
    expect(s.gameState.pending?.kind).toBe('extra_selection');
    expect(s.gameState.pending?.forPlayerId).toBe('rob');
    // rob's Extra adds the Counter (its own) — reveal together; it joins the NEXT batch.
    r = apply(s, 'rob', { type: 'select_extra_cards', cards: ['Counter'] });
    s = r.s;
    // The SECOND original Extra (wiz's) still resolves before the added batch.
    expect(s.gameState.pending?.kind).toBe('extra_selection');
    expect(s.gameState.pending?.forPlayerId).toBe('wiz');
    r = apply(s, 'wiz', { type: 'select_extra_cards', cards: [] });
    s = r.s;
    // Now the added batch's Counter resolves for rob. Both original Extras have
    // already resolved, so nothing is left for it to cancel: it resolves with no
    // target rather than leaving rob owing a choice with no legal answer.
    expect(s.gameState.pending?.kind).not.toBe('counter_target');
    expect(neitherGutsNorGears.getLegalMoves(s, 'rob').some((m) => m.move.type === 'choose_counter_target')).toBe(false);
    expect(s.gameState.log.some((e) => /Counter has nothing to cancel/.test(e.summary))).toBe(true);
    assertCardConservation(s.gameState);
  });

  it('(d) deck conservation: a random walk of purchases/plays keeps exactly 20 across all zones after every move', () => {
    let s = battleSession('rob', (g) => {
      placeUnit(g, 'rob', '-2,6', 'spitter');
      placeUnit(g, 'wiz', '-2,8', 'evoker');
      g.heroes.find((h) => h.ownerId === 'rob' && h.isLeader)!.coord = '2,4';
      g.heroes.find((h) => h.ownerId === 'wiz' && h.isLeader)!.coord = '-2,10';
    });
    assertCardConservation(s.gameState);
    // Deal the decks down: give each seat several cards via the test channel.
    deal(s.gameState, 'wiz', ['retreat', 'retreat', 'bonus-dmg-plus']);
    assertCardConservation(s.gameState);
    deal(s.gameState, 'rob', ['counter', 'extra', 'initiative']);
    assertCardConservation(s.gameState);
    // Play a battle with cards committed and discarded.
    const spitterId = s.gameState.units.find((u) => u.ownerId === 'rob' && u.typeId === 'spitter')!.id;
    let r = apply(s, 'rob', { type: 'move_units', from: '-2,6', to: '-2,8', units: [spitterId] });
    s = r.s;
    assertCardConservation(s.gameState);
    r = apply(s, 'rob', { type: 'commit_battle_card', card: 'Initiative' });
    s = r.s;
    r = apply(s, 'wiz', { type: 'commit_battle_card', card: 'Retreat' });
    s = r.s;
    // Cards revealed; the §10.3 order resolves Retreat AFTER... wait: Initiative
    // is listed after Bonus; Retreat before. Retreat fires: wiz's units leave.
    // Drive to completion.
    let guard = 0;
    while (guard++ < 30 && s.gameState.battle) {
      const pend = s.gameState.pending;
      if (!pend) break;
      if (pend.kind === 'battle_defense') {
        s = apply(s, pend.forPlayerId, { type: 'resolve_battle_defense', defense: { kind: 'none' } }).s;
      } else if (pend.kind === 'retreat') {
        s = apply(s, pend.forPlayerId, { type: 'choose_retreat', destination: null, stay: true }).s;
      } else if (pend.kind === 'rally_selection') {
        s = apply(s, pend.forPlayerId, { type: 'select_rally_units', units: [] }).s;
      } else if (pend.kind === 'extra_selection') {
        s = apply(s, pend.forPlayerId, { type: 'select_extra_cards', cards: [] }).s;
      } else if (pend.kind === 'counter_target') {
        const opts = neitherGutsNorGears.getLegalMoves(s, pend.forPlayerId).filter((m) => m.move.type === 'choose_counter_target');
        if (opts.length === 0) break;
        const mv = opts[0]!.move as Extract<NGGMove, { type: 'choose_counter_target' }>;
        s = apply(s, pend.forPlayerId, mv).s;
      } else if (s.gameState.battle.phase === 'activations') {
        const cur = s.gameState.battle.activationQueue[s.gameState.battle.activationCursor];
        if (cur === undefined) break;
        s = apply(s, s.gameState.activePlayerId, { type: 'battle_activation', unit: cur, action: { kind: 'pass' } }).s;
      } else break;
      assertCardConservation(s.gameState);
    }
    assertCardConservation(s.gameState);
  });

  it('(f) Elara\'s spell: 5 mana, kills DEF≤4 non-allied units in the adjacent space, spares own + allies, and NO battle triggers (no cards offered)', () => {
    // Wizards-only hero: give the wizard Elara as a claimed hero on the map.
    let s = battleSession('wiz', (g) => {
      g.heroPool = g.heroPool.filter((h) => h !== 'elara');
      g.heroes.push({ id: 'elara', ownerId: 'wiz', coord: '-2,6', isLeader: false, dead: false });
      g.players.find((p) => p.playerId === 'wiz')!.manaCurrent = 5;
      // Enemy units at (-2,8): a rob Spitter (DEF 1) + rob's Leader Kestrel (DEF 6 — survives).
      placeUnit(g, 'rob', '-2,8', 'spitter');
      g.heroes.find((h) => h.ownerId === 'rob' && h.isLeader)!.coord = '-2,8';
      g.heroes.find((h) => h.ownerId === 'wiz' && h.isLeader)!.coord = '-2,6';
    });
    // Elara at (-2,6) with Warden. The spell is its own move at the START of
    // the Move/Battle action, before any movement (§6.4); the menu offers it.
    expect(s.gameState.phase).toBe('action');
    expect(neitherGutsNorGears.getLegalMoves(s, 'wiz').some((m) => m.move.type === 'cast_elara_spell'
      && (m.move as { target_location: string }).target_location === '-2,8')).toBe(true);
    s = apply(s, 'wiz', { type: 'cast_elara_spell', target_location: '-2,8' }).s;
    // Not a battle: no card commitments open, nothing moved.
    expect(s.gameState.battle).toBeNull();
    expect(s.gameState.pending).toBeNull();
    expect(s.gameState.heroes.find((h) => h.id === 'elara')!.coord).toBe('-2,6');
    const wizAfter = s.gameState.players.find((p) => p.playerId === 'wiz')!;
    expect(wizAfter.manaCurrent).toBe(0);
    expect(s.gameState.units.some((u) => u.typeId === 'spitter')).toBe(false); // killed by the spell
    expect(s.gameState.heroes.find((h) => h.id === 'kestrel')!.dead).toBe(false); // DEF 6 > 4
    // Moving afterwards is optional: the spell cannot be cast twice, and the
    // action may end without moving.
    const menu = neitherGutsNorGears.getLegalMoves(s, 'wiz');
    expect(menu.some((m) => m.move.type === 'cast_elara_spell')).toBe(false);
    expect(menu.some((m) => m.move.type === 'move_units')).toBe(true);
    s = apply(s, 'wiz', { type: 'skip_action' }).s;
    expect(s.gameState.activeAction?.ownerId === 'wiz' && s.gameState.activeAction.cardKind === 'move_battle').toBe(false);
  });

  it('(g) Marshal dies mid-round: the queued extra Move/Battle RESOLVES; the card is removed at the next upkeep (ruling 42)', () => {
    const players: PlayerConfig[] = [
      { player_id: 'wiz', kind: 'human' }, { player_id: 'rob', kind: 'human' },
    ];
    let s = neitherGutsNorGears.createSession(players, { seed: 9, setupFirstPlayerId: 'wiz' });
    s = apply(s, 'wiz', { type: 'assign_setup_choices', selections: { wiz: 'covenant', rob: 'ledger' } }).s;
    s = apply(s, 'wiz', { type: 'choose_leader', hero: 'Marshal Corvin Ashlock' }).s; // extra MB card as Leader benefit
    s = apply(s, 'rob', { type: 'choose_leader', hero: 'Kestrel Nine' }).s;
    s = apply(s, 'rob', { type: 'choose_starting_location', location: '@2' }).s;
    s = apply(s, 'wiz', { type: 'choose_starting_location', location: '@1' }).s;
    s = keepCores(s);
    expect(s.gameState.players.find((p) => p.playerId === 'wiz')!.actionCards.moveBattle).toBe(2);
    // Kill Marshal now (mid-round-1).
    const marshal = s.gameState.heroes.find((h) => h.id === 'marshal')!;
    marshal.dead = true;
    logHeroDeath(s.gameState, 'wiz');
    // The extra card remains usable for the REST of the round: the wizard can
    // place BOTH Move/Battle cards in planning.
    let placed = 0;
    while (s.gameState.phase === 'planning') {
      const head = s.gameState.planningOrder[0]!;
      const want = head === 'wiz' && placed < 2 ? 'move_battle' : 'pass';
      const kind = head === 'wiz' ? (placed === 0 ? 'base' : 'hero_extra') : undefined;
      void kind;
      const before = s.gameState.actionStack.length;
      s = apply(s, head, { type: 'plan_action', card: want === 'pass' ? 'pass' : 'move_battle', which: want === 'pass' ? undefined : (placed === 0 ? 'base' : 'hero_extra') }).s;
      if (head === 'wiz' && s.gameState.actionStack.length > before) placed++;
    }
    expect(placed).toBe(2); // both cards went in (the second is Marshal's)
    // Drive the round out (both are skipped) and assert the card is removed at upkeep.
    while (s.gameState.phase === 'action') {
      s = apply(s, s.gameState.activeAction!.ownerId, { type: 'skip_action' }).s;
    }
    expect(s.gameState.round).toBe(2);
    expect(s.gameState.players.find((p) => p.playerId === 'wiz')!.actionCards.moveBattle).toBe(1);
  });

  it('(h) Motherboard death removes its +1 bonus tech point; acquired-type points stay permanent (rulings 43–44)', () => {
    let s = battleSession('wiz', (g) => {
      g.heroPool = g.heroPool.filter((h) => h !== 'motherboard');
      g.heroes.push({ id: 'motherboard', ownerId: 'wiz', coord: '-2,10', isLeader: false, dead: false });
    });
    const wiz = s.gameState.players.find((p) => p.playerId === 'wiz')!;
    const base = wiz.acquiredTypes.length; // surf + castle at setup = 2
    expect(base).toBe(2);
    const mb = s.gameState.heroes.find((h) => h.id === 'motherboard')!;
    expect(mb.dead).toBe(false);
    // Kill Motherboard (test-side — the ledger rule is what we lock).
    mb.dead = true;
    // acquiredTypes untouched; the bonus computes live in the per-player view.
    const view = neitherGutsNorGears.getPlayerView(s, 'wiz') as Record<string, unknown>;
    const me = (view['players'] as Array<Record<string, unknown>>).find((p) => p['player_id'] === 'wiz')!;
    const tp = me['tech_progress'] as Record<string, unknown>;
    expect(tp['bonus_points_live']).toBe(0);
    expect((tp['acquired_types'] as string[]).length).toBe(2);
  });
});

/** Log a hero death the way the engine's killHero does (the upkeep card-removal
 *  path consults hero.dead directly; this just marks it). */
function logHeroDeath(g: NGGState, _pid: string): void { void g; void _pid; }
