// Neither Guts nor Gears — public & per-player views.
//
// §15.1 privacy contract: never leak battle-card hands (except to an active
// Shared Tactics partner), spy assignments (until a reveal), or private
// Detection results to any other seat. The public view shows hand COUNTS and
// recruitment events; the player view adds the seat's own hand + spy + knowledge.

import type { GameLogEntry, PendingOption, PendingView } from '@zekel/game-kit';
import { BATTLE_CARDS, FACTIONS, HEROES, TECH_TARGET, TREATIES, cultureTargetFor, milestonesFor, unitsForSpecies } from './data/catalogs.js';
import { collectorCapFor, coreSupplyFor, economicCollectorsNeeded } from './economicScale.js';
import { unitById, buildingById, researchById } from './resolvers.js';
import type { Coord, HeroInstance, MapUnit, NGGMove, NGGState, Pending, PlayerState } from './types.js';
import { tileLabel } from './data/maps.js';
import { seatName, tileName } from './names.js';
import { currentDefOf, currentDmgOf, effectiveDef, effectiveDefOfHero, modifierSumPub, withdrawalDestinations } from './engine-battle.js';
import {
  counterTargetGate, defenseGate, playableCardGroups, treatyBreakGate, usableClerics,
  CLERIC_SAVE_MANA, type DefenseSubject,
} from './gates.js';
import { decoyDestinations } from './legalMoves.js';
import {
  cardByInstanceId, effectiveResourceAt, factionPickShut, sameStackCard, locationOwner, militaryThreshold, overlayResourceOf,
  speciesOf, techTotal, hasLivingLeader, ownedCollectorIds, collectorLabel, collectorPowered,
  lockedFor,
  actionCardSlots, typeName, bankOf, pairedCoreCost,
} from './engine.js';

function describeCardInstance(instanceId: string): Record<string, unknown> {
  const card = cardByInstanceId(instanceId);
  const def = BATTLE_CARDS.find((c) => c.id === card)!;
  return { card: def.label, effect: def.effect };
}

