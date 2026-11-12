// The Fractured Fist table, drawn by the game (docs/design/fractured-fist-arcade,
// Table-Technique.dc.html and Table-Channel.dc.html): both fighters' plates
// at the top facing each other like a fighting game's health bars, their
// played row, the strike gutter, your played row, the action bar, and your
// hand, deck and discard under the play column. The supply goes to the top
// of the side column when the table has one.
//
// Nothing here decides anything. Every number is ff/read.ts's reading of the
// view, a tap sends a move the engine listed, and the buttons are the moves
// that move the turn, each present only while the engine lists it.
//
// On a phone (Phone-*.dc.html, build item 7) the same table stacks, smaller;
// the supply opens as a sheet from the action bar; and a tap on any card
// opens it up close, where a Play button sends the move the engine lists for
// it. That second tap is the one change in how you play on a phone: a small
// card is never played by mistake. A lit supply row still buys on its tap.

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CardZone, Track, type SelectEvent, type TrackData } from '@zekel/primitives';
import type { GameScreenProps, LegalMove, PromptAction, Zone } from '@zekel/glue-kit';
import { Sheet } from '@zekel/glue-kit';
import {
  artUrlFor, buyableCount, cardDefs, colorKeyFor, faceChips, fightOf, litPartsFor, moveForTap, STEP_NAMES, worthOf,
  type CardDef, type Fight, type Fighter,
} from './read.js';

/** A card zone drawn without its own label: the screen draws the heading.
 *  `inspectable` (the phone) lets every face-up card report a tap. */
function Cards({ zone, lit, onSelect, className, inspectable }: { zone: Zone; lit: string[]; onSelect: (e: SelectEvent) => void; className?: string; inspectable?: boolean }) {
  if (zone.kind !== 'card-zone') return null;
  return <CardZone id={zone.id} data={{ ...zone.data, label: undefined, inspectable }} lit={lit} onSelect={onSelect} arriveFrom={zone.arriveFrom} className={className} />;
}

/** A row of blocks, one per point: a track whose filled spaces are what is left. */
function blocks(count: number, of: number): TrackData {
  return { spaces: Array.from({ length: Math.max(0, of) }, (_, i) => ({ index: i + 1, filled: i < count })) };
}

function Plate({ f, side, big, small, showCounts, watching, lit, onSelect }: {
  f: Fighter; side: 'left' | 'right'; big: string; small?: string; showCounts: boolean; watching: boolean;
  lit: string[]; onSelect: (e: SelectEvent) => void;
}) {
  const cap = f.misstepCap;
  const turn = f.active ? (f.self ? 'Your turn' : watching ? 'On turn' : 'Their turn') : null;
  return (
    <section
      className={`ff-plate ${side}${f.active ? ' active' : ''}`}
      aria-label={`${big}: stamina ${f.stamina} of ${f.maxStamina}; missteps ${f.missteps}${cap !== null ? ` of ${cap}` : ''}`}
    >
      <span className="ff-plate-badge" aria-hidden="true"><span>{big.slice(0, 1)}</span></span>
      {showCounts && (
        // Their discard is public: its top card, where their cards land.
        <div className="ff-plate-discard" title={`Discard: ${f.discardSize}`}>
          <Cards zone={f.zones.discard} lit={lit} onSelect={onSelect} />
        </div>
      )}
      <div className="ff-plate-body">
        <div className="ff-plate-head">
          <span className="ff-plate-name">{big}</span>
          {/* the stamina beside the name: where the phone's plate shows it */}
          <span className="ff-plate-stam-inline" aria-hidden="true"><b>{f.stamina}</b>/{f.maxStamina}</span>
          {small && <span className="ff-plate-sub">{small}</span>}
          {turn && <span className="ff-tag"><span>{turn}</span></span>}
          {showCounts && (
            <span className="ff-plate-counts">
              <span data-flip-id={f.zones.hand.id}>Hand {f.handSize}</span>
              <span data-flip-id={f.zones.deck.id}>Deck {f.deckSize}</span>
              <span>Discard {f.discardSize}</span>
            </span>
          )}
        </div>
        <Track id={`ff:stamina:${f.pid}`} data={blocks(f.stamina, f.maxStamina)} className="ff-blocks" />
        <div className="ff-missteps">
          <span className="ff-kicker">Missteps</span>
          {cap !== null && <Track id={`ff:missteps:${f.pid}`} data={blocks(f.missteps, cap)} className="ff-ticks" />}
          <b>{f.missteps}{cap !== null ? ` / ${cap}` : ''}</b>
        </div>
      </div>
      <div className="ff-plate-stam" aria-hidden="true"><b>{f.stamina}</b><span>/{f.maxStamina}</span></div>
    </section>
  );
}

