// In space (Table-Space.dc.html, build item 5): the travel deck and the
// discard on the left of the middle, the drawn card beside them, and the
// choice it asks for. A hazard shows its two ways through as option cards,
// each with what the engine says it leads to: the roll with its chance and
// what failing costs, or, when nobody aboard has either ability, the price
// of failing it. Where more than one being could carry the roll, each is
// offered by name, because the carrier takes the consequence. The roll
// panel below rolls the chosen one. Between cards the panel offers the Draw.

import type { GlueInput, LegalMove } from '@zekel/glue-kit';
import { FAIL_TEXT, KIND, travelCard, type Fail } from '../cards.js';
import { previewOf, reasonFor } from '../facts.js';
import { Icon } from '../icons.js';
import { type WwTable } from '../read.js';
import { TravelCard } from '../TravelCard.js';
import { Lbl, Num } from '../ui.js';
import { Chance, OddsLine, Stakes } from './Facts.js';
import { RollPanel } from './RollPanel.js';

export interface PartProps {
  table: WwTable;
  input: GlueInput;
  pressable: boolean;
  onMove(m: LegalMove): void;
  onForm(template: LegalMove, move: Record<string, unknown>, editableKeys: string[]): void;
  onDraw?: () => void;
  phone?: boolean;
  /** the right column is drawn in the table's side column, not beside the part */
  sideOut?: boolean;
}

/** The deck and the discard as piles, with the last discard face up and small. */
export function Piles({ table, input }: { table: WwTable; input: GlueInput }) {
  // The live card is still the top of the discard in the engine's eyes;
  // while it is drawn large, the pile shows the card under it.
  const d = table.deck.discard;
  const top = table.cardIsLive ? d[d.length - 2] : d[d.length - 1];
  const topFace = top ? travelCard(top, input.reference) : null;
  return (
    <div className="ww-piles">
      <div className="ww-pile">
        <div className="ww-pile-stack" aria-label={`Travel deck, ${table.deck.draw} cards`}>
          <span /><span />
          <span className={`ww-pile-top${table.deck.draw === 0 ? ' empty' : ''}`}><Icon name="swirl" size={48} /></span>
        </div>
        <span>Travel deck · <Num>{table.deck.draw}</Num></span>
      </div>
      <div className="ww-pile">
        <div className={`ww-pile-small${topFace ? '' : ' none'}`} aria-label={`Discard, ${table.deck.discardCount} cards${top ? `, ${top} on top` : ''}`}>
          {topFace ? <TravelCard face={topFace} /> : null}
        </div>
        <span>Discard · <Num>{table.deck.discardCount}</Num></span>
      </div>
    </div>
  );
}

/** The hazard's two ways through, as the engine lists them. */
function HazardOptions({ table, input, pressable, onMove, onForm }: PartProps) {
  const p = table.pending;
  const face = table.card;
  if (!p || p.kind !== 'hazard_option' || !face) return null;
  const mustFail = p['must_fail'] === true;
  const moves = [1, 2].map((n) => input.legalMoves.find((m) => m.move_id === `hazard-option-${n}`));
  return (
    <div className="ww-options wide">
      <Lbl className="ww-dim">{mustFail ? 'NO ONE ABOARD HAS EITHER ABILITY · CHOOSE WHICH PRICE TO PAY' : 'CHOOSE A WAY THROUGH'}</Lbl>
      {(face.options ?? []).map((o, i) => {
        const m = moves[i];
        const pv = previewOf(m);
        const shut = m ? null : reasonFor(input.unavailable, 'choose_hazard_option', `option-${i + 1}`);
        const carriers = pv?.carriers ?? [];
        return (
          <div key={i} className={`ww-option box${m ? '' : ' shut'}`}>
            <span className="ww-option-head"><Lbl>OPTION {i + 1}</Lbl><span className="ww-option-big">{o.head}</span></span>
            {mustFail ? (
              <span style={{ fontSize: 14, lineHeight: 1.45 }}>{pv?.then ?? <>If it fails: <b>{o.fail ? FAIL_TEXT[o.fail as Fail] : o.tail}</b></>}</span>
            ) : pv?.roll ? (
              <>
                <div className="ww-row between" style={{ gap: 10 }}><span style={{ fontSize: 13 }}><OddsLine facts={pv.roll} input={input} /></span><Chance chance={pv.roll.chance} /></div>
                <Stakes facts={pv.roll} />
              </>
            ) : (
              <span style={{ fontSize: 13 }}>If it fails: <b>{o.fail ? FAIL_TEXT[o.fail as Fail] : o.tail}</b></span>
            )}
            {!m && <span className="ww-dim" style={{ fontSize: 13 }}>{shut ?? 'No one aboard has this ability.'}</span>}
            {m && carriers.length > 1 ? (
              <div className="ww-col" style={{ gap: 6 }}>
                <Lbl style={{ fontSize: 10, color: '#aab1d3' }}>WHOSE SCORE CARRIES IT? THEY TAKE WHAT FAILING COSTS</Lbl>
                {carriers.map((c) => (
                  <button key={c.name} type="button" className="ww-carrier" disabled={!pressable} onClick={() => onForm(m, { ...m.move, carrier: c.name }, ['carrier'])}>
                    <span style={{ flex: 1 }}><b>{c.title === 'you' ? 'You' : c.title}</b> · {c.roll.onFail}</span>
                    <Chance chance={c.roll.chance} />
                  </button>
                ))}
              </div>
            ) : m ? (
              <button type="button" className="ww-carrier go" disabled={!pressable} onClick={() => onMove(m)}>{mustFail ? 'Pay this price' : `Roll this way${pv?.roll?.carrier ? `, on ${pv.roll.carrier === 'you' ? 'your own score' : `${pv.roll.carrier}'s score`}` : ''}`}</button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function SpacePart(props: PartProps) {
  const { table, input, phone } = props;
  // A card stays large only while the table is still resolving it; after
  // that it is the top of the discard and the big space waits for the next.
  const face = table.cardIsLive ? table.card : null;
  const p = table.pending;
  const kind = face ? KIND[face.kind] : null;
  const arriving = p?.kind === 'roll' && table.rollFacts?.reason === 'mission_check';
  return (
    <div className="ww-main">
      <div className="ww-space-top">
        {!phone && <Piles table={table} input={input} />}
        {face ? (
          <div className="ww-live" style={{ '--ww-kind-glow': kind ? `color-mix(in srgb, ${kind.colour} 25%, transparent)` : undefined } as React.CSSProperties}>
            <TravelCard face={face} />
          </div>
        ) : arriving ? (
          <div className="ww-arrive">
            <span style={{ color: '#FFD700' }}><Icon name="idcard" size={56} /></span>
            <Lbl style={{ color: '#FFD700' }}>AT THE DESTINATION</Lbl>
            <span className="ww-h1" style={{ fontSize: 26 }}>{table.rollFacts?.subject ?? 'The job'}</span>
            <span className="ww-dim" style={{ fontSize: 13 }}>The job's check. The trip back follows either way.</span>
          </div>
        ) : (
          <div className="ww-pile-stack" aria-label="No card drawn yet"><span /><span /><span className="ww-pile-top empty"><Icon name="nightsky" size={60} /></span></div>
        )}
        <HazardOptions {...props} />
      </div>
      <RollPanel {...props} />
      {!p && table.phase === 'traveling' && <p className="ww-foot">The engine is between cards.</p>}
    </div>
  );
}