function publicPlayerView(state: NGGState, p: PlayerState): Record<string, unknown> {
  const faction = FACTIONS.find((f) => f.id === p.factionId);
  const spyRecruitments = p.spyAssignments.length; // recruitment is public; the hero is not
  return {
    player_id: p.playerId,
    kind: p.kind,
    faction: faction?.name ?? null,
    species: p.species,
    culture: p.culture,
    culture_target: cultureTargetFor(state.players.length),
    economic_collectors: economicCollectorsNeeded(state),
    next_milestones: milestonesFor(state.players.length).filter((m) => p.culture < m),
    mana_current: p.manaCurrent,
    mana_max: p.manaMax,
    buildings: p.buildings,
    building_counts: p.buildingCounts,
    research: p.research,
    tech_progress: {
      acquired_types: p.acquiredTypes,
      acquired_type_names: p.acquiredTypes.map(typeName),
      // The hero bonus the total includes (+3 each for Motherboard and
      // Greymore while in play, #104), read from the same total.
      bonus_points_live: speciesOfSafe(p) ? techTotal(state, p) - p.acquiredTypes.length : 0,
      total: speciesOfSafe(p) ? techTotal(state, p) : 0,
      // The target the victory check uses (§12.5; #86, #90, #101-#103).
      target: p.species ? TECH_TARGET[p.species] : null,
    },
    leader_kills: p.leaderKills,
    military_kills_needed: militaryThreshold(state.players.length),
    leader_alive: hasLivingLeader(state, p.playerId),
    subjects: p.subjects,
    cores_reserve: p.coresInReserve,
    cores_supply: p.coresInSupply,
    action_cards: p.actionCards,
    // Each kind's copies, by slot: what a plan_action's `which` names.
    action_card_slots: actionCardSlots(p),
    // §5.2: planned cards are face down — the table sees how many went down,
    // never which kinds (the owner's own view lists them).
    action_cards_played_count: p.actionCardsPlayed.length,
    battle_hand_count: p.hand.length,
    spy_recruitments: spyRecruitments,
    // What the table can know: spies recruited and not publicly revealed or
    // spent. A spy that ended with its hero's death still counts — that end
    // is not announced, so counting it out would name the hero.
    unrevealed_spies: p.spyAssignments.filter((s) => s.active || s.endedUnseen).length,
    // Map pieces owned (public).
    units: state.units.filter((u) => u.ownerId === p.playerId).map((u) => ({
      id: u.id, type: unitById(u.typeId)?.name, coord: u.coord,
      core: u.allocatedCoreId !== null ? 'allocated' : (unitById(u.typeId)?.needsCore ? 'CORELESS' : null),
      // Its DEF now, out of battle: the printed DEF plus Metal Platforms
      // (§7.10); null for a statless piece. A battle's own view has the
      // battle's live numbers.
      def: effectiveDef(state, u),
    })),
    heroes: state.heroes.filter((h) => h.ownerId === p.playerId).map((h) => ({
      hero: HEROES.find((x) => x.id === h.id)!.name,
      coord: h.coord ?? 'reserved',
      is_leader: h.isLeader,
      dead: h.dead,
      stats: h.dead ? null : heroStatsLabel(state, h.id, h.isLeader),
    })),
    bases: state.bases.filter((b) => b.ownerId === p.playerId).map((b) => b.coord),
    // What this seat has not unlocked yet, and what it needs (public).
    locked: lockedFor(state, p),
    // Every collector the seat owns (public, §15.1): on the map while placed
    // this round, otherwise on the faction board; a robot collector without
    // a Core cannot pay.
    collectors: ownedCollectorIds(p).map((id) => ({
      collector: id, type: collectorLabel(id),
      placed_at: state.placements.find((c) => c.ownerId === p.playerId && c.collectorId === id)?.coord ?? null,
      ...(p.species === 'robot' ? { core: collectorPowered(p, id) ? 'allocated' : 'CORELESS' } : {}),
    })),
    committed_collectors: state.placements.filter((c) => c.ownerId === p.playerId).map((c) => ({ collector: c.collectorId, coord: c.coord, resource: c.resource })),
    // Ruling #101: what a Haste wizard banked this round, by resource (empty
    // for everyone else). Public: it follows from placements and purchases.
    bank: bankOf(p),
    // What a Core bought together with a platform adds to its price: the
    // Core's cost, or nothing with Core Integration (#103). Robots only.
    paired_core_cost: p.species === 'robot' ? pairedCoreCost(p) : null,
    // Each unit type's limit for this seat on this map, as the purchase check
    // enforces it: collectors follow the map (#115, #116), the Core supply is
    // 15 plus the spend's extra, anything else its printed maximum. Keyed by
    // unit name; empty until the seat has a species.
    unit_limits: p.species
      ? Object.fromEntries(unitsForSpecies(p.species).map((u) => [u.name, u.id === 'core' ? coreSupplyFor(state) : collectorCapFor(state, u)]))
      : {},
  };
}

function speciesOfSafe(p: PlayerState): boolean { return p.species !== null; }

function heroStatsLabel(state: NGGState, heroId: string, isLeader: boolean): string {
  const def = HEROES.find((x) => x.id === heroId)!;
  const cat = def.category === 'evo-angel' ? 'evo-angel' : def.category === 'military' ? 'military' : 'non-military';
  void state;
  const s = { 'evo-angel': { init: 80, dmg: 4, def: 4 }, military: { init: 70, dmg: 3, def: 4 }, 'non-military': { init: 30, dmg: 1, def: 3 } }[cat];
  return `Init ${s.init} DMG ${s.dmg} DEF ${s.def + (isLeader ? 2 : 0)}`;
}

