// Warble Way Galaxy's game-drawn screen, against the views the engine
// actually sends (fixtures captured by scripts/ww-fixtures.mjs from a real
// engine build). The screen was rebuilt after a played game showed what a
// player could not see: so these check that every moment draws on a board
// that keeps its own height, that a first tap never acts, that each choice
// carries the engine's chance and what it leads to, that a shut move says
// the engine's reason, that a roll's result is read back on the board, and
// that nothing is chosen for the captain until they choose it.

import { describe, expect, it, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GameReferenceResponse, LegalMove, UnavailableMove } from '@zekel/wire-types';
import type { GameScreenProps, GlueInput } from '@zekel/glue-kit';
import { WwScreen, modeOf } from '../WwScreen.js';
import { readTable } from '../read.js';
import { percent, previewOf } from '../facts.js';
import { warbleWayGlue } from '../index.js';

afterEach(cleanup);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.resolve(HERE, 'fixtures/ww');
/** Views from an engine that sends no facts: the screen must still play. */
const PLAIN = path.resolve(HERE, 'fixtures/ww-plain');
const REF = JSON.parse(readFileSync(path.resolve(DIR, '../ww-reference.json'), 'utf8')) as GameReferenceResponse;
interface Fixture { key: string; view: Record<string, unknown>; legalMoves: LegalMove[]; unavailable?: UnavailableMove[] }
const load = (name: string, dir = DIR): Fixture => JSON.parse(readFileSync(path.join(dir, `${name}.json`), 'utf8')) as Fixture;
const input = (f: Fixture, extra: Partial<GlueInput> = {}): GlueInput => ({
  view: f.view, previous: null, legalMoves: f.legalMoves, unavailable: f.unavailable ?? [], playerId: 'p1', reference: REF, seq: 1, engineMove: null, actorPlayerId: null, memory: new Map(), ...extra,
});

function drawFixture(f: Fixture, extra: Partial<GameScreenProps> = {}, inputExtra: Partial<GlueInput> = {}) {
  const onMove = vi.fn(); const onForm = vi.fn(); const onDraw = vi.fn();
  const r = render(<WwScreen input={input(f, inputExtra)} yourTurn busy={false} interactive nameFor={(p) => p} onMove={onMove} onForm={onForm} onDraw={onDraw} {...extra} />);
  return { ...r, f, onMove, onForm, onDraw, moves: f.legalMoves };
}
const draw = (name: string, extra: Partial<GameScreenProps> = {}, inputExtra: Partial<GlueInput> = {}) => drawFixture(load(name), extra, inputExtra);
const button = (name: string | RegExp) => screen.getByRole('button', { name });
const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ');
/** A row on the board itself, as opposed to the same move in the engine's own list under it. */
const row = (name: RegExp) => within(document.querySelector('.ww-grid') as HTMLElement).getByRole('button', { name });

const EXPECT_MODE: Record<string, string> = {
  'habitat-1': 'habitat', 'habitat-3': 'habitat', 'roll-repair': 'habitat', 'pending-card_draw': 'space', 'pending-hazard_option': 'space', 'roll-hazard_check': 'space',
  'pending-sacrifice_offer': 'space', 'roll-mission_check': 'space', 'pending-space_recruit_offer': 'encounter', 'pending-space_mission_offer': 'encounter', 'pending-ruin_discovery': 'encounter',
  'pending-evade_offer': 'pirate', 'roll-evade': 'pirate', 'combat-choose_action': 'pirate', 'combat-loss_reroll_offer': 'pirate', 'boarding-board_or_leave': 'pirate', 'boarding-take_or_abandon': 'pirate',
  'roll-space_combat': 'pirate', 'roll-ground_combat': 'pirate', 'pending-ruin_setup': 'ruin-setup', 'ruin-setup-R2': 'ruin-setup', 'pending-ruin_continue': 'ruin',
  'pending-ruin_turn': 'ruin', 'ruin-attack': 'ruin', 'ruin-cache': 'ruin', 'ruin-being': 'ruin', 'roll-item_d6': 'ruin', 'phase-game_over': 'over',
};

