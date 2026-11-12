// Warble Way Galaxy's travel cards (build item 4): a card's face is read
// from the engine's reference data by its code, in any spelling the view
// uses; a code the reference does not carry draws nothing; and the card
// component lays each kind out as Cards.dc.html does. The fixture is a slice
// of what the engine publishes (zekel-games, warble-way-galaxy
// getReferenceData), not a copy of its tables.

import { describe, expect, it, afterEach } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { GameReferenceResponse } from '@zekel/wire-types';
import { cardId, deckIds, parseCode, travelCard } from '../cards.js';
import { TravelCard, TravelCardBack } from '../TravelCard.js';

afterEach(cleanup);

const REF: GameReferenceResponse = {
  gameId: 'warble-way-galaxy', rules: '', moveSchema: {}, optionsSchema: {},
  referenceData: {
    travel_tables: {
      hearts_recruits: { A: { id: 'heart-A', race: 'hexapod', idealized: 'smarts', min_roll: 13, abilities: { PIL: 3 } }, Q: { id: 'heart-Q', race: 'grull', idealized: 'finesse', min_roll: 12, abilities: { RES: 2, MEC: 1 } } },
      diamonds_2_to_9_pirates: { '4': { id: 'pirate-4', space_attack: 5, ground_attack: 2, capacity: 5, speed: 0, handling: 0, min_hacking: 13, special: 'space_combat_advantage' } },
      diamonds_10_J_Q_K_A_ruin_depths: { J: 2 },
      spades_hazards: { '3': { option1: { ability: 'RES', min_roll: 10 }, option2: { ability: 'SWA', min_roll: 15 } } },
      clubs_missions: {
        '2': { kind: 'choice', option1: { id: 'club-2-1', distance: 4, goal: { kind: 'ability_check', ability: 'DIP', min_roll: 10 }, credits: 200, xp: 1 }, option2: { id: 'club-2-2', distance: 8, goal: { kind: 'ability_check', ability: 'HAK', min_roll: 15 }, credits: 400, xp: 2 } },
        K: { kind: 'ruins', mission: { id: 'club-K', distance: 16, goal: { kind: 'ruin', depth: 3 }, credits: 1800, xp: 4 } },
      },
    },
    cards: {
      AH: { title: 'C0FFEE', line: 'Hexapod pod pilot' }, '4D': { title: 'Pirates' }, JD: { title: 'Hollow Aerie', line: 'Kralkin perches.' },
      '3S': { title: 'Gravity snare' }, '2C': { title: 'Channel clash', line: 'Two relays, one channel.' }, KC: { title: 'The deep dig', line: 'Three maps down.' },
    },
    hazard_consequence_by_stat: { smarts: 'lose_credits', brawn: 'death' },
    ability_stats: { RES: 'smarts', SWA: 'brawn' },
  },
};

describe('Warble Way Galaxy travel cards', () => {
  it('reads a code in any spelling the view uses', () => {
    expect(parseCode('AH')).toEqual({ rank: 'A', suit: 'H' });
    expect(parseCode('10d')).toEqual({ rank: '10', suit: 'D' });
    expect(parseCode('3♠')).toEqual({ rank: '3', suit: 'S' });
    expect(parseCode('♣ K')).toEqual({ rank: 'K', suit: 'C' });
    expect(parseCode('1H')).toBeNull();
    expect(parseCode('')).toBeNull();
    expect(cardId('Q♥')).toBe('QH');
  });
  it('lays out each kind from the reference and nothing from a code it lacks', () => {
    expect(travelCard('AH', REF)).toMatchObject({ id: 'AH', kind: 'recruit', title: 'C0FFEE', line: 'Hexapod pod pilot · idealizes smarts', race: 'hexapod', need: 13, chips: ['+3 PIL'] });
    expect(travelCard('4♦', REF)).toMatchObject({ kind: 'pirate', title: 'Pirates', line: 'Space combat advantage', spaceAttack: 5, stats: [{ k: 'ground', v: '+2' }, { k: 'crew', v: '5' }, { k: 'speed', v: '+0' }, { k: 'handl.', v: '0' }, { k: 'hack', v: '13' }] });
    expect(travelCard('JD', REF)).toMatchObject({ kind: 'ruin', title: 'Hollow Aerie', line: 'Kralkin perches. Enter, or fly on.', depth: 2 });
    expect(travelCard('3S', REF)).toMatchObject({ kind: 'hazard', title: 'Gravity snare', line: 'Pick a way through · 1 XP', options: [{ head: 'RES 10', tail: 'lose credits', fail: 'lose_credits' }, { head: 'SWA 15', tail: 'death check', fail: 'death' }] });
    expect(travelCard('2C', REF)).toMatchObject({ kind: 'job', title: 'Channel clash', options: [{ head: 'DIP 10', tail: 'dist 4 · 200c · 1 XP' }, { head: 'HAK 15', tail: 'dist 8 · 400c · 2 XP' }] });
    expect(travelCard('KC', REF)).toMatchObject({ kind: 'job', line: 'Three maps down. No ability needed.', options: [{ head: 'R3', tail: 'dist 16 · 1,800c · 4 XP' }] });
    // A card the reference has a row for but no name: the kind's word stands in.
    expect(travelCard('QH', REF)).toMatchObject({ kind: 'recruit', title: 'Grull', line: 'idealizes finesse' });
    expect(travelCard('5D', REF)).toBeNull();
    expect(travelCard('AH', null)).toBeNull();
    expect(deckIds(REF)).toEqual(['AH', 'QH', '4D', 'JD', '3S', '2C', 'KC']);
  });
  it('draws the band, the ring, the name and the kind\'s own block', () => {
    const { container } = render(<TravelCard face={travelCard('AH', REF)!} />);
    const card = container.querySelector('.ww-tc')!;
    expect(card.getAttribute('data-kind')).toBe('recruit');
    expect(card.getAttribute('aria-label')).toBe('C0FFEE, recruit ♥ A');
    expect(card.querySelector('.ww-tc-band')!.textContent).toBe('Recruit♥ A');
    expect(card.querySelector('.ww-tc-ring .ww-gxi img')!.getAttribute('src')).toBe('/art/warble-way/portraits/hexapod.jpg');
    expect(card.querySelector('.ww-tc-title')!.textContent).toBe('C0FFEE');
    expect(card.querySelector('.ww-tc-big')!.textContent).toBe('13');
    expect([...card.querySelectorAll('.ww-tc-chip')].map((c) => c.textContent)).toEqual(['+3 PIL']);
    const ruin = render(<TravelCard face={travelCard('JD', REF)!} />).container;
    expect(ruin.querySelectorAll('.ww-tc-pip.on')).toHaveLength(2);
    expect(ruin.querySelector('.ww-tc-ring .ww-gx')!.getAttribute('data-icon')).toBe('silo');
    const hazard = render(<TravelCard face={travelCard('3S', REF)!} />).container;
    const rows = [...hazard.querySelectorAll('.ww-tc-row')];
    expect(rows.map((r) => r.textContent)).toEqual(['RES 10lose credits', 'SWA 15death check']);
    expect(rows[1]!.querySelector('.ww-gx')!.getAttribute('data-icon')).toBe('disintegrate');
    const back = render(<TravelCardBack />).container.querySelector('.ww-tc-back')!;
    expect(back.getAttribute('aria-hidden')).toBe('true');
    expect(back.textContent).toBe('WARBLEWAY');
  });
});
