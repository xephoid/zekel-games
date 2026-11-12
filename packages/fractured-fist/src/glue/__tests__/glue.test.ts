// The Fractured Fist glue against views in the shape this game's rules give
// them. Legal move fixtures follow the engine's LegalMove shape:
// { move_id, description, move }. These tests came from Zekel Universe's
// apps/web/src/tests/glue.test.ts when the screen moved here.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GameReferenceResponse } from '@zekel/wire-types';
import type { CardData, CardZoneData, MapData, PoolData, TableauData, TrackData } from '@zekel/primitives';
import type { GlueInput, LegalMove, TablePlan, Zone } from '@zekel/glue-kit';
import { formForMove, isSubmissionAllowed, movesForSelect, templateForm } from '@zekel/glue-kit';
import { fracturedFistGlue } from '../index.js';
import { fightOf } from '../read.js';
import type { StrikeMoment } from '../StrikeMoment.js';
import { FF_MOVES, FF_REFERENCE, FF_VIEW } from './fixtures/ff.js';

function input(view: unknown, legalMoves: GlueInput['legalMoves'] = [], extra: Partial<GlueInput> = {}): GlueInput {
  return {
    view, previous: null, legalMoves, playerId: extra.playerId ?? null, reference: extra.reference ?? null,
    seq: extra.seq ?? 1, engineMove: extra.engineMove ?? null, actorPlayerId: extra.actorPlayerId ?? null,
    memory: extra.memory ?? new Map(),
  };
}

const ids = (zones: Zone[]) => zones.map((z) => z.id);
const cards = (z: Zone | undefined) => ((z?.data as CardZoneData | undefined)?.cards ?? []);

