import type { LegalMove } from '@zekel/game-kit';
import {
  anyoneHasEffective,
  bestForAbility,
  cellsWhere,
  describeMission,
  describeRecruit,
  inAttackRange,
  partyQualifiesFor,
  ruinAdjacentSpot,
  ruinAttackRange,
  ruinMapForLevel,
  unnamedCap,
} from './engine.js';
import { HABITATS } from './data/habitats.js';
import { ABILITY_NAMES } from './data/abilities.js';
import { ARCHETYPES, archetypeLabel } from './data/archetypes.js';
import { CLUB_MISSIONS, DIAMOND_PIRATES, SPADE_HAZARDS } from './data/travelTables.js';
import type { AbilityId, WarbleMove, WarbleWayGalaxyState } from './types.js';

// The full legal-move surface: creation, habitat actions, journeys, space
// combat, and ruins. An open pending restricts the menu to its resolution;
// get_legal_moves is always the authoritative list.

export function getLegalMoves(state: WarbleWayGalaxyState, playerId: string): LegalMove<WarbleMove>[] {
  if (state.result !== null) return [];

  // ---- creation: fill-in moves (the values are the PLAYER's — setup checklist walks them)
  if (state.phase === 'creation') {
    return [
      {
        move_id: 'create-character',
        description:
          'Create your character: name, race (human/kralkin/hexapod/grull), ship name, and ability scores — ' +
          'recommended method: one score 3, one 2, one 1 (e.g. { SWA: 3, HAK: 2, SNE: 1 }); or distribute 6 points (max 3 per ability). ' +
          'Optional disposition: brash or risk_averse (a roleplay hint only). FILL IN the values the player chose — do not submit this skeleton.',
        move: {
          type: 'create_character',
          character_name: '',
          race: 'human',
          ship_name: '',
          method: 'recommended',
          scores: {},
        },
      },
      {
        move_id: 'create-character-archetype',
        description:
          'OR pick an archetype card (A21) — a pre-built spread with a printed difficulty: ' +
          ARCHETYPES.map(archetypeLabel).join(' · ') +
          '. FILL IN name/race/ship and the chosen card\'s printed name as archetype_name.',
        move: {
          type: 'create_character',
          character_name: '',
          race: 'human',
          ship_name: '',
          method: 'archetype',
          archetype_name: '',
        },
      },
    ];
  }

  // ---- an open pending restricts the menu to its resolution (+ declaring consumables)
  const pending = state.pending;
  if (pending) {
    const moves: LegalMove<WarbleMove>[] = [];
    if (pending.kind === 'roll') {
      // Digital mode: a digital human presses the Roll button instead of
      // reporting dice — same pending, same consumable declarations, different
      // resolver (docs/digital-mode.md). AI seats never get served legal moves.
      if (state.digital_seat === true) {
        moves.push({
          move_id: 'resolve-report',
          description: `Roll the ${pending.dice_count}d6 for the ${pending.reason.replace(/_/g, ' ')}${pending.min_roll !== null ? ` (needs ${pending.min_roll}+)` : ''} — the server rolls when you press this.`,
          move: { type: 'resolve_report' },
        });
      } else {
        moves.push({
          move_id: 'report-roll',
          description: `Report the player's ${pending.dice_count}d6 for the ${pending.reason.replace(/_/g, ' ')} roll${
            pending.min_roll !== null ? ` (needs ${pending.min_roll}+)` : ''
          } — fill in the actual dice values.`,
          move: { type: 'report_roll', dice: [] },
        });
      }
      for (const item of state.items) {
        if (item.type !== 'consumable') continue;
        if (state.consumed_item_ids.includes(item.id) || pending.declared_items.includes(item.id)) continue;
        if (item.effect.kind !== 'ability_bonus') continue;
        const matches = item.effect.ability === 'ANY' || item.effect.ability === pending.score_source.ability;
        if (!matches) continue;
        moves.push({
          move_id: `use-item-${item.id}`,
          description: `Declare ${item.name} for this roll (+${item.effect.bonus}; consumed when the dice are reported).`,
          move: { type: 'use_item', item_name: item.name },
        });
      }
      return moves;
    }
    if (pending.kind === 'level_up') {
      const char = state.character!;
      const owned = (Object.keys(char.abilities) as AbilityId[])
        .filter((a) => (char.abilities[a] ?? 0) >= 1)
        .map((a) => ({
          move_id: `level-up-${a}`,
          description: `Level up: +1 ${a} (${ABILITY_NAMES[a]}) → ${(char.abilities[a] ?? 0) + 1}.`,
          move: { type: 'level_up', ability: a } as WarbleMove,
        }));
      // Amendment A3: an EVEN level being reached may OPEN a new ability at 1.
      if ((char.level + 1) % 2 === 0) {
        const openable = (Object.keys(ABILITY_NAMES) as AbilityId[])
          .filter((a) => (char.abilities[a] ?? 0) < 1)
          .map((a) => ({
            move_id: `level-up-open-${a}`,
            description: `Open a NEW ability at 1: ${a} (${ABILITY_NAMES[a]}) — even-level unlock (amendment A3).`,
            move: { type: 'level_up', ability: a } as WarbleMove,
          }));
        return [...owned, ...openable];
      }
      return owned;
    }
    if (pending.kind === 'release_crew') {
      return state.crew.map((c) => ({
        move_id: `release-${c.name}`,
        description: `Release ${c.name} (they take their equipped gear).`,
        move: { type: 'release_crew', crew_name: c.name },
      }));
    }
    if (pending.kind === 'card_draw') {
      if (state.digital_seat === true) {
        return [
          {
            move_id: 'resolve-report',
            description: 'Draw the next card from the travel deck — the server deals it when you press this.',
            move: { type: 'resolve_report' },
          },
        ];
      }
      return [
        {
          move_id: 'report-card-draw',
          description:
            'The player draws the next card from THEIR physical travel deck and reports it (e.g. "7♠", "queen of hearts") — fill in the actual card.',
          move: { type: 'report_card_draw', card: '' },
        },
      ];
    }
    if (pending.kind === 'res_discard') {
      return [
        {
          move_id: 'report-res-discard',
          description: `Research peek: the player looks at the top ${pending.peek_count} card(s) of their deck and reports the ONE they discard (a peek REQUIRES discarding one) — fill in the actual card.`,
          move: { type: 'report_res_discard', card: '' },
        },
        {
          move_id: 'skip-res-peek',
          description: 'Decline the peek — the deck stays unread and nothing is discarded (the peek is optional, WR §4).',
          move: { type: 'skip_res_peek' },
        },
      ];
    }
    if (pending.kind === 'hazard_option') {
      const rank = pending.card_id.replace(/[HDSC]$/, '') as keyof typeof SPADE_HAZARDS;
      const hazard = SPADE_HAZARDS[rank]!;
      const opts: LegalMove<WarbleMove>[] = [];
      for (const [n, opt] of [[1, hazard.option1] as const, [2, hazard.option2] as const]) {
        const has = anyoneHasEffective(state, opt.ability);
        if (pending.must_fail || has) {
          opts.push({
            move_id: `hazard-option-${n}`,
            description: pending.must_fail
              ? `FAIL the ${opt.ability} option (take its consequence — nobody aboard has either ability).`
              : `Roll the ${opt.ability} ${opt.min_roll} option (best aboard: +${bestForAbility(state, opt.ability).bonus}). Optional carrier field: WHOSE score carries it (they face the consequence).`,
            move: { type: 'choose_hazard_option', option: n },
          });
        }
      }
      return opts;
    }
    if (pending.kind === 'space_mission_offer') {
      const rank = pending.card_id.replace(/[HDSC]$/, '') as keyof typeof CLUB_MISSIONS;
      const entry = CLUB_MISSIONS[rank]!;
      const moves: LegalMove<WarbleMove>[] = [];
      if (entry.kind === 'choice') {
        for (const [n, m] of [[1, entry.option1] as const, [2, entry.option2] as const]) {
          if (m.goal.kind === 'ability_check' && partyQualifiesFor(state, m.goal.ability)) {
            moves.push({
              move_id: `accept-mission-${n}`,
              description: `Accept mission option ${n} (${describeMission(m)}) — sandwiches on top of the journey in progress.`,
              move: { type: 'accept_mission', option: n },
            });
          }
        }
      } else {
        // A single ruins mission (J/Q/K/A) — ungated (WR §7).
        moves.push({
          move_id: 'accept-mission-1',
          description: `Accept the RUINS mission (${describeMission(entry.mission)}) — sandwiches on top of the journey in progress.`,
          move: { type: 'accept_mission', option: 1 },
        });
      }
      moves.push({ move_id: 'decline-mission', description: 'Decline the mission and fly on.', move: { type: 'decline_mission' } });
      return moves;
    }
    if (pending.kind === 'space_recruit_offer') {
      return [
        {
          move_id: 'attempt-space-recruit',
          description: 'Attempt to recruit the drifting crewmate (roll follows).',
          move: { type: 'attempt_recruit', recruit_name: pending.card_id },
        },
        { move_id: 'decline-recruit', description: 'Leave them adrift and fly on.', move: { type: 'decline_recruit' } },
      ];
    }
    if (pending.kind === 'ruin_discovery') {
      const moves: LegalMove<WarbleMove>[] = [];
      for (let d = 1; d <= pending.max_depth; d++) {
        moves.push({
          move_id: `enter-ruin-${d}`,
          description: `Enter the ruins aiming for depth ${d}${d < pending.max_depth ? ` (they go down to ${pending.max_depth})` : ' (the deepest level)'} — every run starts at the R1 map.`,
          move: { type: 'enter_ruin', depth: d as 1 | 2 | 3 },
        });
      }
      moves.push({ move_id: 'skip-ruin', description: 'Pass the ruins by.', move: { type: 'skip_ruin' } });
      return moves;
    }
    if (pending.kind === 'ruin_continue') {
      return [
        {
          move_id: 'go-deeper',
          description: `Descend to level ${pending.next_level} (full re-setup on the R${pending.next_level} map)${pending.is_mission ? ' — the mission needs the deeper goal' : ''}.`,
          move: { type: 'enter_ruin', depth: pending.next_level },
        },
        {
          move_id: 'leave-ruin',
          description: pending.is_mission ? 'Leave — ABANDONING the mission (no reward).' : 'Leave with what you have collected.',
          move: { type: 'skip_ruin' },
        },
      ];
    }
    if (pending.kind === 'ruin_setup') {
      const map = ruinMapForLevel(pending.level);
      const starts = cellsWhere(map, 'S');
      const spots = cellsWhere(map, 'A');
      return [
        {
          move_id: 'setup-encounter',
          description:
            `Set up the ${map.id} encounter — FILL IN the player's choices: crew_names (who goes in; the character is optional via include_character), ` +
            `start_location (${starts.join(' or ')}), threat_level (1-3; 1 recommended for a first run), and attacker_placements ` +
            `(exactly 3 of: ${spots.join(', ')} — placing them farther away or behind walls makes it easier).`,
          move: {
            type: 'setup_encounter',
            crew_names: [],
            include_character: true,
            start_location: starts[0]!,
            threat_level: 1,
            attacker_placements: [],
          },
        },
      ];
    }
    if (pending.kind === 'ruin_turn') {
      return ruinTurnMoves(state);
    }
    if (pending.kind === 'space_combat_action') {
      if (state.encounter?.kind !== 'space_combat') return [];
      const enc = state.encounter;
      if (enc.stage === 'loss_reroll_offer') {
        return [
          { move_id: 'use-reroll', description: 'Flying Ace: reroll the space-combat 4d6 (once per combat).', move: { type: 'use_reroll' } },
          { move_id: 'accept-result', description: 'Accept the lost exchange — the ship takes one damage.', move: { type: 'accept_result' } },
        ];
      }
      const moves: LegalMove<WarbleMove>[] = [
        { move_id: 'attempt-escape', description: 'Try to run: 3d6 + handling (+PIL) vs 10 + the pirate\'s space bonus. Fail = 1 ship damage, then escape anyway.', move: { type: 'attempt_escape' } },
        { move_id: 'fight-round', description: 'Exchange fire: 4d6 pairing (WR §12).', move: { type: 'fight_round' } },
      ];
      if (bestForAbility(state, 'HAK').bonus >= 1) {
        moves.push({ move_id: 'attempt-hack', description: 'Hack their systems: 3d6 + HAK vs their min. hacking; success disables them.', move: { type: 'attempt_hack' } });
      }
      if (bestForAbility(state, 'GUN').bonus >= 1 && enc.volley_used !== true) {
        moves.push({
          move_id: 'open-fire',
          description: 'Opening Volley (A6, once per encounter): 3d6 + GUN vs 12. Success: −2 to every pirate exchange total this combat; failure: they attack unopposed.',
          move: { type: 'open_fire' },
        });
      }
      if (bestForAbility(state, 'MEC').bonus >= 1 && enc.redline_used !== true) {
        moves.push({
          move_id: 'redline',
          description: 'Redline (A20, once per encounter): 3d6 + MEC vs 12. Success: +2 to YOUR exchange totals this combat; failure: they attack unopposed.',
          move: { type: 'redline' },
        });
      }
      if (bestForAbility(state, 'DEM').bonus >= 1) {
        moves.push({
          move_id: 'attempt-intimidate',
          description: `"Stand down or burn" (A7): 3d6 + DEM vs ${10 + DIAMOND_PIRATES[enc.pirate_rank].space_attack} (10 + their space attack). Success: they break off; failure: they attack unopposed.`,
          move: { type: 'attempt_intimidate' },
        });
      }
      return moves;
    }
    if (pending.kind === 'sacrifice_offer') {
      return [
        {
          move_id: 'sacrifice-unnamed',
          description: `Spend one unnamed crew hand (${state.unnamed_crew ?? 0} aboard): they die and the failed hazard counts as SURVIVED (amendment A14a).`,
          move: { type: 'sacrifice_unnamed' },
        },
        {
          move_id: 'decline-sacrifice',
          description: 'Let the consequence land as rolled.',
          move: { type: 'decline_sacrifice' },
        },
      ];
    }
    if (pending.kind === 'evade_offer') {
      const rank = pending.card_id.replace(/[HDSC]$/, '') as keyof typeof DIAMOND_PIRATES;
      const pirate = DIAMOND_PIRATES[rank];
      return [
        {
          move_id: 'attempt-evade',
          description: `RUN SILENT (A5): 3d6 + SNE vs ${10 + pirate.speed} (10 + their speed). Success: no encounter; failure: they merely spot you (the normal fight).`,
          move: { type: 'attempt_evade' },
        },
        { move_id: 'decline-evade', description: 'Engage the pirates instead (weapons hot).', move: { type: 'decline_evade' } },
      ];
    }
    if (pending.kind === 'boarding_decision') {
      const moves: LegalMove<WarbleMove>[] =
        pending.stage === 'board_or_leave'
          ? [
              { move_id: 'board-ship', description: 'Board the disabled pirate ship (ground-combat roll; win = capture it).', move: { type: 'board_ship' } },
              { move_id: 'leave-pirate', description: 'Leave the disabled pirates and fly on.', move: { type: 'leave_pirate' } },
            ]
          : [
              { move_id: 'take-ship', description: 'Take the captured ship as your own (it arrives Hobbled; your old ship and its parts are abandoned).', move: { type: 'take_ship' } },
              { move_id: 'abandon-ship', description: 'Keep your own ship and leave the hulk.', move: { type: 'abandon_ship' } },
            ];
      // A10: once per victory, DIP may canvass the beaten crew for an unnamed hand.
      if (
        state.encounter?.kind === 'space_combat' &&
        state.encounter.survivors_rolled !== true &&
        bestForAbility(state, 'DIP').bonus >= 1 &&
        (state.unnamed_crew ?? 0) < unnamedCap(state)
      ) {
        moves.push({
          move_id: 'recruit-survivors',
          description: `Talk the survivors aboard (A10): 3d6 + DIP vs 12 — success signs one UNNAMED crew hand (${state.unnamed_crew ?? 0}/${unnamedCap(state)}); once per victory. Then decide the ship.`,
          move: { type: 'recruit_survivors' },
        });
      }
      return moves;
    }
    return [];
  }

  // ---- at habitat, nothing pending
  if (state.phase === 'at_habitat') {
    const moves: LegalMove<WarbleMove>[] = [];
    const char = state.character!;
    const habitat = HABITATS[state.current_habitat]!;
    const progress = state.habitat_progress[state.current_habitat]!;

    for (const item of habitat.shop) {
      if (progress.purchased.includes(item.id)) continue;
      if (char.credits < item.cost) continue;
      moves.push({
        move_id: `buy-${item.id}`,
        description: `Buy ${item.name} for ${item.cost}c (you have ${char.credits}c).`,
        move: { type: 'buy_item', item_name: item.name },
      });
    }

    for (const item of state.items) {
      if (item.type !== 'weapon' && item.type !== 'armor') continue;
      const holders = [state.character!.name, ...state.crew.map((c) => c.name)];
      for (const holder of holders) {
        const gear = holder === char.name ? char.gear : state.crew.find((c) => c.name === holder)!.gear;
        if (gear[item.type] === item.id) continue; // already equipped there
        moves.push({
          move_id: `equip-${item.id}-${holder}`,
          description: `Equip ${item.name} on ${holder}.`,
          move: { type: 'equip_item', item_name: item.name, being: holder },
        });
      }
    }

    for (const recruit of habitat.cantina) {
      if (progress.recruits_failed.includes(recruit.id) || progress.recruits_hired.includes(recruit.id)) continue;
      moves.push({
        move_id: `recruit-${recruit.id}`,
        description: `Attempt to recruit the ${describeRecruit(recruit)} at the cantina.`,
        move: { type: 'attempt_recruit', recruit_name: recruit.id },
      });
    }

    if (!progress.repair_rolled_this_arrival && state.ship!.damage !== 'pristine' && bestForAbility(state, 'MEC').bonus >= 1) {
      moves.push({
        move_id: 'attempt-repair',
        description: `Attempt a repair roll (3d6 + MEC, 12+): the ${state.ship!.name} is ${state.ship!.damage}. Once per arrival.`,
        move: { type: 'attempt_repair' },
      });
    }
    // Amendment A1: paid repairs — repeatable, no roll, may go into debt (never at/below −300).
    if (state.ship!.damage !== 'pristine' && state.character!.credits - 150 > -300) {
      moves.push({
        move_id: 'pay-repair',
        description: `Pay 150c: the yard raises the ${state.ship!.name} one damage level (currently ${state.ship!.damage}; repeatable). Credits: ${state.character!.credits}.`,
        move: { type: 'pay_repair' },
      });
    }
    // Amendment A18 Shipwright: natural MEC 3 fabricates a +1 ship part per visit.
    if (
      progress.fabricated_this_arrival !== true &&
      ((state.character!.abilities.MEC ?? 0) >= 3 || state.crew.some((c) => (c.abilities.MEC ?? 0) >= 3)) &&
      state.character!.credits - 400 > -300
    ) {
      for (const stat of ['speed', 'handling', 'armor'] as const) {
        moves.push({
          move_id: `fabricate-${stat}`,
          description: `Shipwright (A18): pay 400c — fabricate a +1 ${stat} part (ship ${stat} ${state.ship![stat]} → ${state.ship![stat] + 1}). Once per habitat visit.`,
          move: { type: 'fabricate_part', stat },
        });
      }
    }
    // Amendment A16 Tinker: natural MEC 3 aboard upgrades owned weapons/armor.
    if (anyoneHasEffective(state, 'MEC') && state.character!.credits - 200 > -300) {
      for (const item of state.items) {
        if ((item.type !== 'weapon' && item.type !== 'armor') || item.effect.kind !== 'ability_bonus' || item.upgraded === true) continue;
        if (!((state.character!.abilities.MEC ?? 0) >= 3 || state.crew.some((c) => (c.abilities.MEC ?? 0) >= 3))) break;
        moves.push({
          move_id: `upgrade-${item.id}`,
          description: `Tinker (A16): pay 200c — ${item.name} becomes MK-II (+${item.effect.bonus + 1} ${item.effect.ability}). Once per item.`,
          move: { type: 'upgrade_item', item_name: item.name },
        });
      }
    }
    // Amendment A10: once per HABITAT, work the docks for an unnamed crew hand.
    if (progress.unnamed_rolled !== true && bestForAbility(state, 'DIP').bonus >= 1 && (state.unnamed_crew ?? 0) < unnamedCap(state)) {
      moves.push({
        move_id: 'recruit-unnamed',
        description: `Work the docks (A10): 3d6 + DIP vs 12 — success signs one UNNAMED crew hand (bodies for the ground game; ${state.unnamed_crew ?? 0}/${unnamedCap(state)}). Once per habitat.`,
        move: { type: 'recruit_unnamed' },
      });
    }
    if (
      !progress.unrest_rolled_this_arrival &&
      state.crew.some((c) => c.anger_tokens > 0) &&
      bestForAbility(state, 'LEA').bonus >= 1
    ) {
      moves.push({
        move_id: 'attempt-reduce-unrest',
        description: 'Attempt an unrest roll (3d6 + LEA, 12+): remove one anger token from each crew member. Once per arrival.',
        move: { type: 'attempt_reduce_unrest' },
      });
    }

    for (const c of state.crew) {
      moves.push({
        move_id: `release-${c.name}`,
        description: `Release ${c.name} from the crew (they take their equipped gear).`,
        move: { type: 'release_crew', crew_name: c.name },
      });
    }

    for (const m of habitat.missions) {
      if (progress.missions_attempted.includes(m.id)) continue;
      if (m.goal.kind === 'ability_check' && !partyQualifiesFor(state, m.goal.ability)) continue; // ruins missions are ungated (WR §7)
      moves.push({
        move_id: `take-mission-${m.id}`,
        description:
          m.goal.kind === 'ruin'
            ? `Take the R${m.goal.depth} RUINS mission (${describeMission(m)}) — travel there, then delve to depth ${m.goal.depth}.`
            : `Take the ${m.goal.ability} ${m.goal.min_roll} mission (${describeMission(m)}).`,
        move: { type: 'take_mission', mission_name: m.id },
      });
    }

    const prog = habitat.progression;
    if (prog.kind === 'missions_then_travel' && progress.missions_attempted.length >= prog.missions_required) {
      moves.push({
        move_id: 'depart',
        description: `Depart for Habitat #${state.current_habitat + 1} — one-way trip, distance ${prog.distance_one_way}.`,
        move: { type: 'depart_for_next_habitat' },
      });
    } else if (prog.kind === 'travel') {
      moves.push({
        move_id: 'depart',
        description: `Depart for Habitat #${state.current_habitat + 1} — one-way trip, distance ${prog.distance_one_way}.`,
        move: { type: 'depart_for_next_habitat' },
      });
    }
    if (prog.kind === 'final_ruin') {
      moves.push({
        move_id: 'depart',
        description: `THE SEASON 1 FINALE: enter the depth-${prog.depth} ruin beyond ${habitat.name} (complete it to win the season).`,
        move: { type: 'depart_for_next_habitat' },
      });
    }
    return moves;
  }

  return [];
}

