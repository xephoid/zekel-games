// Your hand as candy-wrapper cards (build item 5): a bar in the card's color
// with crimped ends and a cream label naming the action and who it helps
// most; treat cards are pink with the treat's picture; a double card carries
// a dark "×2". Picking a card lifts it; once a card is played the rest dim.
// Beside "Your hand": your Intel tokens, the deck and discard counts, your
// secret goal and the trade-in button, all read from the view and the
// engine's listed moves.

import { useState } from 'react';
import { MoveFormSheet, Sheet } from '@zekel/glue-kit';
import { asArr, asStr, isObj, words } from '@zekel/glue-kit';
import type { GlueInput, LegalMove, MoveForm } from '@zekel/glue-kit';
import { COLOR_ACTION, cap, isColor } from './colors.js';
import { TREAT_ART, treatName, type SlCard, type SlTable } from './read.js';

const TOP_CRIMP = 'M0 12 L0 9 L7 0 L14 9 L21 0 L28 9 L35 0 L42 9 L49 0 L56 9 L63 0 L70 9 L77 0 L84 9 L91 0 L98 9 L105 0 L112 9 L112 12 Z';
const BOTTOM_CRIMP = 'M0 0 L0 3 L7 12 L14 3 L21 12 L28 3 L35 12 L42 3 L49 12 L56 3 L63 12 L70 3 L77 12 L84 3 L91 12 L98 3 L105 12 L112 3 L112 0 Z';

/** Two copies of the same card are the same card to the engine, which lists one. */
export function cardKey(c: { kind: string; color?: string; treat?: string }): string {
  return c.kind === 'treat' ? `treat:${c.treat}` : `${c.kind}:${c.color}`;
}

/** The engine's listed play_intel moves that a card in the hand stands for. */
export function movesForCard(input: GlueInput, hand: SlCard[], cardId: string): LegalMove[] {
  const card = hand.find((c) => c.cardId === cardId);
  if (!card) return [];
  const key = cardKey(card);
  const same = new Set(hand.filter((c) => cardKey(c) === key).map((c) => c.cardId));
  return input.legalMoves.filter((m) => m.move['type'] === 'play_intel' && same.has(asStr(m.move['cardId'])));
}

export function cardLabel(c: SlCard): string {
  if (c.kind === 'treat') return `${treatName(c.treat)} treat card`;
  const action = isColor(c.color) ? COLOR_ACTION[c.color].name : words(c.color);
  return `${cap(c.color)}${c.kind === 'double' ? ' double' : ''} card: ${action}`;
}

function WrapperCard({ c, picked, playable, dim, disabled, onPick }: { c: SlCard; picked: boolean; playable: boolean; dim: boolean; disabled: boolean; onPick(): void }) {
  const treat = c.kind === 'treat';
  const fill = treat ? '#ffd6e6' : `var(--zekel-c-${c.color})`;
  const name = treat ? treatName(c.treat) : isColor(c.color) ? COLOR_ACTION[c.color].name : words(c.color);
  const line = treat ? 'Treat card' : c.kind === 'double' ? 'Twice, same piece' : isColor(c.color) ? COLOR_ACTION[c.color].best : '';
  return (
    <button
      type="button" className={`sl-card${picked ? ' picked' : ''}${playable ? ' playable' : ''}${dim ? ' dim' : ''}${treat ? ' treat' : ''}`}
      aria-pressed={picked} aria-label={cardLabel(c)} disabled={disabled} onClick={onPick}
      data-flip-id={`sl:card:${c.cardId}`} data-flip-from="sl:intel-deck"
    >
      <svg className="sl-crimp top" width="100%" height="12" viewBox="0 0 112 12" preserveAspectRatio="none" aria-hidden="true"><path d={TOP_CRIMP} fill={fill} stroke="#5a3214" strokeWidth="1.6" strokeLinejoin="round" /></svg>
      <span className="sl-card-body" style={{ backgroundColor: fill }}>
        {treat && TREAT_ART[c.treat] && <span className="sl-card-plate"><img src={TREAT_ART[c.treat]} alt="" width={26} height={26} /></span>}
        <span className="sl-card-label">
          <span className="sl-card-name">{name}</span>
          <span className="sl-card-line">{line}</span>
        </span>
      </span>
      <svg className="sl-crimp bottom" width="100%" height="12" viewBox="0 0 112 12" preserveAspectRatio="none" aria-hidden="true"><path d={BOTTOM_CRIMP} fill={fill} stroke="#5a3214" strokeWidth="1.6" strokeLinejoin="round" /></svg>
      {c.kind === 'double' && <span className="sl-double" aria-hidden="true">×2</span>}
    </button>
  );
}

