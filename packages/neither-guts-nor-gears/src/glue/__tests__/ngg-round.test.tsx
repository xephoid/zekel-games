// The NGnG round screens (setup, planning, Cores, draws, treaties, heroes,
// the end) drawn from views the engine produced, plus hand-made views for the
// three decisions no fixture captures (setup factions, overlay choice, a
// reserved hero). Each test checks the agency rules: nothing is selected for
// the person, nothing is sent without a press, a press sends a listed move or
// a listed template completed on its editable key only, a shut option prints
// the engine's reason, and a watcher has no live control.

import { describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, within } from '@testing-library/react';
import type { GameReferenceResponse, LegalMove } from '@zekel/wire-types';
import type { GameScreenProps, GlueInput } from '@zekel/glue-kit';
import { NggScreen } from '../table/NggScreen.js';
import { DiplomacyPanel } from '../table/screens/round.js';
import { makeCtx } from '../table/ctx.js';
import { readView } from '../table/read.js';
import { route } from '../table/route.js';
import { isSubmissionAllowed } from '@zekel/glue-kit';
import REFERENCE from './fixtures/ngg-reference.json';

interface Fixture {
  key: string;
  viewer: string;
  view: Record<string, unknown>;
  legalMoves: LegalMove[];
  watcher: string;
  watcherView: Record<string, unknown>;
  watcherLegalMoves: LegalMove[];
}

const ALL = import.meta.glob<Fixture>('./fixtures/ngg/*.json', { eager: true, import: 'default' });
// Views whose exact content these tests assert (fixtures/ngg-pinned/README.md).
const PINNED = import.meta.glob<Fixture>('./fixtures/ngg-pinned/*.json', { eager: true, import: 'default' });
function pinned(name: string): Fixture {
  const f = PINNED[`./fixtures/ngg-pinned/${name}.json`];
  if (!f) throw new Error(`no pinned fixture ${name}`);
  return structuredClone(f);
}

function fixture(name: string): Fixture {
  const f = ALL[`./fixtures/ngg/${name}.json`];
  if (!f) throw new Error(`no fixture ${name}`);
  return JSON.parse(JSON.stringify(f)) as Fixture;
}

function inputFor(view: unknown, playerId: string, legalMoves: LegalMove[]): GlueInput {
  return {
    view, previous: null, legalMoves, playerId, reference: REFERENCE as GameReferenceResponse, seq: 1,
    engineMove: null, actorPlayerId: null, memory: new Map(),
  };
}

function lm(move: Record<string, unknown>, description = ''): LegalMove {
  return { move_id: '', description, move } as LegalMove;
}

function draw(view: unknown, playerId: string, legalMoves: LegalMove[], yourTurn = true) {
  const onMove = vi.fn();
  const onForm = vi.fn();
  const r = render(
    <NggScreen input={inputFor(view, playerId, legalMoves)} yourTurn={yourTurn} busy={false} interactive
      onMove={onMove} onForm={onForm} nameFor={(p) => `Seat ${p}`} />,
  );
  const column = r.container.querySelector('.ngg-column') as HTMLElement;
  return { ...r, onMove, onForm, column };
}

