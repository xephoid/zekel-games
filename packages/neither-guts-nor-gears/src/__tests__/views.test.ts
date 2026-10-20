// M7 views + privacy — the §15.1 contract locked seat by seat. Opponent
// views/logs/legal-move labels must never name: another seat's battle-card
// hand, a spy assignment, or a private Detection result. A Shared Tactics
// partner sees the hand; nobody else does (ruling 64).

import { describe, it, expect } from 'vitest';
import neitherGutsNorGears from '../index.js';
import type { NGGMove, NGGState } from '../types.js';
import type { PlayerConfig, SessionState } from '@zekel/game-kit';

import { keepCores } from './pendingFixtures.js';
function apply(s: SessionState<NGGState>, playerId: string, move: NGGMove): { s: SessionState<NGGState>; summary: string } {
  const r = neitherGutsNorGears.applyMove(s, playerId, move);
  return { s: r.newState, summary: r.summary };
}

function baseSession(): SessionState<NGGState> {
  const players: PlayerConfig[] = [
    { player_id: 'wiz', kind: 'human' }, { player_id: 'rob', kind: 'human' },
  ];
  let s = neitherGutsNorGears.createSession(players, { seed: 19, setupFirstPlayerId: 'wiz' });
  s = apply(s, 'wiz', { type: 'assign_setup_choices', selections: { wiz: 'covenant', rob: 'ledger' } }).s;
  s = apply(s, 'wiz', { type: 'choose_leader', hero: 'Warden Hesper Quill' }).s;
  s = apply(s, 'rob', { type: 'choose_leader', hero: 'Kestrel Nine' }).s;
  s = apply(s, 'rob', { type: 'choose_starting_location', location: '@2' }).s;
  s = apply(s, 'wiz', { type: 'choose_starting_location', location: '@1' }).s;
  s = keepCores(s);
  return s;
}

