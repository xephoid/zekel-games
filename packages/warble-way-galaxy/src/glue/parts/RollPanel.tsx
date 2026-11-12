// The roll panel every Warble Way board ends with (build item 5): what the
// dice must make, whose score carries it, the chance, what passing and
// failing each do, the eligible consumables as toggles beside Roll, and the
// Roll or Draw button. The numbers and the sentences are the engine's roll
// facts (../facts.ts); with an engine that sends none, the panel falls back
// to the pending's own numbers. The button presses the table's
// resolve_report; a toggle sends the listed use_item.

import { useEffect, useRef } from 'react';
import type { GlueInput, LegalMove } from '@zekel/glue-kit';
import { asArr, asNum, asStr, isObj } from '@zekel/glue-kit';
import { previewOf } from '../facts.js';
import { Icon } from '../icons.js';
import { statGroups, type WwTable } from '../read.js';
import { Lbl, Num, GoldButton, Token } from '../ui.js';
import { Chance, OddsLine, Stakes } from './Facts.js';

const REASON_WORDS: Record<string, string> = {
  recruit: 'Recruit', repair: 'Repair', reduce_unrest: 'Ease unrest', mission_check: 'Mission', hazard_check: 'Hazard', death_check: 'Death check',
  escape: 'Escape', hack: 'Hack', evade: 'Run silent', volley: 'Open fire', intimidate: 'Intimidate', unnamed_recruit: 'Work the docks', redline: 'Redline',
  space_combat: 'Fight', ground_combat: 'Boarding', item_d6: 'Cache', being_d6: 'Being',
};
const GROUND_WORDS: Record<string, string> = { boarding: 'Boarding', ruin_attack: 'Attack', ruin_defense: 'Defend' };

/** What a roll is for, in a word: the engine's reason, and for ground combat which kind. */
export function rollWord(p: { [k: string]: unknown } | null): string {
  if (!p) return '';
  const reason = asStr(p['reason']);
  const ground = isObj(p['context']) ? asStr(p['context']['ground']) : '';
  if (reason === 'ground_combat' && GROUND_WORDS[ground]) return GROUND_WORDS[ground]!;
  return REASON_WORDS[reason] ?? reason.replace(/_/g, ' ');
}

export interface RollPanelProps {
  table: WwTable;
  input: GlueInput;
  pressable: boolean;
  onMove(m: LegalMove): void;
  onDraw?: () => void;
  phone?: boolean;
  /** a line of the part's own about the roll, under the main words */
  note?: string;
}

export function abilityName(input: GlueInput, code: string): string {
  for (const g of statGroups(input.reference)) for (const a of g.abilities) if (a.code === code) return a.name;
  return code;
}

