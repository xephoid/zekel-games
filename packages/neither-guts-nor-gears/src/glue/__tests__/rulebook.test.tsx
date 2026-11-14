// The rulebook page (glue/rulebook/NggRulebook.tsx) against the reference data
// captured from this package's rules (fixtures/reference.json, kept current
// by src/__tests__/rulebook.test.ts). It must show the engine's numbers for the
// chosen player count, the engine's own treaty and unit text, and a picture
// for every name it draws.

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GameReferenceResponse } from '@zekel/wire-types';
import { NggRulebook } from '../rulebook/NggRulebook.js';
import { readRulebook } from '../rulebook/read.js';
import { hasIcon } from '../ui.js';

afterEach(cleanup);

const referenceData = JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'reference.json'), 'utf8'));
const reference: GameReferenceResponse = { gameId: 'neither-guts-nor-gears', rules: '', referenceData, moveSchema: null, optionsSchema: null };
const data = readRulebook(referenceData)!;

const section = (name: RegExp) => screen.getByRole('heading', { level: 2, name }).closest('section')!;
const pick = (n: number) => fireEvent.click(within(screen.getByRole('group', { name: 'Number of players' })).getByRole('button', { name: String(n) }));

describe('the Neither Guts nor Gears rulebook page', () => {
  it('draws nothing without a rulebook in the reference', () => {
    const { container } = render(<NggRulebook reference={null} />);
    expect(container.innerHTML).toBe('');
    expect(readRulebook({})).toBeNull();
  });

  it('refuses data missing part of what the page draws, rather than drawing zeros', () => {
    expect(data).not.toBeNull();
    for (const drop of ['victory', 'maps', 'treaties', 'wizard_units', 'robot_units', 'battle_deck', 'heroes']) {
      const { [drop]: _gone, ...rest } = referenceData;
      expect(readRulebook(rest), drop).toBeNull();
    }
    const v = referenceData.victory;
    const m = v.milestones_by_player_count;
    const broken = [
      { ...referenceData, victory: { ...v, milestones_by_player_count: { ...m, 4: [null, ...m['4'].slice(1)] } } },
      { ...referenceData, victory: { ...v, milestones_by_player_count: { ...m, 4: m['4'].slice(0, 3) } } },
      { ...referenceData, victory: { ...v, tech_target: {} } },
      { ...referenceData, heroes: [] },
      { ...referenceData, maps: { ...referenceData.maps, '2p': [] } },
    ];
    for (const [i, bad] of broken.entries()) expect(readRulebook(bad), `broken data ${i}`).toBeNull();
  });

  // A copy of the reference data with one change made to it.
  const changed = (change: (d: any) => void) => {
    const d = structuredClone(referenceData);
    change(d);
    return d;
  };
  const without = (o: Record<string, unknown>, key: string) => { delete o[key]; };

  it('refuses a list with one entry missing', () => {
    const cases: Record<string, (d: any) => void> = {
      'a tile from the 2-player map': (d) => d.maps['2p'].pop(),
      'a tile from the 5-6 player map': (d) => d.maps['5-6p'].shift(),
      'a wizard unit': (d) => d.wizard_units.pop(),
      'a robot unit': (d) => d.robot_units.pop(),
      'a treaty': (d) => d.treaties.pop(),
      'a battle card': (d) => d.battle_deck.pop(),
      'a hero': (d) => d.heroes.pop(),
      'the Evo Angel': (d) => { d.heroes = d.heroes.filter((h: any) => h.category !== 'evo-angel'); },
      'the counts': (d) => without(d.rulebook, 'counts'),
    };
    for (const [what, change] of Object.entries(cases)) expect(readRulebook(changed(change)), what).toBeNull();
  });

  it('refuses an entry with a field the page draws missing', () => {
    const cases: Record<string, (d: any) => void> = {
      'a tile\'s resource': (d) => without(d.maps['2p'][0], 'resource'),
      'a tile\'s column': (d) => without(d.maps['3-4p'][0], 'c'),
      'a fighting unit\'s DMG': (d) => without(d.wizard_units.find((u: any) => u.init !== null), 'dmg'),
      'a unit\'s cost': (d) => without(d.robot_units[0], 'cost'),
      'a unit\'s name': (d) => without(d.robot_units[0], 'name'),
      'a treaty\'s culture': (d) => without(d.treaties[0], 'cultureIncome'),
      'a battle card\'s copies': (d) => without(d.battle_deck[0], 'copies'),
      'a battle card\'s label': (d) => without(d.battle_deck[0], 'label'),
      'the Evo Angel\'s stats': (d) => without(d.heroes.find((h: any) => h.category === 'evo-angel'), 'stats'),
      'the Evo Angel\'s DEF': (d) => without(d.heroes.find((h: any) => h.category === 'evo-angel').stats, 'def'),
    };
    for (const [what, change] of Object.entries(cases)) expect(readRulebook(changed(change)), what).toBeNull();
  });

  it('refuses rulebook words with a part the page reads missing, so the page never fails while drawing', () => {
    const cases: Record<string, (d: any) => void> = {
      'players by layout': (d) => without(d.rulebook, 'players_by_layout'),
      'one layout\'s players': (d) => without(d.rulebook.players_by_layout, '3-4p'),
      'the facts': (d) => without(d.rulebook, 'facts'),
      'the victory words': (d) => without(d.rulebook.victory, 'economic_mix'),
      'the setup': (d) => without(d.rulebook, 'setup'),
      'the robots\' setup pieces': (d) => without(d.rulebook.setup.robot, 'pieces'),
      'the Action Stack': (d) => without(d.rulebook.round, 'stack'),
      'the paying example\'s figure': (d) => without(d.rulebook.paying.example, 'figure'),
      'the battle example': (d) => without(d.rulebook.battle, 'example'),
      'the treaty chart': (d) => without(d.rulebook.treaties, 'chart'),
      'the unit note': (d) => without(d.rulebook, 'units'),
      'a treaty the chart names': (d) => { d.rulebook.treaties.chart[0].treaty = 'No Such Treaty'; },
      'a unit the battle example names': (d) => { d.rulebook.battle.example.units = ['No Such Unit']; },
    };
    for (const [what, change] of Object.entries(cases)) {
      const bad = changed(change);
      expect(readRulebook(bad), what).toBeNull();
      const { container, unmount } = render(<NggRulebook reference={{ ...reference, referenceData: bad }} />);
      expect(container.innerHTML, what).toBe('');
      unmount();
    }
  });

  it('shows the engine\'s win numbers for the chosen player count', () => {
    render(<NggRulebook reference={reference} />);
    const win = () => section(/Four ways to win/);
    expect(within(win()).getByText('140')).toBeTruthy();
    expect(within(win()).getByText('16')).toBeTruthy();
    expect(within(win()).getByText('Leaders')).toBeTruthy();
    pick(2);
    expect(within(win()).getByText('70')).toBeTruthy();
    expect(within(win()).getByText('12')).toBeTruthy();
    expect(within(win()).getByText('Leader')).toBeTruthy();
    pick(6);
    expect(within(win()).getByText('210')).toBeTruthy();
    // 26 collectors for Economic, and 26 points for Technological at every count.
    expect(within(win()).getAllByText('26')).toHaveLength(2);
  });

  it('draws the map for the chosen player count, with the engine\'s tile names', () => {
    render(<NggRulebook reference={reference} />);
    const board = () => section(/The board/);
    const tiles = () => board().querySelectorAll('svg polygon').length;
    expect(tiles()).toBe(data.maps['3-4p'].length);
    expect(within(board()).getByText('29 tiles')).toBeTruthy();
    pick(2);
    expect(tiles()).toBe(data.maps['2p'].length);
    pick(5);
    expect(tiles()).toBe(data.maps['5-6p'].length);
    for (const t of data.maps['5-6p']) expect(board().textContent).toContain(t.label);
  });

  it('follows the map in the component counts', () => {
    render(<NggRulebook reference={reference} />);
    const surfs = () => within(section(/Components/)).getByText('Surfs per wizard').closest('div')!;
    expect(within(surfs()).getByText('16')).toBeTruthy();
    pick(6);
    expect(within(surfs()).getByText('26')).toBeTruthy();
  });

  it('prints each treaty\'s break condition and units\' notes as the engine words them', () => {
    render(<NggRulebook reference={reference} />);
    const treaties = section(/Treaties/);
    for (const t of data.treaties) expect(treaties.textContent).toContain(t.breaking);
    const units = section(/Units/);
    for (const u of [...data.wizardUnits, ...data.robotUnits]) expect(units.textContent).toContain(u.notes);
  });

  it('has a picture for every name it draws', () => {
    const t = data.text;
    const names = [
      ...t.components.map((c) => c.icon), ...t.round.steps.map((s) => s.icon), ...t.round.stack.cards.map((c) => c.action),
      ...t.setup.wizard.pieces.map((p) => p.icon), ...t.setup.robot.pieces.map((p) => p.icon),
      ...t.paying.example.figure.pieces.map((p) => p.icon), ...t.treaties.chart.map((r) => r.treaty),
      ...data.wizardUnits.map((u) => u.name), ...data.robotUnits.map((u) => u.name),
      ...data.ladder.filter((u) => !u.name.endsWith('(hero)')).map((u) => u.name),
      ...[t.setup.wizard.faction, t.setup.robot.faction],
    ];
    expect(names.filter((n) => !hasIcon(n))).toEqual([]);
  });
});