describe('fractured-fist glue', () => {
  const g = fracturedFistGlue;
  const hand = (plan: { bench: Zone[] }) => cards(plan.bench.find((z) => z.id === 'p:p1:hand'));
  it('plans your row and theirs on the board and your hand, deck and discard on the bench; no tableau panels', () => {
    const plan = g.plan(input(FF_VIEW, FF_MOVES, { playerId: 'p1', reference: FF_REFERENCE }))!;
    expect(plan).not.toBeNull();
    expect(ids(plan.bench)).toEqual(['p:p1:hand', 'p:p1:deck', 'p:p1:discard']);
    expect(ids(plan.board)).toEqual(['p:p2:played', 'p:p1:played']);
    // The table draws a plan's side zones even beside a screen; the screen
    // puts the supply in the side column itself.
    expect(plan.side).toEqual([]);
    expect(plan.status).toBe('Round 2 · Technique step');
    expect(plan.steps).toEqual([{ id: 'technique', label: 'Technique', current: true }, { id: 'channel', label: 'Channel', current: false }]);
    expect(g.Screen).toBeDefined();
  });
  it('draws one shelf with both players\' counts, yours marked as your own', () => {
    const shelf = cards(fightOf(input(FF_VIEW, FF_MOVES, { playerId: 'p1', reference: FF_REFERENCE }))!.supply);
    expect(shelf.map((c) => c.id)).toEqual(['p:p1:supply:attack', 'p:p1:supply:focus', 'p:p1:supply:momentum']);
    expect(shelf[0]!.counts).toEqual([{ label: 'you', value: 4, own: true }, { label: 'them', value: 5, own: false }]);
    // A card only the other player still has is on the shelf too, at zero for you.
    expect(shelf[1]!.counts).toEqual([{ label: 'you', value: 20, own: true }, { label: 'them', value: 0, own: false }]);
    // Buying lights only your own stacks; the opponent's are never selectable.
    const lit = g.litParts(input(FF_VIEW, FF_MOVES, { playerId: 'p1', reference: FF_REFERENCE }));
    expect(lit).toContain('p:p1:supply:attack');
    expect(lit.some((id) => id.startsWith('p:p2:supply'))).toBe(false);
  });
  it('puts you on the left and the opponent on the right, every number from the view', () => {
    const f = fightOf(input(FF_VIEW, FF_MOVES, { playerId: 'p1', reference: FF_REFERENCE }))!;
    expect(f.left.pid).toBe('p1');
    expect(f.left.self).toBe(true);
    expect(f.me).toBe(f.left);
    expect(f.right).toMatchObject({ pid: 'p2', self: false, who: 'Opponent', stamina: 7, maxStamina: 7, handSize: 5, deckSize: 9, discardSize: 1 });
    expect(f.left).toMatchObject({ who: 'You', active: true, stamina: 6, maxStamina: 7, missteps: 3 });
    expect(f.right.active).toBe(false);
    // As the second seat, you are still on the left.
    const asP2 = fightOf(input(FF_VIEW, [], { playerId: 'p2', reference: FF_REFERENCE }))!;
    expect([asP2.left.pid, asP2.right.pid]).toEqual(['p2', 'p1']);
    // A watcher sees the seats in turn order, by their engine names.
    const watch = fightOf(input(FF_VIEW, []))!;
    expect(watch.me?.pid).toBe('p1');
    const publicView = { ...FF_VIEW, players: { p1: { ...FF_VIEW.players.p1, hand: undefined }, p2: FF_VIEW.players.p2 } };
    const watcher = fightOf(input(publicView, []))!;
    expect(watcher.me).toBeNull();
    expect([watcher.left.who, watcher.right.who]).toEqual(['P1', 'P2']);
  });
  it('the gutter reads what each player queued against the other, without subtracting', () => {
    const f = fightOf(input(FF_VIEW, FF_MOVES, { playerId: 'p1', reference: FF_REFERENCE }))!;
    // You hit them for 1 into their 1 defense; they queued nothing into your 0.
    expect([f.left.damageQueued, f.right.defenseQueued]).toEqual([1, 1]);
    expect([f.right.damageQueued, f.left.defenseQueued]).toEqual([0, 0]);
  });
  it('names cards from the reference data and takes the misstep cap from it, never from a constant', () => {
    const plan = g.plan(input(FF_VIEW, FF_MOVES, { playerId: 'p1', reference: FF_REFERENCE }))!;
    expect(hand(plan).map((c) => c.label)).toEqual(['Focus', 'Misstep', 'Quicken', 'Center', 'Focus']);
    expect(hand(plan)[2]!.badges).toEqual(['+2 Draw']);
    const f = fightOf(input(FF_VIEW, FF_MOVES, { playerId: 'p1', reference: FF_REFERENCE }))!;
    expect([f.left.misstepCap, f.right.misstepCap]).toEqual([10, 10]);
    // Without reference data the cap is simply absent.
    expect(fightOf(input(FF_VIEW, FF_MOVES, { playerId: 'p1' }))!.left.misstepCap).toBeNull();
  });
  it('draws each card face from the reference data: cost in the corner, what a resource is worth, the art by engine id, the kind as its color', () => {
    const plan = g.plan(input(FF_VIEW, FF_MOVES, { playerId: 'p1', reference: FF_REFERENCE }))!;
    const [focus, misstep, quicken] = hand(plan);
    // Cost is the card's own field, not a "cost N" badge.
    expect(quicken).toMatchObject({ cost: 2, badges: ['+2 Draw'], colorKey: 'starter', artUrl: '/cards/fractured-fist/quicken.svg' });
    expect(quicken!.value).toBeUndefined();
    // A resource shows what it is worth, top right and as its chip.
    expect(focus).toMatchObject({ cost: 0, value: 1, badges: ['Worth 1'], colorKey: 'resource', artUrl: '/cards/fractured-fist/focus.svg' });
    // A Misstep has no cost; it says what it is in its own words.
    expect(misstep).toMatchObject({ badges: [], subtitle: 'Cannot be played.', colorKey: 'misstep' });
    expect(misstep!.cost).toBeUndefined();
    // A technique outside the default seven, and one with a school.
    const f = fightOf(input(FF_VIEW, FF_MOVES, { playerId: 'p1', reference: FF_REFERENCE }))!;
    const momentum = cards(f.supply).find((c) => c.id === 'p:p1:supply:momentum')!;
    expect(momentum).toMatchObject({ cost: 3, value: 2, colorKey: 'resource' });
    const withSchool = { ...FF_VIEW, players: { ...FF_VIEW.players, p1: { ...FF_VIEW.players.p1, hand: ['grand-finale'] } } };
    const gf = hand(g.plan(input(withSchool, [], { playerId: 'p1', reference: FF_REFERENCE }))!)[0]!;
    expect(gf).toMatchObject({ cost: 10, colorKey: 'titan-entertainment' });
    // Only files that exist are named: this id has no scene under that name.
    expect(gf.artUrl).toBeUndefined();
    // Without reference data there is no number to show.
    const bare = hand(g.plan(input(FF_VIEW, FF_MOVES, { playerId: 'p1' }))!);
    expect(bare[2]).toMatchObject({ label: 'Quicken', badges: [] });
    expect(bare[2]!.cost).toBeUndefined();
  });
  it('the loadout picker shows the art of each technique and its colored corner, the cost on it in the color of its school', () => {
    const fields = g.setupFields(FF_REFERENCE);
    const opts = fields[0]!.kind === 'multi' ? fields[0]!.options : [];
    expect(opts.find((o) => o.value === 'quicken')).toMatchObject({ badge: '2', art: '/cards/fractured-fist/quicken.svg', corner: { color: '#19A58B', ink: '#111111' } });
    expect(opts.find((o) => o.value === 'grand-finale')).toMatchObject({ badge: '10', corner: { color: '#8A6BB0', ink: '#FF8A1F' } });
  });
  it('shows only the counters the current step can change, and only on your turn', () => {
    const counters = (view: unknown, pid = 'p1') => fightOf(input(view, [], { playerId: pid, reference: FF_REFERENCE }))!.counters.map((c) => `${c.label} ${c.value}`);
    expect(counters(FF_VIEW)).toEqual(['Actions 1']);
    // Not on turn: nothing this turn can change.
    expect(counters(FF_VIEW, 'p2')).toEqual([]);
    const channel = { ...FF_VIEW, phase: 'channel' };
    expect(counters(channel)).toEqual(['Spirit 0', 'Channels 1']);
    const refining = { ...FF_VIEW, players: { ...FF_VIEW.players, p1: { ...FF_VIEW.players.p1, refine_pending: 2 } } };
    expect(counters(refining)).toEqual(['Refines 2', 'Actions 1']);
  });
  it('gives cards stable instance ids that carry across events', () => {
    const memory = new Map<string, unknown>();
    const first = g.plan(input(FF_VIEW, FF_MOVES, { playerId: 'p1', reference: FF_REFERENCE, seq: 1, memory }))!;
    const quicken = hand(first)[2]!.id!;
    const after = {
      ...FF_VIEW,
      players: { ...FF_VIEW.players, p1: { ...FF_VIEW.players.p1, hand: ['focus', 'misstep', 'center', 'focus'], played: ['attack', 'quicken'] } },
    };
    const second = g.plan(input(after, [], {
      playerId: 'p1', reference: FF_REFERENCE, seq: 2, memory,
      engineMove: { type: 'play_card', card_id: 'quicken', hand_index: 2 }, actorPlayerId: 'p1',
    }))!;
    const played = second.board.find((z) => z.id === 'p:p1:played')!;
    expect(cards(played).map((c) => c.id)).toContain(quicken);
    expect(hand(second).map((c) => c.id)).not.toContain(quicken);
  });
  it('a bought card flies in from its stack on the shelf', () => {
    const memory = new Map<string, unknown>();
    g.plan(input(FF_VIEW, FF_MOVES, { playerId: 'p1', reference: FF_REFERENCE, seq: 1, memory }));
    const after = {
      ...FF_VIEW,
      players: { ...FF_VIEW.players, p1: { ...FF_VIEW.players.p1, discard: ['misstep', 'focus', 'attack'], discard_size: 3, supply: { attack: 3, focus: 20, momentum: 19 } } },
    };
    const second = g.plan(input(after, [], { playerId: 'p1', reference: FF_REFERENCE, seq: 2, memory, engineMove: { type: 'buy_card', card_id: 'attack' }, actorPlayerId: 'p1' }))!;
    const discard = second.bench.find((z) => z.id === 'p:p1:discard')!;
    expect(discard.kind === 'card-zone' && discard.arriveFrom).toBe('ff:supply');
    const state = memory.get('ff:identity:p1') as { state: { zones: Record<string, string[]>; arrivals: Record<string, string> } };
    const bought = state.state.zones['discard']![2]!;
    expect(state.state.arrivals[bought]).toBe('p:p1:supply:attack');
  });
  it('lights playable hand cards by instance and buyable supply piles', () => {
    const memory = new Map<string, unknown>();
    const inp = input(FF_VIEW, FF_MOVES, { playerId: 'p1', reference: FF_REFERENCE, memory });
    const plan = g.plan(inp)!;
    const lit = g.litParts(inp);
    const quicken = hand(plan)[2]!.id!;
    expect(lit).toContain(quicken);
    expect(lit).toContain('p:p1:supply:attack');
    expect(lit).not.toContain('advance-phase');
    expect(lit).toHaveLength(2);
  });
  it('maps a tap back to the move', () => {
    const memory = new Map<string, unknown>();
    const inp = input(FF_VIEW, FF_MOVES, { playerId: 'p1', reference: FF_REFERENCE, memory });
    const plan = g.plan(inp)!;
    const quicken = hand(plan)[2]!.id!;
    expect(g.moveForSelect({ component: 'card', id: quicken, label: 'Quicken' }, inp)?.move_id).toBe('play-2-quicken');
    expect(g.moveForSelect({ component: 'card', id: 'p:p1:supply:attack', label: 'Attack' }, inp)?.move_id).toBe('buy-attack');
    expect(g.moveForSelect({ component: 'card', id: hand(plan)[0]!.id!, label: 'Focus' }, inp)).toBeNull();
  });
  it('puts the arcade theme on the table for a seat and a watcher, and nothing on a view from another game', () => {
    expect(g.themeFor!(input(FF_VIEW, [], { playerId: 'p1' }))).toBe('ff-theme');
    expect(g.themeFor!(input(FF_VIEW, []))).toBe('ff-theme');
    expect(g.themeFor!(input({ game_id: 'something-else' }, []))).toBeNull();
    expect(g.themeFor!(input(null, []))).toBeNull();
  });
  it('has no resolve_report (no dice, and the engine resolves every draw itself)', () => {
    expect(g.resolveReportMove(FF_MOVES)).toBeNull();
  });
  it('the action bar holds the moves that move the turn, each only while the engine lists it', () => {
    const plan = g.plan(input(FF_VIEW, FF_MOVES, { playerId: 'p1', reference: FF_REFERENCE }))!;
    expect(plan.prompt!.title).toBe('Technique step');
    expect(plan.prompt!.actions.map((a) => a.id)).toEqual(['advance-phase']);
    const withEnd = g.plan(input(FF_VIEW, [...FF_MOVES, { move_id: 'end-turn', description: 'End turn', move: { type: 'end_turn' } }, { move_id: 'focus-reload', description: 'Focus reload', move: { type: 'focus_reload' } }], { playerId: 'p1', reference: FF_REFERENCE }))!;
    expect(withEnd.prompt!.actions.map((a) => a.id)).toEqual(['focus-reload', 'advance-phase', 'end-turn']);
    const end = withEnd.prompt!.actions.find((a) => a.id === 'end-turn')!;
    expect('move' in end && end.move.move).toEqual({ type: 'end_turn' });
    expect(end.primary).toBe(true);
    // Not your turn: words, no buttons.
    const theirs = g.plan(input({ ...FF_VIEW, active_player_id: 'p2' }, [], { playerId: 'p1', reference: FF_REFERENCE }))!;
    expect(theirs.prompt!.title).toBe('Opponent is taking their turn');
    expect(theirs.prompt!.actions).toEqual([]);
    // A refine window is an interrupt with one way out besides picking.
    const refining = { ...FF_VIEW, players: { ...FF_VIEW.players, p1: { ...FF_VIEW.players.p1, refine_pending: 1 } } };
    const r = g.plan(input(refining, [{ move_id: 'refine-0-focus', description: 'Refine Focus', move: { type: 'refine_card', hand_index: 0 } }, { move_id: 'skip-refine', description: 'Skip', move: { type: 'skip_refine' } }], { playerId: 'p1', reference: FF_REFERENCE }))!;
    expect(r.prompt!.title).toBe('Remove 1 more card');
    expect(r.prompt!.urgent).toBe(true);
    expect(r.prompt!.actions.map((a) => a.id)).toEqual(['skip-refine']);
  });
  it('offers "play all resources" only when more than one resource play is listed, and says what it spends', () => {
    const channel = { ...FF_VIEW, phase: 'channel', players: { ...FF_VIEW.players, p1: { ...FF_VIEW.players.p1, hand: ['focus', 'misstep', 'quicken', 'momentum', 'focus'] } } };
    const plays = [
      { move_id: 'play-0-focus', description: 'Play Focus for 1 spirit', move: { type: 'play_card', card_id: 'focus', hand_index: 0 } },
      { move_id: 'play-3-momentum', description: 'Play Momentum for 2 spirit', move: { type: 'play_card', card_id: 'momentum', hand_index: 3 } },
      { move_id: 'play-4-focus', description: 'Play Focus for 1 spirit', move: { type: 'play_card', card_id: 'focus', hand_index: 4 } },
      { move_id: 'end-turn', description: 'End turn', move: { type: 'end_turn' } },
    ];
    const memory = new Map<string, unknown>();
    const plan = g.plan(input(channel, plays, { playerId: 'p1', reference: FF_REFERENCE, memory }))!;
    const all = plan.prompt!.actions.find((a) => a.id === 'play-all-resources')!;
    expect(all.label).toBe('Play all resources · +4');
    expect(all.note).toBeUndefined();
    const batch = 'batch' in all ? all.batch : [];
    expect(batch.map((b) => b.id)).toEqual([hand(plan)[0]!.id, hand(plan)[3]!.id, hand(plan)[4]!.id]);
    // With a reload still legal, the button says the Focus go with it.
    const withReload = g.plan(input(channel, [...plays, { move_id: 'focus-reload', description: 'Focus reload', move: { type: 'focus_reload' } }], { playerId: 'p1', reference: FF_REFERENCE, memory }))!;
    expect(withReload.prompt!.actions.find((a) => a.id === 'play-all-resources')!.note).toBe('spends your 2 Focus');
    // One resource play: no button, the card itself is the press.
    const one = g.plan(input(channel, [plays[1]!, plays[3]!], { playerId: 'p1', reference: FF_REFERENCE, memory }))!;
    expect(one.prompt!.actions.map((a) => a.id)).toEqual(['end-turn']);
  });
  it('reads the strike from the views before and after the round ended, never from arithmetic of its own', () => {
    const before = { ...FF_VIEW, players: { ...FF_VIEW.players, p1: { ...FF_VIEW.players.p1, damage_queued: 2, defense_queued: 0 }, p2: { ...FF_VIEW.players.p2, damage_queued: 3, defense_queued: 1, stamina: 6 } } };
    const after = { ...FF_VIEW, round: 3, players: { ...FF_VIEW.players, p1: { ...FF_VIEW.players.p1, stamina: 3, damage_queued: 0, played: [] }, p2: { ...FF_VIEW.players.p2, stamina: 5, damage_queued: 0, defense_queued: 0 } } };
    const m = g.momentFor!({ before, after, summary: 'End of round 2. Strike: p1 dealt 1, p2 dealt 3.', engineMove: { type: 'end_turn' }, playerId: 'p1', reference: FF_REFERENCE })! as StrikeMoment;
    expect(m.kind).toBe('strike');
    expect(m.title).toBe('Round 2 · strike');
    expect(m.over).toBe(false);
    expect(m.lanes).toEqual([
      { attacker: 'p1', target: 'p2', hit: 2, shield: 1, through: 1, before: 6, after: 5, max: 7 },
      { attacker: 'p2', target: 'p1', hit: 3, shield: 0, through: 3, before: 6, after: 3, max: 7 },
    ]);
    // No round change, no moment; the game ending on the strike is a moment that is over.
    expect(g.momentFor!({ before, after: before, summary: '', engineMove: null, playerId: 'p1', reference: FF_REFERENCE })).toBeNull();
    const over = { ...after, phase: 'game_over', players: { ...after.players, p1: { ...after.players.p1, stamina: 0 } } };
    expect(g.momentFor!({ before, after: over, summary: '', engineMove: null, playerId: 'p1', reference: FF_REFERENCE })!.over).toBe(true);
  });
  it('presents the loadout as a seven-pick grouped by school with nothing preselected and the default as a preset', () => {
    const fields = g.setupFields(FF_REFERENCE);
    expect(fields).toHaveLength(1);
    const f = fields[0]!;
    if (f.kind !== 'multi') throw new Error('the loadout is a multi pick');
    expect(f.pick).toBe(7);
    expect(f.options.map((o) => o.value)).toEqual(['quicken', 'center', 'attack', 'block', 'grand-finale']);
    expect(f.groups!.map((gr) => gr.key)).toEqual(['none', 'Titan Entertainment']);
    const finale = f.options.find((o) => o.value === 'grand-finale')!;
    expect(finale.group).toBe('Titan Entertainment');
    expect(finale.badge).toBe('10');
    expect(finale.chips).toEqual(['+5 Damage']);
    expect(f.options.find((o) => o.value === 'attack')!.tag).toBe('default seven');
    expect(f.preset).toEqual({ label: 'Use the default seven', values: ['attack', 'block', 'center', 'quicken'] });
    expect(f.summarize!(['attack', 'grand-finale', 'quicken'])).toEqual({ chips: ['Damage 6', 'Draw 2'], note: 'Cheapest 2 spirit, dearest 10.' });
    expect(f.summarize!([])).toEqual({ chips: [], note: undefined });
  });
});
