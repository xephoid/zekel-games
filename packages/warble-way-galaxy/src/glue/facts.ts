// What the engine says beside a choice, read off the wire (zekel-games,
// warble-way-galaxy/facts.ts): a roll's chance and stakes, what a listed
// move leads to, why a move is shut, and the sheet's words. Universe prints
// these; it never works a chance, a reason or a consequence out for itself.
// A field the engine did not send reads as absent, never as a guess.

import type { GameReferenceResponse, LegalMove, UnavailableMove } from '@zekel/wire-types';
import { asArr, asNum, asStr, isObj } from '@zekel/glue-kit';

export interface RollPart { label: string; bonus: number; kind: string; ability?: string; who?: string }
export interface Pairing { youTake: 'higher' | 'lower'; why: string; yourAdd: number; theirAdd: number; theirName: string; riderDice: number; win: number; tie: number; lose: number }
export interface RollFacts {
  reason: string; name: string; subject?: string; carrier?: string;
  dice: number; parts: RollPart[]; bonus: number;
  target?: number; diceNeed?: number; chance?: number;
  pairing?: Pairing;
  table?: Array<{ face: number; result: string }>;
  onPass: string; onFail: string; notes: string[];
}
export interface MovePreview {
  roll?: RollFacts; check?: RollFacts; then?: string;
  carriers?: Array<{ name: string; title: string; roll: RollFacts }>;
}
export interface LastRoll {
  reason: string; ground?: string; dice: number[]; parts: RollPart[]; bonus: number; total: number; target: number | null;
  outcome: 'pass' | 'fail' | 'win' | 'lose' | 'tie' | 'none';
  pairs?: { yours: number[]; theirs: number[]; rider: number[]; yourTotal: number; theirTotal: number; theirName: string };
}

const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);
const parts = (v: unknown): RollPart[] => asArr(v).filter(isObj).map((p) => ({ label: asStr(p['label']), bonus: asNum(p['bonus']), kind: asStr(p['kind']), ...(typeof p['ability'] === 'string' ? { ability: p['ability'] } : {}), ...(typeof p['who'] === 'string' ? { who: p['who'] } : {}) }));

export function readRollFacts(v: unknown): RollFacts | null {
  if (!isObj(v) || typeof v['reason'] !== 'string') return null;
  const pr = isObj(v['pairing']) ? v['pairing'] : null;
  const target = num(v['target']); const diceNeed = num(v['dice_need']); const chance = num(v['chance']);
  return {
    reason: v['reason'], name: asStr(v['name']),
    ...(typeof v['subject'] === 'string' ? { subject: v['subject'] } : {}),
    ...(typeof v['carrier'] === 'string' ? { carrier: v['carrier'] } : {}),
    dice: asNum(v['dice']), parts: parts(v['parts']), bonus: asNum(v['bonus']),
    ...(target !== undefined ? { target } : {}), ...(diceNeed !== undefined ? { diceNeed } : {}), ...(chance !== undefined ? { chance } : {}),
    ...(pr ? { pairing: { youTake: pr['you_take'] === 'higher' ? 'higher' : 'lower', why: asStr(pr['why']), yourAdd: asNum(pr['your_add']), theirAdd: asNum(pr['their_add']), theirName: asStr(pr['their_name']), riderDice: asNum(pr['rider_dice']), win: asNum(pr['win']), tie: asNum(pr['tie']), lose: asNum(pr['lose']) } } : {}),
    ...(Array.isArray(v['table']) ? { table: asArr(v['table']).filter(isObj).map((t) => ({ face: asNum(t['face']), result: asStr(t['result']) })) } : {}),
    onPass: asStr(v['on_pass']), onFail: asStr(v['on_fail']), notes: asArr(v['notes']).map((n) => asStr(n)),
  };
}

/** What the engine says a listed move leads to, or null when it says nothing. */
export function previewOf(move: LegalMove | undefined): MovePreview | null {
  const p = move ? (move as unknown as Record<string, unknown>)['preview'] : null;
  if (!isObj(p)) return null;
  const roll = readRollFacts(p['roll']); const check = readRollFacts(p['check']);
  const carriers = asArr(p['carriers']).filter(isObj).map((c) => ({ name: asStr(c['name']), title: asStr(c['title']), roll: readRollFacts(c['roll']) })).filter((c): c is { name: string; title: string; roll: RollFacts } => !!c.roll);
  return {
    ...(roll ? { roll } : {}), ...(check ? { check } : {}),
    ...(typeof p['then'] === 'string' ? { then: p['then'] } : {}),
    ...(carriers.length ? { carriers } : {}),
  };
}

