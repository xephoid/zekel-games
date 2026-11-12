import { describe, expect, it } from 'vitest';
import type { PlayerConfig } from '@zekel/game-kit';
import { plainWords } from '../plainWords.js';
import { warbleWayGalaxy } from '../index.js';

// A player at a screen reads the engine's sentences directly, so a digital
// seat gets them without rule numbers or move ids (plainWords.ts). Every
// number, name and outcome must survive untouched.

describe('plain words for a screen', () => {
  it('drops citations, alone in brackets or beside other words, and keeps everything else', () => {
    expect(plainWords('Hazard survived — nothing happens. +1 XP (WR §10, ruling #4).')).toBe('Hazard survived — nothing happens. +1 XP.');
    expect(plainWords('Redline (A20, once per encounter): 3d6 + MEC vs 12.')).toBe('Redline (once per encounter): 3d6 + MEC vs 12.');
    expect(plainWords('DREAD 1/3 (+1 to intimidation, amendment A9b). Foes defeated: 1/8 (Bounty, A11).')).toBe('DREAD 1/3 (+1 to intimidation). Foes defeated: 1/8 (Bounty).');
    expect(plainWords('Zara DIES leading the boarding party (their score carried the roll — ruling #9/WR §14).')).toBe('Zara DIES leading the boarding party (their score carried the roll).');
  });

  it('never touches an attacker\'s name, a square or a number', () => {
    const s = 'Attackers: A1 (Atk +5, Mv 3, Rng 1) at r1c9 (top-right); A2 (Atk +3, Mv 3, Rng 1) at r4c7. TIE against A3 — reroll the attack.';
    expect(plainWords(s)).toBe(s);
  });

  it('says a move in words, not by its id', () => {
    expect(plainWords('You must engage: attempt_escape, attempt_hack (needs HAK), open_fire (GUN, once — A6), attempt_intimidate (DEM — A7), or fight_round (WR §12).'))
      .toBe('You must engage: run, hack them (needs HAK), an opening volley (GUN, once), threaten them (DEM), or exchange fire.');
    expect(plainWords('sacrifice_unnamed (they die; the hazard counts as survived) or decline_sacrifice (the consequence lands as rolled).'))
      .toBe('spend a red shirt (they die; the hazard counts as survived) or let it land (the consequence lands as rolled).');
  });

  it('a digital seat reads the names on the cards: a recruit by name in the list, and by name once aboard', () => {
    const players: PlayerConfig[] = [{ player_id: 'p1', kind: 'human', name: 'Zeke', table: 'digital' }];
    let s = warbleWayGalaxy.createSession(players, { seed: 7 });
    s = warbleWayGalaxy.applyMove(s, 'p1', { type: 'create_character', character_name: 'Zara', race: 'kralkin', ship_name: 'Wandering Star', method: 'recommended', scores: { PIL: 3, SWA: 2, DIP: 1 } }).newState;
    const legal = warbleWayGalaxy.getLegalMoves(s, 'p1');
    expect(legal.find((m) => m.move_id === 'recruit-h1-c4')!.description).toMatch(/^Attempt to recruit Slate, the Grull \(DIP \+1, min roll 11\), at the cantina\.$/);
    expect(legal.find((m) => m.move_id === 'buy-h1-s1')!.description).toMatch(/^Buy Sustenance Cube \(Consumable \+1 Any\) for 200c/);
    expect(legal.find((m) => m.move_id === 'take-mission-h1-m2')!.description).toMatch(/^Scrapyard Squabble: Take the DIP 10 mission/);
    // Once aboard, the label the moves use is still the engine's; the sentences say the name.
    const aboard = { ...s, gameState: { ...s.gameState, crew: [{ name: 'Grull (DIP+1)', race: 'grull' as const, idealized: 'finesse' as const, abilities: { DIP: 1 }, anger_tokens: 0, gear: { weapon: null, armor: null }, recruit_id: 'h1-c4' }] } };
    const release = warbleWayGalaxy.getLegalMoves(aboard, 'p1').find((m) => m.move.type === 'release_crew')!;
    expect(release.description).toMatch(/^Release Slate from the crew/);
    expect(release.move).toMatchObject({ crew_name: 'Grull (DIP+1)' });
  });

  it('a recruit being asked is named as their card names them, and a seat that presses Roll is not told to report dice', () => {
    const players: PlayerConfig[] = [{ player_id: 'p1', kind: 'human', name: 'Zeke', table: 'digital' }];
    let s = warbleWayGalaxy.createSession(players, { seed: 7 });
    s = warbleWayGalaxy.applyMove(s, 'p1', { type: 'create_character', character_name: 'Zara', race: 'kralkin', ship_name: 'Wandering Star', method: 'recommended', scores: { PIL: 3, SWA: 2, DIP: 1 } }).newState;
    const ask = warbleWayGalaxy.getLegalMoves(s, 'p1').find((m) => m.move_id === 'recruit-h1-c4')!;
    const asked = warbleWayGalaxy.applyMove(s, 'p1', ask.move);
    expect(asked.summary).toMatch(/^Recruiting Slate the Grull \(DIP \+1, min roll 11\)/);
    expect(asked.summary).toMatch(/Roll 3d6; you need 11\+\./);
    expect(asked.summary).not.toMatch(/report/);
    // The roll's own sentence still names them, though the roll is settled by then.
    const roll = warbleWayGalaxy.getLegalMoves(asked.newState, 'p1').find((m) => m.move.type === 'resolve_report')!;
    const rolled = warbleWayGalaxy.applyMove(asked.newState, 'p1', roll.move);
    expect(rolled.summary).toMatch(/Slate/);
    expect(rolled.summary).not.toMatch(/Slate the Slate/);
    // A physical seat is still told to report what it rolled.
    const table: PlayerConfig[] = [{ player_id: 'p1', kind: 'human', name: 'Zeke' }];
    let t = warbleWayGalaxy.createSession(table, { seed: 7 });
    t = warbleWayGalaxy.applyMove(t, 'p1', { type: 'create_character', character_name: 'Zara', race: 'kralkin', ship_name: 'Wandering Star', method: 'recommended', scores: { PIL: 3, SWA: 2, DIP: 1 } }).newState;
    const physical = warbleWayGalaxy.applyMove(t, 'p1', warbleWayGalaxy.getLegalMoves(t, 'p1').find((m) => m.move_id === 'recruit-h1-c4')!.move);
    expect(physical.summary).toMatch(/^Recruiting Grull \(DIP \+1, min roll 11\)/);
    expect(physical.summary).toMatch(/and report the dice/);
  });

  it('a digital seat is served the plain sentences; a physical seat the engine\'s own', () => {
    const create = { type: 'create_character', character_name: 'Zara', race: 'kralkin', ship_name: 'Wandering Star', method: 'recommended', scores: { PIL: 3, SWA: 2, MEC: 1 } } as const;
    const play = (players: PlayerConfig[]) => {
      let s = warbleWayGalaxy.createSession(players, { seed: 7 });
      s = warbleWayGalaxy.applyMove(s, 'p1', create).newState;
      const docks = warbleWayGalaxy.getLegalMoves(s, 'p1').map((m) => m.description).join('\n');
      return { docks, all: docks };
    };
    const digital = play([{ player_id: 'p1', kind: 'human', name: 'Zeke', table: 'digital' }]);
    const physical = play([{ player_id: 'p1', kind: 'human', name: 'Zeke' }]);
    expect(digital.all).not.toMatch(/WR §|amendment|ruling #|\(A\d/);
    expect(digital.all).not.toMatch(/[a-z]_[a-z]/);
    expect(physical.all).toMatch(/Pay 150c/);
    expect(digital.all).toMatch(/Pay 150c: the yard raises the Wandering Star one damage level/);
  });
});