export function RollPanel({ table, input, pressable, onMove, onDraw, phone, note }: RollPanelProps) {
  const p = table.pending;
  // The panel is where the next press is: bring it into view when it appears
  // or changes, wherever on the board the choice that led here was made.
  const ref = useRef<HTMLElement | null>(null);
  const sig = p ? `${p.kind}:${asStr(p['reason'])}:${input.seq}` : '';
  useEffect(() => { if (sig) ref.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }); }, [sig]);
  if (!p) return null;
  const draw = input.legalMoves.find((m) => m.move['type'] === 'resolve_report');
  if (p.kind === 'card_draw') {
    return (
      <section ref={ref} className="ww-roll live" aria-label="Draw">
        <div className="ww-col" style={{ gap: 6 }}>
          <Lbl style={{ color: '#FFD700' }}>DRAW A CARD</Lbl>
          <span className="ww-roll-text">The next travel card. {table.journey[0] ? <>This leg has <b className="ww-num">{table.journey[0].cardsRemaining}</b> to go.</> : null}</span>
          {note && <span className="ww-dim" style={{ fontSize: 13 }}>{note}</span>}
        </div>
        <div className="ww-roll-row">
          <GoldButton big label="Draw" onClick={onDraw} disabled={!pressable || !draw || !onDraw}>DRAW</GoldButton>
        </div>
      </section>
    );
  }
  if (p.kind === 'sacrifice_offer') {
    const spend = input.legalMoves.find((m) => m.move_id === 'sacrifice-unnamed');
    const decline = input.legalMoves.find((m) => m.move_id === 'decline-sacrifice');
    const spendThen = previewOf(spend)?.then; const declineThen = previewOf(decline)?.then;
    return (
      <section ref={ref} className="ww-roll live" aria-label="The hazard failed">
        <div className="ww-col" style={{ gap: 8 }}>
          <Lbl style={{ color: '#ff9da1' }}>THE ROLL FAILED</Lbl>
          <span className="ww-roll-text">A red shirt can take it for you, or it lands{asStr(p['carrier_who']) === 'crew' ? ` on ${table.crew.find((c) => c.name === asStr(p['carrier_name']))?.title ?? asStr(p['carrier_name'])}` : ''}.</span>
          <div className="ww-stakes">
            {spendThen && <span className="ww-stake pass"><Lbl>Spend</Lbl><span>{spendThen}</span></span>}
            {declineThen && <span className="ww-stake fail"><Lbl>Let it land</Lbl><span>{declineThen}</span></span>}
          </div>
          <span className="ww-redshirt-note"><Token race="redshirt" size={18} />{table.unnamed} aboard</span>
        </div>
        <div className="ww-roll-row">
          <GoldButton onClick={() => spend && onMove(spend)} disabled={!pressable || !spend}>SPEND A RED SHIRT</GoldButton>
          <GoldButton quiet onClick={() => decline && onMove(decline)} disabled={!pressable || !decline}>LET IT LAND</GoldButton>
        </div>
      </section>
    );
  }
  if (p.kind !== 'roll') return null;
  const facts = table.rollFacts;
  const dice = asNum(p['dice_count'], 3);
  const declared = asArr(p['declared_items']).map((x) => asStr(x));
  const toggles = input.legalMoves.filter((m) => m.move['type'] === 'use_item');
  const declaredItems = table.items.filter((i) => declared.includes(i.id));
  const word = facts?.name ?? rollWord(p);
  const itemsBlock = (toggles.length > 0 || declaredItems.length > 0) && (
    <div className="ww-col" style={{ gap: 8 }}>
      {declaredItems.map((i) => (
        <label key={i.id} className="ww-toggle on"><input type="checkbox" checked readOnly /><span style={{ color: '#FFD700' }}><Icon name="drink" size={22} /></span><span>Using <b>{i.title}</b></span></label>
      ))}
      {toggles.map((m) => {
        const item = table.items.find((i) => i.name === asStr(m.move['item_name']));
        const after = previewOf(m)?.roll?.chance;
        return (
          <label key={m.move_id} className="ww-toggle">
            <input type="checkbox" checked={false} disabled={!pressable} onChange={() => onMove(m)} />
            <span style={{ color: '#FFD700' }}><Icon name="drink" size={22} /></span>
            <span>Use <b>{item?.title ?? asStr(m.move['item_name'])}</b> on this roll{after !== undefined ? <> · would make it <Chance chance={after} /></> : null}</span>
          </label>
        );
      })}
    </div>
  );
  const button = <GoldButton big label="Roll" onClick={onDraw} disabled={!pressable || !draw || !onDraw}>ROLL</GoldButton>;
  const slots = !phone && <div className="ww-dice-slots" aria-hidden="true">{Array.from({ length: dice }, (_, i) => <span key={i} />)}</div>;

  if (facts) {
    return (
      <section ref={ref} className="ww-roll live" aria-label="Roll">
        <div className="ww-row between" style={{ alignItems: 'flex-start', gap: 20, flexWrap: 'wrap' }}>
          <div className="ww-col" style={{ gap: 8, flex: 1, minWidth: 220 }}>
            <div className="ww-row between" style={{ gap: 12, alignItems: 'center' }}>
              <Lbl style={{ color: '#FFD700' }}>ROLL {dice} {dice === 1 ? 'DIE' : 'DICE'} · {word.toUpperCase()}{facts.subject ? ` · ${facts.subject.toUpperCase()}` : ''}</Lbl>
              <Chance chance={facts.chance} big />
            </div>
            <span className="ww-roll-text"><OddsLine facts={facts} input={input} /></span>
            <Stakes facts={facts} />
            {note && <span className="ww-dim" style={{ fontSize: 13 }}>{note}</span>}
          </div>
          {itemsBlock}
        </div>
        <div className="ww-roll-row">
          {slots}
          {button}
        </div>
      </section>
    );
  }

  // An engine that sends no roll facts: the pending's own numbers, and nothing worked out beyond the sum.
  const reason = asStr(p['reason']);
  const min = typeof p['min_roll'] === 'number' ? p['min_roll'] : null;
  const src = isObj(p['score_source']) ? p['score_source'] : {};
  const ability = asStr(src['ability']);
  const bonus = asNum(src['bonus']);
  const who = asStr(src['who']) === 'crew' ? asStr(src['crew_name']) : 'your own';
  const need = min !== null ? Math.max(0, min - bonus) : null;
  return (
    <section ref={ref} className="ww-roll live" aria-label="Roll">
      <div className="ww-row between" style={{ alignItems: 'flex-start', gap: 20, flexWrap: 'wrap' }}>
        <div className="ww-col" style={{ gap: 6, flex: 1, minWidth: 200 }}>
          <Lbl style={{ color: '#FFD700' }}>ROLL {dice} {dice === 1 ? 'DIE' : 'DICE'} · {word.toUpperCase()}</Lbl>
          <span className="ww-roll-text">
            {min !== null ? <>You need <b className="ww-num">{min}</b> or more</> : <>Roll and see</>}
            {ability ? <>, adding {who === 'your own' ? 'your own' : `${who}'s`} {abilityName(input, ability)} <b className="ww-num" style={{ color: '#ece8dc' }}>+{bonus}</b></> : null}
            {declaredItems.length > 0 && <> and {declaredItems.map((i) => i.title).join(', ')}</>}.
            {need !== null ? <> The dice need <b className="ww-num">{need}</b>.</> : null}
          </span>
          {note && <span className="ww-dim" style={{ fontSize: 13 }}>{note}</span>}
          {reason === 'hazard_check' && table.unnamed > 0 && (
            <span className="ww-redshirt-note"><Token race="redshirt" size={18} />If it fails, you may spend a red shirt ({table.unnamed} aboard) to count it as survived.</span>
          )}
        </div>
        {itemsBlock}
      </div>
      <div className="ww-roll-row">
        {slots}
        <Num className="ww-dim" style={{ fontSize: 12 }}>{dice}d6{bonus ? ` + ${bonus}` : ''}</Num>
        {button}
      </div>
    </section>
  );
}
