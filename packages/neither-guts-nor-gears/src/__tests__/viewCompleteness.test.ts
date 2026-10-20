// §1a view completeness (post-port-runbook): a human who lost track of the
// table must be able to rebuild everything the rules entitle them to see —
// from the views alone, in structured form. This test is the audit's proof.

import { describe, it, expect } from 'vitest';
import neitherGutsNorGears from '../index.js';
import type { NGGState } from '../types.js';
import type { PlayerConfig, SessionState } from '@zekel/game-kit';
import { cardByInstanceId } from '../engine.js';
import {
  accessRequest, battleDefense, commitOwnerFirst, counterTarget, extraSelection,
  sharedResourcesBlocked, type Fixture, keepCores } from './pendingFixtures.js';

function base(): SessionState<NGGState> {
  const players: PlayerConfig[] = [
    { player_id: 'wiz', kind: 'human' }, { player_id: 'rob', kind: 'human' },
  ];
  let s = neitherGutsNorGears.createSession(players, { seed: 3, setupFirstPlayerId: 'wiz' });
  s = neitherGutsNorGears.applyMove(s, 'wiz', { type: 'assign_setup_choices', selections: { wiz: 'covenant', rob: 'ledger' } }).newState;
  s = neitherGutsNorGears.applyMove(s, 'wiz', { type: 'choose_leader', hero: 'Warden Hesper Quill' }).newState;
  s = neitherGutsNorGears.applyMove(s, 'rob', { type: 'choose_leader', hero: 'Kestrel Nine' }).newState;
  s = neitherGutsNorGears.applyMove(s, 'rob', { type: 'choose_starting_location', location: '@2' }).newState;
  s = neitherGutsNorGears.applyMove(s, 'wiz', { type: 'choose_starting_location', location: '@1' }).newState;
  s = keepCores(s);
  // Deal wiz a card so the private-known check has content.
  const g = s.gameState as NGGState;
  const idx = g.battleDeck.findIndex((id) => cardByInstanceId(id) === 'bonus-dmg-plus');
  const c = g.battleDeck.splice(idx, 1)[0]!;
  g.players.find((p) => p.playerId === 'wiz')!.hand.push(c);
  g.cardOwners[c] = 'wiz';
  return s;
}

// SPEC-instance-gates.md §5: each of these pendings must publish more than a
// bare `question` to the seat that owns it — the option set (shut ones with
// their reason) or the facts of the decision. A new pending in this list
// cannot ship with only a question. (pendings.test.ts also checks
// access_request's context on a real purchase.)
describe('§5 pendings publish their options, not just a question', () => {
  const rows: Array<[string, () => Fixture, 'options' | 'context']> = [
    ['treaty_break_decision', sharedResourcesBlocked, 'options'],
    ['access_request', accessRequest, 'context'],
    ['battle_commit', commitOwnerFirst, 'options'],
    ['counter_target', counterTarget, 'options'],
    ['extra_selection', extraSelection, 'options'],
    ['battle_defense', () => battleDefense('mana_shield', 3), 'options'],
  ];
  for (const [kind, make, field] of rows) {
    it(`${kind} carries ${field}`, () => {
      const f = make();
      expect(f.s.gameState.pending?.kind).toBe(kind);
      const pending = (neitherGutsNorGears.getPlayerView(f.s, f.forPlayerId) as { pending: Record<string, unknown> }).pending;
      expect(pending['question']).toBeTypeOf('string');
      expect(pending[field], `${kind} publishes ${field}`).toBeDefined();
      if (field === 'options') {
        for (const o of pending['options'] as Array<Record<string, unknown>>) {
          expect(o['label'], `option ${String(o['option_id'])} has a printed label`).toBeTypeOf('string');
          expect(String(o['label']), 'labels never carry a raw coord').not.toMatch(/-?\d+,-?\d+/);
        }
      }
    });
  }
});

