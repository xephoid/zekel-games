// Rules-teaching: getRulesSections + describeMoveGates (docs/rules-teaching.md —
// port blocker since 2026-09-11). getRulesText derives from these via
// renderRulesText — never a parallel blob.

import type { RuleSection } from '@zekel/game-kit';

export const NGG_SECTIONS: RuleSection[] = [
  {
    id: 'setup-and-drafts',
    title: 'Setup: factions, Leader draft, starting locations',
    text: 'Pick the map for your player count. Each player chooses a faction; the Leader draft runs in player order (starred heroes are recommended, species restrictions are enforced); starting locations run in reverse order. Wizards start with 3 Surfs and max mana 5; robots with 4 Cores in two water and two wood collector platforms. Starting pieces count toward technology type progress.',
    tags: { move_types: ['assign_setup_choices', 'choose_leader', 'choose_starting_location'], phases: ['setup_factions', 'setup_leaders', 'setup_locations'] },
  },
  {
    // Overview only — the full thresholds, eligibility and draws stay in
    // 'victory' at the end. No tags: it is read up front, never taught on a move.
    id: 'ngg-victory-overview',
    title: 'How you win: four paths',
    text: 'There are four ways to win. Full details, thresholds and draws are in the last section, "Victory: four paths, eligibility, draws".\n- Military: kill other players\' Leaders — 1 at two or three players, 2 at four to six.\n- Cultural: reach a culture total of 35 × the number of players.\n- Economic: in a single Build action, produce 3 water + 3 wood + 3 ore + 1 ether + 1 oil from collectors on distinct tiles — 12 tiles at two players, 16 at three to four, 26 at five to six.\n- Technological: reach 26 permanent points, one per unique technology type you own (units + buildings + research).',
    tags: {},
  },
  {
    id: 'round-structure',
    title: 'Round structure: upkeep, planning, LIFO stack, income, claims',
    text: 'Upkeep rotates the first-player token (including before round one), retrieves collectors, lets robots reallocate Cores, resets wizard mana, and returns played action cards. Planning places one card per player in turn or a final pass onto an Action Stack; a player may hold up to three of each card — the printed one, a hero\'s (Marshal / Quartermaster / Archivist) and a researched one (see Research) — and each card goes down once per round. The Action phase pops the stack last-in, first-out; an owner may decline a queued action (skipping commits no collectors). Culture income is awarded in first-player order before any milestone hero claim; claims alternate one per player per cycle.',
    tags: { move_types: ['plan_action', 'skip_action', 'reallocate_cores'], phases: ['upkeep', 'planning', 'action', 'culture', 'claims'] },
  },
  {
    id: 'collector-economy',
    title: 'Collectors: produce on commitment, placement anchors, expiry',
    text: 'Build and Research place available collectors onto eligible map locations; each produces one resource of that tile\'s current type and stays committed until upkeep (it can anchor later placements but cannot pay again). Resources never carry over between actions — unspent production expires. Two collectors never share a location, unless the placing robot has Collector Optimizations: then two of its own may, and an access partner\'s may join one of its if that partner has the research too — never more than two. A wizard with Haste has each committed Surf make two, and banks what a purchase does not spend for later purchases this round; the bank empties at upkeep. A placement is legal on or adjacent to an owned unit or owned base, adjacent to another collector committed this round, or adjacent to a partner\'s units under Shared Resources or Open Borders. Surplus placement to extend reach is legal.',
    tags: { move_types: ['build', 'research', 'economic_victory_spend'], phases: ['action'] },
  },
  {
    id: 'access-consent',
    title: 'Access and complete payment before commitment',
    text: 'For each purchase, declare the purchase and propose a complete legal collector payment; obtain any required access agreement BEFORE committing. Refusal leaves everything uncommitted and the action re-opens. Shared Resources and Open Borders grant automatic collection access; other treaties do not. A one-off agreement authorizes a specified collector on a specified location for Build or Research and protects that collector\'s stay until upkeep — it grants no other rights. Two-purchase abilities settle the procedure separately per purchase.',
    tags: { move_types: ['respond_access_request'] },
  },
  {
    id: 'build-and-spawn',
    title: 'Build: one purchase, prerequisites, spawn placement, bases',
    text: 'A Build action buys one unit, building, or base at its listed cost; Foreman permits two paid separately, and Core+platform is one combined purchase. New map units spawn at any owned base; Subjects go to the faction board; unallocated Cores to the reserve; spies are hero assignments. A new base goes on a tile holding an owned unit, no opposing unit and no base — even when you have no bases (there is no adjacent-placement recovery). Maximum three bases including the free starting base; a baseless player cannot place new map units or heroes until rebuilt.\n\nExample (wizard): you want an Evoker, which costs 2 wood + 1 ore.\n- Commit: place three available Surfs — two on wood tiles and one on an ore tile, each on or next to one of your units or next to a collector already committed this round.\n- Produce: the three Surfs make 2 wood + 1 ore.\n- Pay: all three go to the Evoker; nothing is left over to expire.\n- Resolve: the Evoker appears at any base you own. The three Surfs stay committed until upkeep — they can anchor later placements this round but cannot pay again.',
    tags: { move_types: ['build'], phases: ['action'] },
  },
  {
    id: 'movement-and-entry',
    title: 'Move or battle: adjacent movement and entry consequences',
    text: 'Move any number of your eligible mobile units from one location to one adjacent location. Immobile Combat Platforms and collectors cannot move; a Coreless platform cannot act. Entering opposing combat units begins a battle; Open Borders permits shared occupation; Peace forbids entering a partner\'s location or attacking it. Entering only unprotected opposing non-combat pieces or Coreless platforms sweeps them without battle. Elara\'s spell fires at the start of a Move/Battle action before movement.',
    tags: { move_types: ['move_units', 'cast_elara_spell'], phases: ['action'] },
  },
  {
    id: 'research-and-battle-cards',
    title: 'Research: technology unlocks and the battle-card purchase',
    text: 'Research makes one purchase: unlock one eligible unresearched technology (paying its cost, meeting its building prerequisite), or buy one battle strategy card for 1 water + 1 wood + 1 ore + either 1 ether or 1 oil (requires the Embassy or Defense Research Station) and draw from the shared deck. Three technologies each grant a permanent second action card — Extra Build, Extra Move/Battle, Extra Research — priced like a battle card (1 water + 1 wood + 1 ore + either 1 ether or 1 oil): a wizard unlocks them through the Library of Enchantment (Build), Library of Evocation (Move/Battle) and Library of Illusion (Research); a robot through the Advanced Research Station (2 ore + 1 wood, all three). Wizards may also research Haste at the Library of Enchantment (each committed Surf makes two; unspent production is banked for later purchases this round); robots may research Collector Optimizations (two collectors may share a location), Core Integration (the Core bought with a platform is free) and Self Destruct (a robot unit with printed DMG 1 or more may blow itself up in battle: current DMG + 3 to every other unit and hero there, every side; the unit is lost) at Home. Kettering permits two purchases of either mix, each from separate collectors. Smyth\'s free research waives cost AND prerequisite.',
    tags: { move_types: ['research', 'report_draw', 'resolve_report'] },
  },
  {
    id: 'battle-cards',
    title: 'Battle strategy cards: commitment, Counter/Extra batches, order',
    text: 'Each battle participant secretly commits one eligible card or no card; reveal together, then resolve each batch\'s Counters first in first-player order, then surviving Extras (each picks 0–2 added cards, chosen and revealed together, which form the next batch). A countered Extra reveals nothing. After batches, resolve Rally, then Retreat, then Bonus, then Initiative — first-player order within each type. The deck holds exactly 20 cards; played cards go to the public discard; the discard reshuffles when the deck depletes.',
    tags: { move_types: ['commit_battle_card', 'choose_counter_target', 'select_extra_cards', 'select_rally_units'], phases: ['battle'] },
  },
  {
    id: 'battle-activation',
    title: 'Battle: initiative passes, one activation each, targeting, reactions',
    text: 'Activate from highest to lowest current initiative; defenders win opposing ties, allied ties go by agreement or the earlier first-player-order owner. When several of your OWN units are tied, you pick which acts first — get_legal_moves offers each of them. Identical units of one owner in a battle are numbered (Dragon 1, Dragon 2) in the choices, the battle list and the log, and keep their number for the whole battle; name the numbered unit. Each unit gets one activation per pass: one attack OR one activated ability, or it may pass (the activation is used). A standing opposing Wall Platform must be the single-target target while it stands; AoE attacks hit every opposing unit including the Wall. Mana Shield, Decoy, and Cleric saves are reactions that follow their own timing and never consume an activation. Ice Blast immediately reorders a not-yet-activated target for the rest of the battle. With Self Destruct researched, a robot unit (not a hero) with printed DMG 1 or more may, on its activation instead of attacking, blow itself up: its current DMG + 3 hits every other unit and hero in the battle on every side (reactions as for an area attack; collectors on the tile, every side, are destroyed as by any area attack) and the unit is lost, its Core back to the supply. Killing your own Leader that way earns no Military credit.\n\nExample: a robot Spitter Platform (Initiative 95, DMG 1, DEF 1) attacks a wizard tile holding one Evoker (Initiative 50, DMG 2, DEF 1); the wizard has researched Mana Shield and has mana.\n- The pass runs from highest initiative down, so the Spitter acts first and attacks the Evoker for 1 DMG — enough to kill it at DEF 1.\n- The wizard reacts with Mana Shield, spending 1 mana to cut the hit by 1 point to 0. The Evoker survives.\n- That reaction did not use the Evoker\'s activation. At Initiative 50 it still acts: Wizard Missile (1 mana) hits the Spitter for 2 DMG, which meets its DEF 1, and the Spitter is destroyed.\n- Each unit has now had its one activation, so the pass is over.',
    tags: { move_types: ['battle_activation', 'choose_initiative_order', 'resolve_battle_defense'], phases: ['battle'] },
  },
  {
    id: 'retreat-and-stalemate',
    title: 'Retreat and stalemate',
    text: 'After an initiative pass with both sides alive, defenders declare first; each allied player decides independently. Retreat withdraws ALL of that player\'s mobile units together to one adjacent destination — allied-unit space first, then an eligible empty adjacent (your or an Open-Borders partner\'s bases and Coreless platforms count as empty; nobody can use the attack\'s origin hex). Immobile Combat Platforms and collectors always stay; a Decoy can move only its own hero. A full pass with no kill ends the battle in stalemate: all surviving attackers return to the origin hex together.',
    tags: { move_types: ['choose_retreat'], phases: ['battle'] },
  },
  {
    id: 'spies',
    title: 'Spies',
    text: 'Recruiting an Illusionist or Infiltrator is public, but you privately choose which owned hero carries the spy; only one active assignment per player, and revealing ends it. The wizard Decoy reveals to avoid an attack and optionally move the hero; the wizard\'s Invisible replaces a normal attack to instantly kill an opposing hero. A standing Wall Platform stops spies: while one stands on a side, neither Invisible nor Spy Attack can kill a hero on that side. In a battle on a tile holding a wizard Castle, the same holds for the side of the Castle owner, and for any side Envoy Sable Marrow is fighting on. The robot Infiltrator\'s Spy Attack reveals and expends the assignment. There is no Detection: no one may inspect a spy card.',
    tags: { move_types: ['build', 'choose_spy', 'battle_activation'] },
  },
  {
    id: 'heroes-and-claims',
    title: 'Heroes: milestones, reservation, benefits, lore',
    text: 'There are 20 unique heroes in a shared pool. You choose one Leader at setup and earn one additional hero at each of five culture milestones — maximum six heroes per player. The milestones are 5%, 15%, 30%, 50% and 75% of the culture target, rounded up: 4, 11, 21, 35, 53 at two players; 6, 16, 32, 53, 79 at three; 7, 21, 42, 70, 105 at four; 9, 27, 53, 88, 132 at five; 11, 32, 63, 105, 158 at six. A claimed hero places at any owned base; with no base, the hero is reserved with NO benefits until placed — no culture, no tech point, no action card, no treaty unlock, no purchase bonus, and one-time rewards like Smyth\'s wait. A killed non-Leader hero never returns; Leaders cannot be replaced.',
    tags: { move_types: ['choose_milestone_hero', 'place_reserved_hero', 'choose_leader'], phases: ['claims'] },
  },
  {
    id: 'treaties',
    title: 'Treaties: formation windows, effects, breaking conditions',
    text: 'Treaties are binding two-player agreements formed only at the start or end of the ACTIVE player\'s action, one active treaty per pair, one token per treaty type, and one partner needs an unlock (Embassy, Diplomatic Research Station, or active Envoy) — the unlock is needed to form, not to maintain. Each active treaty pays each partner culture every round, by type: Open Borders +5, Shared Resources +4, Peace +3, Shared Tactics +2, Culture Treaty +1. Open Borders and Peace make military allies; Shared Resources and Open Borders grant collection access; the Culture Treaty (4+ players only) shares a direct partner\'s victory; Shared Tactics privately shares hands. Breaking happens only at each treaty\'s printed window — and never to bypass a condition by a mutual replacement.\n\nTreaty            | Military allies | Collection access | Hand sharing | Victory sharing  | Culture/round\n------------------|-----------------|-------------------|--------------|------------------|--------------\nOpen Borders      | Yes             | Yes               | No           | No               | +5\nShared Resources  | No              | Yes               | No           | No               | +4\nPeace             | Yes             | No                | No           | No               | +3\nShared Tactics    | No              | No                | Yes          | No               | +2\nCulture Treaty    | No              | No                | No           | Yes (4+ players) | +1',
    tags: { move_types: ['form_treaty', 'respond_treaty', 'break_treaty'] },
  },
  {
    id: 'victory',
    title: 'Victory: four paths, eligibility, draws',
    text: 'Only a player with a living Leader can INITIATE any victory. Military: kill enough other Leaders (2p/3p: the first kill ends the game; 4–6p: 2). Cultural: reach 35 culture per player (70 at two players, 105 at three, 140 at four, 175 at five, 210 at six). Economic: in one Build action commit collectors on distinct tiles (12 at two players, 16 at three to four, 26 at five to six) producing at least 3 water + 3 wood + 3 ore + 1 ether + 1 oil (the rest may collect anything), building nothing. Technological: one permanent point per unique acquired type (units + buildings + research), 26 for either species, with Motherboard and Greymore each adding five live bonus points; the battle strategy card type (the first card a player buys or gains from Archmage Chaimidious) is one of the 26. A completed victory is never replaced by a later draw; if every Leader dies with no winner, the game is a draw.',
    tags: { move_types: ['economic_victory_spend', 'build'], phases: ['culture', 'claims', 'action'] },
  },
];