function sharedView(state: NGGState, viewerId?: string): Record<string, unknown> {
  return {
    game_id: 'neither-guts-nor-gears',
    phase: state.phase,
    round: state.round,
    active_player_id: state.activePlayerId,
    first_player_id: state.players[state.firstPlayerIndex]?.playerId,
    layout: state.layout,
    map: {
      tiles: state.tiles.map((t) => ({
        coord: `${t.c},${t.r}`,
        label: tileLabel(t.c, t.r),
        printed_resource: t.resource,
        current_resource: effectiveResourceAt(state, `${t.c},${t.r}`),
        start: t.start ?? null,
        base_owner: state.bases.find((b) => b.coord === `${t.c},${t.r}`)?.ownerId ?? null,
        units: state.units.filter((u) => u.coord === `${t.c},${t.r}`).map((u) => `${unitById(u.typeId)?.name} (${u.ownerId})`),
        heroes: state.heroes.filter((h) => !h.dead && h.coord === `${t.c},${t.r}`).map((h) => `${HEROES.find((x) => x.id === h.id)!.name} (${h.ownerId})`),
        collectors: state.placements.filter((c) => c.coord === `${t.c},${t.r}`).map((c) => `${c.collectorId} (${c.ownerId})`),
      })),
    },
    hero_pool_count: state.heroPool.length,
    // §5 Action Stack entries are placed FACE DOWN (design update 2026-09-21):
    // the public view sees each entry's owner and position, never the kind —
    // the kind only becomes public when the stack pops to that slot and the
    // engine resolves it (the pop IS the reveal). The currently-resolving card
    // is revealed in `active_action`.
    action_stack: state.actionStack.map((a, i) => {
      const resolving = !!state.activeAction && sameStackCard(state.activeAction, a);
      const faceUp = resolving || a.ownerId === viewerId; // owner knows their own placed cards
      return { position: i + 1, owner: a.ownerId, ...(faceUp ? { card_kind: a.cardKind } : { face: 'down' }) };
    }),
    active_action: state.activeAction ? `${state.activeAction.cardKind} by ${state.activeAction.ownerId}` : null,
    // The same fact, structured, for clients that lay it out (a screen routes
    // on the card kind); `active_action` stays the voice/LLM sentence.
    // `finished`: the action's effects are over and only the end-of-action
    // treaty window remains (a treaty offer, or ending the action).
    resolving_action: state.activeAction ? { card_kind: state.activeAction.cardKind, owner: state.activeAction.ownerId, finished: !!state.activeAction.endWindow } : null,
    treaties: state.treaties.map((t) => ({ treaty: TREATIES.find((x) => x.id === t.type)!.name, partners: t.partners, culture_income: TREATIES.find((x) => x.id === t.type)!.cultureIncome })),
    battle: state.battle ? describeBattlePublic(state) : null,
    // The draw pile: every card not in a hand, in play or discarded (§10.1).
    battle_deck_count: state.battleDeck.length,
    battle_discard: state.battleDiscard.map((id) => describeCardInstance(id).card),
    pending: state.pending ? describePending(state, state.pending, viewerId) : null,
    victory_status: Object.fromEntries(state.players.map((p) => [p.playerId, {
      culture: p.culture, tech: p.species ? techTotal(state, p) : 0,
      leader_kills: p.leaderKills, leader_alive: hasLivingLeader(state, p.playerId),
    }])),
    result: state.result,
    // Analysis-only, after completion: retain original setup identity even if
    // a Leader moved/died or a base changed hands. No private fields exposed.
    ...(state.result ? { balance_setup: Object.fromEntries(state.players.map((p) => {
      const placement = state.log.find((e) => e.actor === p.playerId && e.phase === 'setup' && e.summary.includes('places their starting'));
      const coord = placement?.summary.match(/ at (-?\d+,-?\d+)$/)?.[1];
      const tile = state.tiles.find((t) => `${t.c},${t.r}` === coord);
      return [p.playerId, {
        leader: state.heroes.find((h) => h.ownerId === p.playerId && h.isLeader)?.id,
        start: tile?.start,
        setup_order: (state.players.indexOf(p) - state.setupFirstPlayerIndex + state.players.length) % state.players.length,
      }];
    })) } : {}),
    players: state.players.map((p) => publicPlayerView(state, p)),
  };
}


type Option = PendingOption<NGGMove>;

/** An option that is open (carries its move) or shut (carries the gate's
 *  sentence and section) — never both. */
function gated(base: Pick<Option, 'option_id' | 'label' | 'detail'>, shut: string | null, section: string, move: NGGMove): Option {
  return shut !== null ? { ...base, blocked_reason: shut, rules_section: section } : { ...base, move };
}

/** The pending decision, as a seat's view shows it. `question` is the voice/LLM
 *  contract and is unchanged. `options` is the bounded choice set INCLUDING
 *  shut options, each shut one carrying the engine's own refusal sentence
 *  (gates.ts) — SPEC-instance-gates.md. Options that would expose a hand or a
 *  spy go ONLY to the seat that owns the decision (§15.1). */
