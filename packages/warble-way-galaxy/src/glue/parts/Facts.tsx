// A roll's facts on screen: what is added, the number to reach, the chance,
// what passing and failing each do, and the last roll read back with its
// dice. Every number and sentence here is the engine's (../facts.ts); this
// file only lays them out.

import type { ReactNode } from 'react';
import { Die } from '@zekel/primitives';
import type { GlueInput } from '@zekel/glue-kit';
import { abilityWords, percent, type LastRoll, type RollFacts, type RollPart } from '../facts.js';
import { Lbl, Num } from '../ui.js';

/** "your Piloting +3", "Slate's Diplomacy +1", "Sustenance Cube +1". */
export function partWords(part: RollPart, facts: Pick<RollFacts, 'carrier'>, input: GlueInput): string {
  if (part.kind === 'score' && part.ability) {
    const name = abilityWords(input.reference, part.ability)?.name ?? part.ability;
    const whose = !facts.carrier || facts.carrier === 'you' ? 'your' : `${facts.carrier}'s`;
    return `${whose} ${name} +${part.bonus}`;
  }
  return part.label;
}

/** The chance as a pill: "74%". Nothing when the engine gave none. */
export function Chance({ chance, big }: { chance: number | undefined; big?: boolean }) {
  if (chance === undefined) return null;
  const tone = chance >= 0.6 ? 'good' : chance >= 0.35 ? 'even' : 'bad';
  return <span className={`ww-chance ${tone}${big ? ' big' : ''}`} aria-label={`Chance ${percent(chance)}`}>{percent(chance)}</span>;
}

/** One line of how the roll works: dice, what is added, the number, the chance. */
export function OddsLine({ facts, input, brief }: { facts: RollFacts; input: GlueInput; /** leave out how pairing works: the roll panel says it in full */ brief?: boolean }) {
  const added = facts.parts.map((p) => partWords(p, facts, input));
  if (facts.pairing) {
    const p = facts.pairing;
    const sign = (n: number) => (n === 0 ? '' : n > 0 ? ` +${n}` : ` −${-n}`);
    return (
      <span className="ww-odds-line">
        {brief ? 'Four dice in two pairs. ' : 'Four dice make two pairs: the highest with the lowest, and the two middles. '}You take the <b>{p.youTake}</b> pair{sign(p.yourAdd)}; the other pair{sign(p.theirAdd)} goes to {p.theirName}.
        {p.riderDice > 0 ? ` ${p.riderDice === 1 ? 'A fifth die is' : `${p.riderDice} more dice are`} added to your side.` : ''}
        {' '}<span className="ww-odds-split">Win <Num>{percent(p.win)}</Num> · tie <Num>{percent(p.tie)}</Num> · lose <Num>{percent(p.lose)}</Num></span>
      </span>
    );
  }
  if (facts.target === undefined) return null;
  return (
    <span className="ww-odds-line">
      <Num>{facts.dice}</Num> dice{added.length ? `, adding ${added.join(' and ')}` : facts.bonus ? `, adding ${facts.bonus}` : ', nothing added'}.
      {' '}Need <b className="ww-num">{facts.target}</b>, so the dice must make <b className="ww-num">{Math.max(facts.diceNeed ?? 0, facts.dice)}</b> or more.
    </span>
  );
}