interface HandProps {
  table: SlTable;
  /** the card this seat last played: it flies from the hand onto the discard pile */
  discardTop?: SlCard | null;
  input: GlueInput;
  picked: string | null;
  onPick(cardId: string | null): void;
  /** a card may be picked now (your play step, nothing in flight) */
  pressable: boolean;
  formFor(move: LegalMove): MoveForm | null;
  onForm(template: LegalMove, move: Record<string, unknown>, editableKeys: string[]): void;
}

function secretWords(input: GlueInput, id: string): { name: string; text: string } {
  const rd = input.reference?.referenceData;
  const def = isObj(rd) ? asArr(rd['secret_objectives']).find((o) => isObj(o) && o['id'] === id) : undefined;
  return { name: words(id), text: isObj(def) ? asStr(def['description']) : '' };
}

export function Hand({ table, input, picked, onPick, pressable, formFor, onForm, discardTop }: HandProps) {
  const hand = table.hand ?? [];
  const playing = table.step === 'play';
  // Step 4 comes after the card: the rest of the hand dims until your next turn.
  const played = table.step === 'influence';
  const trades = input.legalMoves.filter((m) => m.move['type'] === 'discard_for_color');
  const need = trades[0] ? asArr(trades[0].move['cardIds']).length : 0;
  const [trading, setTrading] = useState(false);
  const [tradeMove, setTradeMove] = useState<LegalMove | null>(null);
  const tradeForm = tradeMove ? formFor(tradeMove) : null;
  const hint = !playing ? (table.step ? 'Cards are played in step 3.' : '') : picked ? 'Click the card again to put it back.' : 'Click a card to see where it can take each of your pieces.';

  return (
    <section className="sl-hand sl-panel" aria-label="Your hand">
      <div className="sl-hand-head">
        <h2 className="sl-h">Your hand</h2>
        <span className="sl-hint">{hint}</span>
        <span className="sl-hand-fill" />
        {table.me?.tokens.map((t) => (
          <span key={t} className="sl-token-chip" title={`${cap(t)} Intel token: play it once as a ${t} card`}>
            <span className={`sl-token-dot sl-c-${t}`} />{cap(t)} Intel token
          </span>
        ))}
        <span className="sl-counts">
          <span data-flip-id="sl:intel-deck">Deck {table.deckCount}</span> ·{' '}
          <span className="sl-discard" data-flip-id="sl:intel-discard">
            {discardTop && (
              <span
                key={discardTop.cardId} className="sl-discard-top" aria-hidden="true"
                style={{ backgroundColor: discardTop.kind === 'treat' ? '#ffd6e6' : `var(--zekel-c-${discardTop.color})` }}
                data-flip-id={`sl:discard-top:${discardTop.cardId}`} data-flip-from={`sl:card:${discardTop.cardId}`} data-flip-ghost=""
              />
            )}
            Discard {table.discardCount}
          </span>
        </span>
        {trades.length > 0 && (
          <button type="button" className="sl-quiet-btn" disabled={!pressable} onClick={() => setTrading(true)}>
            Trade {need} cards for one color
          </button>
        )}
      </div>
      {hand.length === 0 ? (
        <p className="sl-hint sl-hand-empty">{table.hand ? 'No cards in your hand.' : 'Watching: hands stay hidden.'}</p>
      ) : (
        <div className="sl-cards">
          {hand.map((c) => {
            const playable = playing && movesForCard(input, hand, c.cardId).length > 0;
            return (
              <WrapperCard
                key={c.cardId} c={c} picked={picked === c.cardId} playable={playable}
                dim={played} disabled={!pressable || !playable}
                onPick={() => onPick(picked === c.cardId ? null : c.cardId)}
              />
            );
          })}
        </div>
      )}
      {table.secrets.length > 0 && (
        <div className="sl-secrets">
          {table.secrets.map((s) => {
            const w = secretWords(input, s);
            return <span key={s} className="sl-secret" title={w.text || undefined}><b>Your secret goal:</b> {w.text || w.name}</span>;
          })}
        </div>
      )}
      {trading && !tradeMove && (
        <Sheet title={`Trade ${need} cards for one color`} onClose={() => setTrading(false)}>
          <p className="muted">Which color do you want? You pick the {need} cards to give up next.</p>
          <div className="sl-trade-colors">
            {trades.map((m) => {
              const color = asStr(m.move['color']);
              return (
                <button key={m.move_id} type="button" className="btn secondary" onClick={() => setTradeMove(m)}>
                  <span className={`sl-swatch sl-c-${color}`} /> {cap(color)}{isColor(color) ? ` · ${COLOR_ACTION[color].name}` : ''}
                </button>
              );
            })}
          </div>
        </Sheet>
      )}
      {tradeMove && tradeForm && (
        <MoveFormSheet
          form={tradeForm} disabled={!pressable}
          onSend={(move) => { onForm(tradeMove, move, tradeForm.editableKeys); setTradeMove(null); setTrading(false); }}
          onClose={() => { setTradeMove(null); setTrading(false); }}
        />
      )}
    </section>
  );
}
