import { ABILITY_NAMES, ABILITY_STAT, STAT_ABILITIES } from './data/abilities.js';
import { HABITATS } from './data/habitats.js';
import { minXpForLevel } from './data/levels.js';
import { DIAMOND_PIRATES } from './data/travelTables.js';
import { describeMission, describeRecruit, effectiveScore, missionById, parseCellId, ruinMapForLevel } from './engine.js';
import type { AbilityId, WarbleWayGalaxyState } from './types.js';

// Solo game: nothing on the server is hidden from the player, so the public
// and player views are the same document. Views carry printed names, the
// current habitat page (with one-shot flags), and lore_refs so the DM can pull
// the right get_lore topics before narrating (PORT-PLAN §4.8).

// The ruin board rendered for the DM: the raw grid plus a live overlay
// (tokens 1..n, attackers A1..A3) so the human can mirror the physical map.
function ruinView(state: WarbleWayGalaxyState): unknown {
  const enc = state.encounter;
  if (enc?.kind !== 'ruin_run') return null;
  const map = ruinMapForLevel(enc.level);
  const base = {
    map: map.id,
    level: enc.level,
    target_depth: enc.target_depth,
    purpose: enc.origin.type,
    legend: '. floor · # wall (blocks sight) · ~ pit (shoot across) · S start · G goal · I item spot · B being spot · A attacker spot',
  };
  if (!enc.board) return { ...base, status: 'awaiting setup_encounter' };
  const board = enc.board;
  const overlay = map.grid!.rows.map((row) => row.split(''));
  for (const s of board.closed_spots) {
    const p = parseCellId(s)!;
    overlay[p.r - 1]![p.c - 1] = '.';
  }
  // Party = digits 1..n; live attackers = lowercase a/b/c (the base grid uses
  // uppercase legend letters, so the overlay glyphs never collide with it).
  const boardKey: Record<string, string> = {};
  board.tokens.forEach((t, i) => {
    const p = parseCellId(t.cell)!;
    overlay[p.r - 1]![p.c - 1] = String(i + 1);
    boardKey[String(i + 1)] = `${t.name} at ${t.cell}`;
  });
  board.attackers.forEach((a, i) => {
    if (a.defeated) return;
    const glyph = ['a', 'b', 'c'][i]!;
    const p = parseCellId(a.cell)!;
    overlay[p.r - 1]![p.c - 1] = glyph;
    boardKey[glyph] = `${a.id} (Atk +${a.atk}, Mv ${a.move}, Rng ${a.range}) at ${a.cell}`;
  });
  return {
    ...base,
    round: board.round,
    threat_level: board.threat_level,
    start_cell: board.start_cell,
    board_rows: overlay.map((r, i) => `row ${i + 1}: ${r.join(' ')}`),
    board_key: boardKey,
    party: board.tokens.map((t) => ({
      name: t.name,
      cell: t.cell,
      moved: t.moved,
      acted: t.acted,
      ended: t.ended,
      // Distinguish the character from crew from red-shirt bodies, and carry
      // has_attacked (Personal Cloaking targeting legality reads it).
      is_character: t.is_character,
      unnamed: t.unnamed ?? false,
      has_attacked: t.has_attacked ?? false,
    })),
    attackers: board.attackers.map((a) => ({ id: a.id, atk: a.atk, move: a.move, range: a.range, cell: a.cell, defeated: a.defeated })),
    // Whose attacker turn is resolving (the only marker of enemy-phase progress).
    attacker_turn_index: board.attacker_turn_index,
    spots_spent: board.closed_spots,
  };
}

function skillList(state: WarbleWayGalaxyState, natural: Partial<Record<AbilityId, number>>): string[] {
  const skills: string[] = [];
  for (const [ability, score] of Object.entries(natural) as Array<[AbilityId, number]>) {
    if (score >= 1) skills.push(`${ABILITY_NAMES[ability]} (${ability} basic)`);
    if (score >= 3) skills.push(`${ABILITY_NAMES[ability]} advanced`);
  }
  return skills;
}