function describePending(state: NGGState, p: NonNullable<Pending>, viewerId?: string): PendingView<NGGMove> {
  const base = { kind: p.kind, for: p.forPlayerId };
  const owner = viewerId === p.forPlayerId;
  switch (p.kind) {
    case 'choose_faction': {
      // Public: which factions are still open, and who holds the others.
      const options: Option[] = FACTIONS.map((f) => gated(
        { option_id: f.id, label: f.name, detail: { species: f.species, color: f.color, held_by: state.players.find((x) => x.factionId === f.id)?.playerId ?? null } },
        factionPickShut(state, f.id), 'setup', { type: 'choose_faction', faction: f.id },
      ));
      return { ...base, question: `${p.forPlayerId} chooses their faction`, options };
    }
    case 'choose_leader': return { ...base, question: `${p.forPlayerId} chooses their Leader (species-eligible hero from the pool)` };
    case 'choose_starting_location': return { ...base, question: `${p.forPlayerId} chooses an unoccupied numbered starting location` };
    case 'report_draw': return { ...base, question: `${p.forPlayerId} drew a battle card — report it (physical) or press Draw (digital)` };
    case 'upkeep_reallocate_cores': return { ...base, question: `${p.forPlayerId} may reallocate owned Cores among platforms` };
    case 'dowser_collector': return { ...base, context: { remaining: p.remaining ?? 1 }, question: `${p.forPlayerId} takes a free collector from Dowser Wren Calloway, with a Core in it — which type? (${p.remaining ?? 1} left to pick)` };
    case 'access_request': {
      const view: PendingView<NGGMove> = { ...base, question: `${p.forPlayerId} decides whether ${p.buyerId}'s ${p.collectorId} may collect at ${p.coord}` };
      // The declared purchase is shared by the two seats in the request (the
      // owner must know what they consent to); other seats see the question.
      if (viewerId !== p.forPlayerId && viewerId !== p.buyerId) return view;
      const payment = (p.resume.move as { payment?: Array<{ collectorId: string; coord: Coord }> } | null)?.payment ?? p.proposal.placements;
      return {
        ...view,
        context: {
          buyer: p.buyerId,
          action: p.action,
          item: p.proposal.item,
          this_request: { collector: p.collectorId, tile: tileName(p.coord) },
          placements: payment.map((pl) => ({
            collector: pl.collectorId,
            tile: tileName(pl.coord),
            resource: effectiveResourceAt(state, pl.coord),
            location_owner: locationOwner(state, pl.coord),
          })),
          queue: p.queue ?? null,
        },
      };
    }
    case 'second_purchase': return { ...base, question: `${p.forPlayerId} may make a second ${p.action} purchase`, context: { action: p.action } };
    case 'smyth_reward': return { ...base, question: `${p.forPlayerId} picks an unresearched technology (Smyth's reward, waived)` };
    case 'elara_spell': return { ...base, question: `${p.forPlayerId} may cast Elara's spell before movement` };
    case 'treaty_response': {
      // The offer is public: who proposes, which treaty, and its printed terms.
      const def = TREATIES.find((x) => x.id === p.treatyType);
      return {
        ...base,
        question: `${p.forPlayerId} answers ${p.proposerId}'s ${p.treatyType} offer`,
        context: {
          proposer: p.proposerId,
          treaty: def?.name ?? p.treatyType,
          culture_income: def?.cultureIncome ?? null,
          effect: def?.effect ?? null,
          break_condition: def?.breakingCondition ?? null,
        },
      };
    }
    case 'battle_commit': {
      const view: PendingView<NGGMove> = { ...base, question: `${p.forPlayerId} secretly commits a battle card or no card` };
      if (!owner) return view;
      const options: Option[] = [{ option_id: 'none', label: 'No card', move: { type: 'commit_battle_card', card: null } }];
      for (const g of playableCardGroups(state, p.forPlayerId)) {
        const holders = [...new Set([...g.open, ...g.shut].map((c) => c.ownerId))];
        options.push(gated({
          option_id: g.card,
          label: g.label,
          detail: { count: g.open.length, effect: BATTLE_CARDS.find((c) => c.id === g.card)!.effect, held_by: holders },
        }, g.open.length > 0 ? null : g.shut[0]!.reason, 'battle-cards', { type: 'commit_battle_card', card: g.label }));
      }
      return { ...view, options };
    }
    case 'counter_target': {
      const b = state.battle!;
      const options: Option[] = b.committed.map((c, i) => {
        const label = BATTLE_CARDS.find((x) => x.id === c.card)!.label;
        return gated({
          option_id: `card-${i}`,
          label: `${label} (${seatName(state, c.playingPlayerId)})`,
          detail: { card: label, played_by: c.playingPlayerId, batch: c.batch ?? 0 },
        }, counterTargetGate.check(state, p.forPlayerId, c), counterTargetGate.section, { type: 'choose_counter_target', card: label, played_by: c.playingPlayerId, batch: c.batch ?? 0 });
      });
      const batchNumbers = [...new Set(b.committed.map((c) => c.batch ?? 0))].sort((x, y) => x - y);
      return {
        ...base,
        question: `${p.forPlayerId} chooses the Counter's target`,
        options,
        context: {
          counter: `card-${p.cardIndex}`,
          batches: batchNumbers.map((n) => ({
            batch: n,
            option_ids: b.committed.flatMap((c, i) => ((c.batch ?? 0) === n ? [`card-${i}`] : [])),
          })),
        },
      };
    }
    case 'extra_selection': {
      const view: PendingView<NGGMove> = { ...base, question: `${p.forPlayerId} chooses up to two additional battle cards` };
      if (!owner) return view;
      const options: Option[] = [{ option_id: 'none', label: 'Add no cards', move: { type: 'select_extra_cards', cards: [] } }];
      for (const g of playableCardGroups(state, p.forPlayerId)) {
        options.push(gated({
          option_id: g.card,
          label: g.label,
          detail: { count: g.open.length, effect: BATTLE_CARDS.find((c) => c.id === g.card)!.effect },
        }, g.open.length > 0 ? null : g.shut[0]!.reason, 'battle-cards', { type: 'select_extra_cards', cards: [g.label] }));
      }
      return { ...view, options, context: { max: 2, extra: `card-${p.cardIndex}` } };
    }
    case 'initiative_tie': {
      const b = state.battle;
      return {
        ...base,
        question: `${p.forPlayerId} picks which of the tied allied units acts next`,
        options: p.tieGroup.flatMap((ref) => {
          const u = b?.units.find((x) => x.unitRef === ref);
          return u ? [{ option_id: ref, label: `${u.label} (${seatName(state, u.ownerId)})`, ...(owner ? { move: { type: 'choose_initiative_order', unit: ref } as NGGMove } : {}) }] : [];
        }),
      };
    }
    case 'battle_defense': {
      const view: PendingView<NGGMove> = { ...base, question: `${p.forPlayerId} decides a defense` };
      const b = state.battle;
      const d = b?.defense;
      if (!owner || !b || !d) return view;
      const target = b.units.find((x) => x.unitRef === d.targetRef)!;
      const attacker = b.units.find((x) => x.unitRef === d.attackerRef);
      const me = state.players.find((x) => x.playerId === p.forPlayerId)!;
      const targetDef = currentDefOf(state, target);
      const options: Option[] = [{ option_id: 'none', label: 'Decline', move: { type: 'resolve_battle_defense', defense: { kind: 'none' } } }];
      /** Pushes the one shut option for a defense and returns its reason, or
       *  returns null so the caller lists the open choices. */
      const shutOption = (id: string, label: string, subject: DefenseSubject): string | null => {
        const shut = defenseGate.check(state, p.forPlayerId, subject);
        if (shut !== null) options.push({ option_id: id, label, blocked_reason: shut, rules_section: defenseGate.section });
        return shut;
      };
      if (shutOption('decoy', 'Decoy', { kind: 'decoy' }) === null) {
        const { allied, empty } = decoyDestinations(state);
        for (const k of [...allied, ...empty]) {
          options.push({
            option_id: `decoy:${tileName(k)}`, label: `Decoy — move to ${tileName(k)}`,
            detail: { tile: tileName(k), allied_space: allied.includes(k) },
            move: { type: 'resolve_battle_defense', defense: { kind: 'decoy', moveTo: k } },
          });
        }
        options.push({ option_id: 'decoy:stay', label: 'Decoy — stay in the fight', move: { type: 'resolve_battle_defense', defense: { kind: 'decoy' } } });
      }
      if (shutOption('mana_shield', 'Mana Shield', { kind: 'mana_shield' }) === null) {
        for (let m = 1; m <= me.manaCurrent; m++) {
          options.push({
            option_id: `mana_shield:${m}`, label: `Mana Shield — spend ${m} mana`,
            detail: { mana: m, survives: d.kind !== 'instant-kill' && d.damage - m < targetDef },
            move: { type: 'resolve_battle_defense', defense: { kind: 'mana_shield', mana: m } },
          });
        }
      }
      if (shutOption('cleric_save', 'Cleric save', { kind: 'cleric_save' }) === null) {
        for (const c of usableClerics(state, p.forPlayerId)) {
          options.push({
            option_id: `cleric_save:${c.unitRef}`, label: `${c.label} saves ${target.label}`,
            detail: { mana_cost: CLERIC_SAVE_MANA },
            move: { type: 'resolve_battle_defense', defense: { kind: 'cleric_save', cleric: c.unitRef, target: d.targetRef } },
          });
        }
      }
      return {
        ...view,
        options,
        context: {
          step: d.step,
          attack_kind: d.kind,
          // Ruling #111: the area hit is a robot unit blowing itself up (every side).
          self_destruct: d.selfDestruct === true,
          attacker: attacker?.label ?? null,
          target: target.label,
          // An instant kill has no damage number: it kills whatever the DEF.
          damage: d.kind === 'instant-kill' ? null : d.damage,
          target_def: targetDef,
          your_mana: me.manaCurrent,
        },
      };
    }
    case 'retreat': {
      const dests = state.battle ? withdrawalDestinations(state, p.forPlayerId).eligible : [];
      return {
        ...base,
        question: p.viaCard ? `${p.forPlayerId}'s Retreat card: choose where their units retreat` : `${p.forPlayerId} decides whether to retreat`,
        context: { via_card: !!p.viaCard, destinations: dests.map((k) => tileName(k)) },
      };
    }
    case 'rally_selection': return { ...base, question: `${p.forPlayerId} chooses Rally units` };
    case 'choose_milestone_hero': return { ...base, question: `${p.forPlayerId} claims a milestone hero (${p.claimsOwed} owed)` };
    case 'overlay_choice': {
      // Both heroes stand on one tile; each option says what it would make it.
      const [a] = p.heroIds;
      const coord = state.heroes.find((h) => h.id === a)?.coord ?? null;
      return {
        ...base,
        question: `${p.forPlayerId} picks the active Economy overlay`,
        context: { tile: coord ? tileName(coord) : null, printed_resource: coord ? state.tiles.find((t) => `${t.c},${t.r}` === coord)?.resource ?? null : null },
        options: p.heroIds.map((id) => {
          const hero = state.heroes.find((h) => h.id === id);
          const name = HEROES.find((x) => x.id === id)!.name;
          return {
            option_id: id, label: name,
            detail: { owner: hero?.ownerId ?? null, resource: overlayResourceOf(id) },
            ...(owner ? { move: { type: 'resolve_overlay_choice', hero: name } as NGGMove } : {}),
          };
        }),
      };
    }
    case 'place_reserved_hero': return { ...base, question: `${p.forPlayerId} places their reserved hero`, context: { hero: HEROES.find((x) => x.id === p.heroId)!.name } };
    // The recruitment is public (the log names the unit bought); which hero
    // carries it is not, so only the source is published, and to the owner.
    case 'choose_spy': return { ...base, question: `${p.forPlayerId} privately assigns their spy to one of their heroes`, ...(owner ? { context: { source: p.source } } : {}) };
    case 'treaty_break_decision': {
      // Treaties and every fact their break conditions read are public, so
      // every seat sees the same options.
      const options: Option[] = state.treaties.filter((t) => t.partners.includes(p.forPlayerId)).map((t) => {
        const def = TREATIES.find((x) => x.id === t.type)!;
        const partner = t.partners[0] === p.forPlayerId ? t.partners[1] : t.partners[0];
        return gated({
          option_id: `${t.type}:${partner}`,
          label: `${def.name} with ${seatName(state, partner)}`,
          detail: { partner, culture_income: def.cultureIncome, break_condition: def.breakingCondition },
        }, treatyBreakGate.check(state, p.forPlayerId, t), treatyBreakGate.section, { type: 'break_treaty', treaty_type: def.name, partner });
      });
      options.push({ option_id: 'keep', label: 'Keep the rest', move: { type: 'skip_action' } });
      return {
        ...base,
        question: `${p.forPlayerId} may break any of their breakable treaties (end of round, §5.6), or keep them`,
        options,
        repeatable: true,
      };
    }
  }
}