export function readLastRoll(v: unknown): LastRoll | null {
  if (!isObj(v) || !Array.isArray(v['dice'])) return null;
  const pr = isObj(v['pairs']) ? v['pairs'] : null;
  const dice = (x: unknown) => asArr(x).map((d) => asNum(d));
  const outcome = asStr(v['outcome']);
  return {
    reason: asStr(v['reason']), ...(typeof v['ground'] === 'string' ? { ground: v['ground'] } : {}),
    dice: dice(v['dice']), parts: parts(v['parts']), bonus: asNum(v['bonus']), total: asNum(v['total']),
    target: typeof v['target'] === 'number' ? v['target'] : null,
    outcome: outcome === 'pass' || outcome === 'fail' || outcome === 'win' || outcome === 'lose' || outcome === 'tie' ? outcome : 'none',
    ...(pr ? { pairs: { yours: dice(pr['yours']), theirs: dice(pr['theirs']), rider: dice(pr['rider']), yourTotal: asNum(pr['your_total']), theirTotal: asNum(pr['their_total']), theirName: asStr(pr['their_name']) } } : {}),
  };
}

/** The engine's reason a move is not on offer: the whole type, or one named
 *  row or option of it. Null when the engine gave none. */
export function reasonFor(unavailable: UnavailableMove[] | undefined, moveType: string, item?: string): string | null {
  const hit = (unavailable ?? []).find((u) => u.moveType === moveType && (item === undefined ? u.item === undefined : u.item === item));
  return hit?.reason ?? null;
}

/** A chance as a player reads it: a whole percent, with the two ends kept honest. */
export function percent(chance: number | undefined): string {
  if (chance === undefined) return '';
  if (chance <= 0) return '0%';
  if (chance >= 1) return '100%';
  const p = Math.round(chance * 100);
  return p === 0 ? 'under 1%' : p === 100 ? 'over 99%' : `${p}%`;
}

// ---- the sheet's words, from the reference data ----

const ref = (reference: GameReferenceResponse | null): Record<string, unknown> => (isObj(reference?.referenceData) ? reference!.referenceData as Record<string, unknown> : {});

export interface AbilityWords { code: string; name: string; stat: string; basic: string; advanced: { name: string; what: string } | null }
export function abilityWords(reference: GameReferenceResponse | null, code: string): AbilityWords | null {
  const all = ref(reference)['abilities'];
  const a = isObj(all) ? all[code] : null;
  if (!isObj(a)) return null;
  const adv = isObj(a['advanced']) ? { name: asStr(a['advanced']['name']), what: asStr(a['advanced']['what']) } : null;
  return { code, name: asStr(a['name'], code), stat: asStr(a['stat']), basic: asStr(a['basic']), advanced: adv };
}

/** One of the reference data's word tables ("ship_text", "ruin_text", "counter_text", "hazard_text"). */
export function words(reference: GameReferenceResponse | null, table: string): Record<string, string> {
  const t = ref(reference)[table];
  return isObj(t) ? Object.fromEntries(Object.entries(t).filter(([, v]) => typeof v === 'string').map(([k, v]) => [k, v as string])) : {};
}
export function endingWords(reference: GameReferenceResponse | null): Record<string, { name: string; how: string }> {
  const t = ref(reference)['endings'];
  return isObj(t) ? Object.fromEntries(Object.entries(t).filter(([, v]) => isObj(v)).map(([k, v]) => [k, { name: asStr((v as Record<string, unknown>)['name']), how: asStr((v as Record<string, unknown>)['how']) }])) : {};
}
export const lossWords = (reference: GameReferenceResponse | null): string[] => asArr(ref(reference)['losses']).map((x) => asStr(x)).filter(Boolean);
export const deathCheckWords = (reference: GameReferenceResponse | null): string => asStr(ref(reference)['death_check']);
