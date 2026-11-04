import { describe, expect, it } from 'vitest';
import { fullDeckIds } from '../data/cards.js';
import { BEING_NAMES, CARD_FLAVOUR, ITEM_TITLES, MISSION_TITLES } from '../data/flavour.js';
import { HABITATS } from '../data/habitats.js';
import { warbleWayGalaxy } from '../index.js';

// The names on the cards and the habitat pages are flavour the tables
// print; every card and every habitat row has one, and the reference data
// carries them so the web and voice tables say the same thing.

describe('card and habitat names (flavour)', () => {
  it('names every one of the 52 cards, and nothing else', () => {
    const ids = fullDeckIds();
    expect(Object.keys(CARD_FLAVOUR).sort()).toEqual([...ids].sort());
    for (const id of ids) expect(CARD_FLAVOUR[id]!.title.length, id).toBeGreaterThan(0);
    // Ruins and jobs carry a line; recruits say who they are.
    for (const r of ['10', 'J', 'Q', 'K', 'A']) expect(CARD_FLAVOUR[`${r}D`]!.line, r).toBeTruthy();
    for (const id of ids.filter((i) => i.endsWith('C') || i.endsWith('H'))) expect(CARD_FLAVOUR[id]!.line, id).toBeTruthy();
    expect(CARD_FLAVOUR['AH']).toEqual({ title: 'C0FFEE', line: 'Hexapod pod pilot' });
    expect(CARD_FLAVOUR['2D']!.title).toBe('Pirates');
  });

  it('names every habitat mission, shop item and cantina being, and no stranger', () => {
    const missions = Object.values(HABITATS).flatMap((h) => h.missions.map((m) => m.id));
    const items = Object.values(HABITATS).flatMap((h) => h.shop.map((s) => s.id));
    const beings = Object.values(HABITATS).flatMap((h) => h.cantina.map((c) => c.id));
    expect(Object.keys(MISSION_TITLES).sort()).toEqual([...missions].sort());
    expect(Object.keys(ITEM_TITLES).sort()).toEqual([...items].sort());
    expect(Object.keys(BEING_NAMES).sort()).toEqual([...beings].sort());
    for (const v of [...Object.values(MISSION_TITLES), ...Object.values(ITEM_TITLES), ...Object.values(BEING_NAMES)]) expect(v.length).toBeGreaterThan(0);
  });

  it('publishes them in the reference data without touching the printed item labels', () => {
    const rd = warbleWayGalaxy.getReferenceData!() as {
      cards: Record<string, { title: string }>;
      habitats: Record<string, { missions: { id: string; title: string }[]; shop: { id: string; name: string; title: string }[]; cantina: { id: string; name: string }[] }>;
    };
    expect(rd.cards['KC']!.title).toBe('The deep dig');
    const h1 = rd.habitats['1']!;
    expect(h1.missions[0]).toMatchObject({ id: 'h1-m1', title: 'Hydroponics Mold' });
    expect(h1.shop[0]).toMatchObject({ id: 'h1-s1', name: 'Consumable +1 Any', title: 'Sustenance Cube' });
    expect(h1.cantina[0]).toMatchObject({ id: 'h1-c1', race: 'human', name: 'Wang' });
    expect(rd.habitats['3']!.cantina).toHaveLength(6);
  });
});
