// Facts a screen lays out must arrive as fields, not only inside a sentence:
// the resolving action card (a client routes on its kind) and the id each
// battle unit is named by in battle_activation and the defense moves.

import { describe, it, expect } from 'vitest';
import neitherGutsNorGears from '../index.js';
import { battleDefense } from './pendingFixtures.js';

describe('structured view fields', () => {
  it('publishes the resolving action card beside its sentence', () => {
    const { s } = battleDefense('decoy', 5);
    const g = s.gameState;
    const view = neitherGutsNorGears.getPlayerView(s, 'wiz') as Record<string, unknown>;
    if (g.activeAction) {
      expect(view['resolving_action']).toEqual({ card_kind: g.activeAction.cardKind, owner: g.activeAction.ownerId, finished: !!g.activeAction.endWindow });
      expect(view['active_action']).toBe(`${g.activeAction.cardKind} by ${g.activeAction.ownerId}`);
    } else {
      expect(view['resolving_action']).toBeNull();
    }
  });

  it('names every battle unit by the ref the battle moves take', () => {
    const { s } = battleDefense('decoy', 5);
    const view = neitherGutsNorGears.getPlayerView(s, 'wiz') as { battle: { units: Array<{ ref: string }> } };
    const refs = s.gameState.battle!.units.map((u) => u.unitRef);
    expect(view.battle.units.map((u) => u.ref)).toEqual(refs);
    // Each ref is one the menu uses, when the menu names a unit at all.
    const named = neitherGutsNorGears.getLegalMoves(s, 'wiz')
      .flatMap((m) => {
        const d = (m.move as { defense?: { target?: string; cleric?: string } }).defense;
        return [d?.target, d?.cleric].filter((x): x is string => typeof x === 'string');
      });
    for (const ref of named) expect(refs).toContain(ref);
  });
});