function Hit({ from, to, name, dir, phone }: { from: Fighter; to: Fighter; name: (f: Fighter) => string; dir: 'down' | 'up'; phone: boolean }) {
  const who = name(from);
  const whom = name(to);
  const verb = who === 'You' ? 'hit' : 'hits';
  return (
    <div className="ff-hit" aria-label={`${who} ${verb} ${whom === 'You' ? 'you' : whom}: ${from.damageQueued} damage against ${to.defenseQueued} defense`}>
      <span className={`ff-hit-arrow ${dir}`} aria-hidden="true" />
      <span className="ff-hit-who">{who} {verb} {whom === 'You' ? 'you' : whom}</span>
      {/* A phone has room for the short words only; the label above says it in full. */}
      <span className="ff-chip damage"><span><b>{from.damageQueued}</b>{phone ? ' dmg' : ' damage'}</span></span>
      <span className="ff-vs-small" aria-hidden="true">vs</span>
      <span className="ff-chip defense"><span><b>{to.defenseQueued}</b>{phone ? ' def' : ' defense'}</span></span>
    </div>
  );
}

function Row({ title, zone, count, lit, onSelect, phone }: { title: string; zone: Zone; count: number; lit: string[]; onSelect: (e: SelectEvent) => void; phone: boolean }) {
  return (
    <section className="ff-row" aria-label={`${title}: ${count}`}>
      <h3 className="ff-row-head">
        {title}<span className="ff-count"><span>{count}</span></span>
        {phone && count > 0 && <span className="ff-row-hint">Tap a card to read it</span>}
      </h3>
      <Cards zone={zone} lit={lit} onSelect={onSelect} className="ff-row-cards" inspectable={phone} />
    </section>
  );
}

