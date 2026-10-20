import type { LegalMove } from '@zekel/game-kit';
import type { CNMove, CNState } from './types.js';
import { PEOPLE, getPerson, getLocation, LOCATIONS, WEAPON_ID, CLUE_TOKENS, affiliationName, getPersonByName } from './data/index.js';

/** v2.3 (designer ruling 2026-08-13): recruits are LOCATION-GATED like
 *  arrests — only people at face-up locations the Detective has played can be
 *  flipped ("the Hacker only knows where a person was last seen", rulebook
 *  section 6; Anansi was recruited from an unplayed Little Ghana in the
 *  designer's third human game). Shared by legalMoves, the engine's validate,
 *  and the AI's engine-side pick. */
export function recruitablePersonIds(state: CNState): string[] {
  const out: string[] = [];
  for (const locId of state.detective.board) {
    const loc = getLocation(locId);
    if (!loc) continue;
    for (const id of loc.residents) {
      if (state.detective.poi_deck.includes(id) && !out.includes(id)) out.push(id);
    }
  }
  return out;
}

/** Is this seat's DECIDER the AI brain (vs a person)? Distinct from state
 *  ownership (tracked/opaque): digital mode makes a tracked HUMAN. The §23
 *  no-leak privacy shapes (nameless recruit, ordinal upkeep) exist so an AI
 *  Detective's moves/responses can't carry facedown informant identities to
 *  the Hacker — they apply to decider kind 'ai', never to a human seat that
 *  happens to be tracked. Reads the additive `seat_kinds` field; absent
 *  (legacy sessions, hand-built states) falls back to the pre-digital-mode
 *  identity "tracked ⇒ AI". */
export function isAIDecider(state: CNState, playerId: string): boolean {
  const decider = state.seat_kinds?.[playerId];
  if (decider === 'ai') return true;
  if (decider === 'human') return false;
  return state.players[playerId]?.kind === 'tracked'; // legacy fallback
}

/**
 * What each move spends, in the printed words. One home for the prices: a
 * client puts them beside a button without knowing what anything costs, and
 * without parsing them back out of a sentence.
 *
 * A person's play costs what is printed on them, so that one is looked up.
 */
const PRICES: Record<string, string> = {
  // Detective
  play_location: 'free, and required first',
  upkeep_choice: '1 AP for each informant you keep',
  arrest: '1 AP',
  recruit_informant: '3 AP',
  buy_clue: 'free, discard 3 Locations',
  draw_extra_location: '4 AP',
  guess_location: '4 AP, once per game',
  final_guess: 'free, and the last thing you do',
  block_decide: 'free, but reveals the informant and gives a Clue',
  // Hacker
  draw_contact: '1 AP',
  play_evidence: 'free',
  win_back: 'the Contact’s printed cost',
  jailbreak: 'free, and gives the Detective a NOT clue',
  overclock: 'free, once per turn, and gives the Detective 2 Location draws',
  burn_safehouse: '3 AP, once per game',
  burn_choice: 'free — already paid for',
  clue_reveal: 'free — already owed',
  // Both
  pass_turn: 'free; unspent AP is lost',
};

function priceOf(move: CNMove): string | undefined {
  if (move.type === 'play_person') {
    const cost = getPersonByName((move as { person_name: string }).person_name)?.cost;
    return cost === undefined ? undefined : `${cost} AP`;
  }
  return PRICES[move.type];
}

/** Every legal move, each with what it costs. */
export function getLegalMoves(state: CNState, playerId: string): LegalMove<CNMove>[] {
  return buildLegalMoves(state, playerId).map(m => {
    const cost = priceOf(m.move);
    return cost === undefined ? m : { ...m, cost };
  });
}

