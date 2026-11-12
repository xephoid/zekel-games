// Sweetlands Imperium — the Red capture choices, shared by the engine and the
// move list so both see exactly the same targets in the same order.

import type { RegionId } from './data/board.js';
import { regionOf } from './geometry.js';
import type { SweetlandsState, PlayerState, UnitType } from './types.js';

export interface CaptureTarget { ownerId: string; unit: UnitType; }

/** One complete answer to "who do you capture": the target, plus which
 *  "capture a leader" objective it scores when that is also a choice. */
export interface CaptureChoice {
  targetPlayerId: string;
  targetUnit: UnitType;
  captureLeaderScores?: 'public' | 'secret';
}

/** The enemy Leaders and Ambassadors in `region`, leaders first. The AI takes
 *  the first of equally good options, and its policy is a leader when it can. */
export function captureTargetsIn(state: SweetlandsState, p: PlayerState, region: RegionId): CaptureTarget[] {
  const out: CaptureTarget[] = [];
  for (const unit of ['leader', 'ambassador'] as UnitType[]) {
    for (const other of state.players) {
      if (other.playerId !== p.playerId && regionOf(other.units[unit]) === region) out.push({ ownerId: other.playerId, unit });
    }
  }
  return out;
}

/** Whether the secret and the public "Capture a leader" are each still open
 *  for this player. One capture scores only one of them (rules §7 item 2). */
export function leaderObjectivesOpen(p: PlayerState): { secretOpen: boolean; publicOpen: boolean } {
  return {
    secretOpen: p.secretObjectives.includes('capture_leader') && !(p.secretObjectivesScored ?? []).includes('capture_leader'),
    publicOpen: !p.publicObjectivesScored.includes('capture_leader'),
  };
}

/** Every distinct answer for these targets: one per target, and two for a
 *  leader when both objectives are open (the secret first, the AI's pick). */
export function captureChoices(p: PlayerState, targets: CaptureTarget[]): CaptureChoice[] {
  const { secretOpen, publicOpen } = leaderObjectivesOpen(p);
  const out: CaptureChoice[] = [];
  for (const t of targets) {
    const base = { targetPlayerId: t.ownerId, targetUnit: t.unit };
    if (t.unit === 'leader' && secretOpen && publicOpen) {
      out.push({ ...base, captureLeaderScores: 'secret' }, { ...base, captureLeaderScores: 'public' });
    } else {
      out.push(base);
    }
  }
  return out;
}