/** What passing and failing each do, in the engine's sentences. */
export function Stakes({ facts, brief }: { facts: RollFacts; /** the two outcomes only; the reasons and notes are on the roll panel */ brief?: boolean }) {
  if (facts.table) {
    return (
      <div className="ww-stakes">
        <ol className="ww-faces">{facts.table.map((t) => <li key={t.face}><Num>{t.face}</Num><span>{t.result}</span></li>)}</ol>
        {facts.onPass && <span className="ww-dim">{facts.onPass}</span>}
      </div>
    );
  }
  const win = facts.pairing ? 'Win' : 'Pass';
  const lose = facts.pairing ? 'Lose' : 'Fail';
  return (
    <div className="ww-stakes">
      {facts.onPass && <span className="ww-stake pass"><Lbl>{win}</Lbl><span>{facts.onPass}</span></span>}
      {facts.onFail && <span className="ww-stake fail"><Lbl>{lose}</Lbl><span>{facts.onFail}</span></span>}
      {!brief && facts.pairing && <span className="ww-dim" style={{ fontSize: 12 }}>{facts.pairing.why}</span>}
      {!brief && facts.notes.map((n) => <span key={n} className="ww-dim" style={{ fontSize: 12 }}>{n}</span>)}
    </div>
  );
}

/** A roll a choice would lead to, small: the chance and one line each way. For a row or an action card. */
export function RollBrief({ facts, input, label }: { facts: RollFacts; input: GlueInput; label?: string }) {
  return (
    <div className="ww-brief">
      <div className="ww-row between" style={{ gap: 10, alignItems: 'baseline' }}>
        <Lbl style={{ fontSize: 10, color: '#aab1d3' }}>{label ?? facts.name}</Lbl>
        <Chance chance={facts.chance} />
      </div>
      <OddsLine facts={facts} input={input} />
      <Stakes facts={facts} />
    </div>
  );
}

const OUTCOME: Record<LastRoll['outcome'], { word: string; cls: string }> = {
  pass: { word: 'PASSED', cls: 'good' }, fail: { word: 'FAILED', cls: 'bad' }, win: { word: 'WON', cls: 'good' }, lose: { word: 'LOST', cls: 'bad' }, tie: { word: 'TIE · ROLL AGAIN', cls: 'even' }, none: { word: '', cls: '' },
};

/** The last roll read back: the dice (in their pairs, for a pairing roll), the sum against the number, and how it went. */
export function LastRollDice({ last, seq }: { last: LastRoll; seq: number }) {
  const o = OUTCOME[last.outcome];
  const die = (v: number, i: number, cls: string) => <span key={`${cls}${i}`} className={`ww-die-wrap ${cls}`}><Die value={v} rollKey={seq} /></span>;
  let dice: ReactNode;
  let sum: ReactNode;
  if (last.pairs) {
    const p = last.pairs;
    dice = (
      <>
        <span className="ww-pair yours" aria-label={`Your pair: ${p.yours.join(' and ')}`}><Lbl>YOURS</Lbl><span className="ww-row" style={{ gap: 6 }}>{p.yours.map((v, i) => die(v, i, 'y'))}{p.rider.map((v, i) => die(v, i, 'r'))}</span></span>
        <span className="ww-pair theirs" aria-label={`Their pair: ${p.theirs.join(' and ')}`}><Lbl>THEIRS</Lbl><span className="ww-row" style={{ gap: 6 }}>{p.theirs.map((v, i) => die(v, i, 't'))}</span></span>
      </>
    );
    sum = <span className="ww-last-sum"><Num>{p.yourTotal}</Num> against <Num>{p.theirTotal}</Num></span>;
  } else {
    dice = <span className="ww-row" style={{ gap: 6 }}>{last.dice.map((v, i) => die(v, i, 'd'))}</span>;
    const raw = last.dice.reduce((a, b) => a + b, 0);
    sum = last.target !== null
      ? <span className="ww-last-sum"><Num>{raw}</Num>{last.bonus ? <> + <Num>{last.bonus}</Num> = <Num>{last.total}</Num></> : null} against <Num>{last.target}</Num></span>
      : last.dice.length > 1 ? <span className="ww-last-sum"><Num>{raw}</Num></span> : null;
  }
  return (
    <div className={`ww-last-roll ${o.cls}`} role="status" aria-label="The last roll">
      {dice}
      <span className="ww-col" style={{ gap: 2 }}>
        {sum}
        {o.word && <Lbl className="ww-last-word">{o.word}</Lbl>}
      </span>
    </div>
  );
}
