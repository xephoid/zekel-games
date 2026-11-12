// The Adventurer Olympics table, drawn by the game (docs/design/adventurer-olympics,
// Main.dc.html): the deck strip across the top, the map with its legend and
// zoom, the panels that float over the map (a test, exploring, "Any rune",
// the roll for turn order, setup), your board along the bottom, and turn
// order, the other seats and the quests at the top of the side column.
//
// Nothing here decides anything. Every number is read from the view
// (read.ts); a tap sends a move the engine listed through onMove; Draw and
// Roll are onDraw, present only while the engine lists the button; exploring
// is put together on screen (a slot, a turn) and sent with Place as the one
// listed move for that slot and turn.

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CardZone, Map as MapPart, type CardData, type SelectEvent } from '@zekel/primitives';
import type { GameScreenProps, GlueInput, LegalMove } from '@zekel/glue-kit';
import { asArr, asNum, asStr, isObj } from '@zekel/glue-kit';
import { iconUrl } from './icons.js';
import {
  ADVENTURERS, COMPANION_ART, DECKS, DUNGEON_CARD, ICON, LAND, MONSTER_ART,
  adventurerOf, cardFor, hexOf, litFor, mapNodes, movesForHex, pendingOf, placeMove, placementOf,
  players, questNames, refCards, slotForTap, tint, typeOf, type Player,
} from './read.js';
import './ao-screen.css';

const STAT = {
  charisma: { name: 'Charisma', icon: 'cha', bg: '#ffd6e0' },
  strength: { name: 'Strength', icon: 'str', bg: '#ffe0b8' },
  movement: { name: 'Movement', icon: 'mov', bg: '#d6ecff' },
} as const;
const LEGEND = [['city', 'City'], ['dungeon', 'Dungeon'], ['little', 'Little Monster'], ['big', 'Big Monster'], ['spades', 'Rune'], ['star', 'Star rune']] as const;
const RUNES = ['hearts', 'spades', 'diamonds', 'clubs', 'star'] as const;
const DECK_COLOUR: Record<string, string> = { companion: '#5aa9e6', dungeon: '#9d8fc2', little: '#8fd14f', big: '#ff7a59' };
const ZOOMS = [1, 1.35, 1.8, 2.4];
/** How long "how the test went" stays up after the roll lands. */
export const RESULT_MS = 2500;

function Icon({ name, size, tint: colour, title }: { name: string; size: number; tint?: string; title?: string }) {
  const src = iconUrl(name, { tint: colour, wobble: size >= 26 });
  return src ? <img className="ao-icon" src={src} width={size} height={size} alt={title ?? ''} title={title} /> : null;
}

const find = (moves: LegalMove[], pred: (m: LegalMove) => boolean) => moves.find(pred) ?? null;

// ---- the deck strip ------------------------------------------------------------