/** Gate declarations for `describeMoveGates` (the ambient grey list + rejection
 *  enrichment + teach trigger — ONE declaration drives all three). */
export const NGG_GATE_RULES: Record<string, { section: string; reason: string }> = {
  build: { section: 'build-and-spawn', reason: 'needs the purchase\'s cost paid from available collectors, any prerequisite building, and supply' },
  research: { section: 'research-and-battle-cards', reason: 'needs a Research action resolving, an unresearched technology with its prerequisite, or the Embassy/Defense Research Station for a battle card' },
  economic_victory_spend: { section: 'victory', reason: 'needs a Build action, a living Leader, and 12 / 16 / 26 collectors (by player count) on distinct tiles incl. oil and ether' },
  move_units: { section: 'movement-and-entry', reason: 'needs a Move/Battle action resolving and an owned mobile unit on an adjacency' },
  cast_elara_spell: { section: 'movement-and-entry', reason: 'needs your Move/Battle action at its start (before any movement), Elara in play on your side, and 5 mana' },
  form_treaty: { section: 'treaties', reason: 'needs an active action window, an eligible partner, and a treaty unlock (Embassy / Diplomatic Research Station / active Envoy) on one partner' },
  respond_treaty: { section: 'treaties', reason: 'answer an offered treaty (accept or decline)' },
  break_treaty: { section: 'treaties', reason: 'needs an active treaty whose printed break condition is met at a legal window' },
  commit_battle_card: { section: 'battle-cards', reason: 'needs a battle you participate in' },
  choose_counter_target: { section: 'battle-cards', reason: 'needs your unresolved Counter in the batch' },
  select_extra_cards: { section: 'battle-cards', reason: 'needs your Extra to survive the batch\'s Counters' },
  battle_activation: { section: 'battle-activation', reason: 'needs a unit of yours on the activation clock (initiative order; one per pass)' },
  choose_initiative_order: { section: 'battle-activation', reason: 'needs allied units of different owners tied on initiative, with you the tied owner earliest in first-player order' },
  resolve_battle_defense: { section: 'battle-activation', reason: 'needs an attack threatening your unit with a defense you hold' },
  choose_retreat: { section: 'retreat-and-stalemate', reason: 'needs a post-pass battle where your side still stands' },
  select_rally_units: { section: 'battle-cards', reason: 'needs your Rally card resolving' },
  choose_milestone_hero: { section: 'heroes-and-claims', reason: 'needs a crossed culture milestone and the shared pool non-empty' },
  place_reserved_hero: { section: 'heroes-and-claims', reason: 'needs a reserved hero and an owned base' },
  choose_spy: { section: 'spies', reason: 'needs your unresolved Illusionist/Infiltrator recruitment' },
  reallocate_cores: { section: 'round-structure', reason: 'an upkeep option for a robot seat with Cores and platforms or collectors to hold them' },
  report_draw: { section: 'research-and-battle-cards', reason: 'a physical draw you must report by printed card name' },
  resolve_report: { section: 'research-and-battle-cards', reason: 'the Draw button for a digital seat — the server reveals' },
  skip_action: { section: 'round-structure', reason: 'decline the queued action or the optional second purchase, or end a finished action without offering a treaty' },
  plan_action: { section: 'round-structure', reason: 'place one unused action card or pass (final for the round)' },
};