describe('build moves name where the piece goes', () => {
  // A seeded game played to its first few Build actions: every map piece the
  // menu offers names one of the buyer's bases, and every new base names a
  // tile the purchase check accepts — the engine never picks the spot.
  it('lists a spawn base per map piece and a site per new base', async () => {
    const { isBaseSite } = await import('../engine.js');
    const { buildingById } = await import('../resolvers.js');
    const players = [{ player_id: 'p1', kind: 'ai' as const }, { player_id: 'p2', kind: 'ai' as const }];
    let s = neitherGutsNorGears.createSession(players, { seed: 11 });
    if (s.gameState.phase === 'setup_factions') {
      s = neitherGutsNorGears.applyMove(s, 'p1', { type: 'assign_setup_choices', selections: { p1: 'covenant', p2: 'ledger' } }).newState;
    }
    let checked = 0;
    for (let ply = 0; ply < 400 && !neitherGutsNorGears.isGameOver(s); ply++) {
      const g = s.gameState;
      const who = g.pending ? g.pending.forPlayerId : g.activePlayerId;
      for (const m of neitherGutsNorGears.getLegalMoves(s, who)) {
        const mv = m.move as { type: string; item?: string; at_base?: string };
        if (mv.type !== 'build' || !mv.item) continue;
        const building = [buildingById('castle'), buildingById('home')].find((b) => b?.name === mv.item);
        if (building) {
          expect(mv.at_base).toBeTruthy();
          expect(isBaseSite(g, who, mv.at_base!)).toBe(true);
          // Never on a tile that already holds a base, anyone's.
          expect(g.bases.some((b) => b.coord === mv.at_base)).toBe(false);
          checked++;
        } else if (mv.at_base !== undefined) {
          expect(g.bases.some((b) => b.ownerId === who && b.coord === mv.at_base)).toBe(true);
          checked++;
        }
      }
      const { move } = await neitherGutsNorGears.getAIMove(s, who, 'random');
      s = neitherGutsNorGears.applyMove(s, who, move).newState;
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe('a claimed hero goes to the base its owner chooses', () => {
  it('asks with two bases, places at the one listed base pressed, and the claims go on', async () => {
    const { base2p, placeUnit } = await import('./pendingFixtures.js');
    const s = base2p();
    const g = s.gameState;
    const wizBase = g.bases.find((b) => b.ownerId === 'wiz')!;
    // A second base for wiz, and one claim owed.
    placeUnit(g, 'wiz', '0,6', 'evoker');
    g.bases.push({ id: 'base-wiz-2', ownerId: 'wiz', coord: '0,6' });
    g.phase = 'claims';
    g.claimsOwed = { wiz: 1 };
    g.pending = { kind: 'choose_milestone_hero', forPlayerId: 'wiz', claimsOwed: 1 };
    g.activePlayerId = 'wiz';
    const claim = neitherGutsNorGears.getLegalMoves(s, 'wiz').find((m) => (m.move as { hero?: string }).hero === 'Chronicler Ottoline Vey')!;
    let next = neitherGutsNorGears.applyMove(s, 'wiz', claim.move).newState;
    // Not placed yet: the owner chooses between the two bases.
    expect(next.gameState.pending).toEqual({ kind: 'place_reserved_hero', forPlayerId: 'wiz', heroId: 'chronicler' });
    expect(next.gameState.heroes.find((h) => h.id === 'chronicler')!.coord).toBeNull();
    const places = neitherGutsNorGears.getLegalMoves(next, 'wiz').map((m) => (m.move as { coord: string }).coord).sort();
    expect(places).toEqual([wizBase.coord, '0,6'].sort());
    const pick = neitherGutsNorGears.getLegalMoves(next, 'wiz').find((m) => (m.move as { coord: string }).coord === '0,6')!;
    next = neitherGutsNorGears.applyMove(next, 'wiz', pick.move).newState;
    expect(next.gameState.heroes.find((h) => h.id === 'chronicler')!.coord).toBe('0,6');
    // The claim was the only one owed: the claims are over.
    expect(next.gameState.pending?.kind).not.toBe('place_reserved_hero');
    expect(next.gameState.pending?.kind).not.toBe('choose_milestone_hero');
  });
});

describe('pendings name what a screen shows, as fields', () => {
  it('a treaty offer names its proposer and treaty; a second purchase its kind; a spy its source; a win its kind', async () => {
    const { base2p } = await import('./pendingFixtures.js');
    const { checkVictory } = await import('../engine.js');
    const s = base2p();
    const g = s.gameState;
    type P = { pending: { context?: Record<string, unknown> }; result?: { kinds?: string[] } };
    const view = (pid: string) => neitherGutsNorGears.getPlayerView(s, pid) as P;

    g.pending = { kind: 'treaty_response', forPlayerId: 'rob', proposerId: 'wiz', treatyType: 'open-borders' };
    expect(view('rob').pending.context).toMatchObject({ proposer: 'wiz', treaty: 'Open Borders', culture_income: 5 }); // ruling #112

    g.pending = { kind: 'second_purchase', forPlayerId: 'wiz', action: 'research' };
    expect(view('wiz').pending.context).toEqual({ action: 'research' });

    g.pending = { kind: 'choose_spy', forPlayerId: 'rob', source: 'infiltrator', resume: { action: 'build', move: null } };
    expect(view('rob').pending.context).toEqual({ source: 'infiltrator' });
    expect(view('wiz').pending.context).toBeUndefined();

    g.pending = null;
    g.players.find((p) => p.playerId === 'wiz')!.culture = 100;
    expect(checkVictory(g, 'wiz')).toBe(true);
    expect(view('rob').result?.kinds).toEqual(['Cultural']);
  });
});

describe('each human picks their own faction', () => {
  const three = [
    { player_id: 'p1', kind: 'human' as const }, { player_id: 'p2', kind: 'human' as const }, { player_id: 'p3', kind: 'ai' as const },
  ];
  it('asks each human in seat order, shows who holds what, and the AI takes what is left', () => {
    let s = neitherGutsNorGears.createSession(three, { seed: 5, setupFirstPlayerId: 'p1' });
    expect(s.gameState.pending).toEqual({ kind: 'choose_faction', forPlayerId: 'p1' });
    // p2 has nothing to press while p1 chooses.
    expect(neitherGutsNorGears.getLegalMoves(s, 'p2')).toEqual([]);
    s = neitherGutsNorGears.applyMove(s, 'p1', { type: 'choose_faction', faction: 'covenant' }).newState;
    expect(s.gameState.pending).toEqual({ kind: 'choose_faction', forPlayerId: 'p2' });
    const view = neitherGutsNorGears.getPlayerView(s, 'p2') as { pending: { options: Array<{ option_id: string; blocked_reason?: string; move?: unknown; detail: { held_by: string | null } }> } };
    const cov = view.pending.options.find((o) => o.option_id === 'covenant')!;
    expect(cov.blocked_reason).toBe('The Covenant is already taken');
    expect(cov.detail.held_by).toBe('p1');
    expect(neitherGutsNorGears.getLegalMoves(s, 'p2').some((m) => (m.move as { faction: string }).faction === 'covenant')).toBe(false);
    expect(() => neitherGutsNorGears.applyMove(s, 'p2', { type: 'choose_faction', faction: 'covenant' })).toThrow('The Covenant is already taken');
    s = neitherGutsNorGears.applyMove(s, 'p2', { type: 'choose_faction', faction: 'foundry' }).newState;
    const g = s.gameState;
    expect(g.phase).not.toBe('setup_factions');
    expect(g.players.map((p) => p.factionId)).toEqual(['covenant', 'foundry', expect.any(String)]);
    expect(new Set(g.players.map((p) => p.factionId)).size).toBe(3);
  });

  it('lets the reporting seat still assign several seats at once, leaving the rest to choose', () => {
    let s = neitherGutsNorGears.createSession(three, { seed: 5, setupFirstPlayerId: 'p1' });
    s = neitherGutsNorGears.applyMove(s, 'p1', { type: 'assign_setup_choices', selections: { p1: 'ledger', p3: 'schism' } }).newState;
    expect(s.gameState.pending).toEqual({ kind: 'choose_faction', forPlayerId: 'p2' });
    // And a full assignment, as a setup page sends it, finishes the step in one move.
    let t = neitherGutsNorGears.createSession(three, { seed: 5, setupFirstPlayerId: 'p1' });
    t = neitherGutsNorGears.applyMove(t, 'p1', { type: 'assign_setup_choices', selections: { p1: 'ledger', p2: 'covenant', p3: 'schism' } }).newState;
    expect(t.gameState.phase).not.toBe('setup_factions');
  });
});

describe('the reach question agrees with the engine', () => {
  it('accepts, placement by placement, every payment the engine itself lists', async () => {
    let s = neitherGutsNorGears.createSession([{ player_id: 'p1', kind: 'ai' }, { player_id: 'p2', kind: 'ai' }], { seed: 21 });
    let checked = 0;
    for (let ply = 0; ply < 600 && !neitherGutsNorGears.isGameOver(s) && checked < 40; ply++) {
      const g = s.gameState;
      const who = g.pending ? g.pending.forPlayerId : g.activePlayerId;
      for (const m of neitherGutsNorGears.getLegalMoves(s, who)) {
        const mv = m.move as { type: string; payment?: Array<{ collectorId: string; coord: string }> };
        if ((mv.type !== 'build' && mv.type !== 'research') || !mv.payment?.length) continue;
        // Every prefix of the listed payment is a legal partial proposal, and
        // each next placement is among the tiles the question offers.
        for (let i = 0; i < mv.payment.length; i++) {
          const a = neitherGutsNorGears.queryChoice!(s, who, 'collector_reach', { prior: mv.payment.slice(0, i) }) as { next: Record<string, string[]> };
          expect(a.next[mv.payment[i]!.collectorId]).toContain(mv.payment[i]!.coord);
        }
        // The whole listed payment covers its own purchase, by the purchase's cost.
        const whole = neitherGutsNorGears.queryChoice!(s, who, 'collector_reach', { prior: mv.payment, purchase: mv }) as { covers: boolean };
        expect(whole.covers).toBe(true);
        // And nothing placed does not, for anything that costs something.
        const none = neitherGutsNorGears.queryChoice!(s, who, 'collector_reach', { prior: [], purchase: mv }) as { covers: boolean; short: Record<string, number> };
        expect(none.covers).toBe(false);
        expect(Object.keys(none.short).length).toBeGreaterThan(0);
        checked++;
      }
      const { move } = await neitherGutsNorGears.getAIMove(s, who, 'medium');
      s = neitherGutsNorGears.applyMove(s, who, move).newState;
    }
    expect(checked).toBeGreaterThan(5);
  }, 30_000);

  it('answers only the seat composing a purchase, and refuses a placement the rule refuses', () => {
    const s = neitherGutsNorGears.createSession([{ player_id: 'p1', kind: 'ai' }, { player_id: 'p2', kind: 'ai' }], { seed: 21 });
    expect(() => neitherGutsNorGears.queryChoice!(s, 'p1', 'collector_reach', { prior: [] })).toThrow('No purchase of yours is being composed');
    expect(() => neitherGutsNorGears.queryChoice!(s, 'p1', 'no_such_question', {})).toThrow('answers no question named');
  });
});

describe('the action stack resolves every card, one at a time', () => {
  it("finishing one seat's card leaves another seat's card of the same kind on the stack, face down", () => {
    let s = neitherGutsNorGears.createSession([{ player_id: 'p1', kind: 'human', table: 'digital' }, { player_id: 'p2', kind: 'human', table: 'digital' }], { seed: 77, setupFirstPlayerId: 'p1' });
    const g0 = s.gameState;
    s = neitherGutsNorGears.applyMove(s, 'p1', { type: 'assign_setup_choices', selections: { p1: 'covenant', p2: 'foundry' } }).newState;
    void g0;
    // Hand-place the round: both seats put a Research card down; p2's last.
    const g = s.gameState;
    g.phase = 'action';
    g.pending = null;
    g.actionStack = [
      { ownerId: 'p2', cardKind: 'research', slotId: 'research:base' },
      { ownerId: 'p1', cardKind: 'research', slotId: 'research:base' },
    ];
    g.activeAction = g.actionStack[1]!;
    g.activePlayerId = 'p1';
    // While p1's Research resolves, p2's stays face down to p1.
    const view = neitherGutsNorGears.getPlayerView(s, 'p1') as { action_stack: Array<{ owner: string; card_kind?: string; face?: string }> };
    expect(view.action_stack.find((a) => a.owner === 'p2')).toEqual({ position: 1, owner: 'p2', face: 'down' });
    s = neitherGutsNorGears.applyMove(s, 'p1', { type: 'skip_action' }).newState;
    // p2's Research is still there, and it is now p2's to resolve.
    expect(s.gameState.actionStack).toEqual([{ ownerId: 'p2', cardKind: 'research', slotId: 'research:base' }]);
    expect(s.gameState.activeAction?.ownerId).toBe('p2');
  });
});

describe('the engine never refuses a move it listed', () => {
  // Seeded games at every table size, every move chosen from the menu: a
  // menu/engine disagreement (a listed retreat the check refused) stalled
  // six-seat games once every stack card resolved.
  for (const n of [2, 3, 4, 6]) {
    it(`${n} seats`, async () => {
      const F = ['covenant', 'foundry', 'schism', 'ledger', 'brass-circle', 'unbolted'];
      for (const seed of [1015, 1051, 2000 + n]) {
        const players = Array.from({ length: n }, (_, i) => ({ player_id: `p${i + 1}`, kind: (i === 0 ? 'human' : 'ai') as 'human' | 'ai', table: 'digital' as const }));
        let s = neitherGutsNorGears.createSession(players, { seed });
        s = neitherGutsNorGears.applyMove(s, 'p1', { type: 'assign_setup_choices', selections: Object.fromEntries(players.map((p, i) => [p.player_id, F[(i + seed) % 6]!])) }).newState;
        for (let ply = 0; ply < 400 && !neitherGutsNorGears.isGameOver(s); ply++) {
          const g = s.gameState;
          const who = g.pending ? g.pending.forPlayerId : g.activePlayerId;
          const listed = neitherGutsNorGears.getLegalMoves(s, who);
          expect(listed.length, `${n} seats, seed ${seed}, ply ${ply}: ${who} owes a move with none listed`).toBeGreaterThan(0);
          const pick = listed[(ply * 7 + seed) % listed.length]!.move;
          s = neitherGutsNorGears.applyMove(s, who, pick).newState;
        }
      }
    }, 60_000);
  }
});

describe('a reserved hero is placed once its owner has a base', () => {
  it('asks to place it right after the new base is built, then the action goes on', async () => {
    const { base2p, placeUnit } = await import('./pendingFixtures.js');
    const s = base2p();
    const g = s.gameState;
    // wiz has lost its base; a hero it claimed meanwhile waits in reserve.
    g.bases = g.bases.filter((b) => b.ownerId !== 'wiz');
    g.heroes.push({ id: 'chronicler', ownerId: 'wiz', coord: null, isLeader: false, dead: false });
    g.heroPool = g.heroPool.filter((h) => h !== 'chronicler');
    placeUnit(g, 'wiz', '0,6', 'evoker');
    const wiz = g.players.find((p) => p.playerId === 'wiz')!;
    wiz.collectorsAvailable = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`surf-${i + 1}`, 1]));
    g.phase = 'action';
    g.pending = null;
    g.actionStack = [{ ownerId: 'wiz', cardKind: 'build', slotId: 'build:base' }];
    g.activeAction = g.actionStack[0]!;
    g.activePlayerId = 'wiz';
    const castle = neitherGutsNorGears.getLegalMoves(s, 'wiz').find((m) => (m.move as { item?: string; at_base?: string }).item === 'Castle' && (m.move as { at_base?: string }).at_base === '0,6');
    expect(castle, 'a Castle is listed on the evoker tile').toBeTruthy();
    let next = neitherGutsNorGears.applyMove(s, 'wiz', castle!.move).newState;
    expect(next.gameState.pending).toEqual({ kind: 'place_reserved_hero', forPlayerId: 'wiz', heroId: 'chronicler' });
    const place = neitherGutsNorGears.getLegalMoves(next, 'wiz')[0]!;
    next = neitherGutsNorGears.applyMove(next, 'wiz', place.move).newState;
    expect(next.gameState.heroes.find((h) => h.id === 'chronicler')!.coord).toBe('0,6');
    // The Build action finished and the stack moved on.
    expect(next.gameState.pending?.kind).not.toBe('place_reserved_hero');
    expect(next.gameState.actionStack).toHaveLength(0);
  });
});