function ActionBar({ fight, onAction, onDraw, disabled, phone, supply }: {
  fight: Fight; onAction: (a: PromptAction) => void; onDraw?: () => void; disabled: boolean; phone: boolean;
  /** the phone's Supply button: how many stacks can be bought now (null off the Channel step), and how to open the sheet */
  supply?: { count: number | null; open: () => void };
}) {
  const { prompt, steps, counters } = fight;
  // The step tags already say which step it is; the title is shown only
  // when it says something else ("Remove 2 more cards", "No actions left").
  const plain = Object.values(STEP_NAMES).some((s) => prompt.title === `${s} step`);
  return (
    <div className={`ff-actionbar${prompt.actions.length ? ' live' : ''}${prompt.urgent ? ' urgent' : ''}`} role="region" aria-label="Your turn">
      <div className="ff-steps">
        <span className="ff-kicker">Step</span>
        <div className="ff-steps-tags" aria-label="Steps">
          {steps.map((s) => (
            <span key={s.id} className={`ff-step${s.current ? ' current' : ''}`} aria-current={s.current ? 'step' : undefined}><span>{s.label}</span></span>
          ))}
        </div>
      </div>
      {counters.length > 0 && (
        <div className="ff-counters">
          {counters.map((c) => (
            <div key={c.label} className="ff-counter"><b>{c.value}</b><span>{c.label}</span></div>
          ))}
        </div>
      )}
      <div className="ff-words">
        {!plain && <b>{prompt.title}</b>}
        {prompt.sub && <span>{prompt.sub}</span>}
      </div>
      <div className="ff-buttons">
        {supply && (
          // Looking at the supply is never a move: this only opens the sheet, on turn or off.
          <button className="btn secondary ff-supply-btn" onClick={supply.open} aria-haspopup="dialog">
            Supply{supply.count !== null && <span className="note">{supply.count} to buy</span>}
          </button>
        )}
        {onDraw && <button className="btn" disabled={disabled} onClick={onDraw}>Draw</button>}
        {prompt.actions.map((a) => (
          <button key={a.id} className={`btn${a.primary ? '' : ' secondary'}`} disabled={disabled} title={a.title} aria-label={phone && a.short ? a.label : undefined} onClick={() => onAction(a)}>
            {phone ? a.short ?? a.label : a.label}{a.note && <span className="note">{a.note}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

function Bench({ me, lit, onSelect, refining, menu, phone }: { me: Fighter; lit: string[]; onSelect: (e: SelectEvent) => void; refining: boolean; menu?: ReactNode; phone: boolean }) {
  const hand = me.zones.hand;
  const anyLit = hand.kind === 'card-zone' && (hand.data.cards ?? []).some((c) => c.id && lit.includes(c.id));
  const hint = phone
    ? (refining ? 'Tap one to look, then remove it' : anyLit ? 'Tap a lit card to look, then play it' : null)
    : (refining ? 'Pick one to remove' : anyLit ? 'Lit cards can be played now' : null);
  return (
    <div className="ff-bench">
      {/* The numbered menu: every listed move, for the keyboard. A phone has none. */}
      {!phone && <div className="ff-menu">{menu}</div>}
      <section
        className={`ff-hand${anyLit ? ' has-lit' : ''}`}
        aria-label={`Your hand: ${me.handSize}`}
        // How many cards share the fan's width on a phone (ff.css works out the overlap).
        style={phone ? ({ '--ff-fan-n': Math.max(2, me.handSize) } as CSSProperties) : undefined}
      >
        <div className="ff-bench-label">
          <span>Your hand · {me.handSize}</span>
          {hint && <span className="ff-hint">{hint}</span>}
        </div>
        <Cards zone={hand} lit={lit} onSelect={onSelect} inspectable={phone} />
      </section>
      <div className="ff-piles">
        <figure className="ff-pile">
          <Cards zone={me.zones.deck} lit={lit} onSelect={onSelect} />
          <figcaption>Deck · {me.deckSize}</figcaption>
        </figure>
        <figure className="ff-pile">
          <Cards zone={me.zones.discard} lit={lit} onSelect={onSelect} inspectable={phone} />
          <figcaption>Discard · {me.discardSize}</figcaption>
        </figure>
      </div>
    </div>
  );
}

/**
 * The card as printed (the print-and-play sheet): the cost in a coloured
 * corner and again, turned round, in the opposite one; the scene twice, the
 * second copy turned 180° so it reads from either side of the table; and
 * what it does in words. Every number is the reference data's.
 */
function PrintedCard({ cardId, def }: { cardId: string; def: CardDef | undefined }) {
  const name = def?.name ?? cardId;
  const cost = def && def.type !== 'MISSTEP' ? def.cost : undefined;
  const worth = worthOf(def);
  const words = worth !== undefined ? String(worth) : faceChips(def).map((c) => c.toLowerCase()).join(', ');
  const art = artUrlFor(cardId);
  return (
    <div className={`ff-printed${worth !== undefined ? ' worth' : ''}`} data-color-key={colorKeyFor(def) ?? 'technique'} aria-hidden="true">
      <span className="ff-printed-corner tl">{cost ?? ''}</span>
      <span className="ff-printed-corner br">{cost ?? ''}</span>
      {words && <span className="ff-printed-fx tl">{words}</span>}
      {words && <span className="ff-printed-fx br">{words}</span>}
      <div className="ff-printed-panel">
        <b className="ff-printed-name">{name}</b>
        <div className="ff-printed-art">
          {art && <img src={art} alt="" />}
          {art && <img src={art} alt="" className="turned" />}
        </div>
        <b className="ff-printed-name turned">{name}</b>
      </div>
    </div>
  );
}

/** A card up close (Phone-Card.dc.html): the printed face, its chips and its
 *  words, and a Play button only when the engine lists a move for it. */
function CardSheet({ cardId, where, def, move, disabled, onSend, onClose }: {
  cardId: string; where: string; def: CardDef | undefined; move: LegalMove | null; disabled: boolean;
  onSend: (m: LegalMove) => void; onClose: () => void;
}) {
  const name = def?.name ?? cardId;
  const refine = move?.move['type'] === 'refine_card';
  const status = move ? `${where} · can be ${refine ? 'removed' : 'played'} now` : where;
  const chips = faceChips(def);
  return (
    <Sheet
      title={name}
      className="ff-sheet ff-card-sheet"
      onClose={onClose}
      heading={<div className="ff-sheet-head"><h2>{name}</h2><span className="ff-sheet-status">{status}</span></div>}
    >
      <PrintedCard cardId={cardId} def={def} />
      {chips.length > 0 && <div className="ff-card-chips">{chips.map((c) => <span key={c} className="zk-card-badge">{c}</span>)}</div>}
      {def?.description && <p className="ff-card-words">{def.description}</p>}
      <div className="ff-sheet-buttons">
        <button className="btn secondary" onClick={onClose}>Close</button>
        {move && <button className="btn" disabled={disabled} onClick={() => onSend(move)}>{refine ? 'Remove' : 'Play'} {name}</button>}
      </div>
    </Sheet>
  );
}

export function FfScreen(props: GameScreenProps) {
  const { input, yourTurn, busy, interactive, onMove, onBatch, onDraw, nameFor, menu, sideSlot } = props;
  const phone = !!props.phone;
  const fight = useMemo(() => fightOf(input), [input]);
  const defs = useMemo(() => cardDefs(input.reference), [input.reference]);
  const lit = useMemo(() => (interactive && yourTurn ? litPartsFor(input) : []), [input, interactive, yourTurn]);
  /** the phone's sheets: a card up close (its part id), and the supply */
  const [looking, setLooking] = useState<string | null>(null);
  const [supplyOpen, setSupplyOpen] = useState(false);
  useEffect(() => { if (!phone) { setLooking(null); setSupplyOpen(false); } }, [phone]);
  if (!fight) return null;

  const pressable = interactive && yourTurn && !busy;
  const onSelect = (sel: SelectEvent) => {
    // On a phone a card opens up close first; only a lit supply row buys on
    // its tap, as on a desktop.
    if (phone && !(lit.includes(sel.id) && sel.id.includes(':supply:'))) {
      if (fight.cards[sel.id]) setLooking(sel.id);
      return;
    }
    if (!pressable) return;
    const move = moveForTap(sel, input);
    if (move) onMove(move);
  };
  const onAction = (a: PromptAction) => {
    if (!pressable) return;
    if ('move' in a) onMove(a.move);
    else if ('batch' in a) onBatch?.(a.batch);
    else if ('moves' in a && a.moves.length === 1) onMove(a.moves[0]!);
  };
  const watching = input.playerId === null;
  // The big name is the side ("You", "Opponent"); a seat's display name sits
  // beside it. A watcher sees both seats by name.
  const big = (f: Fighter) => (watching ? nameFor(f.pid) : f.who);
  const small = (f: Fighter) => (watching ? undefined : nameFor(f.pid));
  const { left, right, me } = fight;
  const refining = !!me && fight.counters.some((c) => c.label === 'Refines');

  // In the Channel step the stacks you can buy are lit and the rest dim;
  // the outline is the cue, and the opponent's counts are never pressable.
  const buying = !!me && me.active && fight.phase === 'channel' && interactive && yourTurn;
  const supplyList = fight.supply.kind === 'card-zone' && (
    <CardZone id={fight.supply.id} data={{ ...fight.supply.data, inspectable: phone }} lit={lit} onSelect={onSelect} className="ff-supply-list" />
  );
  const supply = (
    <section className={`ff-supply${buying ? ' buying' : ''}`} aria-label="Supply">
      <h3 className="ff-supply-title">Supply</h3>
      {supplyList}
    </section>
  );
  // On a phone with a seat the supply is a sheet the action bar opens; with
  // no seat there is no action bar, so it stays in the stack.
  const supplyAsSheet = phone && !!me;
  const spot = looking ? fight.cards[looking] : undefined;
  // The Play button is the move the engine lists for that card, found the
  // same way a tap on a lit card finds it; no listed move, no button.
  const lookMove = looking && spot && interactive && yourTurn ? moveForTap({ component: 'card', id: looking, label: spot.cardId }, input) : null;
  const counts = (f: Fighter) => `${big(f)} · Hand ${f.handSize} · Deck ${f.deckSize} · Discard ${f.discardSize}`;

  return (
    <div className={`ff-screen${phone ? ' phone' : ''}`}>
      <div className="ff-versus">
        <Plate f={left} side="left" big={big(left)} small={small(left)} showCounts={!left.self} watching={watching} lit={lit} onSelect={onSelect} />
        <span className="ff-vs" aria-hidden="true"><span>VS</span></span>
        <Plate f={right} side="right" big={big(right)} small={small(right)} showCounts={!right.self} watching={watching} lit={lit} onSelect={onSelect} />
      </div>
      {/* The phone's plates are too small for the public counts: they sit on one line under them. */}
      {phone && <p className="ff-phone-counts">{[left, right].filter((f) => !f.self).map(counts).join('  ·  ')}</p>}
      <Row title={big(right) === 'Opponent' ? 'Their played cards' : `${big(right)}'s played cards`} zone={right.zones.played} count={cardCount(right.zones.played)} lit={lit} onSelect={onSelect} phone={phone} />
      <section className="ff-gutter" aria-label="The strike, at the end of the round">
        <Hit from={right} to={left} name={big} dir="down" phone={phone} />
        <div className="ff-strike-note"><span className="ff-burst" aria-hidden="true" /><b>Strike</b><span>Both land at round end</span></div>
        <Hit from={left} to={right} name={big} dir="up" phone={phone} />
      </section>
      <Row title={left.self ? 'Your played cards' : `${big(left)}'s played cards`} zone={left.zones.played} count={cardCount(left.zones.played)} lit={lit} onSelect={onSelect} phone={phone} />
      {!supplyAsSheet && !sideSlot && supply}
      {!supplyAsSheet && sideSlot && createPortal(supply, sideSlot)}
      {me && (
        <ActionBar
          fight={fight} onAction={onAction} onDraw={onDraw} disabled={!pressable} phone={phone}
          supply={supplyAsSheet ? { count: buying ? buyableCount(input) : null, open: () => setSupplyOpen(true) } : undefined}
        />
      )}
      {me && <Bench me={me} lit={lit} onSelect={onSelect} refining={refining} menu={menu} phone={phone} />}
      {supplyAsSheet && supplyOpen && (
        <Sheet
          title="Supply"
          className={`ff-sheet ff-supply-sheet${buying ? ' buying' : ''}`}
          onClose={() => setSupplyOpen(false)}
          heading={(
            <div className="ff-sheet-head">
              <h2>Supply</h2>
              {buying && fight.counters.map((c) => <span key={c.label} className="ff-tag"><span><b>{c.value}</b> {c.label}</span></span>)}
            </div>
          )}
        >
          {supplyList}
        </Sheet>
      )}
      {phone && looking && spot && (
        <CardSheet
          cardId={spot.cardId} where={spot.where} def={defs.get(spot.cardId)} move={lookMove} disabled={!pressable}
          onSend={(m) => { setLooking(null); onMove(m); }}
          onClose={() => setLooking(null)}
        />
      )}
    </div>
  );
}

function cardCount(zone: Zone): number {
  return zone.kind === 'card-zone' ? zone.data.cards?.length ?? zone.data.countOnly ?? 0 : 0;
}
