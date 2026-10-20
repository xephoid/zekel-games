// Sectioned rules for Cybernoir 2127 (docs/rules-teaching.md — sections only;
// gate declarations may come later as real confusion is observed).
//
// Source of truth: port/cybernoir-2127/CYBERNOIR-2127-RULES.html, Rules v2.3
// (2026-08-13, designer-accepted). Authored 2026-08-17 to close the
// integration gate's finding D (INTEGRATION-NOTES.md): the server carried NO
// rules text, so assistants answered rules questions from training memory —
// three different answers to "how does Evidence work?" in one game.
//
// Component counts are interpolated from the data module, never recited as
// literals — the printed rulebook itself disagrees with its own card list
// (§2 says 18 Locations, §8.2 lists 19), and stale counts were the gate's
// finding A. The card tables live in get_rules reference data, not here.

import type { RuleSection } from '@zekel/game-kit';
import { LOCATIONS, PEOPLE } from './data/index.js';

const L = LOCATIONS.length; // 19 as of v2.0 (Little Ghana)
const P = PEOPLE.length;

export const CYBERNOIR_RULE_SECTIONS: RuleSection[] = [
  {
    id: 'how-to-answer-rules-questions',
    title: 'CYBERNOIR 2127 — rules reference for THIS implementation (v2.3)',
    text:
      'get_legal_moves is the sole authority on what is legal RIGHT NOW; this text explains the ' +
      'rules behind each action so you can answer questions and explain absences. NEVER invent a ' +
      'rule from general knowledge — this game exists only here, and this text plus the session\'s ' +
      'reference data are the arbiter. Card-by-card stats live in get_rules reference data.',
    tags: {},
  },
  {
    id: 'overview-and-goal',
    title: 'OVERVIEW & WIN CONDITIONS',
    text:
      'The Detective committed the crime and framed the Hacker. The DETECTIVE wins by deducing the ' +
      'Hacker\'s hidden hideout and arresting them — one mid-game guess, plus one final guess at the ' +
      'endgame (§ENDGAME). The HACKER wins by assembling all 3 pieces of Evidence (the Weapon, 3 ' +
      'Witnesses, 3 Motive sets) that clear their name — and then surviving the Detective\'s final ' +
      'guess. Core tension: every person the Hacker uses might secretly be a Detective informant, ' +
      'and getting burned leaks a Clue about the hideout.',
    tags: {},
  },
  {
    id: 'hideout-and-clues',
    title: 'THE HIDDEN LOCATION & CLUES',
    text:
      'The hideout is defined by three attributes, each with Clue tokens: Borough (3 values), ' +
      'Population (0/1/2/3), Affiliation (6 values). When the Detective GAINS a Clue, the HACKER ' +
      'chooses which category to reveal truthfully. NO REPEATS: each truthful category can be given ' +
      'only once; the Hacker must choose a category not yet revealed; a Clue earned when all three ' +
      'are revealed has no effect. A NEGATIVE Clue is a token the Hacker declares FALSE ("my ' +
      'affiliation is NOT Crimson Clan") — it must be NEW information: not previously declared ' +
      'false and not in a category already truthfully revealed. Negative Clues are given ONLY as ' +
      'the cost of a Jailbreak, never in place of a truthful clue.',
    tags: { move_types: ['clue_reveal'] },
  },
  {
    id: 'setup',
    title: 'SETUP',
    text:
      `The Hacker secretly chooses a hideout from the ${L} locations and TAKES that Location card ` +
      `out of the Location deck, keeping it facedown as their safehouse card — the deck is then ` +
      `${L - 1} cards (against an AI Hacker the physical deck keeps all ${L}; the server tracks the ` +
      'removal). Consequences: a face-up Location on the board can never be the hideout, and a ' +
      'Detective who tracks every card seen (hand, board, discards) narrows the hideout by ' +
      'elimination. The Hacker then secretly gathers the Contact cards of the people RESIDENT at ' +
      'the hideout (0-3 cards; always go through the motions even at population 0 — otherwise you ' +
      'leak immediately), shuffles the remaining Contacts deck (which includes the Weapon), and ' +
      'draws until holding 3 cards total. The Detective shuffles the Location deck, draws 3, and ' +
      'takes the POI deck (facedown, NOT shuffled) for informants and arrests.',
    tags: { move_types: ['report_hideout'], phases: ['setup'] },
  },
  {
    id: 'detective-turn',
    title: 'DETECTIVE\'S TURN — 4 AP',
    text:
      'Start of turn, MANDATORY, in this order: (1) Draw a Location card (free; the Location deck ' +
      'NEVER reshuffles — if you cannot draw, the endgame triggers, §ENDGAME). (2) Play 1 Location ' +
      'card face up to the board (free; the draw precedes the play, so you always have a card). ' +
      '(3) Informant upkeep: pay 1 AP per informant from previous turns; any unpaid informant is ' +
      'released (returns facedown to the hidden POI deck). Then spend remaining AP on: ' +
      'ARREST (1 AP) — any person at a face-up location you have played; their POI card goes to ' +
      'Booked (jail slot 1). RECRUIT INFORMANT (3 AP) — same reach as an Arrest: a person at a ' +
      'face-up location you have played; their POI card goes facedown as an informant (upkeep ' +
      'starts next turn). DRAW AN EXTRA LOCATION (4 AP). GUESS THE HACKER\'S LOCATION (4 AP) — ' +
      'exactly ONE mid-game chance; correct = win, wrong = play continues and only the endgame ' +
      'guess remains. BUY A CLUE (discard 3 Locations from hand) — the Hacker chooses the category ' +
      '(§CLUES). Hand economy note: draw-1/play-1 leaves the starting 3 as spares, so later ' +
      'purchases need the extra-draw action or the Hacker\'s Overclock gift. END OF TURN: the jail ' +
      'track advances (§JAIL). EXAMPLE: you draw the Location Xistential Club and play it face up ' +
      '(free, free). You have no informants yet, so there is no upkeep; 4 AP remain. You recruit an ' +
      'informant on Blackice, who lives at Xistential Club (3 AP). 1 AP is left unused — unused AP ' +
      'is lost. End of turn: any POI card on Booked advances to Processing.',
    tags: {
      move_types: ['play_location', 'arrest', 'recruit_informant', 'draw_extra_location', 'guess_location', 'buy_clue', 'upkeep_choice'],
    },
  },
  {
    id: 'jail-track',
    title: 'THE JAIL TRACK',
    text:
      'Three named slots: Booked (1), Processing (2), Release Pending (3). An arrest places the ' +
      'POI card on Booked; multiple cards may share a slot and advance together. At the END of ' +
      'each Detective turn every jailed card advances one slot; a card advancing off Release ' +
      'Pending is released — the POI card returns facedown into the hidden POI deck and the ' +
      'person may be played again. An arrest NEVER moves anyone already jailed (v2.3). A jailed ' +
      'person cannot be played or used as Evidence while jailed — but their Contact card remains ' +
      'in the Hacker\'s deck and may legally be drawn (it is dead in hand until release). The ' +
      'Hacker\'s JAILBREAK (free) removes one person from the track at the cost of giving the ' +
      'Detective a Negative Clue (§CLUES).',
    tags: { move_types: ['arrest', 'jailbreak'] },
  },
  {
    id: 'hacker-turn',
    title: 'HACKER\'S TURN — 3 AP',
    text:
      'Spend AP in any order on: DRAW A CONTACT (1 AP). PLAY A PERSON (printed play cost) — use ' +
      'their ability, then the card goes to your discard; INFORMANT CHECK: if the card matches a ' +
      'facedown informant the Detective may reveal it to BLOCK — the Detective gains a Clue ' +
      '(Hacker chooses category), the AP spent is LOST, and the card returns to hand. PLAY ' +
      'EVIDENCE (FREE) — the card stays face up on the table permanently; same informant check ' +
      'and penalty; played Evidence can never be arrested or made an informant. WIN BACK A ' +
      'CONTACT (printed cost; Witnesses cost 1) — see §INFORMANTS. JAILBREAK (free + give a ' +
      'Negative Clue) — free one person from the jail track. OVERCLOCK (free + give the Detective ' +
      '2 Location draws) — gain +1 AP this turn, once per turn. BURN THE SAFEHOUSE (3 AP, once ' +
      'per game) — §BURN. Ending the turn with AP unspent is allowed; unspent AP is lost. ' +
      'EXAMPLE (a blocked Evidence play): you have 3 AP. You play Deckard Voss for his ability ' +
      '(cost 2); he goes to your discard. Then you try to play your Witness set (Eddie the ' +
      'Doorman, Gus the Noodle Guy, Dot the Birdwatcher) as Evidence. The Detective reveals a ' +
      'facedown informant on Eddie: the Evidence play cost no AP, so you lose 0 AP, but the whole ' +
      'set returns to your hand and the Detective gains a Clue (you choose the category). You have ' +
      '1 AP left; ending the turn now loses it.',
    tags: {
      move_types: ['draw_contact', 'play_person', 'play_evidence', 'win_back', 'jailbreak', 'overclock', 'pass_turn', 'block_decide'],
    },
  },
  {
    id: 'burn-the-safehouse',
    title: 'BURN THE SAFEHOUSE (3 AP, once per game)',
    text:
      'The Hacker relocates. In order: (1) collect the Detective\'s Location DISCARD pile and the ' +
      'remaining Location deck into one pile and add the old safehouse card (cards in the ' +
      'Detective\'s hand and face up on the board stay put — a human Detective is asked to report ' +
      'the Location cards still in their hand, which the pile reveals by elimination anyway); ' +
      '(2) secretly choose a DIFFERENT location from that pile as the new safehouse card; ' +
      '(3) shuffle the rest facedown into the new Location deck; (4) CLEAR THE CLUES: every Clue ' +
      'token on the table — truthful AND Negative — returns to the supply; the investigation ' +
      'restarts from zero and categories become earnable again. Notes: the burn costs the whole ' +
      'normal turn (3 AP) unless Overclocked first; gathering the pile shows the Hacker which ' +
      'Locations the Detective is holding (by elimination); returned discards push back the ' +
      'deck-exhaustion endgame.',
    tags: { move_types: ['burn_safehouse', 'burn_choice', 'report_location_hand'] },
  },
  {
    id: 'endgame',
    title: 'ENDGAME TRIGGERS & THE FINAL GUESS',
    text:
      'Two events force the showdown; in both the Detective gets ONE FINAL Location guess, granted ' +
      'even if the mid-game guess was already spent. Correct = Detective wins; wrong = the Hacker ' +
      'is exonerated and wins. (1) EVIDENCE COMPLETE: the moment the Hacker completes all 3 ' +
      'Evidence pieces, the final guess happens IMMEDIATELY — the Hacker\'s turn ends on the spot ' +
      'and nothing else resolves first. (2) LOCATION DECK EXHAUSTED: if the Detective cannot make ' +
      'the mandatory start-of-turn draw, the final guess must be made by the end of that turn. The ' +
      'Location deck never reshuffles, so every board discard, forced hand discard, bought Clue, ' +
      'and Overclock draw shortens the game — the one exception is Burn the Safehouse, which folds ' +
      'the discard pile back in.',
    tags: { move_types: ['final_guess'] },
  },
  {
    id: 'informants',
    title: 'INFORMANTS',
    text:
      'The Detective recruits an informant (3 AP) by placing a POI card facedown — only a person ' +
      'at a face-up location they have played. Each later Detective turn, every informant costs ' +
      '1 AP upkeep or must be released. When the Hacker plays a person (ability or Evidence) ' +
      'matching a FACEDOWN informant, the Detective may REVEAL it to block the play and earn a ' +
      'Clue (Hacker\'s choice of category). A REVEALED informant stays face up: it CONTINUES to ' +
      'block that person and still costs upkeep. WIN BACK: the Hacker may play the matching ' +
      'Contact for its printed cost (Witnesses cost 1) to remove a REVEALED informant — the POI ' +
      'card returns facedown to the POI deck, the Contact goes to the Hacker\'s discard (it does ' +
      'NOT count as Evidence); this play cannot be blocked; facedown informants cannot be ' +
      'targeted. ANANSI THE SPIDER: committed AS EVIDENCE (inside whichever witness or motive set ' +
      'contains him — v2.4), remove ONE informant of your choice — a facedown one by POSITION ' +
      '(returns to the POI deck unseen) or a revealed one by name; if ' +
      'the commit completes all 3 Evidence the final guess fires and the removal is skipped. ' +
      'ICEDEN RIDER: a played Motive set containing an Iceden Collective member wins back one ' +
      'REVEALED informant free, once per set; skipped if the set completes all Evidence; with ' +
      'both Anansi and an Iceden member in one set, Anansi resolves first. OMNI "Reveal an ' +
      'informant" ability: the HACKER flips any one facedown informant face up (it keeps ' +
      'blocking and costing upkeep — the value is intel). The POI deck is hidden: released ' +
      'people vanish back into anonymity and can be re-recruited or arrested later unseen.',
    tags: {
      move_types: ['recruit_informant', 'reveal_informant', 'block_decide', 'win_back', 'informant_removal_choice', 'upkeep_choice'],
    },
  },
  {
    id: 'evidence',
    title: 'EVIDENCE — THE HACKER\'S WIN OBJECTIVES',
    text:
      'HOW THE HACKER WINS — at a glance: • THE WEAPON: play the one unique Weapon card by itself ' +
      '(no trio needed). • THE WITNESSES: play exactly 3 Witness cards together as ONE set. • THE ' +
      'MOTIVE: play 3 SETS of 3 people each — every set from 3 different affiliations, at most 2 ' +
      'gang members per set, and no set reusing another set\'s three affiliations. Completing all ' +
      'three fires the Detective\'s final guess immediately. The full rules for each piece follow. ' +
      'All Evidence plays are FREE (no AP). The Hacker must establish all three: (1) THE WEAPON — ' +
      'one unique card shuffled into the Contacts deck; it has no POI copy, so it can never be an ' +
      'informant, blocked, or arrested — find it and play it; the Weapon is the ONLY single-card ' +
      'Evidence play. (2) THE WITNESSES (v2.4) — played as ONE COMPLETE SET of 3 Witness cards in ' +
      'a single action (all None-affiliation people are Witnesses); witnesses are never banked one ' +
      'at a time; each card gets the informant check in declared order and ONE accepted block ' +
      'bounces the WHOLE set back to hand. (3) THE MOTIVE — play 3 SETS of 3 ' +
      'people (v2.1/v2.3): each set is 3 unique people from 3 DIFFERENT affiliations, with AT ' +
      'MOST TWO gang members per set (gangs: Iceden, Crimson Clan, Chimera), and NO TWO SETS may ' +
      'use the same three affiliations. A set is played as a COMPLETE TRIO — all 3 cards in ONE ' +
      'action; Motive cards are NEVER banked one at a time and there are no partial sets. Each ' +
      'card of the set gets the informant check in declared order — ONE accepted block bounces ' +
      'the WHOLE set back to hand (the Detective earns the usual Clue). NO DOUBLE-COUNTING: a ' +
      'card counts toward exactly one Evidence piece. Played Evidence stays on the table ' +
      'permanently and is safe from arrest and recruitment. The moment all three pieces are ' +
      'complete, the endgame fires immediately (§ENDGAME).',
    tags: { move_types: ['play_evidence'] },
  },
  {
    id: 'card-abilities',
    title: 'PEOPLE & ABILITIES (summary — full table in reference data)',
    text:
      `${P} People exist as two identical decks: the Hacker's Contacts and the Detective's POI. ` +
      'Ability families: WITNESSES (None affiliation; Anansi additionally carries his Evidence ' +
      'rider). ICEDEN: draw-3 (cost 1) and force-the-Detective-to-discard-a-Location-from-hand ' +
      '(cost 2; the discard is pulled BLINDLY from the hidden hand). CRIMSON CLAN & CHIMERA: ' +
      'discard a Location from the BOARD (cost 2). OMNI: reveal an informant (cost 2). SHIZUOKA: ' +
      'gain a card from your discard pile (cost 1). A person played for an ability goes to the ' +
      'Hacker\'s discard after resolving; abilities that need a target ask for it as a follow-up ' +
      'choice. People are unique named individuals — same-ability cards are not interchangeable.',
    tags: {
      move_types: ['play_person', 'board_discard_choice', 'discard_retrieval_choice'],
    },
  },
  {
    id: 'deck-rules',
    title: 'DECKS, HANDS, AND CARD FLOW',
    text:
      'CONTACTS DECK (Hacker): if it runs out, reshuffle the discard pile into a new deck — an ' +
      'empty Contacts deck is never a wall. EXCEPTION (server ruling on a printed-rules silence, ' +
      'pending the designer): if the deck AND the discard pile are BOTH empty — every Contact is ' +
      'in the Hacker\'s hand or on the table — there is nothing to draw or reshuffle, and DRAW A ' +
      'CONTACT is simply unavailable that turn (no AP may be spent on it). The Hacker has NO hand limit. LOCATION DECK ' +
      '(Detective): NEVER reshuffles (except via Burn the Safehouse); its exhaustion is the ' +
      'built-in game timer. An empty Detective hand is legal and never blocks play (the mandatory ' +
      'draw precedes the mandatory play). Location cards in hand have no function beyond being ' +
      'played, discarded for a Clue, or lost to Iceden attacks. Card flow: ability plays go to ' +
      'the Hacker\'s discard (retrievable via Shizuoka or the reshuffle); Evidence plays stay on ' +
      'the table for the rest of the game.',
    tags: { move_types: ['draw_contact'] },
  },
];