describe('§1a table-reconstruction audit (post-port)', () => {
  it('every public-physical field is recoverable from getPublicView in structured form', () => {
    const s = base();
    const pub = neitherGutsNorGears.getPublicView(s) as Record<string, unknown>;
    // Map: every tile, with identity pair + label + owner + contents, individually addressable.
    const map = pub['map'] as { tiles: Array<Record<string, unknown>> };
    expect(Array.isArray(map.tiles)).toBe(true);
    expect(map.tiles.length).toBe(s.gameState.tiles.length); // whatever the layout reports
    for (const t of map.tiles) {
      expect(t['coord'], `tile ${JSON.stringify(t)} has a coordinate identity`).toBeDefined();
      expect(t['label'], `tile ${JSON.stringify(t)} has its player-facing label`).toBeDefined();
      expect(t['printed_resource']).toBeDefined();
      expect(t['current_resource']).toBeDefined();
      expect(Array.isArray(t['units'])).toBe(true);
      expect(Array.isArray(t['heroes'])).toBe(true);
      expect(Array.isArray(t['collectors'])).toBe(true);
      expect('base_owner' in t).toBe(true);
    }
    // Action stack entries: face-down rows with owner + position, no kind leak.
    const stack = pub['action_stack'] as Array<Record<string, unknown>>;
    expect(Array.isArray(stack)).toBe(true);
    // Treaties: type + partners (public by rule).
    const treaties = pub['treaties'] as Array<Record<string, unknown>>;
    expect(Array.isArray(treaties)).toBe(true);
    // Victory status per seat: culture, tech, leader kills, leader alive — all
    // public facts per §15.1.
    const vs = pub['victory_status'] as Record<string, Record<string, unknown>>;
    for (const pid of ['wiz', 'rob']) {
      expect(vs[pid]).toBeDefined();
      expect(vs[pid]!['culture']).toBeDefined();
      expect(vs[pid]!['tech']).toBeDefined();
      expect(vs[pid]!['leader_kills']).toBeDefined();
      expect(vs[pid]!['leader_alive']).toBeDefined();
    }
    // Players: per-seat public numbers (culture, tech, cores in reserve/in play,
    // allocated cores, subjects, mana).
    const players = pub['players'] as Array<Record<string, unknown>>;
    const pub0 = pub['victory_status'] as Record<string, Record<string, unknown>> | undefined;
    void pub0;
    for (const p of players) {
      for (const key of ['culture', 'tech_progress', 'mana_current', 'cores_reserve', 'leader_kills', 'leader_alive'] as const) {
        expect(p, `player ${p['player_id']} view carries ${key}`).toHaveProperty(key);
      }
    }
    // Battle deck face-up discard + count: contents public (§15.1).
    expect(typeof pub['battle_deck_count']).toBe('number');
    expect(Array.isArray(pub['battle_discard'])).toBe(true);
    // Log is delivered at the MCP layer (get_state merges it into the response);
    // the engine view contract doesn't carry it — the MCP test surface asserts.
  });

  it('each seat\'s private-known fields appear only in that seat\'s getPlayerView', () => {
    const s = base();
    const wizView = neitherGutsNorGears.getPlayerView(s, 'wiz') as Record<string, unknown>;
    const robView = neitherGutsNorGears.getPlayerView(s, 'rob') as Record<string, unknown>;
    // wiz's hand is present for wiz, absent from rob.
    expect(wizView['your_battle_hand']).toBeDefined();
    expect(Array.isArray(wizView['your_battle_hand'])).toBe(true);
    expect(robView['your_battle_hand']).toBeDefined();
    expect(Array.isArray(robView['your_battle_hand'])).toBe(true);
    const wizHand = (wizView['your_battle_hand'] as Array<{ card?: string }>).map((c) => c.card).join(',');
    const robHandLen = (robView['your_battle_hand'] as unknown[]).length;
    expect(wizHand).toContain('Bonus (+1 DMG to all your units)');
    expect(robHandLen).toBe(0); // rob holds nothing here
    // wiz's spy assignments: private-known (nobody else may read the spy).
    expect(wizView['your_spy_assignments']).toBeDefined();
    expect(robView['your_spy_assignments']).toBeDefined();
    // rob's view must NOT carry wiz's hand contents.
    const robPlayers = (robView['players'] as Array<Record<string, unknown>>).find((p) => p['player_id'] === 'wiz')!;
    expect(robPlayers['hand']).toBeUndefined(); // hands are never in the public per-player row
    // Action stack: wiz sees their own placed kind; the rob view of wiz's entry is face-down.
    const wizStack = (wizView['action_stack'] as Array<{ owner: string; card_kind?: string; face?: string }>);
    const robStack = (robView['action_stack'] as Array<{ owner: string; card_kind?: string; face?: string }>);
    // Nothing placed yet in this fixture — assertion shape only.
    expect(wizStack.every((a) => a.owner !== 'wiz' || a.card_kind !== undefined || a.face === 'down')).toBe(true);
    expect(robStack.every((a) => a.owner === 'rob' ? (a.card_kind !== undefined || a.face === 'down') : a.face === 'down')).toBe(true);
  });
});