describe('Warble Way Galaxy screen', () => {
  it('is the glue\'s screen, with a phone layout, and places the last move\'s sentence itself', () => {
    const g = warbleWayGlue;
    expect(g.Screen).toBe(WwScreen);
    expect(g.phone).toBe(true);
    expect(g.placesCaption).toBe(true);
  });

  it('draws every captured moment without error, in the part its board belongs to, with the sheet beside every card and fight', () => {
    const names = readdirSync(DIR).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
    expect(names.length).toBeGreaterThan(40);
    const errors: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { errors.push(String(a[0])); });
    for (const n of names) {
      const f = load(n);
      const table = readTable(f.view, REF);
      if (n === 'phase-creation') { expect(table?.me).toBeNull(); continue; }
      expect(table, n).not.toBeNull();
      const mode = modeOf(table!);
      if (EXPECT_MODE[n]) expect(mode, n).toBe(EXPECT_MODE[n]);
      const r = render(<WwScreen input={input(f)} yourTurn busy={false} interactive nameFor={(p) => p} onMove={() => {}} onForm={() => {}} />);
      expect(r.container.querySelector('.ww-screen'), n).not.toBeNull();
      // Something is always on the board: no moment draws an empty middle.
      expect(r.container.querySelector('.ww-grid')!.children.length, `${n} draws something`).toBeGreaterThan(0);
      if (mode === 'encounter' || mode === 'pirate' || mode === 'space' || mode === 'habitat') expect(r.container.querySelector('.ww-sheet'), `${n} keeps the sheet`).not.toBeNull();
      // A roll that is owed always has its panel and its button.
      if ((f.view['pending'] as { kind?: string } | null)?.kind === 'roll') expect(r.container.querySelector('.ww-roll button.ww-gold-btn'), `${n} has a Roll button`).not.toBeNull();
      cleanup();
      const p = render(<WwScreen input={input(f, { phone: true })} yourTurn busy={false} interactive nameFor={(p) => p} onMove={() => {}} onForm={() => {}} phone />);
      expect(p.container.querySelector('.ww-phone'), `${n} on a phone`).not.toBeNull();
      cleanup();
    }
    spy.mockRestore();
    expect(errors.filter((e) => !/act\(/.test(e))).toEqual([]);
  });

  it('at a habitat a first tap never acts: it opens what the engine says the move leads to, and one button sends it', () => {
    const { onMove, moves, container } = draw('habitat-1');
    const take = moves.find((m) => m.move_id === 'take-mission-h1-m3')!;
    fireEvent.click(row(/^The Leaky Recycler/));
    expect(onMove).not.toHaveBeenCalled();
    const panel = container.querySelector('.ww-choice')!;
    // The engine's own words: taking a mission leaves the habitat, and how the check stands.
    expect(text(panel)).toContain(previewOf(take)!.then!);
    expect(text(panel)).toMatch(/You leave Xaxalon 4 at once/);
    expect(text(panel)).toContain(percent(previewOf(take)!.check!.chance));
    expect(text(panel)).toContain(previewOf(take)!.check!.onPass);
    expect(text(panel)).toContain(previewOf(take)!.check!.onFail);
    fireEvent.click(within(panel as HTMLElement).getByRole('button', { name: 'TAKE IT AND LEAVE' }));
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove).toHaveBeenLastCalledWith(take);
    // The row itself shows the chance before it is even opened.
    expect(text(row(/^Hydroponics Mold/))).toContain(percent(previewOf(moves.find((m) => m.move_id === 'take-mission-h1-m1'))!.check!.chance));
  });

  it('a row the engine does not list opens with the engine\'s reason and cannot be sent', () => {
    const { onMove, f, container } = draw('habitat-1');
    fireEvent.click(row(/^Scrapyard Squabble/));
    const panel = container.querySelector('.ww-choice') as HTMLElement;
    expect(text(panel)).toContain(f.unavailable!.find((u) => u.moveType === 'take_mission' && u.item === 'h1-m2')!.reason);
    expect((within(panel).getByRole('button', { name: 'TAKE IT AND LEAVE' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(row(/^WinchesterZhang Plinker/));
    expect(text(container.querySelector('.ww-choice'))).toContain('Costs 300c; you have 200c.');
    expect(onMove).not.toHaveBeenCalled();
  });

  it('the cantina and the visit actions show the roll before it is asked for, and the reasons for what is shut', () => {
    const { onMove, moves, f, container } = draw('habitat-1');
    const recruit = moves.find((m) => m.move_id === 'recruit-h1-c4')!;
    fireEvent.click(row(/^Slate/));
    const panel = container.querySelector('.ww-choice') as HTMLElement;
    expect(text(panel)).toContain(percent(previewOf(recruit)!.roll!.chance));
    expect(text(panel)).toMatch(/Slate is marked: no second try at this cantina, ever\./);
    fireEvent.click(within(panel).getByRole('button', { name: 'TRY TO RECRUIT' }));
    expect(onMove).toHaveBeenLastCalledWith(recruit);
    // The visit column says the engine's reason, not one of the screen's own.
    const visit = screen.getByRole('region', { name: 'This visit' });
    expect(text(visit)).toContain(f.unavailable!.find((u) => u.moveType === 'attempt_repair')!.reason);
    expect(text(visit)).toContain(f.unavailable!.find((u) => u.moveType === 'depart_for_next_habitat')!.reason);
    // Pay for repair is listed: opening it then confirming sends it.
    fireEvent.click(within(visit).getByRole('button', { name: /^Pay for repair/ }));
    fireEvent.click(within(container.querySelector('.ww-choice') as HTMLElement).getByRole('button', { name: 'PAY 150c' }));
    expect(onMove).toHaveBeenLastCalledWith(moves.find((m) => m.move_id === 'pay-repair'));
  });

  it('a roll shows who it is about, the chance, how the dice work and what passing and failing do; only the button rolls', () => {
    const h = draw('roll-hazard_check');
    const facts = readTable(h.f.view, REF)!.rollFacts!;
    const panel = screen.getByRole('region', { name: 'Roll' });
    expect(text(panel)).toContain(facts.subject!.toUpperCase());
    expect(text(panel)).toContain(percent(facts.chance));
    expect(text(panel)).toContain(`Need ${facts.target}`);
    expect(text(panel)).toContain(facts.onPass);
    expect(text(panel)).toContain(facts.onFail);
    expect(h.onDraw).not.toHaveBeenCalled();
    fireEvent.click(button('Roll'));
    expect(h.onDraw).toHaveBeenCalledTimes(1);
    cleanup();
    // A pairing roll says which pair is yours and why, and splits the chance three ways.
    const s = draw('roll-space_combat');
    const pair = readTable(s.f.view, REF)!.rollFacts!.pairing!;
    const sp = screen.getByRole('region', { name: 'Roll' });
    expect(text(sp)).toMatch(new RegExp(`You take the ${pair.youTake} pair`));
    expect(text(sp)).toContain(pair.why);
    expect(text(sp)).toMatch(/Win .* tie .* lose /);
    cleanup();
    // A roll on a list shows the list.
    draw('roll-item_d6');
    expect(screen.getByRole('region', { name: 'Roll' }).querySelectorAll('.ww-faces li')).toHaveLength(6);
    cleanup();
    const d = draw('pending-card_draw');
    fireEvent.click(button('Draw'));
    expect(d.onDraw).toHaveBeenCalledTimes(1);
  });

  it('the last roll is read back on the board with its dice, in their pairs, and the glue leaves the table\'s own dice row out', () => {
    const { f, container } = draw('combat-loss_reroll_offer');
    const last = container.querySelector('.ww-last-roll')!;
    expect(last.querySelector('.ww-pair.yours')).not.toBeNull();
    expect(last.querySelector('.ww-pair.theirs')).not.toBeNull();
    expect(text(last)).toContain('LOST');
    expect(last.querySelectorAll('.zk-die')).toHaveLength(4);
    const g = warbleWayGlue;
    expect(g.diceFor!({ engineMove: null, summary: 'the server rolled 1, 1, 1, 1.', view: f.view })).toBeNull();
    // An engine that does not read the roll back still gets the table's dice.
    expect(g.diceFor!({ engineMove: null, summary: 'the server rolled 5, 4, 2.', view: load('habitat-1', PLAIN).view })).toEqual([5, 4, 2]);
    cleanup();
    // The sentence the table hands the screen leads the right column, at a
    // habitat and in space alike; with no roll to read back, no row is drawn.
    for (const name of ['habitat-1', 'pending-card_draw']) {
      const c = draw(name, { caption: <div className="caption-card">Docked.</div> });
      expect(c.container.querySelector('.ww-right')!.firstElementChild!.className).toBe('caption-card');
      expect(c.container.querySelector('.ww-last .caption-card')).toBeNull();
      cleanup();
    }
    expect(draw('habitat-1').container.querySelector('.ww-last')).toBeNull();
    cleanup();
    // A phone has no right column: the sentence stays at the top of Now, and
    // the section bar is the last thing on the screen.
    const p = draw('habitat-1', { caption: <div className="caption-card">Docked.</div>, phone: true });
    expect(p.container.querySelector('.ww-last .caption-card')).not.toBeNull();
    expect(p.container.querySelector('.ww-phone')!.lastElementChild!.className).toBe('ww-phone-tabs');
  });

  it('a hazard nobody can face says there is no roll and what each choice costs; where several could carry it, each is offered by name', () => {
    const h = draw('pending-hazard_option');
    const one = h.moves.find((m) => m.move_id === 'hazard-option-1')!;
    const options = h.container.querySelectorAll('.ww-option');
    expect(text(options[0]!)).toContain(previewOf(one)!.then!);
    fireEvent.click(within(options[0] as HTMLElement).getByRole('button', { name: 'Pay this price' }));
    expect(h.onMove).toHaveBeenLastCalledWith(one);
    cleanup();
    // Two beings could carry the roll: the screen does not pick one.
    const base = load('roll-hazard_check');
    const roll = (base.view['roll_facts'] as Record<string, unknown>);
    const f: Fixture = {
      ...load('pending-hazard_option'),
      view: { ...load('pending-hazard_option').view, pending: { kind: 'hazard_option', card_id: 'QS', must_fail: false } },
      legalMoves: [{ move_id: 'hazard-option-1', description: 'Roll the option.', move: { type: 'choose_hazard_option', option: 1 }, preview: { roll, carriers: [{ name: 'Zara', title: 'you', roll }, { name: 'Grull (DIP+1)', title: 'Slate', roll: { ...roll, carrier: 'Slate', on_fail: 'Slate dies.' } }] } } as unknown as LegalMove],
    };
    const c = drawFixture(f);
    expect(screen.queryByRole('button', { name: /^Roll this way/ })).toBeNull();
    fireEvent.click(button(/^Slate/));
    expect(c.onForm).toHaveBeenLastCalledWith(f.legalMoves[0], { type: 'choose_hazard_option', option: 1, carrier: 'Grull (DIP+1)' }, ['carrier']);
    expect(c.onMove).not.toHaveBeenCalled();
  });

  it('a job nobody can do says the engine\'s reason on each way; a recruit adrift shows the roll before it is tried', () => {
    const m = draw('pending-space_mission_offer');
    for (const u of m.f.unavailable!) expect(text(m.container)).toContain(u.reason);
    fireEvent.click(button('Decline'));
    expect(m.onMove).toHaveBeenLastCalledWith(m.moves.find((x) => x.move_id === 'decline-mission'));
    cleanup();
    const r = draw('pending-space_recruit_offer');
    const tryM = r.moves.find((x) => x.move_id === 'attempt-space-recruit')!;
    expect(text(r.container)).toContain(percent(previewOf(tryM)!.roll!.chance));
    expect(text(r.container)).toContain(previewOf(tryM)!.roll!.onFail);
    fireEvent.click(button('Try to recruit'));
    expect(r.onMove).toHaveBeenLastCalledWith(tryM);
    cleanup();
    // One choice of depth, not two controls for it.
    const d = draw('pending-ruin_discovery');
    expect(screen.getAllByRole('button', { name: /^Enter, to depth/ })).toHaveLength(d.moves.filter((x) => (x.move_id ?? '').startsWith('enter-ruin-')).length);
    fireEvent.click(button('Enter, to depth 1'));
    expect(d.onMove).toHaveBeenLastCalledWith(d.moves.find((x) => x.move_id === 'enter-ruin-1'));
  });

  it('in a fight each way shows its chance and what it leads to; a way the engine does not list says why', () => {
    const c = draw('combat-choose_action');
    const escape = c.moves.find((m) => m.move_id === 'attempt-escape')!;
    const main = c.container.querySelector('.ww-main-card') as HTMLElement;
    expect(text(main)).toContain(percent(previewOf(escape)!.roll!.chance));
    expect(text(main)).toContain(previewOf(escape)!.roll!.onFail);
    for (const u of c.f.unavailable!) expect(text(main)).toContain(u.reason);
    expect(within(main).queryByRole('button', { name: 'Hack' })).toBeNull();
    fireEvent.click(within(main).getByRole('button', { name: 'Exchange fire' }));
    expect(c.onMove).toHaveBeenLastCalledWith(c.moves.find((m) => m.move_id === 'fight-round'));
    cleanup();
    // Taking the ship and keeping yours are drawn alike: the screen leans toward neither.
    const t = draw('boarding-take_or_abandon');
    const take = button('TAKE THE SHIP'); const keep = button(/^KEEP /);
    expect(take.className).toBe(keep.className);
    expect(text(t.container)).toContain(previewOf(t.moves.find((m) => m.move_id === 'take-ship'))!.then!);
    fireEvent.click(keep);
    expect(t.onMove).toHaveBeenLastCalledWith(t.moves.find((m) => m.move_id === 'abandon-ship'));
  });

  it('ruin setup chooses nothing for the captain: nobody goes in, no red shirts, no threat, no start, and each attacker stands where it is put', () => {
    const base = load('ruin-setup-R1');
    const f: Fixture = { ...base, view: { ...base.view, unnamed_crew: 2 } };
    const { onForm, moves, container } = drawFixture(f);
    const template = moves.find((m) => m.move['type'] === 'setup_encounter')!;
    const enter = button(/^ENTER R1/) as HTMLButtonElement;
    expect(enter.disabled).toBe(true);
    expect(container.querySelectorAll('.ww-check-row.on')).toHaveLength(0);
    expect(text(screen.getByRole('group', { name: 'Red shirts going in' }))).toMatch(/0 of 2/);
    fireEvent.click(screen.getByRole('checkbox', { name: /\(you\)$/ }));
    fireEvent.click(button('One more red shirt'));
    fireEvent.click(button('Threat 2'));
    const cell = (id: string) => container.querySelector(`button.ww-cell[data-cell="${id}"]`)!;
    fireEvent.click(cell('r9c9'));
    // Place A3 first, then A1, then A2: the squares follow the attackers, not the order of the taps.
    fireEvent.click(button(/^A3/));
    fireEvent.click(cell('r1c2'));
    fireEvent.click(button(/^A1/));
    fireEvent.click(cell('r1c9'));
    fireEvent.click(cell('r5c1'));
    expect(enter.disabled).toBe(false);
    fireEvent.click(enter);
    expect(onForm).toHaveBeenLastCalledWith(
      template,
      { ...template.move, crew_names: [], include_character: true, unnamed_count: 1, start_location: 'r9c9', threat_level: 2, attacker_placements: ['r1c9', 'r5c1', 'r1c2'] },
      ['crew_names', 'include_character', 'unnamed_count', 'start_location', 'threat_level', 'attacker_placements'],
    );
    // How a being would move and fight is on the row it is picked from, in the engine's numbers.
    expect(text(screen.getByRole('checkbox', { name: /\(you\)$/ }))).toMatch(/moves 3 · attacks with SWA \+0 · reach 1/);
  });

  it('in a ruin only the squares the engine says are in reach can be tapped, the goal asks first, and an attack shows its chance', () => {
    const t = draw('pending-ruin_turn');
    const table = readTable(t.f.view, REF)!;
    const me = table.ruin!.party[0]!;
    const tappable = [...t.container.querySelectorAll('button.ww-cell')].map((b) => b.getAttribute('data-cell')).sort();
    expect(tappable).toEqual([...me.reach].sort());
    const move = t.moves.find((m) => m.move['type'] === 'move_being')!;
    fireEvent.click(t.container.querySelector(`button.ww-cell[data-cell="${me.reach[0]}"]`)!);
    expect(t.onForm).toHaveBeenLastCalledWith(move, { ...move.move, to: me.reach[0] }, ['to']);
    expect(text(screen.getByRole('button', { name: me.title }))).toMatch(/3 of 3 moves left/);
    cleanup();
    // Standing where the goal is in reach: tapping it asks, with what is still unopened, before it sends.
    const base = load('pending-ruin_turn');
    const ruin = base.view['ruin'] as Record<string, unknown>;
    const party = (ruin['party'] as Array<Record<string, unknown>>).map((x) => ({ ...x, cell: 'r2c1', reach: ['r1c1', 'r3c1'] }));
    const g = drawFixture({ ...base, view: { ...base.view, ruin: { ...ruin, party } } });
    fireEvent.click(g.container.querySelector('button.ww-cell[data-cell="r1c1"]')!);
    expect(g.onForm).not.toHaveBeenCalled();
    const ask = screen.getByRole('region', { name: 'Step onto the goal' });
    expect(text(ask)).toMatch(/caches unopened/);
    fireEvent.click(within(ask).getByRole('button', { name: 'STEP ONTO THE GOAL' }));
    expect(g.onForm).toHaveBeenLastCalledWith(g.moves.find((m) => m.move['type'] === 'move_being'), expect.objectContaining({ to: 'r1c1' }), ['to']);
    cleanup();
    const a = draw('ruin-attack');
    const attack = a.moves.find((m) => m.move['type'] === 'attack')!;
    expect(text(a.container)).toContain(percent(previewOf(attack)!.roll!.chance));
    fireEvent.click(button(/^Attack A\d/));
    expect(a.onMove).toHaveBeenLastCalledWith(attack);
    cleanup();
    const s = draw('ruin-surrender');
    const call = s.moves.find((m) => m.move['type'] === 'convert_attacker')!;
    fireEvent.click(button(new RegExp(`^${text(null)}Call on`)));
    expect(s.onMove).toHaveBeenLastCalledWith(call);
  });

  it('the sheet shows what is held and who wears it, names crew by the name on their card, and says what its words mean', () => {
    const h = draw('habitat-2');
    const table = readTable(h.f.view, REF)!;
    const crew = screen.getByRole('region', { name: 'Crew' });
    for (const c of table.crew) expect(text(crew)).toContain(c.title);
    expect(table.crew.some((c) => c.title !== c.name)).toBe(true);
    fireEvent.click(button('What do these mean?'));
    const help = screen.getByRole('dialog', { name: 'What the sheet means' });
    expect(text(help)).toContain('Reach level 5.');
    expect(text(help)).toContain('Debt passes 300 credits.');
    expect(text(help)).toContain('Flying Ace');
    expect(text(help)).toMatch(/Each point takes one card off every leg of a trip\./);
    cleanup();
    // A weapon bought and not yet worn is on the sheet, marked as not worn.
    const base = load('habitat-1');
    const f: Fixture = { ...base, view: { ...base.view, items: [{ id: 'h1-s2', name: 'Weapon +1 GUN', title: 'WinchesterZhang Plinker', type: 'weapon', consumed: false, effect: '+1 Gunslinging for whoever wears it.', worn_by: null, fitted: false }] } };
    const s = drawFixture(f);
    const sheet = s.container.querySelector('.ww-sheet')!;
    expect(text(sheet)).toContain('WinchesterZhang Plinker');
    expect(text(sheet)).toContain('not worn');
  });

  it('counts the ship\'s hits the way the engine does', () => {
    const { container, f } = draw('habitat-1');
    const hits = (f.view['ship'] as { hits_to_lost: number }).hits_to_lost;
    expect(text(container.querySelector('.ww-ship'))).toContain(`${hits} hits from destroyed`);
  });

  it('level up, over capacity and the departure peek are overlays that send listed moves, and level up says what each ability does', () => {
    const l = draw('pending-level_up');
    expect(text(screen.getByRole('dialog', { name: 'Level up' }))).toMatch(/Space combat advantage/);
    fireEvent.click(button(/^Mechanics, 2 to 3/));
    expect(l.onMove).toHaveBeenLastCalledWith(l.moves.find((m) => m.move_id === 'level-up-MEC'));
    cleanup();
    const rel = draw('pending-release_crew');
    const dialog = screen.getByRole('dialog', { name: 'Release crew' });
    fireEvent.click(within(dialog).getAllByRole('button', { name: 'RELEASE' })[0]!);
    expect(rel.onMove).toHaveBeenCalledTimes(1);
    expect(rel.moves).toContainEqual(rel.onMove.mock.calls[0]![0]);
    cleanup();
    const peek = draw('pending-res_discard');
    fireEvent.click(button('DISCARD IT'));
    const template = peek.moves.find((m) => m.move_id === 'report-res-discard')!;
    expect(peek.onForm).toHaveBeenLastCalledWith(template, expect.objectContaining({ type: 'report_res_discard' }), ['card']);
    fireEvent.click(button(/LEAVE IT ON TOP/));
    expect(peek.onMove).toHaveBeenLastCalledWith(peek.moves.find((m) => m.move_id === 'skip-res-peek'));
  });

  it('with an engine that sends no facts the screen still plays: rows open, the engine\'s own description stands in, and the roll panel shows the sum', () => {
    const h = drawFixture(load('habitat-1', PLAIN));
    const take = h.moves.find((m) => (m.move_id ?? '').startsWith('take-mission-'))!;
    const id = (take.move_id ?? '').replace('take-mission-', '');
    const row = [...h.container.querySelectorAll('button.ww-mrow')].find((b) => !(b as HTMLButtonElement).disabled && b.closest('[aria-label="Missions"]') && h.moves.some((m) => m.move_id === `take-mission-${id}`))!;
    fireEvent.click(row);
    expect(h.container.querySelector('.ww-choice')).not.toBeNull();
    cleanup();
    const r = drawFixture(load('roll-hazard_check', PLAIN));
    expect(text(screen.getByRole('region', { name: 'Roll' }))).toMatch(/You need \d+ or more/);
    fireEvent.click(button('Roll'));
    expect(r.onDraw).toHaveBeenCalledTimes(1);
    cleanup();
    // No reach from the engine: every open floor square is offered and the engine answers.
    const t = drawFixture(load('pending-ruin_turn', PLAIN));
    expect(t.container.querySelectorAll('button.ww-cell').length).toBeGreaterThan(20);
  });

  it('a watcher can open a row and read it, and can send nothing', () => {
    const r = draw('habitat-1', { interactive: false, yourTurn: false });
    fireEvent.click(row(/^The Leaky Recycler/));
    const panel = r.container.querySelector('.ww-choice') as HTMLElement;
    expect((within(panel).getByRole('button', { name: 'TAKE IT AND LEAVE' }) as HTMLButtonElement).disabled).toBe(true);
    expect(r.container.querySelector('.move-menu')).toBeNull();
    expect(r.onMove).not.toHaveBeenCalled();
  });

  it('the glue\'s forms complete the ruin templates in words, for the menu', () => {
    const g = warbleWayGlue;
    const f = load('pending-ruin_setup');
    const form = g.formFor!(f.legalMoves[0]!, input(f))!;
    expect(form.fields.map((x) => x.key)).toEqual(['include_character', 'start_location', 'threat_level', 'attacker_placements']);
    expect(form.build({ include_character: 'yes', start_location: 'r9c1', threat_level: '1', attacker_placements: ['r1c2', 'r1c9'] })).toBeNull();
    expect(form.build({ include_character: 'yes', start_location: 'r9c1', threat_level: '1', attacker_placements: ['r1c2', 'r1c9', 'r2c1'] }))
      .toMatchObject({ type: 'setup_encounter', include_character: true, crew_names: [], start_location: 'r9c1', threat_level: 1, attacker_placements: ['r1c2', 'r1c9', 'r2c1'] });
    const a = load('ruin-attack');
    const mv = a.legalMoves.find((m) => m.move['type'] === 'move_being')!;
    const mf = g.formFor!(mv, input(a))!;
    expect(mf.build({ to: 'R7C4' })).toMatchObject({ type: 'move_being', to: 'r7c4' });
    expect(mf.build({ to: 'nowhere' })).toBeNull();
  });
});