function buildLegalMoves(state: CNState, playerId: string): LegalMove<CNMove>[] {
  const moves: LegalMove<CNMove>[] = [];

  if (state.phase === 'setup') {
    // Only the Hacker reports hideout during setup
    if (state.playerOrder[1] === playerId) {
      if (isAIDecider(state, playerId)) {
        // AI Hacker: nameless — the engine picks secretly (no-leak pattern).
        // A digital human Hacker is tracked too; the hideout is still theirs.
        moves.push({
          move_id: 'report_hideout',
          description: 'AI Hacker chooses its hideout secretly (server-side pick — no location name in the move)',
          move: { type: 'report_hideout' },
        });
      } else {
        moves.push({
          move_id: 'report_hideout',
          description: 'Choose your hideout location',
          move: { type: 'report_hideout', location_name: '' },
        });
      }
    }
    return moves;
  }

  if (state.phase === 'game_over') return moves;

  // Handle pending states — only the active player can act
  if (state.pending) {
    if (state.pending.type === 'block_pending') {
      if (state.activePlayerId !== playerId) return moves;
      moves.push({
        move_id: 'block_yes',
        description: `Block ${getPerson(state.pending.person_id)?.name ?? 'play'} by revealing informant`,
        move: { type: 'block_decide', block: true },
      });
      moves.push({
        move_id: 'block_no',
        description: 'Decline to block — let the play proceed',
        move: { type: 'block_decide', block: false },
      });
      return moves;
    }
    if (state.pending.type === 'clue_reveal_pending') {
      if (state.activePlayerId !== playerId) return moves;
      const tc = state.hacker.truthful_clues;
      const hideout = state.hacker.hideout;
      if (!tc.borough) {
        moves.push({
          move_id: 'clue_borough',
          description: 'Reveal your hideout borough',
          move: { type: 'clue_reveal', category: 'borough', value: hideout ? hideout.borough : '' },
        });
      }
      if (!tc.population) {
        moves.push({
          move_id: 'clue_population',
          description: 'Reveal your hideout population',
          move: { type: 'clue_reveal', category: 'population', value: hideout ? String(hideout.population) : '' },
        });
      }
      if (!tc.affiliation) {
        moves.push({
          move_id: 'clue_affiliation',
          description: 'Reveal your hideout affiliation',
          move: { type: 'clue_reveal', category: 'affiliation', value: hideout ? hideout.affiliation : '' },
        });
      }
      return moves;
    }
    if (state.pending.type === 'endgame_final_guess') {
      if (state.activePlayerId !== playerId) return moves;
      for (const loc of getAllLocations()) {
        moves.push({
          move_id: `final_guess_${loc.id}`,
          description: `Final guess: ${loc.name}`,
          move: { type: 'final_guess', location_name: loc.name },
        });
      }
      return moves;
    }
    if (state.pending.type === 'board_discard_pending') {
      if (state.activePlayerId !== playerId) return moves;
      for (const locId of state.detective.board) {
        const loc = getLocation(locId);
        if (!loc) continue;
        moves.push({
          move_id: `board_discard_${locId}`,
          description: `Discard ${loc.name} from the board`,
          move: { type: 'board_discard_choice', target_location: loc.name },
        });
      }
      return moves;
    }
    if (state.pending.type === 'reveal_informant_pending') {
      if (state.activePlayerId !== playerId) return moves;
      // The Hacker points at a facedown CARD (position), never a named person —
      // facedown informant identities are hidden from the Hacker. Enumerate
      // 1-based ordinals over the facedown informants (stable array order).
      let ordinal = 0;
      for (const inf of state.detective.informants) {
        if (inf.revealed) continue;
        ordinal++;
        moves.push({
          move_id: `reveal_inf_${ordinal}`,
          description: `Reveal facedown informant #${ordinal} (of ${state.detective.informants.filter(i => !i.revealed).length})`,
          move: { type: 'reveal_informant', target_informant: String(ordinal) },
        });
      }
      return moves;
    }
    if (state.pending.type === 'burn_choice_pending') {
      if (state.activePlayerId !== playerId) return moves;
      // The Hacker has paid and gathered the pile — NOW its contents may be
      // enumerated (before the burn they would leak the deck/hand split early).
      const currentId = state.hacker.hideout_location_id
        ?? (state.hacker.hideout
          ? LOCATIONS.find(l => l.borough === state.hacker.hideout!.borough && l.population === state.hacker.hideout!.population && l.affiliation === state.hacker.hideout!.affiliation)?.id
          : undefined);
      if (state.detective.kind === 'tracked') {
        const pool = [...new Set([...state.detective.location_deck, ...(state.detective.location_discard ?? [])])];
        for (const locId of pool) {
          if (locId === currentId) continue;
          const loc = getLocation(locId);
          if (!loc) continue;
          moves.push({
            move_id: `burn_choice_${locId}`,
            description: `New safehouse: ${loc.name}`,
            move: { type: 'burn_choice', new_location_name: loc.name },
          });
        }
      } else if (state.detective.location_hand.length > 0) {
        // Determinized (MCTS) opaque Detective: hand is populated — enumerate.
        const out = new Set([...state.detective.board, ...state.detective.location_hand]);
        for (const loc of getAllLocations()) {
          if (out.has(loc.id) || loc.id === currentId) continue;
          moves.push({
            move_id: `burn_choice_${loc.id}`,
            description: `New safehouse: ${loc.name}`,
            move: { type: 'burn_choice', new_location_name: loc.name },
          });
        }
      } else {
        // Two-human table: the server cannot see the pile — declared form.
        moves.push({
          move_id: 'burn_choice',
          description: 'Name your NEW safehouse location (a different location, from the gathered pile)',
          move: { type: 'burn_choice', new_location_name: '' },
        });
      }
      return moves;
    }
    if (state.pending.type === 'burn_hand_report_pending') {
      if (state.activePlayerId !== playerId) return moves;
      // Human Detective reports the Location cards still in their hand. In
      // determinized (MCTS) states the hand is populated — offer it concretely.
      const hand = state.detective.location_hand.map(id => getLocation(id)?.name ?? id);
      moves.push({
        move_id: 'report_location_hand',
        description: hand.length > 0
          ? `Report your Location hand (${hand.join(', ')})`
          : 'Report the Location cards still in your hand (name them exactly; the gathered pile is everything else)',
        move: { type: 'report_location_hand', locations: hand },
      });
      return moves;
    }
    if (state.pending.type === 'informant_removal_pending') {
      if (state.activePlayerId !== playerId) return moves;
      const revealedOnly = state.pending.scope === 'revealed';
      // Facedown informants by blind position; revealed ones by name.
      // (Iceden rider scope: revealed only.)
      let ordinal = 0;
      for (const inf of state.detective.informants) {
        if (revealedOnly) break;
        if (inf.revealed) continue;
        ordinal++;
        moves.push({
          move_id: `remove_inf_fd_${ordinal}`,
          description: `Remove facedown informant #${ordinal} (returned to the POI deck unseen)`,
          move: { type: 'informant_removal_choice', target_informant: String(ordinal) },
        });
      }
      for (const inf of state.detective.informants) {
        if (!inf.revealed) continue;
        const person = getPerson(inf.person_id);
        if (!person) continue;
        moves.push({
          move_id: `remove_inf_rv_${inf.person_id}`,
          description: `Remove revealed informant ${person.name}`,
          move: { type: 'informant_removal_choice', target_informant: person.name },
        });
      }
      return moves;
    }
    if (state.pending.type === 'discard_retrieval_pending') {
      if (state.activePlayerId !== playerId) return moves;
      for (const cardId of state.hacker.contacts_discard) {
        const person = getPerson(cardId);
        const name = person?.name ?? (cardId === WEAPON_ID ? 'The Weapon' : cardId);
        moves.push({
          move_id: `retrieve_${cardId}`,
          description: `Retrieve ${name} from discard`,
          move: { type: 'discard_retrieval_choice', target_card: name },
        });
      }
      return moves;
    }
  }

  if (state.activePlayerId !== playerId) return moves;

  const isDetective = state.playerOrder[0] === playerId;
  const ap = state.players[playerId]?.ap ?? 0;

  if (isDetective) {
    // Detective must play exactly one Location before any AP actions or upkeep.
    // For tracked: list hand locations. For opaque: list all (human chooses).
    const locationPlayed = state.detective.location_played_this_turn;
    const playableLocs = state.detective.kind === 'tracked'
      ? state.detective.location_hand.map(id => getLocation(id)!)
      : [];
    // If the Detective hasn't played a location yet this turn (board check),
    // they MUST play. We'll list all hand locations.
    if (!locationPlayed) {
      if (state.detective.kind === 'opaque') {
        // Human Detective: all locations are legal (server doesn't know hand)
        for (const loc of getAllLocations()) {
          moves.push({
            move_id: `play_${loc.id}`,
            description: `Play ${loc.name} to the board`,
            move: { type: 'play_location', location_name: loc.name },
          });
        }
      } else {
        for (const loc of playableLocs) {
          moves.push({
            move_id: `play_${loc.id}`,
            description: `Play ${loc.name} to the board`,
            move: { type: 'play_location', location_name: loc.name },
          });
        }
      }
    }

    // Upkeep: if Detective has informants, has played a Location, and upkeep has not been paid this turn.
    // Enumerate keep/release subsets (printed names in descriptions) so the choice is real;
    // cap enumeration to keep the menu navigable.
    if (locationPlayed && state.detective.informants.length > 0 && !state.detective.upkeep_paid) {
      const infs = state.detective.informants;
      if (infs.length <= 4) {
        // v2.3 privacy: keep/release entries are ORDINALS ("1"-based positions;
        // revealed informants may use names) ONLY while the decider is the AI —
        // so the AI's chosen move never carries a facedown identity into a
        // response the Hacker can read. A HUMAN Detective (physical or digital)
        // sees printed names — the choice and the menu are theirs alone.
        const aiDecider = isAIDecider(state, playerId);
        const label = (i: number) => {
          const inf = infs[i]!;
          if (!aiDecider || inf.revealed) return getPerson(inf.person_id)?.name ?? inf.person_id;
          return String(i + 1);
        };
        const shown = (i: number) => {
          const inf = infs[i]!;
          if (!aiDecider || inf.revealed) return getPerson(inf.person_id)?.name ?? inf.person_id;
          return `facedown #${i + 1}`;
        };
        const count = 1 << infs.length;
        for (let mask = 0; mask < count; mask++) {
          const keep: string[] = [];
          const release: string[] = [];
          const keepShown: string[] = [];
          const releaseShown: string[] = [];
          for (let i = 0; i < infs.length; i++) {
            if (mask & (1 << i)) { keep.push(label(i)); keepShown.push(shown(i)); }
            else { release.push(label(i)); releaseShown.push(shown(i)); }
          }
          moves.push({
            move_id: `upkeep_${mask}`,
            description: keep.length === 0
              ? `Release all informants (${releaseShown.join(', ')})`
              : release.length === 0
                ? `Keep all informants (${keep.length} AP)`
                : `Keep ${keepShown.join(', ')} (${keep.length} AP); release ${releaseShown.join(', ')}`,
            move: { type: 'upkeep_choice', keep, release },
          });
        }
      } else {
        moves.push({
          move_id: 'upkeep_default',
          description: 'Pay upkeep / release informants (name which to keep)',
          move: { type: 'upkeep_choice', keep: [], release: [] },
        });
      }
    }

    // AP actions: only after Location played and upkeep paid (if there are informants)
    const maySpendAP = locationPlayed && (state.detective.informants.length === 0 || state.detective.upkeep_paid);
    if (maySpendAP && ap >= 1) {
      // Arrest: any person at a face-up location
      for (const locId of state.detective.board) {
        const loc = getLocation(locId);
        if (!loc) continue;
        for (const resId of loc.residents) {
          const person = getPerson(resId);
          if (!person) continue;
          // POI must be available
          if (state.detective.poi_deck.includes(resId)) {
            moves.push({
              move_id: `arrest_${resId}`,
              description: `Arrest ${person.name} at ${loc.name}`,
              move: { type: 'arrest', target_person: person.name },
            });
          }
        }
      }
    }

    if (maySpendAP && ap >= 3) {
      // v2.3 (designer ruling): only people at face-up played locations.
      const recruitable = recruitablePersonIds(state);
      if (isAIDecider(state, playerId)) {
        // §23 privacy (AI Detective ONLY): recruits NAMELESS — the engine picks
        // the target secretly so the move (and any response built from it)
        // can't leak the facedown identity to the Hacker. One entry. A HUMAN
        // Detective (physical or digital) names their own pick below — the
        // choice is theirs (choices.ts owner:'player').
        if (recruitable.length > 0) {
          moves.push({
            move_id: 'recruit_informant',
            description: 'Recruit an informant from a face-up location (facedown — the server picks secretly)',
            move: { type: 'recruit_informant' },
          });
        }
      } else {
        // A human Detective names their own pick (the response goes to them).
        for (const personId of recruitable) {
          const person = getPerson(personId);
          if (!person) continue;
          moves.push({
            move_id: `recruit_${personId}`,
            description: `Recruit ${person.name} as informant`,
            move: { type: 'recruit_informant', target_person: person.name },
          });
        }
      }
    }

    if (maySpendAP && ap >= 4) {
      // Only offer the draw while the deck has cards (tracked; an opaque human's
      // deck size is unknown — the engine only validates tracked decks anyway).
      // Balance-gate find (seed 2063): offering it on an empty deck fed the
      // random tier an illegal move — get_legal_moves must never lie.
      if (state.detective.kind !== 'tracked' || state.detective.location_deck.length > 0) {
        moves.push({
          move_id: 'draw_extra_location',
          description: 'Draw an extra Location card (4 AP)',
          move: { type: 'draw_extra_location' },
        });
      }
      if (!state.detective.mid_game_guess_spent) {
        for (const loc of getAllLocations()) {
          moves.push({
            move_id: `guess_${loc.id}`,
            description: `Guess ${loc.name} as Hacker's hideout (4 AP)`,
            move: { type: 'guess_location', location_name: loc.name },
          });
        }
      }
    }

    // Buy clue (v2.3: back to 3 cards): Detective chooses which 3 from hand
    // to discard (only after mandatory order)
    if (maySpendAP && state.detective.kind === 'tracked' && state.detective.location_hand.length >= 3) {
      const handNames = state.detective.location_hand.map(id => getLocation(id)?.name ?? id);
      // Generate all C(n,3) combinations
      for (let i = 0; i < handNames.length - 2; i++) {
        for (let j = i + 1; j < handNames.length - 1; j++) {
          for (let k = j + 1; k < handNames.length; k++) {
            const triple = [handNames[i]!, handNames[j]!, handNames[k]!] as [string, string, string];
            moves.push({
              move_id: `buy_clue_${i}_${j}_${k}`,
              description: `Buy Clue: discard ${triple.join(', ')}`,
              move: { type: 'buy_clue', discard_locations: triple },
            });
          }
        }
      }
    } else if (maySpendAP && state.detective.kind === 'opaque') {
      // Human Detective physically owns their hand; offer a generic buy_clue prompt.
      moves.push({
        move_id: 'buy_clue',
        description: 'Buy Clue: discard 3 Location cards from your hand (name them)',
        move: { type: 'buy_clue', discard_locations: ['', '', ''] },
      });
    }

    // Pass turn is allowed at any time, but the engine enforces mandatory order if a human tries to act out of sequence.
    moves.push({
      move_id: 'pass_turn',
      description: 'End turn',
      move: { type: 'pass_turn' },
    });
  } else {
    // Hacker moves
    const ap = state.players[playerId]?.ap ?? 0;

    if (ap >= 1) {
      // Nothing left to draw or reshuffle → the draw is unavailable (interim
      // ruling on a rulebook silence, PORT-NOTES §33). Tracked only: an
      // opaque (human) Hacker's deck is physical and invisible to the server.
      const contactsExhausted = state.hacker.kind === 'tracked'
        && state.hacker.contacts_deck.length === 0
        && state.hacker.contacts_discard.length === 0;
      if (!contactsExhausted) {
        moves.push({
          move_id: 'draw_contact',
          description: 'Draw a Contact (1 AP)',
          move: { type: 'draw_contact' },
        });
      }

      // Play a person (if tracked, from hand; if opaque, any person)
      const playablePeople: string[] = state.hacker.kind === 'tracked'
        ? (state.players[playerId]?.kind === 'tracked' ? state.players[playerId].hand : [])
        : PEOPLE.filter(p => !state.hacker.evidence.witnesses.includes(p.id) && !state.hacker.evidence.motive_set_1.includes(p.id) && !state.hacker.evidence.motive_set_2.includes(p.id)).map(p => p.id);
      for (const personId of playablePeople) {
        if (personId === WEAPON_ID) continue;
        const person = getPerson(personId);
        if (!person) continue;
        if (state.detective.jail.flat().includes(personId)) continue;
        if (ap >= person.cost) {
          moves.push({
            move_id: `play_person_${personId}`,
            description: `Play ${person.name} (${person.cost} AP)`,
            move: { type: 'play_person', person_name: person.name },
          });
        }
      }
    }

    // Play Evidence (free)
    // A tracked Hacker plays out of its server-known hand; an OPAQUE (human)
    // Hacker holds physical cards, so — same doctrine as `play_person` above —
    // offer the plays over every eligible person and trust the declaration.
    // (Until 2026-08-17 this entire block sat behind `hacker.kind === 'tracked'`,
    // so a human Hacker was never offered ANY Evidence play: its whole win path
    // was invisible in the move list, even though the engine accepts a declared
    // `play_evidence` fine. Same class of gap as the `buy_clue` one already
    // fixed on the Detective side — POST-PORT.md second-pass fixes.)
    {
      const hackerTracked = state.hacker.kind === 'tracked';
      const hand = state.players[playerId]?.kind === 'tracked' ? state.players[playerId].hand : [];
      const ev = state.hacker.evidence;
      const allUsedEvidence = [...ev.witnesses, ...ev.motive_set_1, ...ev.motive_set_2, ...(ev.motive_set_3 ?? []), ...(ev.motive_set_4 ?? [])];

      // Weapon
      if (!ev.weapon && (!hackerTracked || hand.includes(WEAPON_ID))) {
        moves.push({
          move_id: 'evidence_weapon',
          description: 'Play the Weapon as Evidence',
          move: { type: 'play_evidence', person_name: 'The Weapon', evidence_type: 'weapon' },
        });
      }

      // Witnesses (v2.4: played as a COMPLETE set of 3 at once, exactly like a
      // Motive set — §7 "reveal/play 3 Witness cards" is ONE action for the
      // whole piece. Jailed or already-used people are ineligible — §5.1.)
      if (ev.witnesses.length === 0) {
        const eligibleWitnesses = (hackerTracked ? hand : PEOPLE.map(p => p.id)).filter(id => {
          const person = getPerson(id);
          if (!person?.is_witness) return false;
          if (state.detective.jail.flat().includes(id)) return false;
          return !allUsedEvidence.includes(id);
        });
        // Fewer than 3 eligible Witnesses (jailed / already used / not held):
        // the piece cannot be played at all right now, so offer nothing rather
        // than a prompt that must be rejected.
        if (eligibleWitnesses.length < 3) {
          // nothing to offer
        } else if (hackerTracked) {
          // At most C(7,3) = 35 trios — small enough to enumerate concretely.
          for (let i = 0; i < eligibleWitnesses.length; i++) {
            for (let j = i + 1; j < eligibleWitnesses.length; j++) {
              for (let k = j + 1; k < eligibleWitnesses.length; k++) {
                const trio = [eligibleWitnesses[i]!, eligibleWitnesses[j]!, eligibleWitnesses[k]!];
                const names = trio.map(id => getPerson(id)!.name);
                moves.push({
                  move_id: `evidence_witnessset_${trio.join('_')}`,
                  description: `Play complete Witness evidence: ${names.join(' + ')}`,
                  move: { type: 'play_evidence', evidence_type: 'witness', people: names },
                });
              }
            }
          }
        } else {
          // Opaque Hacker: the hand is physical. Offer the DECLARED atomic
          // form, naming the eligible pool so the model never invents a name.
          const pool = eligibleWitnesses.map(id => getPerson(id)!.name);
          moves.push({
            move_id: 'evidence_witnessset',
            description: `Play COMPLETE Witness evidence: name all 3 Witnesses from your hand at once (never one at a time). Eligible Witnesses: ${pool.join(', ')}`,
            move: { type: 'play_evidence', evidence_type: 'witness', people: ['', '', ''] },
          });
        }
      }

      // Motive (v2.1: a set is played as a COMPLETE trio at once — never
      // banked card by card. v2.2: gang cap removed. Enumerate every legal
      // trio from hand: 3 different affiliations, trio unique vs completed
      // sets, nobody jailed or already used — §7.)
      {
        const allSets = [ev.motive_set_1, ev.motive_set_2, ev.motive_set_3 ?? []];
        const openSlots = allSets.filter(set => set.length === 0).length;
        if (openSlots > 0) {
          const trioOf = (affs: string[]) => [...affs].sort().join('+');
          const completedTrios = new Set(allSets.filter(set => set.length >= 3).map(set => trioOf(set.map(id => getPerson(id)!.affiliation))));
          if (hackerTracked) {
            const eligible = hand.filter(id => {
              if (id === WEAPON_ID) return false;
              if (!getPerson(id)) return false;
              if (state.detective.jail.flat().includes(id)) return false;
              return !allUsedEvidence.includes(id);
            });
            for (let i = 0; i < eligible.length; i++) {
              for (let j = i + 1; j < eligible.length; j++) {
                for (let k = j + 1; k < eligible.length; k++) {
                  const trio = [eligible[i]!, eligible[j]!, eligible[k]!];
                  const affs = trio.map(id => getPerson(id)!.affiliation);
                  if (new Set(affs).size !== 3) continue;
                  // v2.3-PROBE: at most two gangs per trio
                  if (affs.filter(a => a.startsWith('gang')).length > 2) continue;
                  if (completedTrios.has(trioOf(affs))) continue;
                  const names = trio.map(id => getPerson(id)!.name);
                  moves.push({
                    move_id: `evidence_motiveset_${trio.join('_')}`,
                    description: `Play complete Motive set: ${names.join(' + ')} (${affs.map(a => affiliationName(a)).join('/')})`,
                    move: { type: 'play_evidence', evidence_type: 'motive', people: names },
                  });
                }
              }
            }
          } else {
            // Opaque Hacker: the hand is physical and unknowable here, and
            // enumerating every legal trio over all People would be hundreds
            // of mostly-unholdable combinations. Offer the DECLARED atomic
            // form instead (same shape as the opaque `buy_clue` prompt) — it
            // still names all 3 slots at once, so a set can never be banked a
            // card at a time.
            const usedCombos = [...completedTrios].map(t => t.split('+').map(a => affiliationName(a)).join(' + '));
            moves.push({
              move_id: 'evidence_motiveset',
              description: `Play a COMPLETE Motive set (${openSlots} set slot${openSlots === 1 ? '' : 's'} open): name all 3 people from your hand at once — 3 DIFFERENT affiliations, at most 2 gangs, nobody jailed or already used as Evidence. Cards are never banked one at a time.${usedCombos.length > 0 ? ` Affiliation combinations already used: ${usedCombos.join('; ')}.` : ''}`,
              move: { type: 'play_evidence', evidence_type: 'motive', people: ['', '', ''] },
            });
          }
        }
      }
    }

    // Win back revealed informant — §6: you PLAY THE MATCHING CONTACT from
    // hand for its printed cost, so a tracked Hacker must actually hold it.
    // (An opaque Hacker's hand is physical: offer it and trust the
    // declaration, as everywhere else — the engine only validates tracked
    // hands.)
    const winBackHand = state.players[playerId]?.kind === 'tracked' ? state.players[playerId].hand : null;
    for (const inf of state.detective.informants) {
      if (!inf.revealed) continue;
      const person = getPerson(inf.person_id);
      if (!person) continue;
      if (winBackHand && !winBackHand.includes(inf.person_id)) continue;
      const cost = person.is_witness ? 1 : person.cost;
      if (ap >= cost) {
        moves.push({
          move_id: `win_back_${inf.person_id}`,
          description: `Win back ${person.name} (revealed informant, ${cost} AP — play your matching ${person.name} Contact card)`,
          move: { type: 'win_back', person_name: person.name },
        });
      }
    }

    // Jailbreak (free, but need a jailed person + must give a Negative Clue)
    // Enumerate eligible Negative Clue tokens: not already declared, not in a
    // truthfully-revealed category, and (when the hideout is server-known) not
    // actually true of the hideout — the engine rejects all three.
    const tc = state.hacker.truthful_clues;
    const hideout = state.hacker.hideout;
    const eligibleTokens = CLUE_TOKENS.filter(t => {
      if (state.hacker.negative_clues.includes(t.id)) return false;
      if (t.type === 'borough' && tc.borough) return false;
      if (t.type === 'population' && tc.population) return false;
      if (t.type === 'affiliation' && tc.affiliation) return false;
      if (hideout) {
        if (t.type === 'borough' && t.value === hideout.borough) return false;
        if (t.type === 'population' && Number(t.value) === hideout.population) return false;
        if (t.type === 'affiliation' && t.value === hideout.affiliation) return false;
      }
      return true;
    });
    for (const jailedId of state.detective.jail.flat()) {
      if (!jailedId) continue;
      const person = getPerson(jailedId);
      if (!person) continue;
      if (eligibleTokens.length === 0) {
        // No eligible tokens — jailbreak is not available
        continue;
      }
      for (const token of eligibleTokens) {
        moves.push({
          move_id: `jailbreak_${jailedId}_${token.id}`,
          description: `Jailbreak: free ${person.name} (give Negative Clue: ${tokenLabel(token)})`,
          move: { type: 'jailbreak', freed_person: person.name, negative_clue_token: token.id },
        });
      }
    }

    // Burn the Safehouse (v1.7): 3 AP, once per game. One entry regardless of
    // seating — the pile is only enumerated after the action commits (physical
    // order), via burn_choice_pending for a human Hacker or an engine-side
    // secret pick for an AI Hacker.
    // Against a TRACKED Detective the pile is server-known: withhold the offer
    // when no valid relocation target exists (balance-gate find, seed 4124 —
    // the random tier picked an offered burn the engine had to reject; the
    // same gap could also strand a human Hacker in burn_choice_pending with
    // zero choices). Against an opaque Detective the pile is unknowable here;
    // the hand-report path's cancel-and-refund covers the degenerate case.
    const burnPoolNonEmpty = state.detective.kind !== 'tracked' || (() => {
      const currentId = state.hacker.hideout_location_id
        ?? (state.hacker.hideout
          ? LOCATIONS.find(l => l.borough === state.hacker.hideout!.borough && l.population === state.hacker.hideout!.population && l.affiliation === state.hacker.hideout!.affiliation)?.id
          : undefined);
      return [...state.detective.location_deck, ...(state.detective.location_discard ?? [])].some(id => id !== currentId);
    })();
    if (ap >= 3 && !(state.hacker.safehouse_burned ?? false) && burnPoolNonEmpty) {
      moves.push({
        move_id: 'burn_safehouse',
        description: 'Burn the Safehouse (3 AP, once per game): relocate to a new secret hideout — discarded Locations return to the deck and ALL Clue tokens (truthful and Negative) are removed from the table',
        move: { type: 'burn_safehouse' },
      });
    }

    // Overclock (once per turn)
    if (!state.players[playerId]?.overclock_used) {
      moves.push({
        move_id: 'overclock',
        description: 'Overclock: +1 AP (give Detective 2 Location draws)',
        move: { type: 'overclock' },
      });
    }

    // Corp 1 ability targets (reveal informant) — handled via play_person

    moves.push({
      move_id: 'pass_turn',
      description: 'End turn',
      move: { type: 'pass_turn' },
    });
  }

  return moves;
}

function getAllLocations() {
  return LOCATIONS;
}

function tokenLabel(t: { type: string; value: string | number }): string {
  return `${t.type}: ${t.value}`;
}