// The party phase: each unended being may move (declared cell — the server
// validates the path), attack/act, or hold. Kept compact: movement is a
// fill-in, actions are enumerated.
function ruinTurnMoves(state: WarbleWayGalaxyState): LegalMove<WarbleMove>[] {
  const enc = state.encounter;
  if (enc?.kind !== 'ruin_run' || !enc.board) return [];
  const board = enc.board;
  const map = ruinMapForLevel(enc.level);
  const moves: LegalMove<WarbleMove>[] = [];
  for (const t of board.tokens) {
    if (t.ended) continue;
    moves.push({
      move_id: `move-${t.name}`,
      description: `Move ${t.name} (at ${t.cell}) — FILL IN the destination cell like "r5c3"; no diagonals; walls, pits and tokens block.`,
      move: { type: 'move_being', being: t.name, to: '' },
    });
    if (!t.acted) {
      const range = ruinAttackRange(state, t.name);
      for (const a of board.attackers) {
        if (a.defeated) continue;
        if (!inAttackRange(map, t.cell, a.cell, range)) continue; // only offer what is actually legal
        moves.push({
          move_id: `attack-${t.name}-${a.id}`,
          description: `${t.name} attacks ${a.id} (Atk +${a.atk}) at ${a.cell} (in range ${range}, clear line).`,
          move: { type: 'attack', being: t.name, target: a.id },
        });
      }
      if (ruinAdjacentSpot(state, t.name, 'I')) {
        moves.push({
          move_id: `collect-${t.name}`,
          description: `${t.name} opens the adjacent item cache (◆).`,
          move: { type: 'collect_item', being: t.name },
        });
      }
      if (ruinAdjacentSpot(state, t.name, 'B')) {
        moves.push({
          move_id: `recruit-at-${t.name}`,
          description: `${t.name} approaches the adjacent being spot (☺).`,
          move: { type: 'recruit_at', being: t.name },
        });
      }
    }
    if (t.cell === board.start_cell) {
      moves.push({
        move_id: `escape-${t.name}`,
        description: `${t.name} slips out through the starting location (removed from the encounter).`,
        move: { type: 'escape_to_start', being: t.name },
      });
    }
    moves.push({
      move_id: `end-${t.name}`,
      description: `${t.name} ends their turn.`,
      move: { type: 'end_being_turn', being: t.name },
    });
  }
  return moves;
}
