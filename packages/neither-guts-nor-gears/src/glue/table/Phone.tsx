// The parts only the phone draws (the Phone-* boards): the one-row peek at
// every seat's culture, the seats sheet it raises, and a seat's faction board
// as a full panel in tabs. None of it is a rule or a move: every number is
// the view's, and the private lines (the hand, the spy) print only on the
// viewing seat's own row, as its faction board does.

import { useEffect, useLayoutEffect, useState, type RefObject } from 'react';
import type { ScreenCtx } from './ctx.js';
import { inkOf, inkOfSeat } from './factions.js';
import { BOARD_TABS, FactionBoard, type BoardTab } from './FactionBoard.js';
import { econOf, type NggPlayer } from './read.js';
import { cultureRaceOf, economicCollectorsFor } from './ref.js';
import { FactionChip, Icon } from './ui.js';

/** Close on Escape, while something is open. */
function useEscape(onClose: () => void): void {
  useEffect(() => {
    const close = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [onClose]);
}

/** Where the table's own top bar ends, so a full panel starts under it and
 *  the bar still says whose turn it is (Phone-Faction). Zero with no bar. */
function useUnderTopbar(inside: RefObject<HTMLElement | null>): number {
  const [top, setTop] = useState(0);
  useLayoutEffect(() => {
    const bar = inside.current?.closest('.table-shell')?.querySelector('.table-topbar');
    if (!bar) return;
    const measure = () => setTop(Math.max(0, Math.round(bar.getBoundingClientRect().bottom)));
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [inside]);
  return top;
}

function Close({ label, onClose }: { label: string; onClose: () => void }) {
  return (
    <button type="button" data-view-only className="ngg-phone-close" aria-label={label} onClick={onClose}>
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
    </button>
  );
}

/** The viewing seat first, then the others in seat order. */
function youFirst(ctx: ScreenCtx): NggPlayer[] {
  return [...ctx.v.players.filter((p) => p.id === ctx.me), ...ctx.v.players.filter((p) => p.id !== ctx.me)];
}

/**
 * The seats in one row (Phone-Table): a dot and the culture for each, the
 * viewer's first. The whole row is one button that raises the seats sheet.
 * Each dot is that seat's supply, where its new pieces fly from.
 */
export function PeekRow({ ctx, open, onOpen }: { ctx: ScreenCtx; open: boolean; onOpen: () => void }) {
  const { v } = ctx;
  return (
    <button type="button" data-view-only className="ngg-peek" aria-label="Seats and culture: open" aria-expanded={open} onClick={onOpen}>
      {youFirst(ctx).map((p) => {
        const you = p.id === ctx.me;
        const deciding = v.pending ? v.pending.for === p.id : v.activePlayerId === p.id;
        return (
          <span key={p.id} className={`ngg-peek-seat${you ? ' you' : ''}${deciding ? ' deciding' : ''}`} title={`${ctx.seat(p.id)} · ${p.culture} culture`}>
            <span className="ngg-dot" data-flip-id={`ngg-supply:${p.id}`} style={{ background: inkOf(p.faction).fill }} />
            <b>{p.culture}</b>
          </span>
        );
      })}
      <span className="ngg-peek-hint">SEATS</span>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="m7 14 5-5 5 5" /></svg>
    </button>
  );
}

/** The culture race on one rail (Phone-Seats): a marker a seat, a tick at
 *  each hero flag and at the number that wins. */
function CultureRail({ ctx }: { ctx: ScreenCtx }) {
  const { v, ref } = ctx;
  const { target, milestones } = cultureRaceOf(ref, v.players.length, v.players.find((p) => p.cultureTarget !== null)?.cultureTarget ?? null);
  const pct = (n: number) => `${Math.max(0, Math.min(100, (n / target) * 100))}%`;
  const ticks = [...new Set([0, ...milestones, target])];
  return (
    <div className="ngg-rail" role="img" aria-label={`Culture, 0 to ${target}: ${v.players.map((p) => `${ctx.seat(p.id)} ${p.culture}`).join(', ')}`}>
      <span className="ngg-rail-line" />
      {ticks.map((t) => <span key={t} className="ngg-rail-tick" style={{ left: pct(t) }}>{t}</span>)}
      {[...v.players].sort((a, b) => a.culture - b.culture).map((p) => (
        <span key={p.id} className={`ngg-rail-mark${p.id === ctx.me ? ' you' : ''}`} style={{ left: pct(p.culture), background: inkOf(p.faction).fill }} />
      ))}
      <span className="ngg-rail-cap">{target} wins · a hero at each flag</span>
    </div>
  );
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * The seats sheet (Phone-Seats): the culture rail, then a card a seat, the
 * leader in culture first. A card opens that seat's faction board. Your own
 * card prints what you hold; the others print only the backs and the count,
 * and for a spy only that one is out, never which hero carries it.
 */
export function PhoneSeats({ ctx, onClose, onBoard, onHeroes, onTreaties }: {
  ctx: ScreenCtx;
  onClose: () => void;
  onBoard: (playerId: string) => void;
  onHeroes: () => void;
  onTreaties: () => void;
}) {
  const { v } = ctx;
  useEscape(onClose);
  const need = economicCollectorsFor(ctx.ref, v.layout);
  const seats = [...v.players].sort((a, b) => b.culture - a.culture);
  return (
    <>
      <div className="ngg-phone-scrim" role="presentation" onClick={onClose} />
      <section className="ngg-phone-seats ngg-side" role="dialog" aria-label="Seats and culture">
        <span className="ngg-phone-grip" aria-hidden="true" />
        <div className="ngg-phone-seats-head">
          <h2>Seats</h2>
          <Close label="Close the seats sheet" onClose={onClose} />
        </div>
        <CultureRail ctx={ctx} />
        <ul className="ngg-phone-seat-list">
          {seats.map((p) => {
            const you = p.id === ctx.me;
            const deciding = v.pending ? v.pending.for === p.id : v.activePlayerId === p.id;
            const econ = econOf(p);
            const treaties = v.treaties.filter((t) => t.partners.includes(p.id));
            const spy = you ? v.spies.find((s) => s.active) ?? null : null;
            const heroes = p.heroes.filter((h) => !h.dead).length;
            const facts = [
              `${p.tech.total}${p.tech.target !== null ? ` of ${p.tech.target}` : ''} techs`,
              plural(p.bases.length, 'base'),
              plural(heroes, 'hero', 'heroes'),
            ];
            const race = [
              econ ? `${econ.owned}${need ? `/${need}` : ''} collectors` : null,
              `${p.leaderKills}${p.militaryKillsNeeded ? `/${p.militaryKillsNeeded}` : ''} Leader kills`,
              p.leaderAlive ? 'Leader alive' : 'Leader killed',
            ].filter(Boolean);
            const spyLine = you
              ? spy ? `${spy.source} · ${spy.hero}` : (p.unrevealedSpies ?? 0) > 0 ? 'spy out' : 'no spy'
              : p.unrevealedSpies === null ? '' : p.unrevealedSpies > 0 ? 'spy out · hero face down' : 'no spy';
            return (
              <li key={p.id}>
                <button type="button" data-view-only className={`ngg-phone-seat${you ? ' you' : ''}${deciding ? ' deciding' : ''}`}
                  onClick={() => onBoard(p.id)} aria-label={`Open ${you ? 'your' : `${ctx.seat(p.id)}'s`} faction board`}>
                  <span className="ngg-phone-seat-top">
                    <FactionChip faction={p.faction} size={24} />
                    <b className="ngg-phone-seat-name">{ctx.seat(p.id)}</b>
                    {you && <i className="ngg-phone-tag">you</i>}
                    {v.firstPlayerId === p.id && <i className="ngg-phone-tag quiet">first player</i>}
                    <b className="ngg-phone-seat-culture">{p.culture}</b>
                  </span>
                  <span className="ngg-phone-seat-read">{facts.join(' · ')}</span>
                  <span className="ngg-phone-seat-read">{race.join(' · ')}</span>
                  <span className="ngg-phone-seat-bottom">
                    {/* A treaty mark is the treaty's own glyph in the partner's colour:
                        the mark says what the treaty is, the colour who it is with. */}
                    {treaties.map((t) => {
                      const partner = t.partners.find((x) => x !== p.id) ?? null;
                      const ink = inkOfSeat(v, partner);
                      return (
                        <span key={`${t.name}:${partner}`} className="ngg-phone-treaty" style={{ background: ink.fill, color: ink.on }}
                          title={`${t.name} with ${ctx.seat(partner)}`} aria-label={`${t.name} with ${ctx.seat(partner)}`}>
                          <Icon name={t.name} size={12} stroke={2.2} />
                        </span>
                      );
                    })}
                    <span className="ngg-phone-seat-cards">
                      {you ? `${plural(p.handCount, 'card')}, tap to read` : p.handCount === 0 ? 'no cards' : `${p.handCount} face down`}
                    </span>
                    <span className="ngg-phone-seat-spy">{spyLine}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="ngg-phone-seats-foot">
          <button type="button" data-view-only className="ngg-btn quiet" onClick={onHeroes}>Heroes</button>
          <button type="button" data-view-only className="ngg-btn quiet" onClick={onTreaties}>
            Treaties{v.treaties.length > 0 ? ` (${v.treaties.length})` : ''}
          </button>
        </div>
      </section>
    </>
  );
}

/**
 * A seat's faction board on a phone (Phone-Faction): the one thing that wants
 * the whole screen, so it takes it, under the table's top bar, in four tabs.
 * It is the same board the desktop opens, a part at a time.
 */
export function PhoneFaction({ ctx, player, anchor, onClose }: {
  ctx: ScreenCtx;
  player: NggPlayer;
  /** an element of the table, to find the top bar this panel starts under */
  anchor: RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<BoardTab>('board');
  const top = useUnderTopbar(anchor);
  useEscape(onClose);
  const own = player.id === ctx.me;
  const name = player.faction ?? (own ? 'Your seat' : ctx.seat(player.id));
  return (
    <section className={`ngg-board-sheet ngg-phone-faction seat-${player.species ?? 'wizard'}`} style={{ top }} role="dialog"
      aria-label={own ? 'Your faction board' : `${name}'s faction board`}>
      <header className="ngg-phone-faction-head">
        <FactionChip faction={player.faction} size={30} />
        <h2>{name}</h2>
        <span className="ngg-phone-faction-culture"><i>culture</i><b>{player.culture}</b></span>
        <Close label="Close the faction board" onClose={onClose} />
      </header>
      <div className="ngg-phone-tabs" role="tablist" aria-label="Faction board sections">
        {BOARD_TABS.map((t) => (
          <button key={t.tab} type="button" data-view-only role="tab" aria-selected={tab === t.tab} className={tab === t.tab ? 'on' : ''} onClick={() => setTab(t.tab)}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="ngg-phone-faction-body" role="tabpanel" aria-label={BOARD_TABS.find((t) => t.tab === tab)?.label}>
        <FactionBoard ctx={ctx} player={player} tab={tab} />
      </div>
    </section>
  );
}