function describeBattlePublic(state: NGGState): Record<string, unknown> {
  const b = state.battle!;
  const allCommitted = Object.values(b.commitments).every((v) => v !== 'pending');
  return {
    coord: b.coord,
    origin: b.originCoord,
    phase: b.phase,
    pass: b.pass,
    units: b.units.map((u) => {
      // Effective stats at display time (modifiers + hero bonuses included) —
      // a +1 DEF card on a Dragon must SHOW 3, not quietly sit at the raw 2.
      const base = u.isHero ? state.heroes.find((h) => h.id === u.unitRef) : state.units.find((x) => x.id === u.unitRef);
      const effDef = u.isHero && base
        ? (effectiveDefOfHero(state, base as HeroInstance, b) ?? u.def)
        : (!u.isHero && base ? (effectiveDef(state, base as MapUnit, b) ?? u.def) : u.def);
      // The engine's own live DMG: a unit printed with DMG 0 never gains
      // damage, and none falls below zero (§7.1, §7.4).
      const effDmg = currentDmgOf(state, u);
      const initMod = modifierSumPub(state, u, 'init');
      // `ref` is the id battle_activation and the defense moves name the unit by.
      return { unit: u.label, ref: u.unitRef, owner: u.ownerId, side: u.side, init: u.init + initMod, dmg: effDmg, def: effDef, activated: u.activated };
    }),
    // Commitments stay hidden until every required participant has committed;
    // then they reveal together (§9.2).
    commitments: allCommitted
      ? b.committed.map((c) => ({ card: BATTLE_CARDS.find((x) => x.id === c.card)!.label, by: c.playingPlayerId, resolved: c.resolved, countered: c.countered }))
      : Object.fromEntries(Object.entries(b.commitments).map(([pid, v]) => [pid, v === 'pending' ? 'pending' : 'committed (secret)'])),
  };
}