function DeckStrip({ view, all }: { view: Record<string, unknown>; all: Player[] }) {
  const decks = isObj(view['decks']) ? view['decks'] : {};
  const holder = (a: string) => all.find((p) => p.artifacts.includes(a));
  return (
    <div className="ao-strip">
      {DECKS.map((d) => (
        <div key={d.key} className="ao-deck" title={`${d.label} deck`}>
          <div className="ao-deck-pile" data-flip-id={`ao:deck:${d.key}`} style={{ ['--deck' as string]: DECK_COLOUR[d.key] }}>
            <span /><span />
            <span className="top"><Icon name={d.art} size={34} /></span>
          </div>
          <div className="ao-count"><div className="label">{d.key === 'little' ? 'Little' : d.key === 'big' ? 'Big' : d.label}</div><div className="n">{asNum(decks[d.key])}</div></div>
        </div>
      ))}
      <span className="ao-rule" />
      <div className="ao-deck" title="Map tiles still face down">
        <div className="ao-tilestack" data-flip-id="ao:deck:tile"><span /><span /><span className="top">?</span></div>
        <div className="ao-count"><div className="label">Map tiles</div><div className="n">{asNum(decks['tileStack'])}</div></div>
      </div>
      <span className="ao-rule" />
      <div className="ao-runes">
        <div className="label">Runes</div>
        <div className="row">
          {RUNES.map((a) => {
            const h = holder(a);
            return (
              <div key={a} className="ao-rune-chip" title={`${ICON[a]?.name ?? a} · ${h ? `held by ${h.name}` : 'in the supply'}`}>
                <Icon name={a} size={32} />
                <span className="who"><span className="dot" style={{ background: h ? tint(h.colour) : 'transparent' }} />{h ? h.name : 'Free'}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ---- a card as the canvas draws it ---------------------------------------------------

function chipsOf(view: Record<string, unknown>, cardId: string): Array<{ icon: string; v: number; bg: string }> {
  const c = refCards(view, 'companions').find((x) => x.id === cardId);
  if (!c) return [];
  return (Object.keys(STAT) as Array<keyof typeof STAT>).filter((k) => c.bonus[k]).map((k) => ({ icon: STAT[k].icon, v: c.bonus[k]!, bg: STAT[k].bg }));
}

function MiniCard({ view, cardId, tilt = 0 }: { view: Record<string, unknown>; cardId: string; tilt?: number }) {
  const c = cardFor(view, cardId);
  const art = companionOrMonsterArt(cardId, view);
  return (
    <div className="ao-mini-card" data-flip-id={c.id} title={`${c.label}${c.subtitle ? ` · ${c.subtitle}` : ''}`} style={{ transform: `rotate(${tilt}deg)` }}>
      <div className="band" style={{ background: c.colorKey === 'companion' ? '#5aa9e6' : c.colorKey === 'big' ? '#ff7a59' : '#8fd14f' }} />
      {art && <Icon name={art} size={46} />}
      <div className="name">{c.label}</div>
      <div className="chips">{chipsOf(view, cardId).map((ch) => <span key={ch.icon} className="ao-chip" style={{ background: ch.bg }}><Icon name={ch.icon} size={11} />+{ch.v}</span>)}</div>
    </div>
  );
}

function companionOrMonsterArt(cardId: string, view: Record<string, unknown>): string | null {
  if (cardId.startsWith('companion-')) return COMPANION_ART[Number(cardId.replace(/\D+/g, ''))]?.[0] ?? null;
  for (const key of ['littleMonsters', 'bigMonsters']) {
    const m = refCards(view, key).find((c) => c.id === cardId);
    if (m) return MONSTER_ART[m.number]?.[0] ?? null;
  }
  return null;
}

/** The drawn card, big, flown from its deck (a card zone, so the flight is the table's). */
function DrawnCard({ view, cardId, from }: { view: Record<string, unknown>; cardId: string; from: string }) {
  const c: CardData = cardFor(view, cardId);
  return <CardZone id="ao:drawn" data={{ mode: 'row', cards: [c] }} arriveFrom={from} className="ao-drawn" />;
}

function Dice({ dice, total, good }: { dice: number[]; total: number; good: boolean | null }) {
  const PIPS: Record<number, number[]> = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
  return (
    <div className="ao-dice" aria-label={`Rolled ${dice.join(' + ')} = ${total}`}>
      {dice.map((d, i) => (
        <div key={i} className="ao-die">{Array.from({ length: 9 }, (_, k) => <span key={k}><i className={PIPS[d]?.includes(k) ? 'on' : ''} /></span>)}</div>
      ))}
      <div className={`ao-total${good === true ? ' good' : good === false ? ' bad' : ''}`}>= {total}</div>
    </div>
  );
}

// ---- the panels over the map --------------------------------------------------------------

const DECK_OF: Record<string, string> = { recruit: 'companion', little: 'little', big: 'big' };

function TestPanel({ view, previous, all, mine, meId, onDraw, showResult }: {
  view: Record<string, unknown>; previous: unknown; all: Player[]; mine: boolean; meId: string | null; onDraw?: () => void;
  showResult: boolean;
}): ReactNode {
  const p = pendingOf(view);
  const who = (id: string) => all.find((x) => x.id === id);
  const res = isObj(view['dungeonResolving']) ? view['dungeonResolving'] : null;
  const dungeonCard = res ? DUNGEON_CARD[asStr(res['kind'])] : null;
  // Just after a roll: the card that was tested, the dice, and how it went.
  const before = isObj(previous) ? pendingOf(previous) : null;
  const last = isObj(view['lastRoll']) ? view['lastRoll'] : null;
  if (showResult && (!p || (p.kind !== 'draw' && p.kind !== 'roll')) && before?.kind === 'roll' && before.payload['rollKind'] === 'test' && last) {
    const cardId = asStr(before.payload['cardId']);
    const tester = who(before.seat);
    const kept = !!tester && [...tester.companions, ...tester.little, ...tester.big].includes(cardId);
    const dice = asArr(last['dice']).map((d) => asNum(d));
    return (
      <section className="ao-panel ao-test result" aria-label="How the test went">
        <header><Icon name={ICON[asStr(before.payload['test']) === 'recruit' ? 'city' : asStr(before.payload['test']) === 'big' ? 'big_monster' : 'little_monster']?.art ?? 'city'} size={40} /><h3>{kept ? 'Success!' : 'Not enough'}</h3></header>
        <div className="body">
          <MiniCard view={view} cardId={cardId} />
          <div className="words">
            <p>{kept
              ? `${tester?.id === meId ? 'You keep' : `${tester?.name ?? 'They'} keeps`} ${cardFor(view, cardId).label}.`
              : `${cardFor(view, cardId).label} goes to the bottom of its deck.`}</p>
            {dice.length > 0 && <Dice dice={dice} total={asNum(last['total'])} good={kept} />}
          </div>
        </div>
      </section>
    );
  }
  if (!p) return null;
  const tester = who(p.seat);
  if (p.kind === 'draw' && asStr(p.payload['deck']) !== 'tile') {
    const deck = asStr(p.payload['deck']);
    const titles: Record<string, [string, string]> = {
      companion: ['city', 'City · make a friend'], little: ['little', 'Little Monster · fight!'],
      big: ['big', 'Big Monster · fight!'], dungeon: ['dungeon', 'Dungeon'],
    };
    const [icon, title] = titles[deck] ?? ['city', 'Draw'];
    return (
      <section className="ao-panel ao-test" aria-label="The test">
        <header><Icon name={p.payload['dungeon'] ? 'dungeon' : icon} size={40} /><h3>{p.payload['dungeon'] ? `Dungeon · ${dungeonCard ?? ''}` : title}</h3></header>
        <div className="body">
          <div className="ao-card-slot">The card lands here</div>
          <div className="words">
            <p>{mine
              ? `Draw the top ${deck === 'companion' ? 'Companion' : deck === 'dungeon' ? 'Dungeon' : deck === 'little' ? 'Little Monster' : 'Big Monster'} card.`
              : `${tester?.name ?? 'They'} draws a card.`}</p>
            {mine && onDraw && <button className="ao-btn primary" onClick={onDraw}>Draw a card</button>}
          </div>
        </div>
      </section>
    );
  }
  if (p.kind === 'roll' && p.payload['rollKind'] === 'test') {
    const cardId = asStr(p.payload['cardId']);
    const n = asNum(p.payload['diceCount']);
    const stat = p.payload['test'] === 'recruit' ? 'Charisma' : 'Strength';
    return (
      <section className="ao-panel ao-test" aria-label="The test">
        <header><Icon name={p.payload['dungeon'] ? 'dungeon' : p.payload['test'] === 'recruit' ? 'city' : p.payload['test'] === 'big' ? 'big' : 'little'} size={40} /><h3>{p.payload['dungeon'] ? `Dungeon · ${dungeonCard ?? ''}` : `Beat ${asNum(p.payload['number'])}`}</h3></header>
        <div className="body">
          <DrawnCard view={view} cardId={cardId} from={`ao:deck:${DECK_OF[asStr(p.payload['test'])] ?? 'companion'}`} />
          <div className="words">
            <p>{mine ? `Roll ${n} ${n === 1 ? 'die' : 'dice'} (your ${stat}). You need ${asNum(p.payload['number'])} or more.` : `${tester?.name ?? 'They'} rolls ${n} ${n === 1 ? 'die' : 'dice'} and needs ${asNum(p.payload['number'])}.`}</p>
            {mine && onDraw && <button className="ao-btn primary" onClick={onDraw}>Roll {n} {n === 1 ? 'die' : 'dice'}</button>}
          </div>
        </div>
      </section>
    );
  }
  return null;
}

function MiniTile({ view, tileId, icons, centre }: { view: Record<string, unknown>; tileId: number; icons: Array<{ hex: string; kind: string }>; centre: string }) {
  // The tile at a small size: the centre and its six neighbours, the icons where this turn puts them.
  const c = hexOf(centre);
  const at = (key: string) => { const h = hexOf(key); return h && c ? { q: h.q - c.q, r: h.r - c.r } : null; };
  const offs = [[0, 0], [0, -1], [1, -1], [1, 0], [0, 1], [-1, 1], [-1, 0]];
  const S = 19;
  void view;
  return (
    <div className="ao-mini-tile" aria-hidden="true">
      {offs.map(([q, r]) => {
        const icon = icons.find((i) => { const o = at(i.hex); return o && o.q === q && o.r === r; });
        return (
          <span key={`${q},${r}`} style={{ left: 52 + 1.5 * S * q! - S, top: 52 + Math.sqrt(3) * S * (r! + q! / 2) - (Math.sqrt(3) / 2) * S }}>
            <b style={{ background: LAND[tileId - 1] ?? '#c8e6a0' }}>{icon && <Icon name={ICON[icon.kind]?.art ?? icon.kind} size={24} />}</b>
          </span>
        );
      })}
    </div>
  );
}

function ExplorePanel({ view, input, pick, setPick, onMove, onDraw, mine }: {
  view: Record<string, unknown>; input: GlueInput; pick: { slot: string; rotation: number } | null;
  setPick: (p: { slot: string; rotation: number } | null) => void; onMove: (m: LegalMove) => void; onDraw?: () => void; mine: boolean;
}): ReactNode {
  const p = pendingOf(view);
  if (!p || !mine) return null;
  if (p.kind === 'draw' && asStr(p.payload['deck']) === 'tile') {
    return (
      <section className="ao-panel ao-explore" aria-label="Exploring">
        <header><div className="ao-tilestack small"><span /><span /><span className="top">?</span></div>
          <div><h3>{p.payload['context'] === 'forced' ? 'Every icon is done' : 'Map card'}</h3>
            <p>{p.payload['context'] === 'forced' ? 'Explore first: turn over the top tile, place it in any empty slot touching the map, then take your turn.' : 'Turn over the top tile and place it in any empty slot touching the map.'}</p></div></header>
        {onDraw && <div className="actions"><button className="ao-btn primary" onClick={onDraw}>Turn over a tile</button></div>}
      </section>
    );
  }
  if (p.kind !== 'explore_place') return null;
  const place = placementOf(view);
  if (!place) return null;
  const slot = place.slots.find((s) => s.slot === pick?.slot) ?? null;
  const shown = slot ?? place.slots[0];
  const turn = shown?.rotations.find((r) => r.rotation === (slot ? pick!.rotation : 0));
  const placing = slot ? placeMove(input, slot.slot, pick!.rotation) : null;
  return (
    <section className="ao-panel ao-explore" aria-label="Exploring">
      <header>
        {shown && turn && <MiniTile view={view} tileId={place.tileId} icons={turn.icons} centre={shown.slot} />}
        <div><h3>Exploring · tile {place.tileId}</h3>
          <p>{slot ? 'Turn it any of 6 ways, then place it. Your coin goes on its centre.' : place.context === 'ordinary' ? 'Pick one of the glowing slots next to you.' : 'Pick any glowing slot touching the map.'}</p></div>
      </header>
      {slot && (
        <div className="actions">
          <button className="ao-btn" onClick={() => setPick({ slot: slot.slot, rotation: (pick!.rotation + 1) % 6 })}>⟲ Turn left</button>
          <button className="ao-btn" onClick={() => setPick({ slot: slot.slot, rotation: (pick!.rotation + 5) % 6 })}>Turn right ⟳</button>
          {placing && <button className="ao-btn primary push" onClick={() => onMove(placing)}>Place tile</button>}
        </div>
      )}
    </section>
  );
}

function RunePanel({ view, input, all, mine, onMove }: { view: Record<string, unknown>; input: GlueInput; all: Player[]; mine: boolean; onMove: (m: LegalMove) => void }): ReactNode {
  const p = pendingOf(view);
  if (!p || p.kind !== 'take_artifact' || !mine) return null;
  const takes = input.legalMoves.filter((m) => typeOf(m) === 'take_artifact');
  const decline = find(input.legalMoves, (m) => typeOf(m) === 'decline_artifact');
  return (
    <section className="ao-panel ao-runes-panel" aria-label="Any rune">
      <header><Icon name="dungeon" size={40} /><div><h3>Any rune</h3><p>Take one suit rune from the supply or from another player, or say no and draw another Dungeon card.</p></div></header>
      <div className="options">
        {takes.map((m) => {
          const a = asStr(m.move['artifact']);
          const from = asStr(m.move['from']);
          const h = all.find((x) => x.id === from);
          return (
            <button key={`${a}:${from}`} className="ao-option" onClick={() => onMove(m)}>
              <Icon name={a} size={30} /><b>{ICON[a]?.name ?? a}</b>
              <span className="from">{h ? <><span className="dot" style={{ background: tint(h.colour) }} />from {h.name}</> : 'from the supply'}</span>
            </button>
          );
        })}
      </div>
      {decline && <div className="actions"><button className="ao-btn" onClick={() => onMove(decline)}>No thanks, draw again</button></div>}
    </section>
  );
}

function OrderPanel({ view, all, mine, onDraw }: { view: Record<string, unknown>; all: Player[]; mine: boolean; onDraw?: () => void }): ReactNode {
  const p = pendingOf(view);
  if (!p || p.kind !== 'roll' || p.payload['rollKind'] !== 'turn_order') return null;
  const rolls = isObj(view['turnOrderRolls']) ? view['turnOrderRolls'] : {};
  const totals = isObj(rolls['totals']) ? rolls['totals'] : {};
  const reRolls = isObj(rolls['reRolls']) ? rolls['reRolls'] : {};
  const tied = asArr(rolls['tiedGroup']).map((x) => asStr(x));
  const who = all.find((x) => x.id === p.seat);
  return (
    <section className="ao-panel ao-order" aria-label="Who goes first">
      <h3>{asNum(view['round']) > 0 ? `Round ${asNum(view['round'])} · who goes first?` : 'Who goes first?'}</h3>
      <p className="muted">Everyone rolls 2 dice. Highest total goes first. Ties roll again.</p>
      <div className="rows">
        {all.map((pl) => (
          <div key={pl.id} className={`row${pl.id === p.seat ? ' now' : ''}`}>
            <Icon name={adventurerOf(all, pl.id).toLowerCase()} size={40} tint={tint(pl.colour)} />
            <span className="name">{pl.name}</span>
            <span className="note">{tied.includes(pl.id) ? 'tied · rolls again' : ''}</span>
            <span className="total">{asNum(reRolls[pl.id], asNum(totals[pl.id], 0)) || '–'}</span>
          </div>
        ))}
      </div>
      {mine && onDraw ? <button className="ao-btn primary" onClick={onDraw}>Roll 2 dice</button> : <p className="muted">{who?.name ?? 'They'} rolls next.</p>}
    </section>
  );
}

function SetupPanel({ input, onForm }: { input: GlueInput; onForm: GameScreenProps['onForm'] }): ReactNode {
  const moves = input.legalMoves.filter((m) => typeOf(m) === 'setup_standee');
  const [standee, setStandee] = useState<string | null>(null);
  const [colour, setColour] = useState<string | null>(null);
  if (moves.length === 0) return null;
  const template = colour ? moves.find((m) => asStr(m.move['colour']) === colour) ?? moves[0]! : moves[0]!;
  return (
    <section className="ao-panel ao-order" aria-label="Pick your adventurer">
      <h3>Pick your adventurer and colour</h3>
      <p className="muted">Any adventurer can take any colour. Your coins are your colour.</p>
      <div className="ao-picks" role="radiogroup" aria-label="Your adventurer">
        {ADVENTURERS.map((a) => (
          <button key={a} role="radio" aria-checked={standee === a} className={`ao-pick${standee === a ? ' on' : ''}`} onClick={() => setStandee(a)}>
            <Icon name={a.toLowerCase()} size={44} tint={colour ? tint(colour) : undefined} />{a}
          </button>
        ))}
      </div>
      <div className="ao-picks" role="radiogroup" aria-label="Your colour">
        {moves.map((m) => {
          const c = asStr(m.move['colour']);
          return <button key={c} role="radio" aria-checked={colour === c} className={`ao-pick${colour === c ? ' on' : ''}`} onClick={() => setColour(c)}><span className="swatch" style={{ background: tint(c) }} />{c}</button>;
        })}
      </div>
      <button className="ao-btn primary" disabled={!standee || !colour} onClick={() => standee && colour && onForm(template, { ...template.move, standee, colour }, ['standee', 'colour'])}>Take my seat</button>
    </section>
  );
}

// ---- your board --------------------------------------------------------------------------

function YourBoard({ view, input, me, all, pressable, onMove, menu }: {
  view: Record<string, unknown>; input: GlueInput; me: Player; all: Player[]; pressable: boolean;
  onMove: (m: LegalMove) => void; menu?: ReactNode;
}) {
  const p = pendingOf(view);
  const myTurn = p?.seat === me.id;
  const bonus = (k: keyof typeof STAT) => me.companions.reduce((n, c) => n + (refCards(view, 'companions').find((x) => x.id === c)?.bonus[k] ?? 0), 0);
  const rd = isObj(view['referenceData']) ? view['referenceData'] : {};
  const perColour = asNum(rd['tokensPerColour'], 0);
  const raw = asArr(view['players']).find((x) => isObj(x) && x['player_id'] === me.id);
  const left = isObj(raw) && typeof raw['tokensLeft'] === 'number' ? raw['tokensLeft'] : null;
  const explore = find(input.legalMoves, (m) => typeOf(m) === 'explore' && m.move['slot'] === undefined);
  const stop = find(input.legalMoves, (m) => typeOf(m) === 'stop');
  const stay = find(input.legalMoves, (m) => typeOf(m) === 'try_again');
  const exploreWhy = input.unavailable?.find((u) => u.moveType === 'explore')?.reason;
  const moving = myTurn && (p?.kind === 'move' || p?.kind === 'try_again');
  const movement = me.stats?.movement ?? 0;
  const hint = !myTurn ? 'Watching the others. Change the speed or replay a move at the top of the map.'
    : p?.kind === 'try_again' ? 'You failed here last turn: stay and try again with a fresh card, walk away (tap a glowing hex), or explore.'
    : p?.kind === 'move' ? (explore ? 'You are next to an empty slot. Explore now, or keep walking. Exploring ends your turn.' : me.stepsLeft > 0 ? 'Tap a glowing hex to step. A glowing icon starts the moment you step on it, and ends your turn.' : 'No steps left. End your turn.')
    : 'Finish what is on the map first.';
  const little = me.little, big = me.big;
  return (
    <section className="ao-board" aria-label="Your board">
      <div className="ao-me">
        <div className="head">
          <Icon name={adventurerOf(all, me.id).toLowerCase()} size={42} tint={tint(me.colour)} />
          <div><div className="who">You · {adventurerOf(all, me.id)}</div><div className="muted small">{me.colour}</div></div>
          <span className="ao-qp" title="Quest points"><Icon name="quest" size={22} />{me.questPoints}</span>
        </div>
        {me.stats && (Object.keys(STAT) as Array<keyof typeof STAT>).map((k) => (
          <div key={k} className="ao-stat" style={{ background: STAT[k].bg }}>
            <Icon name={STAT[k].icon} size={26} /><span className="name">{STAT[k].name}</span>
            <span className="note">{bonus(k) ? `+${bonus(k)} from friends` : 'to start'}</span><b>{me.stats![k]}</b>
          </div>
        ))}
      </div>
      <div className="ao-holdings">
        <div className="group"><div className="label">Companions {me.companions.length}</div>
          <div className="cards">{me.companions.length ? me.companions.map((c, i) => <MiniCard key={c} view={view} cardId={c} tilt={((i * 7) % 5) - 2} />) : <div className="ao-empty">None yet</div>}</div></div>
        <div className="group"><div className="label">Monsters beaten</div>
          <div className="cards">
            {([['Little', little], ['Big', big]] as const).map(([name, list]) => (
              <div key={name} className="ao-stack">
                <div className="pile">{list.length > 1 && <span className="under" />}{list.length ? <MiniCard view={view} cardId={list[list.length - 1]!} /> : <div className="ao-empty">None yet</div>}</div>
                <div className="caption">{name} <b>{list.length}</b></div>
              </div>
            ))}
          </div></div>
        <div className="group"><div className="label">Runes {me.artifacts.length}</div>
          <div className="cards">{me.artifacts.length ? me.artifacts.map((a) => (
            <div key={a} className="ao-rune-card" data-flip-id={`ao:rune:${a}`}><Icon name={a} size={46} /><span>{ICON[a]?.name ?? a}</span></div>
          )) : <div className="ao-empty">None yet</div>}</div></div>
        <div className="group push">
          {left !== null && perColour > 0 && <>
            <div className="label">Coins left {left} of {perColour}</div>
            <div className="ao-coins">{Array.from({ length: perColour }, (_, i) => (
              <span key={i}>{i < left ? <Icon name="coin" size={20} tint={tint(me.colour)} /> : <i />}</span>
            ))}</div>
          </>}
          <div className="muted small">Tiles explored <b>{me.exploredTiles.length}</b><br />Dungeons done <b>{me.dungeonsCompleted}</b></div>
        </div>
      </div>
      <div className="ao-turn">
        <div className="steps"><Icon name="mov" size={26} /><span>Steps</span>
          <span className="pips">{Array.from({ length: movement }, (_, i) => <i key={i} className={moving && i < me.stepsLeft ? 'on' : ''} />)}</span>
          <span className="muted">{moving ? `${me.stepsLeft} of ${movement}` : ''}</span></div>
        <div className="hint">{hint}</div>
        <div className={`buttons${stay ? ' two' : ''}`}>
          {stay && <button className="ao-btn" disabled={!pressable} onClick={() => onMove(stay)}>Stay and try again</button>}
          <button className="ao-btn" disabled={!pressable || !explore} title={explore ? undefined : exploreWhy} onClick={() => explore && onMove(explore)}>{stay ? 'Explore' : 'Explore · turn over a tile'}</button>
          <button className="ao-btn primary" disabled={!pressable || !stop} onClick={() => stop && onMove(stop)}>{p?.kind === 'try_again' ? 'Do nothing this turn' : 'End turn'}</button>
        </div>
        {menu}
      </div>
    </section>
  );
}

// ---- the side column ------------------------------------------------------------------------------

function Side({ view, all, me, nameOf, caption, isAI }: {
  view: Record<string, unknown>; all: Player[]; me: string | null; nameOf: (p: Player) => string;
  caption?: ReactNode; isAI: (pid: string) => boolean;
}) {
  const rolls = isObj(view['turnOrderRolls']) && isObj(view['turnOrderRolls']['totals']) ? view['turnOrderRolls']['totals'] : {};
  const order = [...all].sort((a, b) => (a.initiative || 99) - (b.initiative || 99));
  const active = asStr(view['activeSeat']);
  const quests = questNames(view);
  const inPlay = isObj(view['inPlayQuests']) ? view['inPlayQuests'] : {};
  const counts: Record<string, (p: Player) => number> = {
    most_little_monsters: (p) => p.little.length, most_big_monsters: (p) => p.big.length, most_artifacts: (p) => p.artifacts.length,
  };
  const icons = isObj(view['map']) ? asArr(view['map']['icons']).filter(isObj) : [];
  // What a seat is standing on, when it is an icon still open ("on the City").
  const standingOn = (p: Player) => {
    const icon = icons.find((i) => asStr(i['key']) === p.hex && i['completed'] !== true);
    return icon ? `on the ${ICON[asStr(icon['kind'])]?.name ?? 'icon'}` : null;
  };
  // The quests with what it takes and how far each seat has got, from the engine.
  const listed = asArr(view['quests']).filter(isObj);
  return (
    <div className="ao-side">
      {caption && <div className="ao-side-caption">{caption}</div>}
      <div className="ao-side-block">
        <div className="label">Turn order</div>
        <div className="ao-order-strip">
          {order.map((p, i) => (
            <div key={p.id} className={`chip${p.id === active ? ' now' : ''}${p.id === me ? ' you' : ''}`}>
              <span className="place" style={{ background: tint(p.colour) }}>{p.initiative || i + 1}</span>
              <span className="name">{p.id === me ? 'You' : nameOf(p)}</span>
              <span className="roll">{asNum(rolls[p.id], 0) || ''}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="ao-side-block">
        {order.filter((p) => p.id !== me).map((p) => (
          <div key={p.id} className={`ao-seat${p.id === active ? ' now' : ''}`}>
            <Icon name={adventurerOf(all, p.id).toLowerCase()} size={50} tint={tint(p.colour)} />
            <div className="body">
              <div className="top"><b>{nameOf(p)}</b>{isAI(p.id) && <span className="ai">AI</span>}<span className="status">{standingOn(p) ?? adventurerOf(all, p.id)}</span>
                <span className="qp" title="Quest points"><Icon name="quest" size={20} />{p.questPoints}</span></div>
              <div className="line">
                {p.stats && (Object.keys(STAT) as Array<keyof typeof STAT>).map((k) => <span key={k} title={STAT[k].name} className="stat"><Icon name={STAT[k].icon} size={18} />{p.stats![k]}</span>)}
                <span className="sep" />
                <span className="counts">Friends {p.companions.length} · Monsters {p.little.length + p.big.length} · Tiles {p.exploredTiles.length}{p.tokensLeft !== null ? ` · Coins ${p.tokensLeft}` : ''}</span>
                <span className="arts">{p.artifacts.map((a) => <Icon key={a} name={a} size={20} title={ICON[a]?.name} />)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="ao-side-block">
        <div className="label">Quests in play · {Object.keys(inPlay).length}</div>
        {listed.length > 0 && listed.map((q) => {
          const kind = asStr(q['kind']);
          const target = typeof q['target'] === 'number' ? q['target'] : null;
          const holder = all.find((p) => p.id === asStr(q['claimedBy']));
          const progress = isObj(q['progress']) ? q['progress'] : {};
          const n = all.map((p) => ({ p, v: asNum(progress[p.id]) }));
          const best = Math.max(0, ...n.map((x) => x.v));
          const top = n.filter((x) => x.v === best);
          let sub = q['endGame'] === true ? 'End of game · a tie scores nothing' : 'First to do it';
          let tag: ReactNode;
          let tagClass = '';
          if (holder) { tag = <><span className="dot" style={{ background: tint(holder.colour) }} />{holder.id === me ? 'You' : nameOf(holder)}</>; tagClass = 'claimed'; sub += ' · claimed'; }
          else if (q['endGame'] === true) {
            if (best === 0) tag = 'Nobody yet';
            else if (top.length > 1) tag = `Tied at ${best}`;
            else { const l = top[0]!.p; tag = <><span className="dot" style={{ background: tint(l.colour) }} />{l.id === me ? `You lead, ${best}` : `${nameOf(l)} leads, ${best}`}</>; tagClass = 'lead'; }
          } else {
            tag = target !== null ? `${best} of ${target}` : String(best);
            if (best > 0) sub += ` · closest: ${top.map((x) => (x.p.id === me ? 'You' : nameOf(x.p))).join(', ')}`;
          }
          return (
            <div key={kind} className="ao-quest">
              <Icon name="quest" size={30} />
              <div className="words"><b>{asStr(q['name'], kind)}</b><span>{sub}</span></div>
              <span className={`tag ${tagClass}`}>{tag}</span>
            </div>
          );
        })}
        {listed.length === 0 && Object.entries(inPlay).map(([kind, who]) => {
          const q = quests[kind];
          const holder = all.find((p) => p.id === who);
          let tag: ReactNode = 'Open';
          let tagClass = '';
          if (holder) { tag = <><span className="dot" style={{ background: tint(holder.colour) }} />{holder.id === me ? 'You' : nameOf(holder)}</>; tagClass = 'claimed'; }
          else if (counts[kind]) {
            const n = all.map((p) => ({ p, v: counts[kind]!(p) }));
            const best = Math.max(...n.map((x) => x.v));
            const top = n.filter((x) => x.v === best);
            if (best === 0) tag = 'Nobody yet';
            else if (top.length > 1) tag = `Tied at ${best}`;
            else { const l = top[0]!.p; tag = <><span className="dot" style={{ background: tint(l.colour) }} />{l.id === me ? `You lead, ${best}` : `${nameOf(l)} leads, ${best}`}</>; tagClass = 'lead'; }
          }
          return (
            <div key={kind} className="ao-quest">
              <Icon name="quest" size={30} />
              <div className="words"><b>{q?.name ?? kind}</b><span>{q?.endGame ? 'End of game · a tie scores nothing' : 'First to do it'}</span></div>
              <span className={`tag ${tagClass}`}>{tag}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---- the screen ----------------------------------------------------------------------------------

export function AoScreen(props: GameScreenProps) {
  const { input, yourTurn, busy, interactive, onMove, onForm, onDraw, nameFor, menu, sideSlot, caption } = props;
  const [pick, setPick] = useState<{ slot: string; rotation: number } | null>(null);
  const [zoom, setZoom] = useState(0);
  // A new event drops a choice being put together: its moves may be gone.
  useEffect(() => { setPick(null); }, [input.seq]);
  // How a test went shows for a beat after the roll, then closes by itself.
  const [showResult, setShowResult] = useState(true);
  useEffect(() => {
    setShowResult(true);
    const t = setTimeout(() => setShowResult(false), RESULT_MS);
    return () => clearTimeout(t);
  }, [input.seq]);
  const view = isObj(input.view) ? input.view : null;
  const all = useMemo(() => (view ? players(view) : []), [view]);
  const pressable = interactive && yourTurn && !busy;
  const withPick: GlueInput = useMemo(() => ({ ...input, ui: pick ? { slot: pick.slot, rotation: pick.rotation } : {} }), [input, pick]);
  const lit = useMemo(() => (pressable ? litFor(input) : []), [input, pressable]);
  if (!view || !isObj(view['map'])) return null;
  const me = all.find((p) => p.id === input.playerId) ?? null;
  const p = pendingOf(view);
  const mine = !!me && p?.seat === me.id && pressable;
  // Engine names an unnamed AI by its seat id; the table's seat name is better when it has one.
  // An AI seat goes by its colour, as the canvas names it; a person by their seat name.
  const nameOf = (pl: Player) => { const n = nameFor(pl.id); return n && n !== pl.id && !/^AI\b/.test(n) ? n : pl.name; };
  const named = all.map((pl) => ({ ...pl, name: pl.id === me?.id ? 'You' : nameOf(pl) }));

  const onSelect = (sel: SelectEvent) => {
    if (!pressable) return;
    const slot = slotForTap(sel.id, view);
    if (slot) { if (pick?.slot !== slot) setPick({ slot, rotation: 0 }); return; }
    const moves = movesForHex(sel.id, input);
    if (moves.length === 1) onMove(moves[0]!);
  };
  const nodes = mapNodes(view, withPick, all);
  const isAI = (pid: string) => props.seatKind?.(pid) === 'ai';
  const side = <Side view={view} all={named} me={me?.id ?? null} nameOf={nameOf} caption={caption} isAI={isAI} />;
  const panel = (
    <>
      <TestPanel view={view} previous={input.previous} all={named} mine={mine} meId={me?.id ?? null} onDraw={onDraw} showResult={showResult} />
      <ExplorePanel view={view} input={input} pick={pick} setPick={setPick} onMove={onMove} onDraw={onDraw} mine={mine} />
      <RunePanel view={view} input={input} all={named} mine={mine} onMove={onMove} />
    </>
  );
  const centre = p?.kind === 'roll' && p.payload['rollKind'] === 'turn_order'
    ? <OrderPanel view={view} all={named} mine={mine} onDraw={onDraw} />
    : mine && p?.kind === 'setup_standee_colour' ? <SetupPanel input={input} onForm={onForm} /> : null;

  return (
    <div className="ao-screen">
      <DeckStrip view={view} all={named} />
      <div className="ao-map">
        <MapPart id="ao:map" data={{ hex: { orientation: 'flat', maxRadius: 34, zoom: ZOOMS[zoom], drawn: true }, fill: { minHeight: 200 }, nodes }} lit={lit} onSelect={onSelect} className="ao-map-board" />
        <div className="ao-legend" aria-label="What the icons are">
          {LEGEND.map(([icon, name]) => <div key={icon}><Icon name={icon} size={24} />{name}</div>)}
        </div>
        <div className="ao-zoom">
          <button aria-label="Zoom in" disabled={zoom >= ZOOMS.length - 1} onClick={() => setZoom((z) => Math.min(ZOOMS.length - 1, z + 1))}>+</button>
          <button aria-label="Zoom out" disabled={zoom === 0} onClick={() => setZoom((z) => Math.max(0, z - 1))}>−</button>
          <button className="fit" onClick={() => setZoom(0)}>Fit</button>
        </div>
        <div className="ao-panels">{panel}</div>
        {centre && <div className="ao-centre">{centre}</div>}
      </div>
      {me && <YourBoard view={view} input={input} me={me} all={named} pressable={pressable} onMove={onMove} menu={menu} />}
      {sideSlot ? createPortal(side, sideSlot) : <div className="ao-side-inline">{side}</div>}
    </div>
  );
}