export function getView(state: WarbleWayGalaxyState): unknown {
  const char = state.character;
  const habitat = HABITATS[state.current_habitat]!;
  const progress = state.habitat_progress[state.current_habitat]!;

  const loreRefs = new Set<string>(['galaxy-overview']);
  if (habitat.lore_topic) loreRefs.add(habitat.lore_topic);
  if (char) loreRefs.add(`${char.race}s` === 'humans' ? 'humans' : char.race); // race topics: humans/kralkin/hexapods/grull
  if (char?.race === 'human') loreRefs.add('humans');
  if (char?.race === 'kralkin') loreRefs.add('kralkin');
  if (char?.race === 'hexapod') loreRefs.add('hexapods');
  if (char?.race === 'grull') loreRefs.add('grull');
  for (const c of state.crew) {
    if (c.race === 'human') loreRefs.add('humans');
    if (c.race === 'kralkin') loreRefs.add('kralkin');
    if (c.race === 'hexapod') loreRefs.add('hexapods');
    if (c.race === 'grull') loreRefs.add('grull');
  }

  return {
    phase: state.phase,
    pending: state.pending,
    character: char
      ? {
          name: char.name,
          race: char.race,
          disposition_roleplay_hint: char.disposition,
          level: char.level,
          xp: char.xp,
          xp_to_next_level: Math.max(0, minXpForLevel(char.level) - char.xp),
          credits: char.credits,
          wounded: char.wounded === true, // amendment A4: −1 all effective scores; heals on habitat arrival
          dread: state.dread ?? 0, // amendment A9b: +1/point on intimidation rolls (cap 3)

          abilities: Object.fromEntries(
            (Object.entries(char.abilities) as Array<[AbilityId, number]>).map(([a, v]) => [
              a,
              {
                name: ABILITY_NAMES[a],
                stat: ABILITY_STAT[a],
                natural: v,
                effective: effectiveScore(
                  state,
                  { name: char.name, natural: char.abilities, gear: char.gear, is_character: true },
                  a,
                ),
              },
            ]),
          ),
          skills: skillList(state, char.abilities),
          equipped: char.gear,
        }
      : null,
    crew: state.crew.map((c) => ({
      name: c.name,
      race: c.race,
      idealizes: c.idealized,
      abilities: c.abilities,
      skills: skillList(state, c.abilities),
      anger_tokens: c.anger_tokens,
      equipped: c.gear,
    })),
    // A10: pure bodies — no scores, no gear, no capacity slot; ruins only.
    unnamed_crew: state.unnamed_crew ?? 0,
    // A11: the five endings, tracked live (the DM keeps every finish line visible).
    season_endings: {
      conquest: 'clear the depth-3 ruin beyond Habitat #3',
      fortune: `${state.character?.credits ?? 0}/${6000}c banked while at a habitat`,
      legend: `level ${state.character?.level ?? 1}/5`,
      plunder: `${state.caches_looted ?? 0}/6 ruin caches opened`,
      bounty: `${state.foes_defeated ?? 0}/8 foes defeated face to face (boarding captures + ruin kills)`,
    },
    ship: state.ship,
    // `id` joins this ledger to character/crew `equipped` and `ship.parts`
    // (both are id lists) — without it duplicate-named items are indistinguishable.
    items: state.items.map((i) => ({
      id: i.id,
      name: i.name,
      type: i.type,
      consumed: state.consumed_item_ids.includes(i.id),
    })),
    // A19 Emergency Bulkheads: the once-per-run save, tracked on the sheet.
    bulkheads_spent: state.bulkheads_spent ?? false,
    habitat: {
      number: habitat.number,
      name: habitat.name,
      shop: habitat.shop.map((s) => ({
        name: s.name,
        cost: s.cost,
        purchased: progress.purchased.includes(s.id),
      })),
      cantina: habitat.cantina.map((r) => ({
        recruit: describeRecruit(r),
        status: progress.recruits_hired.includes(r.id)
          ? 'hired'
          : progress.recruits_failed.includes(r.id)
            ? 'permanently marked (failed)'
            : 'available',
      })),
      missions: habitat.missions.map((m) => ({
        id: m.id,
        mission: describeMission(m),
        status: progress.missions_succeeded.includes(m.id)
          ? 'succeeded'
          : progress.missions_attempted.includes(m.id)
            ? 'attempted (failed)'
            : 'available',
      })),
      progression:
        habitat.progression.kind === 'missions_then_travel'
          ? `complete ${habitat.progression.missions_required} missions (any result; ${progress.missions_attempted.length} done), then travel ${habitat.progression.distance_one_way} one-way`
          : habitat.progression.kind === 'travel'
            ? `travel ${habitat.progression.distance_one_way} one-way to the next habitat`
            : `the Season 1 finale: complete a depth-${habitat.progression.depth} ruin to WIN (depart_for_next_habitat starts it)`,
      repair_roll_available: !progress.repair_rolled_this_arrival,
      unrest_roll_available: !progress.unrest_rolled_this_arrival,
      // Same one-shot category as the two above — previously inconsistently omitted.
      docks_unnamed_roll_available: !(progress.unnamed_rolled ?? false),
      fabrication_available_this_visit: !(progress.fabricated_this_arrival ?? false),
    },
    journey:
      state.journey_stack.length > 0
        ? {
            note: 'Legs resolve top-down (a sandwiched mission finishes before the journey under it resumes).',
            legs: [...state.journey_stack].reverse().map((leg, i) => ({
              position: i === 0 ? 'current' : `queued ${i}`,
              purpose:
                leg.purpose.kind === 'habitat_transfer'
                  ? `one-way transfer to Habitat #${leg.purpose.to_habitat}`
                  : `${leg.purpose.kind === 'mission_outbound' ? 'outbound' : 'return'} — ${describeMission(missionById(leg.purpose.mission_id))}`,
              // Structured twin of the prose: kind + mission id (two missions with
              // identical stats are otherwise indistinguishable; the habitat
              // missions list keys by this id).
              kind: leg.purpose.kind,
              ...(leg.purpose.kind !== 'habitat_transfer' ? { mission_id: leg.purpose.mission_id } : {}),
              cards_remaining: leg.cards_remaining,
            })),
          }
        : null,
    space_combat:
      state.encounter?.kind === 'space_combat'
        ? {
            pirate: `♦${state.encounter.pirate_rank}`,
            stats: DIAMOND_PIRATES[state.encounter.pirate_rank],
            stage: state.encounter.stage,
            flying_ace_reroll_used: state.encounter.reroll_used,
            // Exchange modifiers + once-per-encounter spends — the player cannot
            // compute a roll total without these.
            opening_volley_used: state.encounter.volley_used ?? false,
            pirate_debuff: state.encounter.pirate_debuff ?? 0,
            player_buff: state.encounter.player_buff ?? 0,
            redline_used: state.encounter.redline_used ?? false,
            survivors_roll_used: state.encounter.survivors_rolled ?? false,
          }
        : null,
    ruin: state.encounter?.kind === 'ruin_run' ? ruinView(state) : null,
    travel_deck: {
      cards_in_draw_pile: state.deck.remaining.length,
      cards_in_discard: state.deck.discard.length,
      // The discard is face-up on the table and server-mirrored — contents are
      // public. (The DRAW pile's order is the physical player's shuffle; on a
      // digital seat the server owns it — the drawn card arrives via the Draw
      // button's response / the res_peek reveal below.)
      discard: [...state.deck.discard],
    },
    // Digital mode (docs/digital-mode.md): a digital human's Research peek is
    // revealed by the server (a physical player just looks at their own deck).
    // res_discard is a CHOICE pending — never button-resolved; only the reveal
    // moves here. Physical seats get nothing extra.
    ...(state.digital_seat === true && state.pending?.kind === 'res_discard'
      ? { res_peek: state.deck.remaining.slice(0, state.pending.peek_count) }
      : {}),
    stat_reference: Object.fromEntries(
      Object.entries(STAT_ABILITIES).map(([stat, abilities]) => [stat, abilities.join('/')]),
    ),
    lore_refs: [...loreRefs],
    result: state.result,
  };
}