export function getPublicView(state: NGGState): unknown {
  return sharedView(state);
}

export function getPlayerView(state: NGGState, playerId: string): unknown {
  const view = sharedView(state, playerId);
  const me = state.players.find((p) => p.playerId === playerId);
  if (!me) return view;
  // Own hand (the printed labels), plus any active Shared Tactics partner's.
  view['your_battle_hand'] = me.hand.map((id) => describeCardInstance(id));
  const partners = state.treaties.filter((t) => t.type === 'shared-tactics' && t.partners.includes(playerId));
  if (partners.length > 0) {
    view['shared_tactics_hands'] = Object.fromEntries(partners.map((t) => {
      const partner = state.players.find((p) => p.playerId === (t.partners[0] === playerId ? t.partners[1] : t.partners[0]))!;
      return [partner.playerId, partner.hand.map((id) => describeCardInstance(id))];
    }));
  }
  // Own face-down planned cards (private until each is revealed).
  view['your_action_cards_played'] = me.actionCardsPlayed;
  // Own spy assignments (private).
  view['your_spy_assignments'] = me.spyAssignments.map((s) => ({ source: s.source, hero: HEROES.find((h) => h.id === s.heroId)!.name, active: s.active }));
  // Own knowledge log (spy facts learned; Detection, which wrote most of it, was removed by #121).
  view['your_knowledge'] = me.knowledge;
  // Which heroes are owed placement (reserved, base exists).
  view['your_reserved_heroes'] = state.heroes.filter((h) => h.ownerId === playerId && !h.dead && h.coord === null).map((h) => HEROES.find((x) => x.id === h.id)!.name);
  return view;
}

export function getLogEntries(state: NGGState): GameLogEntry[] {
  return state.log;
}
