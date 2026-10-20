// M7 desync-pendings: a scripted full session drives every PORT-PLAN §5
// pending kind and asserts describeNextStep surfaces each with the OWNING SEAT
// named, and that no pending auto-resolves for a human (the choice is the
// player's — the catalog's whole point). One test, one sweep, per the plan.

import { describe, it, expect } from 'vitest';
import neitherGutsNorGears from '../index.js';
import type { NGGMove } from '../types.js';
import type { PlayerConfig, SessionState, NextStep } from '@zekel/game-kit';
import type { NGGState } from '../types.js';

import { keepCores } from './pendingFixtures.js';
function apply(s: SessionState<NGGState>, playerId: string, move: NGGMove): SessionState<NGGState> {
  return neitherGutsNorGears.applyMove(s, playerId, move).newState;
}

function stepFor(s: SessionState<NGGState>): NextStep | null {
  return neitherGutsNorGears.describeNextStep(s);
}

describe('desync pendings sweep (PORT-PLAN §5 → describeNextStep)', () => {
  it('every human-owed pending surfaces via describeNextStep naming its seat + exact questions', () => {
    const players: PlayerConfig[] = [
      { player_id: 'wiz', kind: 'human' }, { player_id: 'rob', kind: 'human' },
    ];
    let s: SessionState<NGGState> = neitherGutsNorGears.createSession(players, { seed: 23, setupFirstPlayerId: 'wiz' });
    const seen: string[] = [];
    const mark = () => {
      const pend = s.gameState.pending;
      if (pend && !seen.includes(pend.kind)) {
        seen.push(pend.kind);
        // The directive names the owning seat.
        const ns = stepFor(s);
        expect(ns, `pending ${pend.kind} has a describeNextStep`).not.toBeNull();
        expect(ns!.status).toBe('human_to_move');
        expect(ns!.active_player_id).toBe(pend.forPlayerId);
        // The guidance names the seat + the exact question, and tells the model
        // to ASK rather than invent (never echo a guess into apply_move).
        expect(ns!.instruction.toLowerCase()).toMatch(/ask|choose|decide|whether/);
        expect(ns!.instruction).toContain(pend.forPlayerId);
      }
    };
    mark(); // setup_factions has no pending yet; the phase directive handles it
    // Factions → leaders → locations.
    s = apply(s, 'wiz', { type: 'assign_setup_choices', selections: { wiz: 'covenant', rob: 'ledger' } });
    mark(); // choose_leader wiz
    s = apply(s, 'wiz', { type: 'choose_leader', hero: 'Archmage Chaimidious' });
    mark(); // report_draw (Chaimidious grant) owed by wiz
    s = apply(s, 'wiz', { type: 'report_draw', card: 'Retreat' });
    mark(); // choose_leader rob
    s = apply(s, 'rob', { type: 'choose_leader', hero: 'Kestrel Nine' });
    mark(); // choose_starting_location rob (reverse order)
    s = apply(s, 'rob', { type: 'choose_starting_location', location: '@2' });
    mark(); // wiz's location pick
    s = apply(s, 'wiz', { type: 'choose_starting_location', location: '@1' });
    s = keepCores(s);
    expect(s.gameState.phase).toBe('planning');
    expect(seen).toContain('choose_leader');
    expect(seen).toContain('report_draw');
    expect(seen).toContain('choose_starting_location');

    // Round 1: wiz plans a Build, rob research (rob's card behind). Access + second-purchase surface.
    let placed = new Set<string>();
    while (s.gameState.phase === 'planning') {
      const head = s.gameState.planningOrder[0]!;
      const want = head === 'wiz' && !placed.has('wiz') ? 'build' : head === 'rob' && !placed.has('rob') ? 'research' : 'pass';
      if (want !== 'pass') placed.add(head);
      s = apply(s, head, { type: 'plan_action', card: want });
    }
    if (s.gameState.activeAction?.ownerId !== 'wiz') {
      s = apply(s, s.gameState.activeAction!.ownerId, { type: 'skip_action' });
    }
    expect(s.gameState.activeAction?.ownerId).toBe('wiz');
    // wiz builds a Surf with 2 water from its adjacent lakes; one placement on
    // rob's tile needs consent → access_request pending.
    const robBase = s.gameState.bases.find((b) => b.ownerId === 'rob')!.coord;
    // Bring the wizard Leader adjacent to rob's base so the anchor is legal.
    const [rc, rr] = robBase.split(',').map((v) => parseInt(v, 10));
    const nbr = [[0, -2], [0, 2], [-1, -1], [-1, 1], [1, -1], [1, 1]]
      .map(([dc, dr]) => `${rc! + dc},${rr! + dr}`)
      .find((k) => s.gameState.tiles.some((t) => `${t.c},${t.r}` === k))!;
    s.gameState.heroes.find((h) => h.ownerId === 'wiz' && h.isLeader)!.coord = nbr;
    const pay = [
      { collectorId: 'surf-1', coord: '-2,8' },   // Wa adjacent to wiz's base
      { collectorId: 'surf-2', coord: robBase },   // rob's tile — the wizard has an anchor via the moved Leader
    ];
    s = apply(s, 'wiz', { type: 'build', item: 'Surf', payment: pay });
    mark(); // access_request owed by rob
    expect(s.gameState.pending?.kind).toBe('access_request');
    // The owner sees what they are consenting to: the declared purchase, the
    // whole payment by printed tile label (never a raw coord), and where this
    // request sits in the purchase's queue of consents (SPEC-instance-gates §5).
    const accessView = (neitherGutsNorGears.getPlayerView(s, 'rob') as { pending: { context?: Record<string, unknown> } }).pending;
    expect(accessView.context).toMatchObject({ buyer: 'wiz', action: 'build', item: 'Surf', queue: { index: 1, total: 1 } });
    const placements = accessView.context!['placements'] as Array<{ collector: string; tile: string }>;
    expect(placements.map((p) => p.collector)).toEqual(['surf-1', 'surf-2']);
    for (const p of placements) expect(p.tile).toMatch(/^[A-I]\d+$/);
    expect((accessView.context!['this_request'] as { tile: string }).tile).toMatch(/^[A-I]\d+$/);
    expect((neitherGutsNorGears.getPublicView(s) as { pending: { context?: unknown } }).pending.context).toBeUndefined();
    s = apply(s, 'rob', { type: 'respond_access_request', grant: true });
    expect(s.gameState.pending).toBeNull();
    expect(seen).toContain('access_request');

    // Milestone claim: push wiz to 4 culture (the first 2p milestone, #119) and roll the round out.
    s.gameState.players.find((p) => p.playerId === 'wiz')!.culture = 3;
    s.gameState.players.find((p) => p.playerId === 'wiz')!.subjects = 1; // +1 at income
    // rob completes its research action (skip), wiz's build done → culture → claims.
    let guard = 0;
    while (guard++ < 12 && s.gameState.phase !== 'claims') {
      if (s.gameState.phase === 'action' && s.gameState.activeAction) {
        s = apply(s, s.gameState.activeAction.ownerId, { type: 'skip_action' });
      } else break;
    }
    expect(s.gameState.pending?.kind).toBe('choose_milestone_hero');
    mark();
    // Claim a hero that pends (Chaimidious is wiz's Leader; take Envoy.)
    s = apply(s, 'wiz', { type: 'choose_milestone_hero', hero: 'Envoy Sable Marrow' });

    // Treaty offer: wiz (the ACTIVE seat) proposes to rob; respond pending.
    // We need an active action window: the round rolled to round 2 planning.
    // Drive a new round to a wiz action.
    placed = new Set();
    guard = 0;
    while (guard++ < 40 && !(s.gameState.phase === 'action' && s.gameState.activeAction?.ownerId === 'wiz')) {
      if (s.gameState.phase === 'planning') {
        const head = s.gameState.planningOrder[0]!;
        const want = head === 'wiz' && !placed.has('wiz') ? 'research' : 'pass';
        if (want !== 'pass') placed.add(head);
        s = apply(s, head, { type: 'plan_action', card: want });
      } else if (s.gameState.phase === 'action' && s.gameState.activeAction) {
        s = apply(s, s.gameState.activeAction.ownerId, { type: 'skip_action' });
      } else if (s.gameState.pending?.kind === 'choose_milestone_hero') {
        s = apply(s, s.gameState.pending.forPlayerId, { type: 'choose_milestone_hero', hero: 'Professor Anselm Kettering' });
      } else if (s.gameState.pending?.kind === 'upkeep_reallocate_cores') {
        const pend = s.gameState.pending;
        const keep: Record<string, boolean> = {};
        for (const u of s.gameState.units.filter((u) => u.ownerId === pend.forPlayerId)) keep[u.id] = !!u.allocatedCoreId;
        s = apply(s, pend.forPlayerId, { type: 'reallocate_cores', allocations: keep });
      } else break;
    }
    expect(s.gameState.activeAction?.ownerId).toBe('wiz');
    s = apply(s, 'wiz', { type: 'form_treaty', partner: 'rob', treaty_type: 'Peace' });
    expect(s.gameState.pending?.kind).toBe('treaty_response');
    mark();
    s = apply(s, 'rob', { type: 'respond_treaty', accept: true });
    expect(s.gameState.treaties.length).toBe(1);

    // The catalog's remaining pendings (battle card commitments, defenses,
    // retreats, spies, overlays) are driven explicitly in battle.test.ts /
    // spy/detection in the views suite; here we assert coverage on what ran.
    expect(seen).toEqual(expect.arrayContaining([
      'choose_leader', 'report_draw', 'choose_starting_location',
      'access_request', 'choose_milestone_hero', 'treaty_response',
    ]));
    // Sanity: nothing in the seen set auto-resolved for a human — each arming
    // flipped activePlayerId to the owning seat (asserted inside mark()).
  });

  it('all-AI sessions run end-to-end with no human pendings (harness path)', () => {
    const players: PlayerConfig[] = [
      { player_id: 'a', kind: 'ai' }, { player_id: 'b', kind: 'ai' },
    ];
    const s = neitherGutsNorGears.createSession(players, { seed: 31 });
    expect(s.gameState.phase).toBe('planning');
    // An all-AI session has no human pending anywhere after auto-setup.
    expect(s.gameState.pending).toBeNull();
    expect(neitherGutsNorGears.getSetupChecklist(s)).toEqual([]);
    expect(stepFor(s)).toBeNull(); // no human override — generic ai_to_move
  });
});