describe('M7 views & privacy (§15.1)', () => {
  it('opponent view shows only hand COUNT, never hand contents', () => {
    let s = baseSession();
    const g = s.gameState;
    // Deal wiz a card via the engine's own channel: simulate a draw by splicing
    // from the server order (as a digital deal would).
    const id = g.battleDeck.shift()!;
    g.players.find((p) => p.playerId === 'wiz')!.hand.push(id);
    g.cardOwners[id] = 'wiz';
    const publicView = neitherGutsNorGears.getPublicView(s) as Record<string, unknown>;
    const text = JSON.stringify(publicView);
    // The card's label must not appear in the public view.
    const label = { 'bonus-def-plus': 'Bonus (+1 DEF', 'bonus-dmg-plus': 'Bonus (+1 DMG', 'bonus-def-minus': 'Bonus (−1 DEF', 'bonus-dmg-minus': 'Bonus (−1 DMG', 'extra': 'Extra', 'counter': 'Counter', 'rally': 'Rally', 'retreat': 'Retreat', 'initiative': 'Initiative' }[id.replace(/-\d+$/, '')]!;
    // Public view shows counts only.
    const players = publicView['players'] as Array<Record<string, unknown>>;
    const wizPub = players.find((p) => p['player_id'] === 'wiz')!;
    expect(wizPub['battle_hand_count']).toBe(1);
    expect(wizPub['your_battle_hand']).toBeUndefined();
    // The dealt card's label must not appear ANYWHERE in the public view (the
    // public discard is empty here; deck counts only).
    expect(text).not.toContain(label);
    // wiz's own view sees it.
    const wizView = neitherGutsNorGears.getPlayerView(s, 'wiz') as Record<string, unknown>;
    expect(JSON.stringify(wizView['your_battle_hand'])).toContain(label.split(' ')[0]!);
    // rob's own view does NOT see wiz's hand.
    const robView = neitherGutsNorGears.getPlayerView(s, 'rob') as Record<string, unknown>;
    expect(JSON.stringify(robView)).not.toContain(label);
    expect((robView['your_battle_hand'] as unknown[]).length).toBe(0);
  });

  it('Shared Tactics partner sees the hand; others do not (ruling 64)', () => {
    let s = baseSession();
    const g = s.gameState;
    g.treaties.push({ type: 'shared-tactics', partners: ['wiz', 'rob'] });
    const id = g.battleDeck.shift()!;
    g.players.find((p) => p.playerId === 'wiz')!.hand.push(id);
    g.cardOwners[id] = 'wiz';
    const robView = neitherGutsNorGears.getPlayerView(s, 'rob') as Record<string, unknown>;
    expect(JSON.stringify(robView['shared_tactics_hands'])).toContain('wiz');
    // The partner hand renders the card's printed label (see describeCardInstance).
    const cardBase = id.replace(/-\d+$/, '');
    const labelWord = cardBase === 'rally' ? 'Rally' : cardBase === 'retreat' ? 'Retreat' : cardBase === 'extra' ? 'Extra' : cardBase === 'counter' ? 'Counter' : cardBase === 'initiative' ? 'Initiative' : 'Bonus';
    expect(JSON.stringify(robView['shared_tactics_hands'])).toContain(labelWord);
    // The PUBLIC view still hides the card.
    const publicView = neitherGutsNorGears.getPublicView(s);
    expect(JSON.stringify(publicView)).not.toContain(id.replace(/-\d+$/, ''));
  });

  it('spy assignments are invisible to opponent views, logs, and legal-move labels; Detection results surface only in the inspector\'s view', () => {
    let s = baseSession();
    const g = s.gameState;
    // wiz recruits an Illusionist (public) and privately assigns the spy to Warden.
    g.players.find((p) => p.playerId === 'wiz')!.spyAssignments.push({ source: 'illusionist', heroId: 'warden', active: true });
    g.players.find((p) => p.playerId === 'wiz')!.knowledge.push("Detection: rob's spy is hero kestrel");
    const robView = JSON.stringify(neitherGutsNorGears.getPlayerView(s, 'rob'));
    expect(robView).not.toContain('illusionist');
    expect(robView).not.toContain('"spy"');
    // The string 'warden' appears (public hero position) — but never tied to a spy.
    expect(robView).not.toContain('carries the spy');
    // wiz's own view shows the assignment.
    const wizView = JSON.stringify(neitherGutsNorGears.getPlayerView(s, 'wiz'));
    expect(wizView).toContain('illusionist');
    expect(wizView).toContain('Warden Hesper Quill');
    expect(wizView).toContain("Detection: rob's spy is hero kestrel");
    // rob's view must NOT see wiz's knowledge line.
    expect(robView).not.toContain('Detection: rob');
    // The log shows the public recruitment event, never the hero.
    const logText = JSON.stringify(neitherGutsNorGears.getLog(s));
    expect(logText).not.toMatch(/spy.*warden|warden.*spy/i);
  });

  it('uncommitted battle commitments stay hidden until all commit (§9.2); they reveal TOGETHER', () => {
    let s = baseSession();
    const g = s.gameState;
    // Open a battle: rob's Spitter on the wizard's neighbor; wiz attacks in.
    const seq = g.units.filter((u) => u.ownerId === 'rob').length + 1;
    g.units.push({ id: `u-spitter-rob-${seq}`, typeId: 'spitter', ownerId: 'rob', coord: '-2,8', allocatedCoreId: 'c' });
    // Both hold one card.
    const idW = g.battleDeck.shift()!;
    g.players.find((p) => p.playerId === 'wiz')!.hand.push(idW); g.cardOwners[idW] = 'wiz';
    const idR = g.battleDeck.shift()!;
    g.players.find((p) => p.playerId === 'rob')!.hand.push(idR); g.cardOwners[idR] = 'rob';
    // Drive wiz's Move/Battle.
    let placed = false;
    while (s.gameState.phase === 'planning') {
      const head = s.gameState.planningOrder[0]!;
      const want = head === 'wiz' && !placed;
      s = apply(s, head, { type: 'plan_action', card: want ? 'move_battle' : 'pass' }).s;
      if (want) placed = true;
    }
    s = apply(s, 'wiz', { type: 'move_units', from: '-2,10', to: '-2,8', units: ['warden'] }).s;
    expect(s.gameState.battle).not.toBeNull();
    expect(s.gameState.pending?.kind).toBe('battle_commit');
    // wiz commits their card.
    s = apply(s, s.gameState.pending!.forPlayerId, { type: 'commit_battle_card', card: null }).s;
    // After wiz commits but rob hasn't: no commitment value may surface.
    expect(s.gameState.pending?.kind).toBe('battle_commit');
    const pub = JSON.stringify(neitherGutsNorGears.getPublicView(s));
    expect(pub).toContain('committed (secret)');
    expect(pub).not.toContain('Retreat resolves');
    // rob commits a real card now.
    const robPlayer = s.gameState.players.find((p) => p.playerId === 'rob')!;
    const robCardName = cardLabel(robPlayer.hand[0]!);
    s = apply(s, s.gameState.pending!.forPlayerId, { type: 'commit_battle_card', card: robCardName }).s;
    // All in → revealed together.
    const pubAfter = JSON.stringify(neitherGutsNorGears.getPublicView(s));
    expect(pubAfter).toContain(robCardName.split(' ')[0]!);
  });

  it('move menus never leak an opponent-only pending or an AI seat\'s secrets', () => {
    let s = baseSession();
    const g = s.gameState;
    g.players.find((p) => p.playerId === 'rob')!.spyAssignments.push({ source: 'infiltrator', heroId: 'kestrel', active: true });
    // getLegalMoves for wiz should never surface rob's spy content.
    const wizMoves = JSON.stringify(neitherGutsNorGears.getLegalMoves(s, 'wiz'));
    expect(wizMoves).not.toContain('infiltrator');
    expect(wizMoves).not.toContain('kestrel\','); // kestrel as a spy target is never enumerated for wiz
  });
});

function cardLabel(instanceId: string): string {
  const base = instanceId.replace(/-\d+$/, '');
  return {
    'bonus-def-plus': 'Bonus (+1 DEF to all your units)',
    'bonus-dmg-plus': 'Bonus (+1 DMG to all your units)',
    'bonus-def-minus': 'Bonus (−1 DEF to all opposing units)',
    'bonus-dmg-minus': 'Bonus (−1 DMG to all opposing units)',
    'extra': 'Extra', 'counter': 'Counter', 'rally': 'Rally', 'retreat': 'Retreat', 'initiative': 'Initiative',
  }[base]!;
}

void (0 as unknown as NGGState);