function press(scope: HTMLElement, name: RegExp | string) {
  const button = within(scope).getByRole('button', { name });
  expect((button as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(button);
}

/** Nothing pre-selected: no pressed option, no checked radio. */
function expectNothingSelected(scope: HTMLElement) {
  expect(scope.querySelectorAll('[aria-pressed="true"]')).toHaveLength(0);
  expect(scope.querySelectorAll('[aria-checked="true"]')).toHaveLength(0);
  expect(scope.querySelectorAll('.ngg-option.selected')).toHaveLength(0);
}

/** No raw seat id and no raw "c,r" coord in what the decision prints. */
function expectNoRawIds(scope: HTMLElement) {
  const text = scope.textContent ?? '';
  expect(text).not.toMatch(/\bp[1-6]\b/);
  expect(text).not.toMatch(/-?\d+,-?\d+/);
}

function expectSentListed(onMove: ReturnType<typeof vi.fn>, legal: LegalMove[], expected: Record<string, unknown>) {
  expect(onMove).toHaveBeenCalledTimes(1);
  const sent = onMove.mock.calls[0]![0] as LegalMove;
  expect(legal).toContain(sent);
  expect(sent.move).toEqual(expected);
}

function expectFormAllowed(onForm: ReturnType<typeof vi.fn>, legal: LegalMove[]) {
  expect(onForm).toHaveBeenCalledTimes(1);
  const [template, move, keys] = onForm.mock.calls[0]! as [LegalMove, Record<string, unknown>, string[]];
  expect(legal).toContain(template);
  expect(isSubmissionAllowed('form', move, legal, { template: template.move, editableKeys: keys })).toBe(true);
  return { template, move, keys };
}

// Views the fixtures do not capture, made from one that does.
function setupFactionsView() {
  const f = fixture('phase-planning');
  const view = f.view;
  view['phase'] = 'setup_factions';
  view['active_player_id'] = null;
  for (const p of view['players'] as Array<Record<string, unknown>>) { p['faction'] = null; p['species'] = null; }
  const legal = [lm({ type: 'assign_setup_choices', selections: { p1: 'covenant', p2: 'schism' } }, 'Assign each player a faction')];
  return { view, legal, viewer: f.viewer };
}

describe('NGnG round screens', () => {
  it('Setup Table: every seat must be set by the person; the default map is never sent', () => {
    const { view, legal, viewer } = setupFactionsView();
    const r = draw(view, viewer, legal);
    expectNothingSelected(r.column);
    const start = within(r.column).getByRole('button', { name: 'Start the Leader draft' }) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    // Set only one seat: still shut.
    fireEvent.click(within(within(r.column).getByRole('radiogroup', { name: /Faction for Seat p1/ })).getByRole('radio', { name: /The Foundry/ }));
    expect(start.disabled).toBe(true);
    fireEvent.click(within(within(r.column).getByRole('radiogroup', { name: /Faction for Seat p2/ })).getByRole('radio', { name: /The Ledger/ }));
    expect(r.onForm).not.toHaveBeenCalled();
    expect(start.disabled).toBe(false);
    fireEvent.click(start);
    const { move, keys } = expectFormAllowed(r.onForm, legal);
    expect(keys).toEqual(['selections']);
    expect(move['selections']).toEqual({ p1: 'foundry', p2: 'ledger' });
    cleanup();
  });

  it('Setup Table: a seat with no move watches, with no picker', () => {
    const { view } = setupFactionsView();
    const r = draw(view, 'p2', [], false);
    expect(r.column.querySelectorAll('[role="radio"]')).toHaveLength(0);
    expect(r.column.querySelectorAll('button:not(:disabled):not([data-view-only])')).toHaveLength(0);
    cleanup();
  });

  it('Setup Draft: printed effect and star from the reference; tap then Take sends the listed move', () => {
    const f = fixture('pending-choose_leader');
    const r = draw(f.view, f.viewer, f.legalMoves);
    expectNothingSelected(r.column);
    expect(r.column.textContent).toContain('Gain a battle strategy card.');
    // The same facts as the Heroes list: the star, kind and species, stats, and
    // the ability on one line until the hero is selected.
    expect(r.column.querySelector('.ngg-hero-star[title="Recommended Leader"]')).not.toBeNull();
    expect(r.column.textContent).toContain('wizards only');
    expect(r.column.textContent).toMatch(/Init \d+ DMG \d+ DEF \d+/);
    const elara = [...r.column.querySelectorAll('.ngg-option')].find((el) => el.textContent?.includes('Archmage Elara'))!;
    expect(elara.querySelector('.ngg-hero-effect')!.classList.contains('clamped')).toBe(true);
    const take = within(r.column).getByRole('button', { name: 'Take a hero' }) as HTMLButtonElement;
    expect(take.disabled).toBe(true);
    press(r.column, /Archmage Elara/);
    expect(r.onMove).not.toHaveBeenCalled();
    // Selected, its whole ability shows.
    const opened = [...r.column.querySelectorAll('.ngg-option')].find((el) => el.textContent?.includes('Archmage Elara'))!;
    expect(opened.querySelector('.ngg-hero-effect')!.classList.contains('clamped')).toBe(false);
    press(r.column, 'Take Archmage Elara');
    expectSentListed(r.onMove, f.legalMoves, { type: 'choose_leader', hero: 'Archmage Elara' });
    cleanup();
  });

  it('Setup Start: a numbered site maps to its tile; taken sites name their owner', () => {
    const f = fixture('pending-choose_starting_location-multi');
    const r = draw(f.view, f.viewer, f.legalMoves);
    expectNothingSelected(r.column);
    expectNoRawIds(r.column);
    expect(r.column.textContent).toContain('Taken · The Ledger');
    press(r.column, /Site 2 · G7/);
    expect(r.onMove).not.toHaveBeenCalled();
    press(r.column, /Start at site 2/);
    expectSentListed(r.onMove, f.legalMoves, { type: 'choose_starting_location', location: '@2' });
    cleanup();
  });

  it('Setup Start: the map lights only the listed sites and a lit site selects', () => {
    const f = fixture('pending-choose_starting_location-multi');
    const r = draw(f.view, f.viewer, f.legalMoves);
    const lit = r.container.querySelectorAll('button.ngg-hex.lit');
    expect(lit).toHaveLength(1);
    fireEvent.click(lit[0]!);
    expect(r.onMove).not.toHaveBeenCalled();
    press(r.column, /Start at site 2/);
    expect(r.onMove).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it('Choice Planning: a card sends its listed plan_action; Pass sends the listed pass', () => {
    const f = fixture('phase-planning');
    const r = draw(f.view, f.viewer, f.legalMoves);
    expect(r.onMove).not.toHaveBeenCalled();
    press(r.column, /Research/);
    expectSentListed(r.onMove, f.legalMoves, { type: 'plan_action', card: 'research', which: 'base' });
    r.onMove.mockClear();
    press(r.column, 'Pass for the round');
    expectSentListed(r.onMove, f.legalMoves, { type: 'plan_action', card: 'pass' });
    cleanup();
  });

  it('Core Reallocation: toggles compose one allocations map on the listed template', () => {
    const f = fixture('pending-upkeep_reallocate_cores-multi');
    const r = draw(f.view, f.viewer, f.legalMoves);
    expectNothingSelected(r.column);
    expectNoRawIds(r.column);
    const move = within(r.column).getByRole('button', { name: 'Move the Cores' }) as HTMLButtonElement;
    expect(move.disabled).toBe(true);
    // Robot collectors hold Cores too, named by type, never by id.
    fireEvent.click(within(r.column).getAllByRole('button', { name: /Water collector/ })[0]!);
    expect(r.onForm).not.toHaveBeenCalled();
    fireEvent.click(move);
    const sent = expectFormAllowed(r.onForm, f.legalMoves);
    expect(sent.keys).toEqual(['allocations']);
    expect(sent.move['allocations']).toMatchObject({ 'water-collector-1': false, 'water-collector-2': true });
    cleanup();
  });

  it('Core Reallocation: Leave them sends the listed keep-as-is move', () => {
    const f = fixture('pending-upkeep_reallocate_cores-multi');
    const r = draw(f.view, f.viewer, f.legalMoves);
    press(r.column, 'Leave them where they are');
    expectSentListed(r.onMove, f.legalMoves, f.legalMoves[0]!.move);
    cleanup();
  });

  it('Report Draw: a digital seat is told what the draw is for and sends nothing from here', () => {
    const f = fixture('pending-report_draw');
    const r = draw(f.view, f.viewer, f.legalMoves);
    expect(r.column.textContent).toContain('Draw a battle card');
    expect(r.column.textContent).toContain('Leader draft');
    expect(r.column.querySelectorAll('.ngg-panel.hl button')).toHaveLength(0);
    cleanup();
  });

  it('Report Draw: a physical seat picks the card it drew; the template default is not pre-picked', () => {
    const f = fixture('pending-report_draw');
    const legal = [lm({ type: 'report_draw', card: 'Retreat' })];
    const r = draw(f.view, f.viewer, legal);
    expectNothingSelected(r.column);
    const report = within(r.column).getByRole('button', { name: 'Report the card' }) as HTMLButtonElement;
    expect(report.disabled).toBe(true);
    press(r.column, /^Battle card\s*Counter/);
    press(r.column, 'Report Counter');
    const sent = expectFormAllowed(r.onForm, legal);
    expect(sent.move).toEqual({ type: 'report_draw', card: 'Counter' });
    cleanup();
  });

  it('Treaty Response: drawn as an interrupt; Accept and Decline send the listed moves', () => {
    const f = fixture('pending-treaty_response');
    const r = draw(f.view, f.viewer, f.legalMoves);
    const dialog = r.getByRole('dialog', { name: /out of turn/ });
    expectNoRawIds(dialog);
    expect(r.onMove).not.toHaveBeenCalled();
    press(dialog, /Accept/);
    expectSentListed(r.onMove, f.legalMoves, { type: 'respond_treaty', accept: true });
    cleanup();
  });

  it('Treaty Response: the offering seat watches with no dialog', () => {
    const f = fixture('pending-treaty_response');
    const r = draw(f.watcherView, f.watcher, f.watcherLegalMoves, false);
    expect(r.queryByRole('dialog')).toBeNull();
    cleanup();
  });

  it('Treaty Break: a shut treaty prints the engine reason and cannot be picked; Keep keeps them all', () => {
    const f = fixture('pending-treaty_break_decision-blocked');
    const reason = (f.view['pending'] as { options: Array<{ blocked_reason?: string }> }).options.find((o) => o.blocked_reason)!.blocked_reason!;
    const r = draw(f.view, f.viewer, f.legalMoves);
    expect(r.column.textContent).toContain(reason);
    expect((within(r.column).getByRole('button', { name: 'Break a treaty' }) as HTMLButtonElement).disabled).toBe(true);
    press(r.column, 'Keep');
    expectSentListed(r.onMove, f.legalMoves, { type: 'skip_action' });
    cleanup();
  });

  it('Treaty Break: pick an open treaty, then Break sends the listed break', () => {
    const f = fixture('pending-treaty_break_decision');
    const r = draw(f.view, f.viewer, f.legalMoves);
    expectNothingSelected(r.column);
    expect(r.column.textContent).toContain('End of round, provided allied units do not share a space.');
    press(r.column, /Open Borders with The Unbolted/);
    expect(r.onMove).not.toHaveBeenCalled();
    press(r.column, 'Break Open Borders');
    expectSentListed(r.onMove, f.legalMoves, { type: 'break_treaty', treaty_type: 'Open Borders', partner: 'p2' });
    cleanup();
  });

  it('Treaty Break: a watcher sees the public options with nothing live', () => {
    const f = fixture('pending-treaty_break_decision');
    const r = draw(f.watcherView, f.watcher, f.watcherLegalMoves, false);
    expect(r.column.textContent).toContain('Open Borders with The Unbolted');
    expect(r.column.querySelectorAll('button:not(:disabled):not([data-view-only])')).toHaveLength(0);
    cleanup();
  });

  it('Hero Claim: tap then Claim sends the listed claim', () => {
    const f = fixture('pending-choose_milestone_hero');
    const r = draw(f.view, f.viewer, f.legalMoves);
    expectNothingSelected(r.column);
    press(r.column, /Kestrel Nine/);
    press(r.column, 'Claim Kestrel Nine');
    expectSentListed(r.onMove, f.legalMoves, { type: 'choose_milestone_hero', hero: 'Kestrel Nine' });
    cleanup();
  });

  it('Spy Assign: carriers with their tiles; tap then Assign sends the listed move', () => {
    const f = pinned('pending-choose_spy-4p');
    const r = draw(f.view, f.viewer, f.legalMoves);
    expectNothingSelected(r.column);
    expectNoRawIds(r.column);
    expect(r.column.textContent).toContain('Only you see this');
    press(r.column, /Warden Hesper Quill/);
    press(r.column, 'Assign to Warden Hesper Quill');
    expectSentListed(r.onMove, f.legalMoves, { type: 'choose_spy', hero: 'Warden Hesper Quill' });
    cleanup();
  });

  it('Spy Assign: a watcher is not shown the carriers', () => {
    const f = pinned('pending-choose_spy-4p');
    const r = draw(f.watcherView, f.watcher, f.watcherLegalMoves, false);
    expect(r.column.textContent).not.toContain('Which hero carries it');
    cleanup();
  });

  it('Reserved Hero: the listed bases light; tap one, then Place', () => {
    const f = pinned('pending-choose_spy-4p');
    const view = f.view;
    view['pending'] = { kind: 'place_reserved_hero', for: f.viewer, question: 'places their reserved hero' };
    const legal = [lm({ type: 'place_reserved_hero', hero: 'Kestrel Nine', coord: '2,2' })];
    const r = draw(view, f.viewer, legal);
    expectNothingSelected(r.column);
    expectNoRawIds(r.column);
    const lit = r.container.querySelectorAll('button.ngg-hex.lit');
    expect(lit).toHaveLength(1);
    fireEvent.click(lit[0]!);
    expect(r.onMove).not.toHaveBeenCalled();
    press(r.column, /Place Kestrel Nine on G2/);
    expectSentListed(r.onMove, legal, { type: 'place_reserved_hero', hero: 'Kestrel Nine', coord: '2,2' });
    cleanup();
  });

  it('Overlay Choice: two listed heroes, nothing chosen until the person picks', () => {
    const f = pinned('pending-choose_spy-4p');
    const view = f.view;
    view['pending'] = { kind: 'overlay_choice', for: f.viewer, question: 'picks the active Economy overlay' };
    const legal = [
      lm({ type: 'resolve_overlay_choice', hero: 'Archmage Chaimidious' }),
      lm({ type: 'resolve_overlay_choice', hero: 'Marshal Corvin Ashlock' }),
    ];
    const r = draw(view, f.viewer, legal);
    expectNothingSelected(r.column);
    expectNoRawIds(r.column);
    expect((within(r.column).getByRole('button', { name: 'Choose an overlay' }) as HTMLButtonElement).disabled).toBe(true);
    press(r.column, /Marshal Corvin Ashlock/);
    press(r.column, "Make Marshal Corvin Ashlock's overlay active");
    expectSentListed(r.onMove, legal, { type: 'resolve_overlay_choice', hero: 'Marshal Corvin Ashlock' });
    cleanup();
  });

  it('The End: the winner by faction, standings from victory_status, no raw ids', () => {
    const f = pinned('phase-game_over');
    const r = draw(f.view, f.viewer, f.legalMoves, false);
    expect(r.column.textContent).toContain('The Covenant wins');
    expect(r.column.textContent).toContain('culture 107');
    expect(r.column.textContent).toContain('tech 15 of 18');
    expectNoRawIds(r.column);
    cleanup();
  });

  it('The quiet routes draw the table with nothing to press', () => {
    const f = fixture('phase-planning');
    const view = f.view;
    view['phase'] = 'culture';
    const r = draw(view, f.viewer, [], false);
    expect(r.column.textContent).toContain('Culture income');
    expect(r.column.querySelectorAll('button:not([data-view-only])')).toHaveLength(0);
    cleanup();
  });

  for (const name of [
    'pending-choose_leader', 'pending-choose_starting_location', 'phase-planning', 'pending-upkeep_reallocate_cores-multi',
    'pending-report_draw', 'pending-treaty_response', 'pending-treaty_break_decision', 'pending-choose_milestone_hero',
    'phase-game_over',
  ]) {
    it(`${name}: a watcher has no live control and nothing is sent`, () => {
      const f = fixture(name);
      const r = draw(f.watcherView, f.watcher, f.watcherLegalMoves, false);
      expect(r.column.querySelectorAll('button:not(:disabled):not([data-view-only])')).toHaveLength(0);
      expect(r.container.querySelectorAll('button.ngg-hex')).toHaveLength(0);
      expectNoRawIds(r.column);
      expect(r.onMove).not.toHaveBeenCalled();
      expect(r.onForm).not.toHaveBeenCalled();
      cleanup();
    });
  }
});

describe('DiplomacyPanel', () => {
  function ctxFor(f: Fixture, legal: LegalMove[], live = true) {
    const v = readView(f.view)!;
    const onMove = vi.fn();
    const props: GameScreenProps = {
      input: inputFor(f.view, f.viewer, legal), yourTurn: live, busy: false, interactive: true,
      onMove, onForm: vi.fn(), nameFor: (p) => `Seat ${p}`,
    };
    return { ctx: makeCtx(props, v, route(v, f.viewer, legal)), onMove };
  }

  it('draws nothing without a listed form_treaty', () => {
    const f = pinned('pending-choose_spy-4p');
    const { ctx } = ctxFor(f, f.legalMoves);
    const r = render(<DiplomacyPanel ctx={ctx} />);
    expect(r.container.textContent).toBe('');
    cleanup();
  });

  it('offers only the listed partners and types, with printed text, and sends on a press', () => {
    const f = pinned('pending-choose_spy-4p');
    const legal = [
      lm({ type: 'form_treaty', partner: 'p1', treaty_type: 'Culture Treaty' }),
      lm({ type: 'form_treaty', partner: 'p1', treaty_type: 'Shared Tactics' }),
      lm({ type: 'form_treaty', partner: 'p2', treaty_type: 'Shared Tactics' }),
    ];
    const { ctx, onMove } = ctxFor(f, legal);
    const r = render(<DiplomacyPanel ctx={ctx} />);
    const panel = r.container as HTMLElement;
    expectNoRawIds(panel);
    expect(panel.textContent).toContain('Standing treaties');
    press(panel, /Offer a treaty/);
    expectNothingSelected(panel);
    expect(within(panel).queryByRole('button', { name: /The Schism/ })).toBeNull();
    press(panel, /The Unbolted/);
    expect(panel.textContent).toContain('Direct partners share an eligible partner');
    expect(within(panel).queryByRole('button', { name: /^Peace/ })).toBeNull();
    expect((within(panel).getByRole('button', { name: 'Send the offer' }) as HTMLButtonElement).disabled).toBe(true);
    press(panel, /^Culture Treaty/);
    expect(onMove).not.toHaveBeenCalled();
    press(panel, 'Offer Culture Treaty to The Unbolted');
    expectSentListed(onMove, legal, { type: 'form_treaty', partner: 'p1', treaty_type: 'Culture Treaty' });
    cleanup();
  });

  it('a seat whose turn it is not cannot open the offer', () => {
    const f = pinned('pending-choose_spy-4p');
    const legal = [lm({ type: 'form_treaty', partner: 'p1', treaty_type: 'Peace' })];
    const { ctx } = ctxFor(f, legal, false);
    const r = render(<DiplomacyPanel ctx={ctx} />);
    // Not live: makeCtx gives a non-deciding seat no legal moves, so nothing draws.
    expect(r.container.querySelectorAll('button:not(:disabled):not([data-view-only])')).toHaveLength(0);
    cleanup();
  });
});

describe('NGnG: each human picks their own faction', () => {
  it('strikes the taken faction with the engine reason and who holds it, and sends only the pressed pick', async () => {
    const { render, fireEvent, screen, cleanup } = await import('@testing-library/react');
    const { vi } = await import('vitest');
    const { NggScreen } = await import('../table/NggScreen.js');
    const REF = (await import('./fixtures/ngg-reference.json')).default;
    const f = (await import('./fixtures/ngg/pending-choose_faction.json')).default as unknown as {
      viewer: string; view: unknown; legalMoves: Array<{ move_id: string; description: string; move: Record<string, unknown> }>;
    };
    const onMove = vi.fn();
    render(<NggScreen input={{ view: f.view, previous: null, legalMoves: f.legalMoves, playerId: f.viewer, reference: REF as never, seq: 1, engineMove: null, actorPlayerId: null, memory: new Map() }}
      yourTurn busy={false} interactive onMove={onMove} onForm={vi.fn()} nameFor={(p) => (p === 'p1' ? 'Ada' : p)} />);
    expect(screen.getByText(/The Covenant is already taken/)).toBeTruthy();
    expect(screen.getByText(/held by Ada/)).toBeTruthy();
    const take = screen.getByRole('button', { name: 'Take a faction' }) as HTMLButtonElement;
    expect(take.disabled).toBe(true);
    fireEvent.click(screen.getAllByRole('button', { name: /^The Foundry/ })[0]!);
    expect(onMove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Play The Foundry' }));
    expect(onMove.mock.calls[0]![0].move).toEqual({ type: 'choose_faction', faction: 'foundry' });
    cleanup();
  });
  it('Action Done: a finished action offers End action, which sends the listed finish', () => {
    const f = fixture('action-build');
    const view = f.view as { resolving_action: Record<string, unknown> };
    view.resolving_action = { ...view.resolving_action, finished: true };
    const legal: LegalMove[] = [{ move_id: 'end', description: 'Finish the build action without offering a treaty.', move: { type: 'skip_action' } }];
    const r = draw(view, f.viewer, legal);
    expect(r.column.textContent).toContain('Your Build action is done');
    expect(within(r.column).queryByRole('button', { name: /Skip/ })).toBeNull();
    press(r.column, 'End action');
    expectSentListed(r.onMove, legal, { type: 'skip_action' });
    cleanup();
  });

  it('Treaty Response: the offer shows who is offering by their faction mark and colour', () => {
    const f = fixture('pending-treaty_response');
    const r = draw(f.view, f.viewer, f.legalMoves);
    const box = r.container.querySelector('.ngg-interrupt') as HTMLElement;
    const band = box.querySelector('.ngr-proposer') as HTMLElement;
    expect(band).not.toBeNull();
    expect(band.querySelector('.ngg-chip')).not.toBeNull();
    const proposer = (f.view as { pending: { context: { proposer: string } } }).pending.context.proposer;
    const faction = (f.view as { players: Array<{ player_id: string; faction: string }> }).players.find((p) => p.player_id === proposer)!.faction;
    expect(band.textContent).toContain(faction);
    expect(band.style.borderColor).not.toBe('');
    cleanup();
  });
  it('Planning: each action card copy is its own card, sent by the slot the engine names it', () => {
    const f = fixture('phase-planning');
    const view = f.view as { players: Array<Record<string, unknown>> };
    const me = view.players.find((p) => p['player_id'] === f.viewer)!;
    me['action_cards'] = { build: 2, moveBattle: 1, research: 1 };
    me['action_card_slots'] = { build: ['base', 'researched_extra'], moveBattle: ['base'], research: ['base'] };
    const legal: LegalMove[] = [
      { move_id: 'b1', description: 'base', move: { type: 'plan_action', card: 'build', which: 'base' } },
      { move_id: 'b2', description: 'researched', move: { type: 'plan_action', card: 'build', which: 'researched_extra' } },
      { move_id: 'p', description: 'pass', move: { type: 'plan_action', card: 'pass' } },
    ];
    const r = draw(view, f.viewer, legal);
    const extra = within(r.column).getAllByRole('button').find((b) => b.textContent?.includes('Researched extra'))!;
    fireEvent.click(extra);
    expectSentListed(r.onMove, legal, { type: 'plan_action', card: 'build', which: 'researched_extra' });
    cleanup();
  });
});
